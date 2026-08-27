package runtime

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/erpc/admin/internal/configdoc"
	"github.com/erpc/admin/internal/revisions"
)

const (
	StateStopped = "stopped"
	StateRunning = "running"
)

var (
	ErrAlreadyRunning       = errors.New("eRPC is already running")
	ErrNotRunning           = errors.New("eRPC is not running")
	ErrNoConfiguration      = errors.New("no eRPC configuration revision exists")
	ErrInvalidConfiguration = errors.New("latest eRPC configuration is invalid")
	processIsOwned          = isOwnedProcess
)

type Status struct {
	State            string     `json:"state"`
	PID              int        `json:"pid,omitempty"`
	ProcessStartedAt *time.Time `json:"processStartedAt,omitempty"`
	RunningRevision  int64      `json:"runningRevision,omitempty"`
	LatestRevision   int64      `json:"latestRevision,omitempty"`
	OutOfDate        bool       `json:"outOfDate"`
	BinaryVersion    string     `json:"binaryVersion"`
	BinaryCommit     string     `json:"binaryCommit"`
	LastError        string     `json:"lastError,omitempty"`
}

type Manager struct {
	mu              sync.Mutex
	db              *sql.DB
	revisions       *revisions.Store
	validator       configdoc.Validator
	binary          string
	runtimeDir      string
	shutdownTimeout time.Duration
	command         *exec.Cmd
	stopping        bool
	updateTarget    func(string, string, string) error
	clearTarget     func(string)
}

func (m *Manager) SetTargetUpdater(update func(string, string, string) error, clear func(string)) {
	m.mu.Lock()
	m.updateTarget = update
	m.clearTarget = clear
	m.mu.Unlock()
}

func (m *Manager) SyncTarget(ctx context.Context) error {
	status, err := m.Status(ctx)
	if err != nil || status.State != StateRunning || status.RunningRevision == 0 {
		return err
	}
	revision, err := m.revisions.Get(ctx, status.RunningRevision)
	if err != nil {
		return err
	}
	document, err := configdoc.ParseJSON(revision.Payload)
	if err != nil {
		return err
	}
	return m.updateManagedTarget(document)
}

func NewManager(db *sql.DB, revisionStore *revisions.Store, validator configdoc.Validator, binary, runtimeDir string, shutdownTimeout time.Duration) *Manager {
	return &Manager{db: db, revisions: revisionStore, validator: validator, binary: binary, runtimeDir: runtimeDir, shutdownTimeout: shutdownTimeout}
}

func (m *Manager) Status(ctx context.Context) (Status, error) {
	var pid sql.NullInt64
	var started sql.NullTime
	var runningRevision sql.NullInt64
	status := Status{State: StateStopped}
	if err := m.db.QueryRowContext(ctx, "SELECT pid, process_started_at, running_revision, binary_version, binary_commit, last_error FROM erpc_runtime WHERE singleton = true").Scan(&pid, &started, &runningRevision, &status.BinaryVersion, &status.BinaryCommit, &status.LastError); err != nil {
		return Status{}, fmt.Errorf("query eRPC runtime status: %w", err)
	}
	if pid.Valid && started.Valid && processIsOwned(int(pid.Int64), started.Time) {
		status.State = StateRunning
		status.PID = int(pid.Int64)
	}
	if started.Valid {
		value := started.Time
		status.ProcessStartedAt = &value
	}
	if runningRevision.Valid {
		status.RunningRevision = runningRevision.Int64
	}
	latest, err := m.revisions.Latest(ctx)
	if err == nil {
		status.LatestRevision = latest.Revision
	} else if !errors.Is(err, sql.ErrNoRows) {
		return Status{}, err
	}
	status.OutOfDate = status.LatestRevision != status.RunningRevision
	return status, nil
}

