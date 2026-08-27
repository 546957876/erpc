package registry

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/erpc/admin/internal/config"
	"github.com/erpc/admin/internal/erpc"
)

type Status string

const (
	Healthy      Status = "healthy"
	Degraded     Status = "degraded"
	Offline      Status = "offline"
	Unauthorized Status = "unauthorized"
)

type Snapshot struct {
	ID            string        `json:"id"`
	BaseURL       string        `json:"baseUrl"`
	Status        Status        `json:"status"`
	LastAttemptAt *time.Time    `json:"lastAttemptAt,omitempty"`
	LastSuccessAt *time.Time    `json:"lastSuccessAt,omitempty"`
	LatencyMs     int64         `json:"latencyMs,omitempty"`
	FailureCount  int           `json:"failureCount"`
	LastError     string        `json:"lastError,omitempty"`
	Taxonomy      erpc.Taxonomy `json:"taxonomy"`
}

type Target struct {
	ID      string
	BaseURL string
	Client  *erpc.Client

	mu   sync.RWMutex
	snap Snapshot
}

type Registry struct {
	mu       sync.RWMutex
	targets  map[string]*Target
	polling  map[string]pollingHandle
	interval time.Duration
	ctx      context.Context
}

type pollingHandle struct {
	cancel context.CancelFunc
	token  chan struct{}
}

func New(cfg config.RuntimeConfig) (*Registry, error) {
	r := &Registry{targets: make(map[string]*Target), polling: make(map[string]pollingHandle), interval: cfg.PollInterval}
	if r.interval <= 0 {
		r.interval = 10 * time.Second
	}
	for _, resolved := range cfg.Targets {
		client, err := erpc.NewClient(resolved.BaseURL, resolved.Token)
		if err != nil {
			return nil, fmt.Errorf("target %q: %w", resolved.ID, err)
		}
		r.targets[resolved.ID] = &Target{ID: resolved.ID, BaseURL: resolved.BaseURL, Client: client, snap: Snapshot{ID: resolved.ID, BaseURL: resolved.BaseURL, Status: Offline, Taxonomy: erpc.Taxonomy{Projects: []erpc.Project{}}}}
	}
	return r, nil
}

func (r *Registry) Start(ctx context.Context) {
	r.mu.Lock()
	r.ctx = ctx
	ids := make([]string, 0, len(r.targets))
	for id := range r.targets {
		ids = append(ids, id)
	}
	r.mu.Unlock()
	for _, id := range ids {
		r.startPolling(id)
	}
}

func (r *Registry) SetTarget(id, baseURL, token string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return fmt.Errorf("target id is required")
	}
	client, err := erpc.NewClient(baseURL, token)
	if err != nil {
		return fmt.Errorf("target %q: %w", id, err)
	}
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	r.mu.Lock()
	r.targets[id] = &Target{ID: id, BaseURL: baseURL, Client: client, snap: Snapshot{ID: id, BaseURL: baseURL, Status: Offline, Taxonomy: erpc.Taxonomy{Projects: []erpc.Project{}}}}
	r.mu.Unlock()
	r.startPolling(id)
	return nil
}

func (r *Registry) ClearTarget(id string) {
	r.mu.Lock()
	if handle, ok := r.polling[id]; ok {
		handle.cancel()
		delete(r.polling, id)
	}
	delete(r.targets, id)
	r.mu.Unlock()
}

func (r *Registry) startPolling(id string) {
	r.mu.Lock()
	parent := r.ctx
	if parent == nil {
		r.mu.Unlock()
		return
	}
	if _, exists := r.polling[id]; exists {
		r.mu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(parent)
	token := make(chan struct{})
	r.polling[id] = pollingHandle{cancel: cancel, token: token}
	r.mu.Unlock()
	go func() {
		defer func() {
			r.mu.Lock()
			if current, ok := r.polling[id]; ok && current.token == token {
				delete(r.polling, id)
			}
			r.mu.Unlock()
		}()
		_ = r.PollOnce(ctx, id)
		ticker := time.NewTicker(r.interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				_ = r.PollOnce(ctx, id)
			}
		}
	}()
}

func (r *Registry) targetsCopy() []*Target {
	r.mu.RLock()
	defer r.mu.RUnlock()
	items := make([]*Target, 0, len(r.targets))
	for _, target := range r.targets {
		items = append(items, target)
	}
	return items
}

func (r *Registry) Target(id string) (*Target, bool) {
	r.mu.RLock()
	target, ok := r.targets[id]
	r.mu.RUnlock()
	return target, ok
}

func (r *Registry) List() []Snapshot {
	items := make([]Snapshot, 0)
	for _, target := range r.targetsCopy() {
		target.mu.RLock()
		snapshot := target.snap
		target.mu.RUnlock()
		items = append(items, snapshot)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].ID < items[j].ID })
	return items
}

func (r *Registry) Snapshot(id string) (Snapshot, bool) {
	target, ok := r.Target(id)
	if !ok {
		return Snapshot{}, false
	}
	target.mu.RLock()
	snapshot := target.snap
	target.mu.RUnlock()
	return snapshot, true
}

func (r *Registry) PollOnce(ctx context.Context, id string) error {
	target, ok := r.Target(id)
	if !ok {
		return fmt.Errorf("target %q not found", id)
	}
	now := time.Now().UTC()
	target.mu.Lock()
	target.snap.LastAttemptAt = &now
	target.mu.Unlock()
	started := time.Now()
	taxonomy, err := target.Client.Taxonomy(ctx)
	latency := time.Since(started).Milliseconds()
	target.mu.Lock()
	defer target.mu.Unlock()
	target.snap.LatencyMs = latency
	if err == nil {
		success := time.Now().UTC()
		target.snap.LastSuccessAt = &success
		target.snap.Status = Healthy
		target.snap.FailureCount = 0
		target.snap.LastError = ""
		target.snap.Taxonomy = taxonomy
		return nil
	}
	target.snap.FailureCount++
	target.snap.LastError = safeError(err)
	var httpErr *erpc.HTTPError
	if errors.As(err, &httpErr) && httpErr.Status == 401 {
		target.snap.Status = Unauthorized
	} else if target.snap.LastSuccessAt != nil {
		target.snap.Status = Degraded
	} else {
		target.snap.Status = Offline
	}
	return err
}

func safeError(err error) string {
	var rpcErr *erpc.RPCError
	if errors.As(err, &rpcErr) {
		return fmt.Sprintf("eRPC RPC 错误 %d", rpcErr.Code)
	}
	var httpErr *erpc.HTTPError
	if errors.As(err, &httpErr) {
		return fmt.Sprintf("eRPC HTTP 状态 %d", httpErr.Status)
	}
	message := strings.TrimSpace(err.Error())
	if len(message) > 256 {
		return message[:256]
	}
	return message
}
