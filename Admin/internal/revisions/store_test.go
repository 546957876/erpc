package revisions

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/erpc/admin/internal/configdoc"
)

func TestCreateAssignsNextRevision(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	document, err := configdoc.ParseJSON([]byte(`{"projects":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	createdAt := time.Now().UTC()
	mock.ExpectBegin()
	mock.ExpectExec("LOCK TABLE config_revisions").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("SELECT COALESCE").WillReturnRows(sqlmock.NewRows([]string{"revision"}).AddRow(0))
	mock.ExpectQuery("INSERT INTO config_revisions").WithArgs(string(document.Payload), document.Hash, "admin").WillReturnRows(sqlmock.NewRows([]string{"revision", "created_at"}).AddRow(1, createdAt))
	mock.ExpectCommit()
	revision, err := NewStore(db).Create(context.Background(), document, "admin", 0)
	if err != nil || revision.Revision != 1 {
		t.Fatalf("revision = %#v, err=%v", revision, err)
	}
}

func TestCreateRejectsStaleBaseRevision(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	document, err := configdoc.ParseJSON([]byte(`{"projects":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	mock.ExpectBegin()
	mock.ExpectExec("LOCK TABLE config_revisions").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("SELECT COALESCE").WillReturnRows(sqlmock.NewRows([]string{"revision"}).AddRow(3))
	mock.ExpectRollback()
	_, err = NewStore(db).Create(context.Background(), document, "admin", 2)
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("create error = %v", err)
	}
}

func TestDeleteRemovesHistoricalRevision(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectBegin()
	mock.ExpectExec("LOCK TABLE config_revisions").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("SELECT COALESCE\\(MAX\\(revision\\), 0\\)").WillReturnRows(sqlmock.NewRows([]string{"revision"}).AddRow(3))
	mock.ExpectExec("DELETE FROM config_revisions").WithArgs(int64(2)).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	if err := NewStore(db).Delete(context.Background(), 2); err != nil {
		t.Fatalf("delete historical revision: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDeleteRejectsLatestRevision(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectBegin()
	mock.ExpectExec("LOCK TABLE config_revisions").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("SELECT COALESCE\\(MAX\\(revision\\), 0\\)").WillReturnRows(sqlmock.NewRows([]string{"revision"}).AddRow(3))
	mock.ExpectRollback()

	if err := NewStore(db).Delete(context.Background(), 3); !errors.Is(err, ErrLatest) {
		t.Fatalf("delete latest error = %v, want %v", err, ErrLatest)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
