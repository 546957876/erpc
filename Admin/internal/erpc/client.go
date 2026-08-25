package erpc

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const maxResponseBytes int64 = 2 << 20

type RPCError struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
}

func (e *RPCError) Error() string {
	if e.Message == "" {
		return fmt.Sprintf("eRPC admin returned JSON-RPC error %d", e.Code)
	}
	return fmt.Sprintf("eRPC admin error %d: %s", e.Code, e.Message)
}

type HTTPError struct{ Status int }

func (e *HTTPError) Error() string { return fmt.Sprintf("eRPC admin HTTP status %d", e.Status) }

type Client struct {
	endpoint string
	token    string
	http     *http.Client
}

func NewClient(baseURL, token string) (*Client, error) {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		return nil, fmt.Errorf("eRPC base URL is required")
	}
	if strings.HasSuffix(baseURL, "/admin") {
		return &Client{endpoint: baseURL, token: token, http: &http.Client{Timeout: 8 * time.Second}}, nil
	}
	return &Client{endpoint: baseURL + "/admin", token: token, http: &http.Client{Timeout: 8 * time.Second}}, nil
}

func (c *Client) Call(ctx context.Context, method string, params any, out any) error {
	body := struct {
		JSONRPC string `json:"jsonrpc"`
		ID      int    `json:"id"`
		Method  string `json:"method"`
		Params  any    `json:"params,omitempty"`
	}{"2.0", 1, method, params}
	encoded, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal %s request: %w", method, err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(encoded))
	if err != nil {
		return fmt.Errorf("create %s request: %w", method, err)
	}
	req.Header.Set("content-type", "application/json")
	if c.token != "" {
		req.Header.Set("x-erpc-secret-token", c.token)
	}
	res, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("request %s: %w", method, err)
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, maxResponseBytes))
	if err != nil {
		return fmt.Errorf("read %s response: %w", method, err)
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return &HTTPError{Status: res.StatusCode}
	}
	var envelope struct {
		Result json.RawMessage `json:"result"`
		Error  *RPCError       `json:"error"`
	}
	if err := json.Unmarshal(data, &envelope); err != nil {
		return fmt.Errorf("decode %s response: %w", method, err)
	}
	if envelope.Error != nil {
		return envelope.Error
	}
	if out == nil || len(envelope.Result) == 0 || string(envelope.Result) == "null" {
		return nil
	}
	if err := json.Unmarshal(envelope.Result, out); err != nil {
		return fmt.Errorf("decode %s result: %w", method, err)
	}
	return nil
}

type Taxonomy struct {
	Projects []Project `json:"projects"`
}

type Project struct {
	ID       string    `json:"id"`
	Networks []Network `json:"networks"`
}

type Network struct {
	ID        string     `json:"id"`
	Alias     string     `json:"alias,omitempty"`
	Upstreams []Upstream `json:"upstreams"`
}

type Upstream struct {
	ID     string `json:"id"`
	Vendor string `json:"vendor,omitempty"`
}

type ProjectView struct {
	Config json.RawMessage `json:"config"`
	Health json.RawMessage `json:"health"`
}

type Cordons struct {
	ProjectID string        `json:"projectId"`
	Cordoned  []CordonEntry `json:"cordoned"`
}

type CordonEntry struct {
	Upstream string `json:"upstream"`
	Reason   string `json:"reason"`
}

type CordonRequest struct {
	ProjectID string `json:"projectId"`
	Upstream  string `json:"upstream"`
	Method    string `json:"method,omitempty"`
	Reason    string `json:"reason,omitempty"`
}

type CordonResult struct {
	ProjectID string `json:"projectId"`
	Upstream  string `json:"upstream"`
	Method    string `json:"method"`
	Cordoned  bool   `json:"cordoned"`
	Reason    string `json:"reason"`
}

func (c *Client) Taxonomy(ctx context.Context) (Taxonomy, error) {
	var result Taxonomy
	err := c.Call(ctx, "erpc_taxonomy", []any{}, &result)
	return result, err
}

func (c *Client) Project(ctx context.Context, projectID string) (ProjectView, error) {
	var result ProjectView
	err := c.Call(ctx, "erpc_project", []any{projectID}, &result)
	return result, err
}

func (c *Client) Cordons(ctx context.Context, projectID string) (Cordons, error) {
	var result Cordons
	err := c.Call(ctx, "erpc_listCordoned", []any{map[string]string{"projectId": projectID}}, &result)
	return result, err
}

func (c *Client) Cordon(ctx context.Context, method string, request CordonRequest) (CordonResult, error) {
	var result CordonResult
	if request.Method == "" {
		request.Method = "*"
	}
	err := c.Call(ctx, method, []any{request}, &result)
	return result, err
}
