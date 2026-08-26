package revisions

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/erpc/admin/internal/configdoc"
)

var ErrConflict = errors.New("configuration revision conflict")

type Revision struct {
	Revision    int64           `json:"revision"`
	Payload     json.RawMessage `json:"payload"`
	ContentHash string          `json:"contentHash"`
	CreatedBy   string          `json:"createdBy"`
	CreatedAt   time.Time       `json:"createdAt"`
}

type Store struct {
	db *sql.DB
}

func NewStore(db *sql.DB) *Store {
	return &Store{db: db}
}

func (s *Store) Create(ctx context.Context, document configdoc.Document, createdBy string, baseRevision int64) (Revision, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Revision{}, fmt.Errorf("begin configuration revision: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, "LOCK TABLE config_revisions IN EXCLUSIVE MODE"); err != nil {
		return Revision{}, fmt.Errorf("lock configuration revisions: %w", err)
	}
	var current int64
	if err := tx.QueryRowContext(ctx, "SELECT COALESCE(MAX(revision), 0) FROM config_revisions").Scan(&current); err != nil {
		return Revision{}, fmt.Errorf("query latest configuration revision: %w", err)
	}
	if current != baseRevision {
		return Revision{}, fmt.Errorf("%w: current revision is %d", ErrConflict, current)
	}
	revision := Revision{Payload: append(json.RawMessage(nil), document.Payload...), ContentHash: document.Hash, CreatedBy: createdBy}
	if err := tx.QueryRowContext(ctx, "INSERT INTO config_revisions (payload, content_hash, created_by) VALUES ($1, $2, $3) RETURNING revision, created_at", string(document.Payload), document.Hash, createdBy).Scan(&revision.Revision, &revision.CreatedAt); err != nil {
		return Revision{}, fmt.Errorf("insert configuration revision: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return Revision{}, fmt.Errorf("commit configuration revision: %w", err)
	}
	return revision, nil
}

func (s *Store) Latest(ctx context.Context) (Revision, error) {
	return scanRevision(s.db.QueryRowContext(ctx, "SELECT revision, payload, content_hash, created_by, created_at FROM config_revisions ORDER BY revision DESC LIMIT 1"))
}

func (s *Store) Get(ctx context.Context, revision int64) (Revision, error) {
	return scanRevision(s.db.QueryRowContext(ctx, "SELECT revision, payload, content_hash, created_by, created_at FROM config_revisions WHERE revision = $1", revision))
}

func (s *Store) List(ctx context.Context, limit int) ([]Revision, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := s.db.QueryContext(ctx, "SELECT revision, payload, content_hash, created_by, created_at FROM config_revisions ORDER BY revision DESC LIMIT $1", limit)
	if err != nil {
		return nil, fmt.Errorf("list configuration revisions: %w", err)
	}
	defer rows.Close()
	revisions := make([]Revision, 0)
	for rows.Next() {
		revision, err := scanRevision(rows)
		if err != nil {
			return nil, err
		}
		revisions = append(revisions, revision)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate configuration revisions: %w", err)
	}
	return revisions, nil
}

type scanner interface {
	Scan(...any) error
}

func scanRevision(row scanner) (Revision, error) {
	var revision Revision
	var payload []byte
	if err := row.Scan(&revision.Revision, &payload, &revision.ContentHash, &revision.CreatedBy, &revision.CreatedAt); err != nil {
		return Revision{}, fmt.Errorf("scan configuration revision: %w", err)
	}
	revision.Payload = append(json.RawMessage(nil), payload...)
	return revision, nil
}
