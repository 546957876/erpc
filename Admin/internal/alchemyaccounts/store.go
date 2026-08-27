package alchemyaccounts

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"time"
)

var ErrConflict = errors.New("Alchemy account conflicts with an existing email")

type ImportSummary struct {
	Created  int
	Skipped  int
	Accounts []Account
}

type Store struct {
	db *sql.DB
}

func NewStore(db *sql.DB) *Store {
	return &Store{db: db}
}

func (s *Store) Import(ctx context.Context, records []Record) (ImportSummary, error) {
	result := ImportSummary{Accounts: make([]Account, 0, len(records))}
	if len(records) == 0 {
		return result, nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return result, fmt.Errorf("begin Alchemy account import: %w", err)
	}
	rollback := func(importErr error) (ImportSummary, error) {
		if rollbackErr := tx.Rollback(); rollbackErr != nil && !errors.Is(rollbackErr, sql.ErrTxDone) {
			return result, fmt.Errorf("%w; rollback Alchemy account import: %v", importErr, rollbackErr)
		}
		return result, importErr
	}

	for _, record := range records {
		var existingPayload []byte
		err := tx.QueryRowContext(ctx,
			"SELECT payload FROM alchemy_accounts WHERE lower(email) = lower($1)",
			record.Email,
		).Scan(&existingPayload)
		switch {
		case errors.Is(err, sql.ErrNoRows):
			var account Account
			var createdAt, updatedAt time.Time
			err = tx.QueryRowContext(ctx,
				"INSERT INTO alchemy_accounts (email, name, provider_id, api_key, payload) VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at, updated_at",
				record.Email, record.Name, record.ProviderID, record.APIKey, string(record.Payload),
			).Scan(&account.ID, &createdAt, &updatedAt)
			if err != nil {
				return rollback(fmt.Errorf("insert Alchemy account %q: %w", record.Email, err))
			}
			account.Email = record.Email
			account.Name = record.Name
			account.ProviderID = record.ProviderID
			account.APIKey = record.APIKey
			account.Payload = append(json.RawMessage(nil), record.Payload...)
			account.CreatedAt = formatTime(createdAt)
			account.UpdatedAt = formatTime(updatedAt)
			result.Created++
			result.Accounts = append(result.Accounts, account)
		case err != nil:
			return rollback(fmt.Errorf("check existing Alchemy account %q: %w", record.Email, err))
		case equalJSON(existingPayload, record.Payload):
			result.Skipped++
		default:
			return rollback(fmt.Errorf("Alchemy account email %q already exists with different data: %w", record.Email, ErrConflict))
		}
	}

	if err := tx.Commit(); err != nil {
		return result, fmt.Errorf("commit Alchemy account import: %w", err)
	}
	return result, nil
}

func (s *Store) List(ctx context.Context, limit, offset int) ([]Account, int, error) {
	if limit < 1 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}
	var total int
	if err := s.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM alchemy_accounts").Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count Alchemy accounts: %w", err)
	}
	rows, err := s.db.QueryContext(ctx,
		"SELECT id, email, name, provider_id, api_key, payload, created_at, updated_at FROM alchemy_accounts ORDER BY id DESC LIMIT $1 OFFSET $2",
		limit, offset,
	)
	if err != nil {
		return nil, 0, fmt.Errorf("list Alchemy accounts: %w", err)
	}
	defer rows.Close()
	accounts := make([]Account, 0, limit)
	for rows.Next() {
		account, err := scanAccount(rows)
		if err != nil {
			return nil, 0, fmt.Errorf("scan Alchemy account: %w", err)
		}
		accounts = append(accounts, account)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate Alchemy accounts: %w", err)
	}
	return accounts, total, nil
}

func (s *Store) Get(ctx context.Context, id int64) (Account, error) {
	row := s.db.QueryRowContext(ctx,
		"SELECT id, email, name, provider_id, api_key, payload, created_at, updated_at FROM alchemy_accounts WHERE id = $1",
		id,
	)
	account, err := scanAccount(row)
	if err != nil {
		return Account{}, fmt.Errorf("get Alchemy account %d: %w", id, err)
	}
	return account, nil
}

func (s *Store) Update(ctx context.Context, id int64, record Record) (Account, error) {
	row := s.db.QueryRowContext(ctx,
		"UPDATE alchemy_accounts SET email = $1, name = $2, provider_id = $3, api_key = $4, payload = $5, updated_at = now() WHERE id = $6 RETURNING id, email, name, provider_id, api_key, payload, created_at, updated_at",
		record.Email, record.Name, record.ProviderID, record.APIKey, string(record.Payload), id,
	)
	account, err := scanAccount(row)
	if err != nil {
		return Account{}, fmt.Errorf("update Alchemy account %d: %w", id, err)
	}
	return account, nil
}

func (s *Store) Delete(ctx context.Context, id int64) error {
	result, err := s.db.ExecContext(ctx, "DELETE FROM alchemy_accounts WHERE id = $1", id)
	if err != nil {
		return fmt.Errorf("delete Alchemy account %d: %w", id, err)
	}
	if affected, err := result.RowsAffected(); err != nil {
		return fmt.Errorf("check deleted Alchemy account %d: %w", id, err)
	} else if affected == 0 {
		return sql.ErrNoRows
	}
	return nil
}

type scanner interface {
	Scan(dest ...any) error
}

func scanAccount(row scanner) (Account, error) {
	var account Account
	var payload any
	var createdAt, updatedAt time.Time
	if err := row.Scan(&account.ID, &account.Email, &account.Name, &account.ProviderID, &account.APIKey, &payload, &createdAt, &updatedAt); err != nil {
		return Account{}, err
	}
	account.Payload = payloadBytes(payload)
	account.CreatedAt = formatTime(createdAt)
	account.UpdatedAt = formatTime(updatedAt)
	return account, nil
}

func payloadBytes(value any) json.RawMessage {
	switch typed := value.(type) {
	case []byte:
		return append(json.RawMessage(nil), typed...)
	case string:
		return json.RawMessage(typed)
	case json.RawMessage:
		return append(json.RawMessage(nil), typed...)
	default:
		return nil
	}
}

func equalJSON(left, right []byte) bool {
	var leftValue, rightValue any
	if json.Unmarshal(left, &leftValue) != nil || json.Unmarshal(right, &rightValue) != nil {
		return string(left) == string(right)
	}
	return reflect.DeepEqual(leftValue, rightValue)
}

func formatTime(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.UTC().Format(time.RFC3339Nano)
}
