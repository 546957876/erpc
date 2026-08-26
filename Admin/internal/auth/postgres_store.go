package auth

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/crypto/bcrypt"
)

type AccountStore interface {
	RequiresSetup(context.Context) (bool, error)
	Setup(context.Context, string, string) error
	Authenticate(context.Context, string, string) (bool, error)
}

type DatabaseStore struct {
	db *sql.DB
}

func NewDatabaseStore(db *sql.DB) *DatabaseStore {
	return &DatabaseStore{db: db}
}

func (s *DatabaseStore) RequiresSetup(ctx context.Context) (bool, error) {
	var exists bool
	if err := s.db.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM admin_users WHERE singleton = true)").Scan(&exists); err != nil {
		return false, fmt.Errorf("query administrator setup state: %w", err)
	}
	return !exists, nil
}

func (s *DatabaseStore) Setup(ctx context.Context, username, password string) error {
	username = strings.TrimSpace(username)
	if err := validateCredentials(username, password); err != nil {
		return err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, "INSERT INTO admin_users (username, password_hash) VALUES ($1, $2)", username, string(hash)); err != nil {
		var postgresError *pgconn.PgError
		if errors.As(err, &postgresError) && postgresError.Code == "23505" {
			return ErrAlreadySetup
		}
		return fmt.Errorf("create administrator: %w", err)
	}
	return nil
}

func (s *DatabaseStore) Authenticate(ctx context.Context, username, password string) (bool, error) {
	var hash string
	username = strings.TrimSpace(username)
	if err := s.db.QueryRowContext(ctx, "SELECT password_hash FROM admin_users WHERE singleton = true AND username = $1", username).Scan(&hash); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, fmt.Errorf("query administrator credentials: %w", err)
	}
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil, nil
}

func MigrateLegacyFile(ctx context.Context, db *sql.DB, path string) error {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil
	}
	store := NewDatabaseStore(db)
	required, err := store.RequiresSetup(ctx)
	if err != nil || !required {
		return err
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read legacy auth file: %w", err)
	}
	var saved account
	if err := json.Unmarshal(data, &saved); err != nil {
		return fmt.Errorf("decode legacy auth file: %w", err)
	}
	if saved.Version != 1 || strings.TrimSpace(saved.Username) == "" || saved.PasswordHash == "" {
		return fmt.Errorf("legacy auth file is invalid")
	}
	if _, err := db.ExecContext(ctx, "INSERT INTO admin_users (username, password_hash) VALUES ($1, $2)", strings.TrimSpace(saved.Username), saved.PasswordHash); err != nil {
		return fmt.Errorf("migrate legacy administrator: %w", err)
	}
	if err := os.Rename(path, path+".migrated"); err != nil {
		return fmt.Errorf("archive legacy auth file: %w", err)
	}
	return nil
}
