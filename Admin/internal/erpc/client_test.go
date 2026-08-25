package erpc

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClientCallAndTaxonomy(t *testing.T) {
	httpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/admin" || r.Header.Get("x-erpc-secret-token") != "secret" {
			t.Fatalf("unexpected request: %s %s", r.URL.Path, r.Header.Get("x-erpc-secret-token"))
		}
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil || request["method"] != "erpc_taxonomy" {
			t.Fatalf("unexpected JSON-RPC request: %#v, err=%v", request, err)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": 1, "result": map[string]any{"projects": []any{}}})
	}))
	defer httpServer.Close()
	client, err := NewClient(httpServer.URL, "secret")
	if err != nil {
		t.Fatal(err)
	}
	result, err := client.Taxonomy(context.Background())
	if err != nil || result.Projects == nil {
		t.Fatalf("unexpected result: %#v, err=%v", result, err)
	}
}

func TestClientMapsRPCError(t *testing.T) {
	httpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": 1, "error": map[string]any{"code": -32000, "message": "bad"}})
	}))
	defer httpServer.Close()
	client, _ := NewClient(httpServer.URL, "secret")
	_, err := client.Taxonomy(context.Background())
	rpcErr, ok := err.(*RPCError)
	if !ok || rpcErr.Code != -32000 {
		t.Fatalf("expected RPC error, got %T %v", err, err)
	}
}
