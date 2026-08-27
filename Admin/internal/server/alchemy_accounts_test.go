package server

import (
	"context"
	"database/sql"
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

type fakeAlchemyAccountStore struct {
	accounts []alchemyaccounts.Account
	nextID   int64
}

func (s *fakeAlchemyAccountStore) Import(_ context.Context, records []alchemyaccounts.Record) (alchemyaccounts.ImportSummary, error) {
	result := alchemyaccounts.ImportSummary{Accounts: make([]alchemyaccounts.Account, 0, len(records))}
	for _, record := range records {
		for _, existing := range s.accounts {
			if existing.Email == record.Email {
				if string(existing.Payload) == string(record.Payload) {
					result.Skipped++
					continue
				}
				return result, alchemyaccounts.ErrConflict
			}
		}
		s.nextID++
		account := alchemyaccounts.Account{ID: s.nextID, Email: record.Email, Name: record.Name, ProviderID: record.ProviderID, APIKey: record.APIKey, Payload: record.Payload, CreatedAt: time.Now().UTC().Format(time.RFC3339), UpdatedAt: time.Now().UTC().Format(time.RFC3339)}
		s.accounts = append(s.accounts, account)
		result.Created++
		result.Accounts = append(result.Accounts, account)
	}
	return result, nil
}

func (s *fakeAlchemyAccountStore) List(_ context.Context, limit, offset int) ([]alchemyaccounts.Account, int, error) {
	if offset > len(s.accounts) {
		offset = len(s.accounts)
	}
	end := offset + limit
	if end > len(s.accounts) {
		end = len(s.accounts)
	}
	return s.accounts[offset:end], len(s.accounts), nil
}

func (s *fakeAlchemyAccountStore) Get(_ context.Context, id int64) (alchemyaccounts.Account, error) {
	for _, account := range s.accounts {
		if account.ID == id {
			return account, nil
		}
	}
	return alchemyaccounts.Account{}, sql.ErrNoRows
}

func (s *fakeAlchemyAccountStore) Update(_ context.Context, id int64, record alchemyaccounts.Record) (alchemyaccounts.Account, error) {
	for index, account := range s.accounts {
		if account.ID == id {
			updated := account
			updated.Email, updated.Name, updated.ProviderID, updated.APIKey, updated.Payload = record.Email, record.Name, record.ProviderID, record.APIKey, record.Payload
			s.accounts[index] = updated
			return updated, nil
		}
	}
	return alchemyaccounts.Account{}, sql.ErrNoRows
}

func (s *fakeAlchemyAccountStore) Delete(_ context.Context, id int64) error {
	for index, account := range s.accounts {
		if account.ID == id {
			s.accounts = append(s.accounts[:index], s.accounts[index+1:]...)
			return nil
		}
	}
	return sql.ErrNoRows
}

func (s *fakeAlchemyAccountStore) DeleteMany(ctx context.Context, ids []int64) error {
	for _, id := range ids {
		if _, err := s.Get(ctx, id); err != nil {
			return err
		}
	}
	for _, id := range ids {
		if err := s.Delete(ctx, id); err != nil {
			return err
		}
	}
	return nil
}

func TestAlchemyAccountManagementAPI(t *testing.T) {
	reg, err := registry.New(config.RuntimeConfig{PollInterval: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	auth, err := adminauth.NewStore(filepath.Join(t.TempDir(), "administrator.json"))
	if err != nil {
		t.Fatal(err)
	}
	accountStore := &fakeAlchemyAccountStore{}
	handler := NewManaged(reg, auth, adminauth.NewSessions(time.Hour), ManagedDependencies{AlchemyAccounts: accountStore, Runtime: fakeRuntime{}})

	unauthorized := request(t, handler, http.MethodPost, "/api/alchemy/accounts/import", map[string]string{"text": `{"email":"one@example.com","api_key":"key-one"}`}, nil)
	assertStatus(t, unauthorized, http.StatusUnauthorized)
	setup := request(t, handler, http.MethodPost, "/api/auth/setup", map[string]string{"username": "admin", "password": "correct-horse"}, nil)
	assertStatus(t, setup, http.StatusCreated)
	cookie := setup.Result().Cookies()[0]

	imported := request(t, handler, http.MethodPost, "/api/alchemy/accounts/import", map[string]string{"text": "{\"email\":\"one@example.com\",\"api_key\":\"key-one\"}\n{\"email\":\"two@example.com\",\"api_key\":\"key-two\"}"}, cookie)
	assertStatus(t, imported, http.StatusCreated)
	var importResponse struct {
		Created int `json:"created"`
	}
	if err := json.NewDecoder(imported.Body).Decode(&importResponse); err != nil || importResponse.Created != 2 {
		t.Fatalf("import response = %#v, err=%v", importResponse, err)
	}

	list := request(t, handler, http.MethodGet, "/api/alchemy/accounts?limit=20&offset=0", nil, cookie)
	assertStatus(t, list, http.StatusOK)
	var listResponse struct {
		Items []alchemyaccounts.Account `json:"items"`
		Total int                       `json:"total"`
	}
	if err := json.NewDecoder(list.Body).Decode(&listResponse); err != nil || listResponse.Total != 2 || len(listResponse.Items) != 2 {
		t.Fatalf("list response = %#v, err=%v", listResponse, err)
	}

	detail := request(t, handler, http.MethodGet, "/api/alchemy/accounts/1", nil, cookie)
	assertStatus(t, detail, http.StatusOK)
	var account alchemyaccounts.Account
	if err := json.NewDecoder(detail.Body).Decode(&account); err != nil || account.Email != "one@example.com" {
		t.Fatalf("detail = %#v, err=%v", account, err)
	}

	updated := request(t, handler, http.MethodPatch, "/api/alchemy/accounts/1", map[string]any{"email": "one@example.com", "name": "主账号", "providerId": account.ProviderID, "apiKey": "key-updated", "payload": map[string]any{"email": "one@example.com", "api_key": "key-updated", "checkpoint": map[string]any{"stage": "completed"}}}, cookie)
	assertStatus(t, updated, http.StatusOK)
	deleted := request(t, handler, http.MethodDelete, "/api/alchemy/accounts/1", nil, cookie)
	assertStatus(t, deleted, http.StatusNoContent)
	if len(accountStore.accounts) != 1 {
		t.Fatalf("accounts after delete = %#v", accountStore.accounts)
	}
}

func TestAlchemyAccountDeleteProtectsLatestConfigReference(t *testing.T) {
	accountStore := &fakeAlchemyAccountStore{accounts: []alchemyaccounts.Account{{ID: 1, ProviderID: "account-provider", APIKey: "key"}}}
	config := mustDocument(t, `{"projects":[{"id":"main","providers":[{"id":"account-provider","vendor":"alchemy","settings":{"apiKey":"key"}}]}]}`)
	revisionStore := &fakeRevisionStore{items: []revisions.Revision{{Revision: 1, Payload: config.Payload, ContentHash: config.Hash}}}
	handler, cookie := newManagedWithDependencies(t, ManagedDependencies{Revisions: revisionStore, Runtime: fakeRuntime{}, AlchemyAccounts: accountStore})
	response := request(t, handler, http.MethodDelete, "/api/alchemy/accounts/1", nil, cookie)
	assertStatus(t, response, http.StatusConflict)
	if len(accountStore.accounts) != 1 {
		t.Fatal("referenced account was deleted")
	}
}

func TestAlchemyAccountBatchDelete(t *testing.T) {
	accountStore := &fakeAlchemyAccountStore{accounts: []alchemyaccounts.Account{{ID: 1}, {ID: 2}, {ID: 3}}}
	handler, cookie := newManagedWithDependencies(t, ManagedDependencies{Runtime: fakeRuntime{}, AlchemyAccounts: accountStore})
	response := request(t, handler, http.MethodPost, "/api/alchemy/accounts/batch-delete", map[string]any{"accountIds": []int64{1, 3}}, cookie)
	assertStatus(t, response, http.StatusOK)
	if len(accountStore.accounts) != 1 || accountStore.accounts[0].ID != 2 {
		t.Fatalf("accounts after batch delete = %#v", accountStore.accounts)
	}
}

func TestAlchemyAccountBatchDeleteRejectsReferencedSelection(t *testing.T) {
	accountStore := &fakeAlchemyAccountStore{accounts: []alchemyaccounts.Account{{ID: 1, ProviderID: "account-provider", APIKey: "key"}, {ID: 2}}}
	config := mustDocument(t, `{"projects":[{"id":"main","providers":[{"id":"account-provider","vendor":"alchemy","settings":{"apiKey":"key"}}]}]}`)
	revisionStore := &fakeRevisionStore{items: []revisions.Revision{{Revision: 1, Payload: config.Payload, ContentHash: config.Hash}}}
	handler, cookie := newManagedWithDependencies(t, ManagedDependencies{Revisions: revisionStore, Runtime: fakeRuntime{}, AlchemyAccounts: accountStore})
	response := request(t, handler, http.MethodPost, "/api/alchemy/accounts/batch-delete", map[string]any{"accountIds": []int64{1, 2}}, cookie)
	assertStatus(t, response, http.StatusConflict)
	if len(accountStore.accounts) != 2 {
		t.Fatal("batch delete removed accounts after reference conflict")
	}
}
