package server

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"testing"
	"time"

	"github.com/erpc/admin/internal/alchemyaccounts"
	adminauth "github.com/erpc/admin/internal/auth"
	"github.com/erpc/admin/internal/config"
	"github.com/erpc/admin/internal/registry"
	"github.com/erpc/admin/internal/revisions"
)

func TestApplyAlchemyAccountCreatesAndUpdatesProvider(t *testing.T) {
	initial := mustDocument(t, `{"projects":[{"id":"main","providers":[{"id":"manual","vendor":"alchemy","settings":{"apiKey":"manual-key"}}],"future":"keep"}],"futureRoot":true}`)
	revisionStore := &fakeRevisionStore{items: []revisions.Revision{{Revision: 1, Payload: initial.Payload, ContentHash: initial.Hash}}}
	accountStore := &fakeAlchemyAccountStore{nextID: 1, accounts: []alchemyaccounts.Account{{ID: 1, Email: "one@example.com", Name: "one@example.com", ProviderID: "alchemy-one-example-com-12345678", APIKey: "account-key", Payload: json.RawMessage(`{"email":"one@example.com","api_key":"account-key","mailbox_password":"do-not-project"}`)}}}
	handler, cookie := newAlchemyManagedHandler(t, revisionStore, accountStore)

	response := request(t, handler, http.MethodPost, "/api/alchemy/accounts/1/apply", map[string]any{"projectId": "main", "networkMode": "only", "networks": []string{"evm:56"}}, cookie)
	assertStatus(t, response, http.StatusCreated)
	if len(revisionStore.items) != 2 {
		t.Fatalf("revision count = %d", len(revisionStore.items))
	}
	assertAppliedAlchemyProvider(t, revisionStore.items[1].Payload, "account-key")

	repeat := request(t, handler, http.MethodPost, "/api/alchemy/accounts/1/apply", map[string]any{"projectId": "main", "networkMode": "only", "networks": []string{"evm:56"}}, cookie)
	assertStatus(t, repeat, http.StatusOK)
	if len(revisionStore.items) != 2 {
		t.Fatalf("repeat apply created revision: %d", len(revisionStore.items))
	}

	accountStore.accounts[0].APIKey = "changed-key"
	changed := request(t, handler, http.MethodPost, "/api/alchemy/accounts/1/apply", map[string]any{"projectId": "main", "networkMode": "only", "networks": []string{"evm:56"}}, cookie)
	assertStatus(t, changed, http.StatusCreated)
	assertAppliedAlchemyProvider(t, revisionStore.items[2].Payload, "changed-key")
}

func TestApplyAlchemyAccountRejectsUnknownProject(t *testing.T) {
	initial := mustDocument(t, `{"projects":[{"id":"main"}]}`)
	revisionStore := &fakeRevisionStore{items: []revisions.Revision{{Revision: 1, Payload: initial.Payload, ContentHash: initial.Hash}}}
	accountStore := &fakeAlchemyAccountStore{accounts: []alchemyaccounts.Account{{ID: 1, ProviderID: "account-provider", APIKey: "key"}}}
	handler, cookie := newAlchemyManagedHandler(t, revisionStore, accountStore)
	response := request(t, handler, http.MethodPost, "/api/alchemy/accounts/1/apply", map[string]any{"projectId": "missing", "networkMode": "all"}, cookie)
	assertStatus(t, response, http.StatusNotFound)
	if len(revisionStore.items) != 1 {
		t.Fatalf("invalid apply created revision: %d", len(revisionStore.items))
	}
}

func newAlchemyManagedHandler(t *testing.T, revisions *fakeRevisionStore, accounts *fakeAlchemyAccountStore) (http.Handler, *http.Cookie) {
	t.Helper()
	return newManagedWithDependencies(t, ManagedDependencies{Revisions: revisions, Validator: fakeValidator{valid: true}, Runtime: fakeRuntime{}, AlchemyAccounts: accounts})
}

func newManagedWithDependencies(t *testing.T, dependencies ManagedDependencies) (http.Handler, *http.Cookie) {
	t.Helper()
	reg, err := registry.New(config.RuntimeConfig{PollInterval: time.Hour})
	if err != nil {
		t.Fatal(err)
	}
	auth, err := adminauth.NewStore(filepath.Join(t.TempDir(), "administrator.json"))
	if err != nil {
		t.Fatal(err)
	}
	handler := NewManaged(reg, auth, adminauth.NewSessions(time.Hour), dependencies)
	setup := request(t, handler, http.MethodPost, "/api/auth/setup", map[string]string{"username": "admin", "password": "correct-horse"}, nil)
	assertStatus(t, setup, http.StatusCreated)
	return handler, setup.Result().Cookies()[0]
}

func assertAppliedAlchemyProvider(t *testing.T, payload json.RawMessage, apiKey string) {
	t.Helper()
	var root map[string]any
	if err := json.Unmarshal(payload, &root); err != nil {
		t.Fatal(err)
	}
	projects := root["projects"].([]any)
	project := projects[0].(map[string]any)
	providers := project["providers"].([]any)
	if len(providers) != 2 || project["future"] != "keep" || root["futureRoot"] != true {
		t.Fatalf("configuration not preserved: %#v", root)
	}
	manual := providers[0].(map[string]any)
	generated := providers[1].(map[string]any)
	if manual["id"] != "manual" || generated["vendor"] != "alchemy" || generated["upstreamIdTemplate"] != "<PROVIDER>-<NETWORK>" {
		t.Fatalf("providers = %#v", providers)
	}
	settings := generated["settings"].(map[string]any)
	if settings["apiKey"] != apiKey || len(settings) != 1 {
		t.Fatalf("generated settings = %#v", settings)
	}
	if _, leaked := generated["mailbox_password"]; leaked {
		t.Fatalf("secret account payload leaked: %#v", generated)
	}
}
