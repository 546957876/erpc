package registry

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/erpc/admin/internal/config"
)

func TestPollTransitionsFromHealthyToDegraded(t *testing.T) {
	requests := 0
	httpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests++
		if requests > 1 {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": 1, "result": map[string]any{"projects": []any{}}})
	}))
	defer httpServer.Close()
	cfg := config.RuntimeConfig{PollInterval: time.Second, Targets: []config.ResolvedTarget{{ID: "one", BaseURL: httpServer.URL, Token: "secret"}}}
	reg, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if err := reg.PollOnce(context.Background(), "one"); err != nil {
		t.Fatal(err)
	}
	snapshot, _ := reg.Snapshot("one")
	if snapshot.Status != Healthy {
		t.Fatalf("expected healthy, got %s", snapshot.Status)
	}
	if err := reg.PollOnce(context.Background(), "one"); err == nil {
		t.Fatal("expected second poll failure")
	}
	snapshot, _ = reg.Snapshot("one")
	if snapshot.Status != Degraded || snapshot.FailureCount != 1 {
		t.Fatalf("expected degraded snapshot, got %#v", snapshot)
	}
}

func TestPollMarksMissingAdminAuthAsUnauthorized(t *testing.T) {
	httpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"jsonrpc": "2.0",
			"id":      1,
			"error": map[string]any{
				"code":    -32603,
				"message": "admin auth not configured",
			},
		})
	}))
	defer httpServer.Close()

	reg, err := New(config.RuntimeConfig{PollInterval: time.Second, Targets: []config.ResolvedTarget{{ID: "one", BaseURL: httpServer.URL, Token: "secret"}}})
	if err != nil {
		t.Fatal(err)
	}
	if err := reg.PollOnce(context.Background(), "one"); err == nil {
		t.Fatal("expected admin authentication error")
	}
	snapshot, _ := reg.Snapshot("one")
	if snapshot.Status != Unauthorized {
		t.Fatalf("expected unauthorized snapshot, got %#v", snapshot)
	}
}

func TestSetManagedTarget(t *testing.T) {
	httpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": 1, "result": map[string]any{"projects": []any{}}})
	}))
	defer httpServer.Close()
	reg, err := New(config.RuntimeConfig{PollInterval: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	if err := reg.SetTarget("local-erpc", httpServer.URL, "secret"); err != nil {
		t.Fatal(err)
	}
	if err := reg.PollOnce(context.Background(), "local-erpc"); err != nil {
		t.Fatal(err)
	}
	if snapshot, ok := reg.Snapshot("local-erpc"); !ok || snapshot.Status != Healthy {
		t.Fatalf("unexpected managed target: %#v, exists=%v", snapshot, ok)
	}
	reg.ClearTarget("local-erpc")
	if _, ok := reg.Snapshot("local-erpc"); ok {
		t.Fatal("managed target was not cleared")
	}
}

func TestClearAndReplaceManagedTargetRestartsPollingHandle(t *testing.T) {
	requests := make(chan struct{}, 8)
	httpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests <- struct{}{}
		_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": 1, "result": map[string]any{"projects": []any{}}})
	}))
	defer httpServer.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	reg, err := New(config.RuntimeConfig{PollInterval: time.Hour})
	if err != nil {
		t.Fatal(err)
	}
	reg.Start(ctx)
	if err := reg.SetTarget("local-erpc", httpServer.URL, "secret"); err != nil {
		t.Fatal(err)
	}
	select {
	case <-requests:
	case <-time.After(time.Second):
		t.Fatal("initial managed target poll did not run")
	}
	reg.ClearTarget("local-erpc")
	if err := reg.SetTarget("local-erpc", httpServer.URL, "secret"); err != nil {
		t.Fatal(err)
	}
	select {
	case <-requests:
	case <-time.After(time.Second):
		t.Fatal("replacement managed target poll did not run")
	}
}
