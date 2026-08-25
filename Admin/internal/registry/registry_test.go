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
