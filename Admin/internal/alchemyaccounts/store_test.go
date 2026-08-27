package alchemyaccounts

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestStoreImportCreatesAndSkipsIdenticalAccount(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	record := storeRecord("one@example.com", "key-one", `{"checkpoint":{"stage":"completed"}}`)
	createdAt := time.Date(2026, 8, 28, 1, 2, 3, 0, time.UTC)
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT payload FROM alchemy_accounts WHERE lower(email) = lower($1)")).
		WithArgs(record.Email).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("INSERT INTO alchemy_accounts (email, name, provider_id, api_key, payload) VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at, updated_at")).
		WithArgs(record.Email, record.Name, record.ProviderID, record.APIKey, string(record.Payload)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "created_at", "updated_at"}).AddRow(int64(7), createdAt, createdAt))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT payload FROM alchemy_accounts WHERE lower(email) = lower($1)")).
		WithArgs(record.Email).
		WillReturnRows(sqlmock.NewRows([]string{"payload"}).AddRow(string(record.Payload)))
	mock.ExpectCommit()

	store := NewStore(db)
	result, err := store.Import(context.Background(), []Record{record, record})
	if err != nil {
		t.Fatal(err)
	}
	if result.Created != 1 || result.Skipped != 1 || len(result.Accounts) != 1 {
		t.Fatalf("result = %#v", result)
	}
	if result.Accounts[0].ID != 7 || result.Accounts[0].Email != record.Email {
		t.Fatalf("account = %#v", result.Accounts[0])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestStoreImportRollsBackOnConflictingEmail(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	first := storeRecord("one@example.com", "key-one", `{}`)
	conflict := storeRecord("ONE@example.com", "different-key", `{}`)
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT payload FROM alchemy_accounts WHERE lower(email) = lower($1)")).
		WithArgs(first.Email).
		WillReturnRows(sqlmock.NewRows([]string{"payload"}).AddRow(string(first.Payload)))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT payload FROM alchemy_accounts WHERE lower(email) = lower($1)")).
		WithArgs(conflict.Email).
		WillReturnRows(sqlmock.NewRows([]string{"payload"}).AddRow(`{"email":"one@example.com","api_key":"old-key"}`))
	mock.ExpectRollback()

	_, err = NewStore(db).Import(context.Background(), []Record{first, conflict})
	if err == nil || !errors.Is(err, ErrConflict) {
		t.Fatalf("error = %v, want ErrConflict", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestStoreCRUD(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := NewStore(db)
	record := storeRecord("one@example.com", "key-one", `{"future":true}`)
	createdAt := time.Date(2026, 8, 28, 1, 2, 3, 0, time.UTC)

	mock.ExpectQuery(regexp.QuoteMeta("SELECT COUNT(*) FROM alchemy_accounts")).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT id, email, name, provider_id, api_key, payload, created_at, updated_at FROM alchemy_accounts ORDER BY id DESC LIMIT $1 OFFSET $2")).
		WithArgs(20, 0).
		WillReturnRows(sqlmock.NewRows([]string{"id", "email", "name", "provider_id", "api_key", "payload", "created_at", "updated_at"}).AddRow(int64(7), record.Email, record.Name, record.ProviderID, record.APIKey, string(record.Payload), createdAt, createdAt))
	accounts, total, err := store.List(context.Background(), 20, 0)
	if err != nil || total != 1 || len(accounts) != 1 {
		t.Fatalf("list = %#v, total=%d, err=%v", accounts, total, err)
	}

	mock.ExpectQuery(regexp.QuoteMeta("SELECT id, email, name, provider_id, api_key, payload, created_at, updated_at FROM alchemy_accounts WHERE id = $1")).
		WithArgs(int64(7)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "email", "name", "provider_id", "api_key", "payload", "created_at", "updated_at"}).AddRow(int64(7), record.Email, record.Name, record.ProviderID, record.APIKey, string(record.Payload), createdAt, createdAt))
	account, err := store.Get(context.Background(), 7)
	if err != nil || account.ID != 7 || account.APIKey != record.APIKey {
		t.Fatalf("get = %#v, err=%v", account, err)
	}

	updated := record
	updated.Name = "renamed"
	mock.ExpectQuery(regexp.QuoteMeta("UPDATE alchemy_accounts SET email = $1, name = $2, provider_id = $3, api_key = $4, payload = $5, updated_at = now() WHERE id = $6 RETURNING id, email, name, provider_id, api_key, payload, created_at, updated_at")).
		WithArgs(updated.Email, updated.Name, updated.ProviderID, updated.APIKey, string(updated.Payload), int64(7)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "email", "name", "provider_id", "api_key", "payload", "created_at", "updated_at"}).AddRow(int64(7), updated.Email, updated.Name, updated.ProviderID, updated.APIKey, string(updated.Payload), createdAt, createdAt.Add(time.Minute)))
	if _, err := store.Update(context.Background(), 7, updated); err != nil {
		t.Fatal(err)
	}

	mock.ExpectExec(regexp.QuoteMeta("DELETE FROM alchemy_accounts WHERE id = $1")).WithArgs(int64(7)).WillReturnResult(sqlmock.NewResult(0, 1))
	if err := store.Delete(context.Background(), 7); err != nil {
		t.Fatal(err)
	}
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("DELETE FROM alchemy_accounts WHERE id = $1")).WithArgs(int64(8)).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("DELETE FROM alchemy_accounts WHERE id = $1")).WithArgs(int64(9)).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	if err := store.DeleteMany(context.Background(), []int64{8, 9}); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func storeRecord(email, apiKey, extra string) Record {
	var payload map[string]any
	if err := json.Unmarshal([]byte(extra), &payload); err != nil {
		panic(err)
	}
	payload["email"] = email
	payload["api_key"] = apiKey
	data, err := json.Marshal(payload)
	if err != nil {
		panic(err)
	}
	result, err := ParseImport(string(data))
	if err != nil {
		panic(err)
	}
	return result.Records[0]
}
