package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"path/filepath"
	"testing"
	"time"

	"github.com/erpc/admin/internal/alchemyaccounts"
	adminauth "github.com/erpc/admin/internal/auth"
	"github.com/erpc/admin/internal/config"
	"github.com/erpc/admin/internal/registry"
	adminruntime "github.com/erpc/admin/internal/runtime"
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

var _ = errors.Is
var _ adminruntime.Status
