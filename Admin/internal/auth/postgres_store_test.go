package auth

import (
	"context"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/crypto/bcrypt"
)

type bcryptValue struct {
	password string
}

func (value bcryptValue) Match(input driver.Value) bool {
	hash, ok := input.(string)
	return ok && hash != value.password && bcrypt.CompareHashAndPassword([]byte(hash), []byte(value.password)) == nil
}

func TestDatabaseStoreSetupAndAuthenticate(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	store := NewDatabaseStore(db)
	ctx := context.Background()

	mock.ExpectQuery("SELECT EXISTS").WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	required, err := store.RequiresSetup(ctx)
	if err != nil || !required {
		t.Fatalf("setup required = %v, err=%v", required, err)
	}
	mock.ExpectExec("INSERT INTO admin_users").WithArgs("admin", bcryptValue{password: "correct-horse"}).WillReturnResult(sqlmock.NewResult(0, 1))
	if err := store.Setup(ctx, " admin ", "correct-horse"); err != nil {
		t.Fatal(err)
	}
	hash, err := bcrypt.GenerateFromPassword([]byte("correct-horse"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	mock.ExpectQuery("SELECT password_hash").WithArgs("admin").WillReturnRows(sqlmock.NewRows([]string{"password_hash"}).AddRow(string(hash)))
	ok, err := store.Authenticate(ctx, "admin", "correct-horse")
	if err != nil || !ok {
		t.Fatalf("authenticated = %v, err=%v", ok, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDatabaseStoreMapsDuplicateAdministrator(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectExec("INSERT INTO admin_users").WillReturnError(&pgconn.PgError{Code: "23505"})
	err = NewDatabaseStore(db).Setup(context.Background(), "admin", "correct-horse")
	if !errors.Is(err, ErrAlreadySetup) {
		t.Fatalf("setup error = %v", err)
	}
}

func TestMigrateLegacyFilePreservesExistingHash(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	hash, err := bcrypt.GenerateFromPassword([]byte("correct-horse"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "admin-auth.json")
	data, err := json.Marshal(account{Version: 1, Username: "admin", PasswordHash: string(hash)})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	mock.ExpectQuery("SELECT EXISTS").WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectExec("INSERT INTO admin_users").WithArgs("admin", string(hash)).WillReturnResult(sqlmock.NewResult(0, 1))
	if err := MigrateLegacyFile(context.Background(), db, path); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path + ".migrated"); err != nil {
		t.Fatalf("migrated file is missing: %v", err)
	}
}
