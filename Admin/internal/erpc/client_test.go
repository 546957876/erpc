package erpc

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
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

func TestClientTestRPCForwardsOpenValuesAndReturnsDiagnostics(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/ main " {
			t.Fatalf("path = %q, want / main ", r.URL.Path)
		}
		if got := r.Header.Get("x-erpc-secret-token"); got != "project-secret" {
			t.Fatalf("project secret = %q", got)
		}
		if got := r.Header.Get("X-ERPC-Skip-Cache-Read"); got != "true" {
			t.Fatalf("skip cache directive = %q", got)
		}
		if got := r.Header.Get("X-ERPC-Use-Upstream"); got != "future-upstream" {
			t.Fatalf("upstream directive = %q", got)
		}
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		if request["method"] != " future_method " || request["networkId"] != " future:chain:segment " {
			t.Fatalf("request = %#v", request)
		}
		params, ok := request["params"].(map[string]any)
		if !ok || params["future"] != true {
			t.Fatalf("params = %#v", request["params"])
		}
		w.Header().Set("X-ERPC-Upstream", "future-upstream")
		w.Header().Set("X-ERPC-Upstreams", "future-upstream=primary:success:7ms:won")
		w.Header().Set("X-ERPC-Cache", "MISS")
		w.Header().Set("X-Private-Header", "must-not-be-returned")
		w.WriteHeader(http.StatusAccepted)
		_, _ = io.WriteString(w, `{"jsonrpc":"2.0","id":1,"result":"future-result"}`)
	}))
	defer server.Close()

	client, err := NewClient(server.URL, "secret")
	if err != nil {
		t.Fatal(err)
	}
	result, err := client.TestRPC(context.Background(), TestRequest{
		ProjectID:     " main ",
		NetworkID:     " future:chain:segment ",
		UpstreamID:    "future-upstream",
		Method:        " future_method ",
		Params:        json.RawMessage(`{"future":true}`),
		ProjectSecret: "project-secret",
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.HTTPStatus != http.StatusAccepted || result.Upstream != "future-upstream" || result.Cache != "MISS" {
		t.Fatalf("result = %#v", result)
	}
	if result.Upstreams != "future-upstream=primary:success:7ms:won" || !strings.Contains(result.Body, "future-result") {
		t.Fatalf("result = %#v", result)
	}
}

func TestClientAdminCallFollowsRedirect(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/admin":
			http.Redirect(w, r, "/admin/", http.StatusTemporaryRedirect)
		case "/admin/":
			if r.Header.Get("x-erpc-secret-token") != "secret" {
				t.Fatal("redirected admin request lost its token")
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": 1, "result": map[string]any{"projects": []any{}}})
		default:
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
	}))
	defer server.Close()

	client, err := NewClient(server.URL, "secret")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.Taxonomy(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestClientAdminCallRejectsCrossOriginRedirect(t *testing.T) {
	var redirected atomic.Int32
	sink := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		redirected.Add(1)
		if token := r.Header.Get("x-erpc-secret-token"); token != "" {
			t.Errorf("cross-origin request leaked admin token %q", token)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": 1, "result": map[string]any{"projects": []any{}}})
	}))
	defer sink.Close()

	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, sink.URL+"/capture", http.StatusTemporaryRedirect)
	}))
	defer source.Close()

	client, err := NewClient(source.URL, "admin-secret")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.Taxonomy(context.Background()); err == nil {
		t.Fatal("expected cross-origin admin redirect to be rejected")
	}
	if got := redirected.Load(); got != 0 {
		t.Fatalf("cross-origin redirect target received %d requests", got)
	}
}

func TestRPCTestsDoNotFollowRedirects(t *testing.T) {
	var redirected atomic.Int32
	sink := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		redirected.Add(1)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer sink.Close()

	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, sink.URL+"/capture", http.StatusTemporaryRedirect)
	}))
	defer source.Close()

	direct, err := TestEndpoint(context.Background(), source.URL, nil, TestRequest{Method: "future_method"})
	if err != nil {
		t.Fatal(err)
	}
	if direct.HTTPStatus != http.StatusTemporaryRedirect {
		t.Fatalf("direct status = %d, want %d", direct.HTTPStatus, http.StatusTemporaryRedirect)
	}

	client, err := NewClient(source.URL, "admin-secret")
	if err != nil {
		t.Fatal(err)
	}
	runtime, err := client.TestRPC(context.Background(), TestRequest{ProjectID: "main", NetworkID: "future:network", Method: "future_method"})
	if err != nil {
		t.Fatal(err)
	}
	if runtime.HTTPStatus != http.StatusTemporaryRedirect {
		t.Fatalf("runtime status = %d, want %d", runtime.HTTPStatus, http.StatusTemporaryRedirect)
	}
	if got := redirected.Load(); got != 0 {
		t.Fatalf("RPC redirect target received %d requests", got)
	}
}

func TestNewClientOnlyTreatsAdminAsAPathSegment(t *testing.T) {
	client, err := NewClient("http://admin", "secret")
	if err != nil {
		t.Fatal(err)
	}
	if client.baseURL != "http://admin" || client.endpoint != "http://admin/admin" {
		t.Fatalf("client URLs = base %q, admin %q", client.baseURL, client.endpoint)
	}
}

func TestEndpointPreservesTestedHTTPFailureWithoutERPCDirectives(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer vendor-secret" {
			t.Fatalf("configured authorization header = %q", got)
		}
		if got := r.Header.Get("X-ERPC-Skip-Cache-Read"); got != "" {
			t.Fatalf("direct request received skip-cache directive %q", got)
		}
		if got := r.Header.Get("X-ERPC-Use-Upstream"); got != "" {
			t.Fatalf("direct request received upstream directive %q", got)
		}
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		if _, exists := request["networkId"]; exists {
			t.Fatalf("direct request must not include networkId: %#v", request)
		}
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = io.WriteString(w, "rate limited")
	}))
	defer server.Close()

	result, err := TestEndpoint(context.Background(), server.URL, map[string]string{"Authorization": "Bearer vendor-secret"}, TestRequest{Method: "custom_probe", Params: json.RawMessage(`[]`)})
	if err != nil {
		t.Fatal(err)
	}
	if result.HTTPStatus != http.StatusTooManyRequests || result.Body != "rate limited" {
		t.Fatalf("result = %#v", result)
	}
}

func TestRPCTestRejectsInvalidInputAndOversizedResponses(t *testing.T) {
	if _, err := TestEndpoint(context.Background(), "file:///private/config", nil, TestRequest{Method: "eth_chainId"}); err == nil {
		t.Fatal("expected non-HTTP endpoint to be rejected")
	}
	if _, err := TestEndpoint(context.Background(), "https://rpc.example", nil, TestRequest{Method: "eth_chainId", Params: json.RawMessage(`"not-params"`)}); err == nil {
		t.Fatal("expected scalar params to be rejected")
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, strings.Repeat("x", int(maxResponseBytes)+1))
	}))
	defer server.Close()
	if _, err := TestEndpoint(context.Background(), server.URL, nil, TestRequest{Method: "eth_chainId"}); err == nil {
		t.Fatal("expected oversized response to be rejected")
	}
}
