package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	adminauth "github.com/erpc/admin/internal/auth"
	"github.com/erpc/admin/internal/config"
	"github.com/erpc/admin/internal/registry"
)

func TestServerAccountSetupLoginAndProtection(t *testing.T) {
	handler := newTestServer(t)

	status := request(t, handler, http.MethodGet, "/api/auth/status", nil, nil)
	assertStatus(t, status, http.StatusOK)
	var initial map[string]bool
	if err := json.NewDecoder(status.Body).Decode(&initial); err != nil {
		t.Fatal(err)
	}
	if !initial["setupRequired"] || initial["authenticated"] {
		t.Fatalf("unexpected initial auth status: %#v", initial)
	}

	denied := request(t, handler, http.MethodGet, "/api/targets", nil, nil)
	assertStatus(t, denied, http.StatusUnauthorized)

	setup := request(t, handler, http.MethodPost, "/api/auth/setup", map[string]string{"username": "admin", "password": "correct-horse"}, nil)
	assertStatus(t, setup, http.StatusCreated)
	cookie := setup.Result().Cookies()[0]
	if !cookie.HttpOnly || cookie.SameSite != http.SameSiteStrictMode || cookie.Value == "" {
		t.Fatalf("insecure session cookie: %#v", cookie)
	}

	secondSetup := request(t, handler, http.MethodPost, "/api/auth/setup", map[string]string{"username": "other", "password": "another-password"}, nil)
	assertStatus(t, secondSetup, http.StatusConflict)

	targets := request(t, handler, http.MethodGet, "/api/targets", nil, cookie)
	assertStatus(t, targets, http.StatusOK)
	var snapshots []registry.Snapshot
	if err := json.NewDecoder(targets.Body).Decode(&snapshots); err != nil || len(snapshots) != 1 {
		t.Fatalf("unexpected response: %#v, err=%v", snapshots, err)
	}

	logout := request(t, handler, http.MethodPost, "/api/auth/logout", nil, cookie)
	assertStatus(t, logout, http.StatusNoContent)
	denied = request(t, handler, http.MethodGet, "/api/targets", nil, cookie)
	assertStatus(t, denied, http.StatusUnauthorized)

	wrong := request(t, handler, http.MethodPost, "/api/auth/login", map[string]string{"username": "admin", "password": "wrong-password"}, nil)
	assertStatus(t, wrong, http.StatusUnauthorized)
	correct := request(t, handler, http.MethodPost, "/api/auth/login", map[string]string{"username": "admin", "password": "correct-horse"}, nil)
	assertStatus(t, correct, http.StatusOK)
	loginCookie := correct.Result().Cookies()[0]
	authenticated := request(t, handler, http.MethodGet, "/api/auth/status", nil, loginCookie)
	var signedIn map[string]bool
	if err := json.NewDecoder(authenticated.Body).Decode(&signedIn); err != nil {
		t.Fatal(err)
	}
	if signedIn["setupRequired"] || !signedIn["authenticated"] {
		t.Fatalf("unexpected signed-in status: %#v", signedIn)
	}
}

func newTestServer(t *testing.T) http.Handler {
	t.Helper()
	erpcServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": 1, "result": map[string]any{"projects": []any{}}})
	}))
	t.Cleanup(erpcServer.Close)
	reg, err := registry.New(config.RuntimeConfig{PollInterval: time.Second, Targets: []config.ResolvedTarget{{ID: "one", BaseURL: erpcServer.URL, Token: "secret"}}})
	if err != nil {
		t.Fatal(err)
	}
	accounts, err := adminauth.NewStore(filepath.Join(t.TempDir(), "administrator.json"))
	if err != nil {
		t.Fatal(err)
	}
	return New(reg, accounts, adminauth.NewSessions(time.Hour))
}

func request(t *testing.T, handler http.Handler, method, path string, body any, cookie *http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	var data []byte
	if body != nil {
		var err error
		data, err = json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(data))
	if cookie != nil {
		req.AddCookie(cookie)
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)
	return recorder
}

func assertStatus(t *testing.T, recorder *httptest.ResponseRecorder, want int) {
	t.Helper()
	if recorder.Code != want {
		t.Fatalf("status = %d, want %d; body=%s", recorder.Code, want, recorder.Body.String())
	}
}
