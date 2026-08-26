package main

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"

	"github.com/erpc/admin/internal/configdoc"
	"github.com/erpc/admin/internal/revisions"
)

type initialStoreFake struct {
	latest       revisions.Revision
	latestErr    error
	latestCalls  int
	createErr    error
	createCalls  int
	createdBy    string
	baseRevision int64
}

func (s *initialStoreFake) Latest(context.Context) (revisions.Revision, error) {
	if s.latestErr != nil {
		err := s.latestErr
		s.latestErr = nil
		return revisions.Revision{}, err
	}
	return s.latest, nil
}

func (s *initialStoreFake) Create(_ context.Context, _ configdoc.Document, createdBy string, baseRevision int64) (revisions.Revision, error) {
	s.createCalls++
	s.createdBy = createdBy
	s.baseRevision = baseRevision
	if s.createErr != nil {
		return revisions.Revision{}, s.createErr
	}
	s.latest = revisions.Revision{Revision: 1}
	return s.latest, nil
}

type initialValidatorFake struct {
	validateResult configdoc.ValidationResult
	validateErr    error
	dumpDocument   configdoc.Document
	dumpErr        error
	validateCalls  int
	dumpCalls      int
}

func (v *initialValidatorFake) Validate(context.Context, configdoc.Document) (configdoc.ValidationResult, error) {
	v.validateCalls++
	return v.validateResult, v.validateErr
}

func (v *initialValidatorFake) Dump(context.Context, configdoc.Document) (configdoc.Document, error) {
	v.dumpCalls++
	return v.dumpDocument, v.dumpErr
}

func initialDocument(t *testing.T, value string) configdoc.Document {
	t.Helper()
	document, err := configdoc.ParseJSON([]byte(value))
	if err != nil {
		t.Fatal(err)
	}
	return document
}

func TestEnsureInitialRevisionCreatesSystemDefaultAndDumpsDefaults(t *testing.T) {
	store := &initialStoreFake{latestErr: sql.ErrNoRows}
	validator := &initialValidatorFake{
		validateResult: configdoc.ValidationResult{Valid: true},
		dumpDocument:   initialDocument(t, `{"server":{"httpPortV4":4000}}`),
	}
	revision, defaults, err := ensureInitialRevision(context.Background(), store, validator)
	if err != nil {
		t.Fatal(err)
	}
	if revision.Revision != 1 || store.createCalls != 1 || store.createdBy != "system-default" || store.baseRevision != 0 {
		t.Fatalf("revision=%+v store=%+v", revision, store)
	}
	if validator.validateCalls != 1 || validator.dumpCalls != 1 || string(defaults.Payload) != `{"server":{"httpPortV4":4000}}` {
		t.Fatalf("validator calls/defaults = %d/%d/%s", validator.validateCalls, validator.dumpCalls, defaults.Payload)
	}
}

func TestEnsureInitialRevisionLeavesExistingRevisionUntouched(t *testing.T) {
	store := &initialStoreFake{latest: revisions.Revision{Revision: 7}}
	validator := &initialValidatorFake{dumpDocument: initialDocument(t, `{"server":{"httpPortV4":4000}}`)}
	revision, _, err := ensureInitialRevision(context.Background(), store, validator)
	if err != nil {
		t.Fatal(err)
	}
	if revision.Revision != 7 || store.createCalls != 0 || validator.validateCalls != 0 || validator.dumpCalls != 1 {
		t.Fatalf("revision=%+v calls create=%d validate=%d dump=%d", revision, store.createCalls, validator.validateCalls, validator.dumpCalls)
	}
}

func TestEnsureInitialRevisionCreateConflictReadsWinner(t *testing.T) {
	store := &initialStoreFake{latestErr: sql.ErrNoRows, createErr: revisions.ErrConflict}
	store.latest = revisions.Revision{Revision: 9}
	validator := &initialValidatorFake{validateResult: configdoc.ValidationResult{Valid: true}, dumpDocument: initialDocument(t, `{}`)}
	revision, _, err := ensureInitialRevision(context.Background(), store, validator)
	if err != nil {
		t.Fatal(err)
	}
	if revision.Revision != 9 || store.createCalls != 1 || validator.dumpCalls != 1 {
		t.Fatalf("revision=%+v calls=%d/%d", revision, store.createCalls, validator.dumpCalls)
	}
}

func TestEnsureInitialRevisionRejectsInvalidValidation(t *testing.T) {
	store := &initialStoreFake{latestErr: sql.ErrNoRows}
	validator := &initialValidatorFake{validateResult: configdoc.ValidationResult{Valid: false, Errors: []string{"missing project"}}}
	_, _, err := ensureInitialRevision(context.Background(), store, validator)
	if err == nil || !strings.Contains(err.Error(), "validate initial configuration") || strings.Contains(err.Error(), "missing project") {
		t.Fatalf("error = %v", err)
	}
	if store.createCalls != 0 || validator.dumpCalls != 0 {
		t.Fatalf("unexpected calls create=%d dump=%d", store.createCalls, validator.dumpCalls)
	}
}

func TestEnsureInitialRevisionWrapsDatabaseAndDumpErrors(t *testing.T) {
	store := &initialStoreFake{latestErr: errors.New("database unavailable")}
	validator := &initialValidatorFake{}
	_, _, err := ensureInitialRevision(context.Background(), store, validator)
	if err == nil || !strings.Contains(err.Error(), "read initial revision") || strings.Contains(err.Error(), "database unavailable") == false {
		t.Fatalf("database error = %v", err)
	}

	store = &initialStoreFake{latestErr: sql.ErrNoRows}
	validator = &initialValidatorFake{validateResult: configdoc.ValidationResult{Valid: true}, dumpErr: errors.New("dump failed")}
	_, _, err = ensureInitialRevision(context.Background(), store, validator)
	if err == nil || !strings.Contains(err.Error(), "dump initial defaults") || !strings.Contains(err.Error(), "dump failed") {
		t.Fatalf("dump error = %v", err)
	}
}