func (m *Manager) Start(ctx context.Context) (Status, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	status, err := m.Status(ctx)
	if err != nil {
		return Status{}, err
	}
	if status.State == StateRunning {
		return status, ErrAlreadyRunning
	}
	latest, err := m.revisions.Latest(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return Status{}, ErrNoConfiguration
	}
	if err != nil {
		return Status{}, err
	}
	document, err := configdoc.ParseJSON(latest.Payload)
	if err != nil {
		return Status{}, err
	}
	validation, err := m.validator.Validate(ctx, document)
	if err != nil {
		return Status{}, err
	}
	if !validation.Valid {
		return Status{}, fmt.Errorf("%w: %s", ErrInvalidConfiguration, strings.Join(validation.Errors, "; "))
	}
	configPath, err := writeRuntimeConfig(filepath.Join(m.runtimeDir, fmt.Sprintf("revision-%d", latest.Revision)), document.YAML)
	if err != nil {
		return Status{}, err
	}
	logFile, err := os.OpenFile(filepath.Join(m.runtimeDir, "erpc.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return Status{}, fmt.Errorf("open eRPC log: %w", err)
	}
	command := exec.Command(m.binary, "--config", configPath, "start")
	command.Dir = m.runtimeDir
	command.Stdout = logFile
	command.Stderr = logFile
	configureProcess(command)
	if err := command.Start(); err != nil {
		logFile.Close()
		return Status{}, fmt.Errorf("start eRPC process: %w", err)
	}
	startedAt := time.Now().UTC()
	if actual, ok := processCreationTime(command.Process.Pid); ok {
		startedAt = actual.UTC()
	}
	version := binaryVersion(m.binary)
	if _, err := m.db.ExecContext(ctx, "UPDATE erpc_runtime SET pid = $1, process_started_at = $2, running_revision = $3, binary_version = $4, last_error = '' WHERE singleton = true", command.Process.Pid, startedAt, latest.Revision, version); err != nil {
		_ = command.Process.Kill()
		logFile.Close()
		return Status{}, fmt.Errorf("persist eRPC process state: %w", err)
	}
	m.command = command
	m.stopping = false
	if err := m.updateManagedTarget(document); err != nil {
		_, _ = m.db.ExecContext(ctx, "UPDATE erpc_runtime SET last_error = $1 WHERE singleton = true", err.Error())
	}
	go m.wait(command, logFile)
	return Status{State: StateRunning, PID: command.Process.Pid, ProcessStartedAt: &startedAt, RunningRevision: latest.Revision, LatestRevision: latest.Revision, BinaryVersion: version}, nil
}

func (m *Manager) Stop(ctx context.Context) (Status, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	status, err := m.Status(ctx)
	if err != nil {
		return Status{}, err
	}
	if status.State != StateRunning {
		return status, ErrNotRunning
	}
	m.stopping = true
	_ = interruptProcess(status.PID)
	deadline := time.Now().Add(m.shutdownTimeout)
	for processIsOwned(status.PID, *status.ProcessStartedAt) && time.Now().Before(deadline) {
		time.Sleep(100 * time.Millisecond)
	}
	if processIsOwned(status.PID, *status.ProcessStartedAt) {
		if err := killProcess(status.PID); err != nil {
			return Status{}, fmt.Errorf("terminate eRPC process: %w", err)
		}
	}
	if _, err := m.db.ExecContext(ctx, "UPDATE erpc_runtime SET pid = NULL, process_started_at = NULL, last_error = '' WHERE singleton = true"); err != nil {
		return Status{}, fmt.Errorf("persist stopped eRPC state: %w", err)
	}
	if m.clearTarget != nil {
		m.clearTarget("local-erpc")
	}
	return Status{State: StateStopped, RunningRevision: status.RunningRevision, LatestRevision: status.LatestRevision, OutOfDate: status.LatestRevision != status.RunningRevision, BinaryVersion: status.BinaryVersion, BinaryCommit: status.BinaryCommit}, nil
}

func (m *Manager) Restart(ctx context.Context) (Status, error) {
	if _, err := m.Stop(ctx); err != nil && !errors.Is(err, ErrNotRunning) {
		return Status{}, err
	}
	return m.Start(ctx)
}

func (m *Manager) wait(command *exec.Cmd, logFile *os.File) {
	err := command.Wait()
	logFile.Close()
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.command != command {
		return
	}
	m.command = nil
	lastError := ""
	if err != nil && !m.stopping {
		lastError = err.Error()
	}
	m.stopping = false
	if m.clearTarget != nil {
		m.clearTarget("local-erpc")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, _ = m.db.ExecContext(ctx, "UPDATE erpc_runtime SET pid = NULL, process_started_at = NULL, last_error = $1 WHERE singleton = true", lastError)
}

func writeRuntimeConfig(runtimeDir string, data []byte) (string, error) {
	if err := os.MkdirAll(runtimeDir, 0o700); err != nil {
		return "", fmt.Errorf("create eRPC runtime directory: %w", err)
	}
	temporary, err := os.CreateTemp(runtimeDir, "erpc-*.yaml")
	if err != nil {
		return "", fmt.Errorf("create generated eRPC config: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return "", fmt.Errorf("secure generated eRPC config: %w", err)
	}
	if _, err := temporary.Write(data); err != nil {
		temporary.Close()
		return "", fmt.Errorf("write generated eRPC config: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return "", fmt.Errorf("close generated eRPC config: %w", err)
	}
	path, err := filepath.Abs(filepath.Join(runtimeDir, "erpc.yaml"))
	if err != nil {
		return "", fmt.Errorf("resolve generated eRPC config path: %w", err)
	}
	if existing, err := os.ReadFile(path); err == nil {
		if string(existing) == string(data) {
			return path, nil
		}
		return "", fmt.Errorf("generated eRPC config %q already exists with different content", path)
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", fmt.Errorf("read generated eRPC config: %w", err)
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return "", fmt.Errorf("install generated eRPC config: %w", err)
	}
	return path, nil
}

func binaryVersion(binary string) string {
	output, err := exec.Command(binary, "--version").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(output))
}

func (m *Manager) updateManagedTarget(document configdoc.Document) error {
	if m.updateTarget == nil {
		return nil
	}
	baseURL, token, ok := managedTarget(document)
	if !ok {
		return nil
	}
	return m.updateTarget("local-erpc", baseURL, token)
}

func managedTarget(document configdoc.Document) (string, string, bool) {
	var payload map[string]any
	if err := json.Unmarshal(document.Payload, &payload); err != nil {
		return "", "", false
	}
	// The managed eRPC configuration may omit the admin block entirely. The
	// admin service still needs a target in that case so the UI can surface the
	// actual unauthorized response instead of showing an empty instance list.
	admin, _ := payload["admin"].(map[string]any)
	server, _ := payload["server"].(map[string]any)
	host, _ := server["httpHostV4"].(string)
	if host == "" || host == "0.0.0.0" {
		host = "127.0.0.1"
	}
	port := 4000
	if number, ok := server["httpPortV4"].(float64); ok && number > 0 {
		port = int(number)
	} else if number, ok := server["httpPort"].(float64); ok && number > 0 {
		port = int(number)
	}
	scheme := "http"
	if tls, ok := server["tls"].(map[string]any); ok {
		enabled, _ := tls["enabled"].(bool)
		if enabled {
			scheme = "https"
		}
	}
	token := ""
	if auth, ok := admin["auth"].(map[string]any); ok {
		if strategies, ok := auth["strategies"].([]any); ok {
			for _, item := range strategies {
				strategy, _ := item.(map[string]any)
				if strategy["type"] != "secret" {
					continue
				}
				secret, _ := strategy["secret"].(map[string]any)
				token, _ = secret["value"].(string)
				break
			}
		}
	}
	return scheme + "://" + net.JoinHostPort(host, fmt.Sprint(port)), token, true
}
