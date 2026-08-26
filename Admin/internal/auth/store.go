package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"golang.org/x/crypto/bcrypt"
)

var (
	ErrAlreadySetup      = errors.New("administrator already exists")
	ErrInvalidCredential = errors.New("invalid administrator credentials")
)

type account struct {
	Version      int       `json:"version"`
	Username     string    `json:"username"`
	PasswordHash string    `json:"passwordHash"`
	CreatedAt    time.Time `json:"createdAt"`
}

type Store struct {
	mu      sync.RWMutex
	path    string
	account *account
}

func NewStore(path string) (*Store, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil, fmt.Errorf("auth file path is required")
	}
	store := &Store{path: path}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return store, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read auth file: %w", err)
	}
	var saved account
	if err := json.Unmarshal(data, &saved); err != nil {
		return nil, fmt.Errorf("decode auth file: %w", err)
	}
	if saved.Version != 1 || saved.Username == "" || saved.PasswordHash == "" {
		return nil, fmt.Errorf("auth file is invalid")
	}
	store.account = &saved
	return store, nil
}

func (s *Store) RequiresSetup(_ context.Context) (bool, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.account == nil, nil
}

func (s *Store) Setup(_ context.Context, username, password string) error {
	username = strings.TrimSpace(username)
	if err := validateCredentials(username, password); err != nil {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.account != nil {
		return ErrAlreadySetup
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}
	saved := &account{Version: 1, Username: username, PasswordHash: string(hash), CreatedAt: time.Now().UTC()}
	if err := writeAccount(s.path, saved); err != nil {
		return err
	}
	s.account = saved
	return nil
}

func (s *Store) Authenticate(_ context.Context, username, password string) (bool, error) {
	s.mu.RLock()
	saved := s.account
	s.mu.RUnlock()
	if saved == nil {
		return false, nil
	}
	validPassword := bcrypt.CompareHashAndPassword([]byte(saved.PasswordHash), []byte(password)) == nil
	return validPassword && strings.TrimSpace(username) == saved.Username, nil
}

func validateCredentials(username, password string) error {
	usernameLength := utf8.RuneCountInString(username)
	if usernameLength < 3 || usernameLength > 64 {
		return fmt.Errorf("%w: username must contain 3 to 64 characters", ErrInvalidCredential)
	}
	if len(password) < 8 || len(password) > 72 {
		return fmt.Errorf("%w: password must contain 8 to 72 bytes", ErrInvalidCredential)
	}
	return nil
}

func writeAccount(path string, saved *account) error {
	directory := filepath.Dir(path)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return fmt.Errorf("create auth directory: %w", err)
	}
	temporary, err := os.CreateTemp(directory, ".admin-auth-*")
	if err != nil {
		return fmt.Errorf("create auth file: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return fmt.Errorf("secure auth file: %w", err)
	}
	encoder := json.NewEncoder(temporary)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(saved); err != nil {
		temporary.Close()
		return fmt.Errorf("write auth file: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return fmt.Errorf("sync auth file: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close auth file: %w", err)
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return fmt.Errorf("install auth file: %w", err)
	}
	return nil
}
