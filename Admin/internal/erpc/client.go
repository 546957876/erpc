package erpc

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const maxResponseBytes int64 = 2 << 20

var ErrInvalidTestRequest = errors.New("invalid RPC test request")

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
	baseURL  string
	endpoint string
	token    string
	http     *http.Client
}

func NewClient(baseURL, token string) (*Client, error) {
	baseURL = strings.TrimSpace(baseURL)
	if baseURL == "" {
		return nil, fmt.Errorf("eRPC base URL is required")
	}
	parsed, err := url.Parse(baseURL)
	if err != nil {
		return nil, fmt.Errorf("parse eRPC base URL: %w", err)
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	parsed.RawPath = ""
	rpcURL := *parsed
	adminURL := *parsed
	if strings.HasSuffix(parsed.Path, "/admin") {
		rpcURL.Path = strings.TrimSuffix(parsed.Path, "/admin")
	} else {
		adminURL.Path = parsed.Path + "/admin"
	}
	httpClient := &http.Client{Timeout: 8 * time.Second}
	httpClient.CheckRedirect = checkAdminRedirect
	return &Client{baseURL: rpcURL.String(), endpoint: adminURL.String(), token: token, http: httpClient}, nil
}

func checkAdminRedirect(req *http.Request, via []*http.Request) error {
	if len(via) >= 10 {
		return fmt.Errorf("stopped after 10 redirects")
	}
	if len(via) == 0 || !sameOrigin(req.URL, via[0].URL) {
		return http.ErrUseLastResponse
	}
	return nil
}

func sameOrigin(left, right *url.URL) bool {
	return strings.EqualFold(left.Scheme, right.Scheme) &&
		strings.EqualFold(left.Hostname(), right.Hostname()) &&
		effectivePort(left) == effectivePort(right)
}

func effectivePort(value *url.URL) string {
	if port := value.Port(); port != "" {
		return port
	}
	switch strings.ToLower(value.Scheme) {
	case "http":
		return "80"
	case "https":
		return "443"
	default:
		return ""
	}
}

type TestRequest struct {
	ProjectID     string          `json:"projectId"`
	NetworkID     string          `json:"networkId,omitempty"`
	UpstreamID    string          `json:"upstreamId,omitempty"`
	ProjectSecret string          `json:"projectSecret,omitempty"`
	Method        string          `json:"method"`
	Params        json.RawMessage `json:"params,omitempty"`
}

type TestResult struct {
	HTTPStatus int    `json:"httpStatus"`
	DurationMs int64  `json:"durationMs"`
	Body       string `json:"body"`
	Upstream   string `json:"upstream,omitempty"`
	Upstreams  string `json:"upstreams,omitempty"`
	Cache      string `json:"cache,omitempty"`
}

func (c *Client) TestRPC(ctx context.Context, input TestRequest) (TestResult, error) {
	if strings.TrimSpace(input.ProjectID) == "" || strings.TrimSpace(input.NetworkID) == "" {
		return TestResult{}, fmt.Errorf("%w: projectId and networkId are required", ErrInvalidTestRequest)
	}
	endpoint := c.baseURL + "/" + url.PathEscape(input.ProjectID)
	httpClient := *c.http
	httpClient.CheckRedirect = func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}
	return doRPCTest(ctx, &httpClient, endpoint, nil, input, true)
}

func TestEndpoint(ctx context.Context, endpoint string, headers map[string]string, input TestRequest) (TestResult, error) {
	httpClient := &http.Client{
		Timeout: 8 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	return doRPCTest(ctx, httpClient, endpoint, headers, input, false)
}

func doRPCTest(ctx context.Context, httpClient *http.Client, endpoint string, headers map[string]string, input TestRequest, runtime bool) (TestResult, error) {
	parsed, err := url.Parse(strings.TrimSpace(endpoint))
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return TestResult{}, fmt.Errorf("%w: RPC endpoint must be an absolute HTTP(S) URL", ErrInvalidTestRequest)
	}
	if strings.TrimSpace(input.Method) == "" {
		return TestResult{}, fmt.Errorf("%w: method is required", ErrInvalidTestRequest)
	}
	params := bytes.TrimSpace(input.Params)
	if len(params) == 0 {
		params = json.RawMessage(`[]`)
	}
	var decodedParams any
	if err := json.Unmarshal(params, &decodedParams); err != nil {
		return TestResult{}, fmt.Errorf("%w: params must be valid JSON: %v", ErrInvalidTestRequest, err)
	}
	switch decodedParams.(type) {
	case []any, map[string]any:
	default:
		return TestResult{}, fmt.Errorf("%w: params must be a JSON array or object", ErrInvalidTestRequest)
	}
	body := struct {
		JSONRPC   string          `json:"jsonrpc"`
		ID        int             `json:"id"`
		Method    string          `json:"method"`
		Params    json.RawMessage `json:"params"`
		NetworkID string          `json:"networkId,omitempty"`
	}{JSONRPC: "2.0", ID: 1, Method: input.Method, Params: params}
	if runtime {
		body.NetworkID = input.NetworkID
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return TestResult{}, fmt.Errorf("marshal RPC test request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, parsed.String(), bytes.NewReader(encoded))
	if err != nil {
		return TestResult{}, fmt.Errorf("create RPC test request: %w", err)
	}
	req.Header.Set("content-type", "application/json")
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	if runtime {
		if input.ProjectSecret != "" {
			req.Header.Set("X-ERPC-Secret-Token", input.ProjectSecret)
		}
		req.Header.Set("X-ERPC-Skip-Cache-Read", "true")
		if strings.TrimSpace(input.UpstreamID) != "" {
			req.Header.Set("X-ERPC-Use-Upstream", input.UpstreamID)
		}
	}
	started := time.Now()
	response, err := httpClient.Do(req)
	if err != nil {
		return TestResult{}, fmt.Errorf("send RPC test request: %w", err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if err != nil {
		return TestResult{}, fmt.Errorf("read RPC test response: %w", err)
	}
	if int64(len(data)) > maxResponseBytes {
		return TestResult{}, fmt.Errorf("RPC test response exceeds %d bytes", maxResponseBytes)
	}
	return TestResult{
		HTTPStatus: response.StatusCode,
		DurationMs: time.Since(started).Milliseconds(),
		Body:       string(data),
		Upstream:   response.Header.Get("X-ERPC-Upstream"),
		Upstreams:  response.Header.Get("X-ERPC-Upstreams"),
		Cache:      response.Header.Get("X-ERPC-Cache"),
	}, nil
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
