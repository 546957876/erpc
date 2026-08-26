package database

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestMigrateExecutesEmbeddedSchema(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectExec("(?s)CREATE TABLE IF NOT EXISTS admin_users.*INSERT INTO erpc_runtime").WillReturnResult(sqlmock.NewResult(0, 1))
	if err := Migrate(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestMigrateWrapsDatabaseError(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectExec("(?s)CREATE TABLE IF NOT EXISTS admin_users").WillReturnError(errors.New("database unavailable"))
	err = Migrate(context.Background(), db)
	if err == nil || !strings.Contains(err.Error(), "migrate Admin database") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestOpenRejectsEmptyDSN(t *testing.T) {
	_, err := Open(context.Background(), "  ")
	if err == nil || !strings.Contains(err.Error(), "database URL") {
		t.Fatalf("unexpected error: %v", err)
	}
}
