package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"

	adminauth "github.com/erpc/admin/internal/auth"
	"github.com/erpc/admin/internal/config"
	"github.com/erpc/admin/internal/configdoc"
	"github.com/erpc/admin/internal/registry"
	"github.com/erpc/admin/internal/revisions"
	adminruntime "github.com/erpc/admin/internal/runtime"
)

type fakeRevisionStore struct {
	items []revisions.Revision
}

func (store *fakeRevisionStore) Create(_ context.Context, document configdoc.Document, createdBy string, baseRevision int64) (revisions.Revision, error) {
	if int64(len(store.items)) != baseRevision {
		return revisions.Revision{}, revisions.ErrConflict
	}
	revision := revisions.Revision{Revision: baseRevision + 1, Payload: document.Payload, ContentHash: document.Hash, CreatedBy: createdBy, CreatedAt: time.Now().UTC()}
	store.items = append(store.items, revision)
	return revision, nil
}

func (store *fakeRevisionStore) Latest(context.Context) (revisions.Revision, error) {
	if len(store.items) == 0 {
		return revisions.Revision{}, sql.ErrNoRows
	}
	return store.items[len(store.items)-1], nil
}

func (store *fakeRevisionStore) Get(_ context.Context, revision int64) (revisions.Revision, error) {
	if revision <= 0 || revision > int64(len(store.items)) {
		return revisions.Revision{}, sql.ErrNoRows
	}
	return store.items[revision-1], nil
}

func (store *fakeRevisionStore) List(context.Context, int) ([]revisions.Revision, error) {
	return append([]revisions.Revision(nil), store.items...), nil
}

type fakeValidator struct {
	valid        bool
	dumpDocument configdoc.Document
	dumpErr      error
}

func (validator fakeValidator) Validate(context.Context, configdoc.Document) (configdoc.ValidationResult, error) {
	if validator.valid {
		return configdoc.ValidationResult{Valid: true}, nil
	}
	return configdoc.ValidationResult{Valid: false, Errors: []string{"配置无效"}}, nil
}

func (validator fakeValidator) Dump(_ context.Context, document configdoc.Document) (configdoc.Document, error) {
	if validator.dumpErr != nil {
		return configdoc.Document{}, validator.dumpErr
	}
	if len(validator.dumpDocument.Payload) == 0 {
		return document, nil
	}
	return configdoc.Overlay(validator.dumpDocument, document)
}

type fakeRuntime struct{}

func (fakeRuntime) Status(context.Context) (adminruntime.Status, error) {
	return adminruntime.Status{State: adminruntime.StateStopped}, nil
}
func (fakeRuntime) Start(context.Context) (adminruntime.Status, error) {
	return adminruntime.Status{State: adminruntime.StateRunning}, nil
}
func (fakeRuntime) Stop(context.Context) (adminruntime.Status, error) {
	return adminruntime.Status{State: adminruntime.StateStopped}, nil
}
func (fakeRuntime) Restart(context.Context) (adminruntime.Status, error) {
	return adminruntime.Status{State: adminruntime.StateRunning}, nil
}

