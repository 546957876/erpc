package server

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	adminauth "github.com/erpc/admin/internal/auth"
	"github.com/erpc/admin/internal/config"
	"github.com/erpc/admin/internal/erpc"
	"github.com/erpc/admin/internal/registry"
)

func TestPublicErrorUsesChineseMessages(t *testing.T) {
	if got := publicError(&erpc.HTTPError{Status: http.StatusUnauthorized}); got != "eRPC 管理接口返回 HTTP 状态 401" {
		t.Fatalf("HTTP error = %q", got)
	}
	if got := publicError(&erpc.RPCError{Code: -32000}); got != "eRPC 管理接口拒绝请求（错误码 -32000）" {
		t.Fatalf("RPC error = %q", got)
	}
}

func TestRespondRPCMapsMissingAdminAuthToUnauthorized(t *testing.T) {
	recorder := httptest.NewRecorder()
	(&Server{}).respondRPC(recorder, nil, &erpc.RPCError{Code: -32603, Message: "admin auth not configured"})
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusUnauthorized)
	}
	if !strings.Contains(recorder.Body.String(), "错误码 -32603") {
		t.Fatalf("response = %s", recorder.Body.String())
	}
}

func TestServerAccountSetupLoginAndProtection(t *testing.T) {
	handler := newTestServer(t)
	options := request(t, handler, http.MethodOptions, "/api/config/revisions/2", nil, nil)
	assertStatus(t, options, http.StatusNoContent)
	if got := options.Header().Get("access-control-allow-methods"); got != "GET,POST,DELETE,OPTIONS" {
		t.Fatalf("CORS methods = %q", got)
	}

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

func TestRuntimeRPCTestRoute(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/main" {
			t.Fatalf("path = %q, want /main", r.URL.Path)
		}
		if r.Header.Get("X-ERPC-Skip-Cache-Read") != "true" || r.Header.Get("X-ERPC-Use-Upstream") != "node-a" {
			t.Fatalf("directives = %#v", r.Header)
		}
		if r.Header.Get("X-ERPC-Secret-Token") != "project-secret" {
			t.Fatalf("project secret = %q", r.Header.Get("X-ERPC-Secret-Token"))
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["networkId"] != "future:network" || body["method"] != "future_method" {
			t.Fatalf("body = %#v", body)
		}
		w.Header().Set("X-ERPC-Upstream", "node-a")
		w.Header().Set("X-ERPC-Cache", "MISS")
		_, _ = io.WriteString(w, `{"jsonrpc":"2.0","id":1,"result":"ok"}`)
	}))
	defer upstream.Close()

	reg, err := registry.New(config.RuntimeConfig{PollInterval: time.Second, Targets: []config.ResolvedTarget{{ID: "target/one", BaseURL: upstream.URL, Token: "secret"}}})
	if err != nil {
		t.Fatal(err)
	}
	accounts, err := adminauth.NewStore(filepath.Join(t.TempDir(), "administrator.json"))
	if err != nil {
		t.Fatal(err)
	}
	handler := New(reg, accounts, adminauth.NewSessions(time.Hour))
	unauthorized := request(t, handler, http.MethodPost, "/api/targets/target%2Fone/rpc-test", map[string]any{"projectId": "main", "networkId": "future:network", "method": "future_method", "params": []any{}}, nil)
	assertStatus(t, unauthorized, http.StatusUnauthorized)
	setup := request(t, handler, http.MethodPost, "/api/auth/setup", map[string]string{"username": "admin", "password": "correct-horse"}, nil)
	cookie := setup.Result().Cookies()[0]

	response := request(t, handler, http.MethodPost, "/api/targets/target%2Fone/rpc-test", map[string]any{"projectId": "main", "networkId": "future:network", "upstreamId": "node-a", "projectSecret": "project-secret", "method": "future_method", "params": map[string]any{"open": true}}, cookie)
	assertStatus(t, response, http.StatusOK)
	var result struct {
		HTTPStatus int    `json:"httpStatus"`
		Upstream   string `json:"upstream"`
		Cache      string `json:"cache"`
	}
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if result.HTTPStatus != http.StatusOK || result.Upstream != "node-a" || result.Cache != "MISS" {
		t.Fatalf("result = %#v", result)
	}

	missing := request(t, handler, http.MethodPost, "/api/targets/missing/rpc-test", map[string]any{"projectId": "main", "networkId": "evm:1", "method": "eth_chainId"}, cookie)
	assertStatus(t, missing, http.StatusNotFound)
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
