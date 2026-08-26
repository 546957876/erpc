package auth

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStoreSetupPersistsHashedAdministrator(t *testing.T) {
	path := filepath.Join(t.TempDir(), "auth", "administrator.json")
	store, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	required, err := store.RequiresSetup(ctx)
	if err != nil || !required {
		t.Fatal("new store must require setup")
	}
	if err := store.Setup(ctx, " admin ", "correct-horse"); err != nil {
		t.Fatal(err)
	}
	required, err = store.RequiresSetup(ctx)
	if err != nil || required {
		t.Fatal("configured store must not require setup")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "correct-horse") {
		t.Fatal("account file contains plaintext password")
	}
	authenticated, err := store.Authenticate(ctx, "admin", "correct-horse")
	if err != nil || !authenticated {
		t.Fatal("correct credentials were rejected")
	}
	authenticated, err = store.Authenticate(ctx, "admin", "wrong-password")
	if err != nil || authenticated {
		t.Fatal("wrong password was accepted")
	}
	if err := store.Setup(ctx, "other", "another-password"); !errors.Is(err, ErrAlreadySetup) {
		t.Fatalf("second setup error = %v, want ErrAlreadySetup", err)
	}

	reloaded, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	authenticated, err = reloaded.Authenticate(ctx, "admin", "correct-horse")
	if err != nil || !authenticated {
		t.Fatal("persisted credentials were rejected after reload")
	}
}

func TestStoreValidatesCredentials(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "administrator.json"))
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	for _, tc := range []struct {
		name, username, password string
	}{
		{"short username", "ab", "password"},
		{"short password", "admin", "1234567"},
		{"long password", "admin", strings.Repeat("x", 73)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := store.Setup(ctx, tc.username, tc.password); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
}