func TestManagedConfigRequiresValidationBeforeRevision(t *testing.T) {
	reg, err := registry.New(config.RuntimeConfig{PollInterval: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	accounts, err := adminauth.NewStore(filepath.Join(t.TempDir(), "administrator.json"))
	if err != nil {
		t.Fatal(err)
	}
	store := &fakeRevisionStore{}
	handler := NewManaged(reg, accounts, adminauth.NewSessions(time.Hour), ManagedDependencies{Revisions: store, Validator: fakeValidator{valid: true}, Runtime: fakeRuntime{}})
	setup := request(t, handler, http.MethodPost, "/api/auth/setup", map[string]string{"username": "admin", "password": "correct-horse"}, nil)
	cookie := setup.Result().Cookies()[0]
	created := request(t, handler, http.MethodPost, "/api/config/revisions", map[string]any{"payload": map[string]any{"projects": []any{}}, "baseRevision": 0}, cookie)
	assertStatus(t, created, http.StatusCreated)
	status := request(t, handler, http.MethodGet, "/api/runtime", nil, cookie)
	assertStatus(t, status, http.StatusOK)

	invalidStore := &fakeRevisionStore{}
	invalidHandler := NewManaged(reg, accounts, adminauth.NewSessions(time.Hour), ManagedDependencies{Revisions: invalidStore, Validator: fakeValidator{valid: false}, Runtime: fakeRuntime{}})
	login := request(t, invalidHandler, http.MethodPost, "/api/auth/login", map[string]string{"username": "admin", "password": "correct-horse"}, nil)
	invalidCookie := login.Result().Cookies()[0]
	invalid := request(t, invalidHandler, http.MethodPost, "/api/config/revisions", map[string]any{"payload": map[string]any{"projects": []any{}}, "baseRevision": 0}, invalidCookie)
	assertStatus(t, invalid, http.StatusUnprocessableEntity)
	if len(invalidStore.items) != 0 {
		t.Fatal(errors.New("invalid configuration created a revision"))
	}
}

func TestManagedCurrentConfigReturnsOverrideEffectiveAndDefaultPayloads(t *testing.T) {
	reg, err := registry.New(config.RuntimeConfig{PollInterval: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	accounts, err := adminauth.NewStore(filepath.Join(t.TempDir(), "administrator.json"))
	if err != nil {
		t.Fatal(err)
	}
	override := mustDocument(t, `{}`)
	defaults := mustDocument(t, `{"server":{"httpPortV4":4000}}`)
	store := &fakeRevisionStore{items: []revisions.Revision{{Revision: 1, Payload: override.Payload, ContentHash: override.Hash, CreatedBy: "system-default", CreatedAt: time.Now().UTC()}}}
	handler := NewManaged(reg, accounts, adminauth.NewSessions(time.Hour), ManagedDependencies{
		Revisions: store,
		Validator: fakeValidator{valid: true, dumpDocument: defaults},
		Defaults:  defaults,
		Runtime:   fakeRuntime{},
	})
	setup := request(t, handler, http.MethodPost, "/api/auth/setup", map[string]string{"username": "admin", "password": "correct-horse"}, nil)
	assertStatus(t, setup, http.StatusCreated)
	cookie := setup.Result().Cookies()[0]
	response := request(t, handler, http.MethodGet, "/api/config/current", nil, cookie)
	assertStatus(t, response, http.StatusOK)
	var body struct {
		Revision  int64           `json:"revision"`
		Payload   json.RawMessage `json:"payload"`
		Effective json.RawMessage `json:"effectivePayload"`
		Default   json.RawMessage `json:"defaultPayload"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Revision != 1 {
		t.Fatalf("revision = %d, want 1", body.Revision)
	}
	assertJSONEqual(t, body.Payload, `{}`)
	assertJSONEqual(t, body.Effective, `{"server":{"httpPortV4":4000}}`)
	assertJSONEqual(t, body.Default, `{"server":{"httpPortV4":4000}}`)
}

func TestManagedCurrentConfigOverlaysExplicitValuesAfterDump(t *testing.T) {
	reg, err := registry.New(config.RuntimeConfig{PollInterval: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	accounts, err := adminauth.NewStore(filepath.Join(t.TempDir(), "administrator.json"))
	if err != nil {
		t.Fatal(err)
	}
	override := mustDocument(t, `{"secret":"plain"}`)
	defaults := mustDocument(t, `{"secret":"REDACTED"}`)
	store := &fakeRevisionStore{items: []revisions.Revision{{Revision: 2, Payload: override.Payload, ContentHash: override.Hash, CreatedBy: "administrator", CreatedAt: time.Now().UTC()}}}
	handler := NewManaged(reg, accounts, adminauth.NewSessions(time.Hour), ManagedDependencies{
		Revisions: store,
		Validator: fakeValidator{valid: true, dumpDocument: defaults},
		Defaults:  defaults,
		Runtime:   fakeRuntime{},
	})
	setup := request(t, handler, http.MethodPost, "/api/auth/setup", map[string]string{"username": "admin", "password": "correct-horse"}, nil)
	assertStatus(t, setup, http.StatusCreated)
	cookie := setup.Result().Cookies()[0]
	response := request(t, handler, http.MethodGet, "/api/config/current", nil, cookie)
	assertStatus(t, response, http.StatusOK)
	var body struct {
		Effective json.RawMessage `json:"effectivePayload"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	assertJSONEqual(t, body.Effective, `{"secret":"plain"}`)
}

func TestManagedCurrentConfigHidesDumpFailures(t *testing.T) {
	reg, err := registry.New(config.RuntimeConfig{PollInterval: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	accounts, err := adminauth.NewStore(filepath.Join(t.TempDir(), "administrator.json"))
	if err != nil {
		t.Fatal(err)
	}
	override := mustDocument(t, `{"secret":"plain"}`)
	store := &fakeRevisionStore{items: []revisions.Revision{{Revision: 1, Payload: override.Payload, ContentHash: override.Hash, CreatedAt: time.Now().UTC()}}}
	handler := NewManaged(reg, accounts, adminauth.NewSessions(time.Hour), ManagedDependencies{
		Revisions: store,
		Validator: fakeValidator{valid: true, dumpErr: errors.New("private dump failure")},
		Defaults:  mustDocument(t, `{"secret":"REDACTED"}`),
		Runtime:   fakeRuntime{},
	})
	setup := request(t, handler, http.MethodPost, "/api/auth/setup", map[string]string{"username": "admin", "password": "correct-horse"}, nil)
	assertStatus(t, setup, http.StatusCreated)
	cookie := setup.Result().Cookies()[0]
	response := request(t, handler, http.MethodGet, "/api/config/current", nil, cookie)
	assertStatus(t, response, http.StatusInternalServerError)
	body := response.Body.String()
	if strings.Contains(body, "plain") || strings.Contains(body, "private dump failure") {
		t.Fatalf("response leaked configuration or dump error: %s", body)
	}
}

func mustDocument(t *testing.T, payload string) configdoc.Document {
	t.Helper()
	document, err := configdoc.ParseJSON([]byte(payload))
	if err != nil {
		t.Fatal(err)
	}
	return document
}

func assertJSONEqual(t *testing.T, actual json.RawMessage, expected string) {
	t.Helper()
	var got any
	var want any
	if err := json.Unmarshal(actual, &got); err != nil {
		t.Fatalf("invalid JSON response %q: %v", string(actual), err)
	}
	if err := json.Unmarshal([]byte(expected), &want); err != nil {
		t.Fatal(err)
	}
	gotJSON, _ := json.Marshal(got)
	wantJSON, _ := json.Marshal(want)
	if string(gotJSON) != string(wantJSON) {
		t.Fatalf("JSON = %s, want %s", gotJSON, wantJSON)
	}
}
