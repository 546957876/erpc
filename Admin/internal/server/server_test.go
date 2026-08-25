package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/erpc/admin/internal/config"
	"github.com/erpc/admin/internal/registry"
)

func TestServerAuthAndTargets(t *testing.T) {
	erpcServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": 1, "result": map[string]any{"projects": []any{}}})
	}))
	defer erpcServer.Close()
	reg, err := registry.New(config.RuntimeConfig{PollInterval: time.Second, Targets: []config.ResolvedTarget{{ID: "one", BaseURL: erpcServer.URL, Token: "secret"}}})
	if err != nil {
		t.Fatal(err)
	}
	handler := New(reg, "web-secret")
	unauthorized := httptest.NewRecorder()
	handler.ServeHTTP(unauthorized, httptest.NewRequest(http.MethodGet, "/api/targets", nil))
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", unauthorized.Code)
	}
	request := httptest.NewRequest(http.MethodGet, "/api/targets", nil)
	request.Header.Set("x-admin-token", "web-secret")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}
	var snapshots []registry.Snapshot
	if err := json.NewDecoder(recorder.Body).Decode(&snapshots); err != nil || len(snapshots) != 1 {
		t.Fatalf("unexpected response: %#v, err=%v", snapshots, err)
	}
}
