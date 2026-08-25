# Managed eRPC Admin Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Extend the standalone Admin and Chinese Web applications so one local eRPC process is configured through versioned PostgreSQL documents and explicitly started, stopped, or restarted without modifying eRPC itself.

**Architecture:** PostgreSQL stores the single administrator and immutable full-document configuration revisions. Admin converts the selected document to YAML, validates it through the configured eRPC executable, and owns the resulting Windows process. Saving and runtime application stay separate: a save creates a revision, while start/restart applies the latest valid revision.

**Tech Stack:** Go 1.25, database/sql with pgx PostgreSQL driver, yaml.v3, bcrypt, Windows x/sys process APIs, React 19, React Router, Redux Toolkit, TanStack Query, Ant Design, Tailwind CSS, TypeScript, Vitest.

---

## Scope and ordering

Execute tasks in order. Each task leaves a testable product increment. Do not modify eRPC root Go packages, common.Config, cmd/erpc, root go.mod, or the root pnpm workspace.

The accepted product decisions are recorded in specs/admin-web/feature.md. In particular:

- PostgreSQL, not SQLite;
- one local Admin-owned eRPC process;
- complete JSON document per revision, not normalized config tables;
- plaintext eRPC secrets in PostgreSQL and generated YAML;
- bcrypt-only administrator password storage;
- no save-time restart and no eRPC hot reload;
- Chinese field forms for the complete pinned eRPC configuration; YAML is
  generated internally and never entered by the user.

## Planned file structure

Backend responsibilities:

~~~text
Admin/internal/database/     PostgreSQL connection and embedded schema
Admin/internal/auth/         PostgreSQL administrator store and in-memory sessions
Admin/internal/configdoc/    YAML/JSON conversion, hashing, eRPC CLI validation
Admin/internal/revisions/    Immutable configuration revision queries
Admin/internal/runtime/      One-process ownership, generated YAML, status
Admin/internal/server/       Authenticated HTTP routing only
Admin/internal/erpc/         Existing live /admin client and response headers
~~~

Frontend responsibilities:

~~~text
web/src/app/api.ts           HTTP types, queries, and mutations
web/src/app/store.ts         Authenticated UI state only
web/src/layout/AppShell.tsx  Shared Chinese navigation and status header
web/src/pages/Overview.tsx   Process controls and version state
web/src/pages/Upstreams.tsx  Persistent config edit plus live cordon
web/src/pages/Settings.tsx   Common server, port, polling, and failsafe forms
web/src/pages/Advanced.tsx   Complete sectioned Chinese configuration forms
web/src/pages/Revisions.tsx  Immutable history and restore-as-new
~~~

Keep the saved document open-ended and preserve unknown keys during edits. The
frontend field schema covers the pinned eRPC version and is updated alongside
future upstream eRPC upgrades.

### Task 1: Add PostgreSQL bootstrap configuration

**Files:**
- Modify: Admin/go.mod
- Modify: Admin/admin.yaml.example
- Modify: Admin/internal/config/config.go
- Modify: Admin/internal/config/config_test.go
- Modify: Admin/cmd/admin/main.go

- [x] **Step 1: Write config tests for the new bootstrap boundary**

Cover databaseUrlEnv, erpcBinary, runtimeDir, shutdownTimeout, and the existing Admin listen/pollInterval fields. Remove the requirement for YAML target entries because there is exactly one managed local instance.

~~~go
func TestLoadManagedRuntimeConfig(t *testing.T) {
    cfg, err := Load([]byte(`
listen: 127.0.0.1:8090
databaseUrlEnv: ERPC_ADMIN_DATABASE_URL
erpcBinary: E:/go/goProject/eRPC/bin/erpc.exe
runtimeDir: data/runtime
pollInterval: 10s
shutdownTimeout: 15s
`))
    require.NoError(t, err)

    runtime, err := cfg.Resolve(func(key string) (string, bool) {
        return "postgres://admin:admin@127.0.0.1:5432/erpc_admin?sslmode=disable", key == "ERPC_ADMIN_DATABASE_URL"
    })
    require.NoError(t, err)
    assert.Equal(t, 15*time.Second, runtime.ShutdownTimeout)
    assert.NotEmpty(t, runtime.DatabaseURL)
}
~~~

- [ ] **Step 2: Run the focused test and confirm it fails**

Run from Admin:

~~~powershell
go test ./internal/config -run TestLoadManagedRuntimeConfig -count=1
~~~

Expected: FAIL because the managed bootstrap fields do not exist.

- [ ] **Step 3: Replace target bootstrap fields with managed-runtime fields**

Use these concrete types:

~~~go
type fileConfig struct {
    Listen          string `yaml:"listen"`
    PollInterval    string `yaml:"pollInterval"`
    DatabaseURLEnv  string `yaml:"databaseUrlEnv"`
    ERPCBinary      string `yaml:"erpcBinary"`
    RuntimeDir      string `yaml:"runtimeDir"`
    ShutdownTimeout string `yaml:"shutdownTimeout"`
    LegacyAuthFile  string `yaml:"authFile"`
}

type RuntimeConfig struct {
    Listen          string
    PollInterval    time.Duration
    DatabaseURL     string
    ERPCBinary      string
    RuntimeDir      string
    ShutdownTimeout time.Duration
    LegacyAuthFile  string
}
~~~

Defaults: listen 127.0.0.1:8090, pollInterval 10s, databaseUrlEnv ERPC_ADMIN_DATABASE_URL, runtimeDir data/runtime, and shutdownTimeout 15s. Require a non-empty PostgreSQL URL and existing eRPC executable during Resolve.

- [x] **Step 4: Add only the PostgreSQL and Windows dependencies**

~~~powershell
go get github.com/jackc/pgx/v5/stdlib
go get golang.org/x/sys/windows
go get github.com/DATA-DOG/go-sqlmock
go mod tidy
~~~

Expected: Admin/go.mod contains pgx, x/sys, and the test-only SQL mock dependency; the root go.mod is unchanged.

- [x] **Step 5: Update the sample bootstrap file and rerun tests**

~~~yaml
listen: 127.0.0.1:8090
pollInterval: 10s
databaseUrlEnv: ERPC_ADMIN_DATABASE_URL
erpcBinary: E:/go/goProject/eRPC/bin/erpc.exe
runtimeDir: data/runtime
shutdownTimeout: 15s
authFile: data/admin-auth.json
~~~

Run: go test ./internal/config -count=1

Expected: PASS.

- [ ] **Step 6: Commit the bootstrap boundary**

~~~powershell
git add Admin/go.mod Admin/go.sum Admin/admin.yaml.example Admin/internal/config Admin/cmd/admin/main.go
git commit -m "feat(admin): configure managed erpc runtime"
~~~

### Task 2: Add the minimal PostgreSQL schema and connection

**Files:**
- Create: Admin/internal/database/schema.sql
- Create: Admin/internal/database/database.go
- Create: Admin/internal/database/database_test.go
- Modify: Admin/cmd/admin/main.go

- [x] **Step 1: Write the schema contract**

Use one embedded idempotent migration, not a migration framework:

~~~sql
CREATE TABLE IF NOT EXISTS admin_users (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    username text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS config_revisions (
    revision bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    payload jsonb NOT NULL,
    content_hash char(64) NOT NULL,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS erpc_runtime (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    pid integer,
    process_started_at timestamptz,
    running_revision bigint REFERENCES config_revisions(revision),
    binary_version text NOT NULL DEFAULT '',
    binary_commit text NOT NULL DEFAULT '',
    last_error text NOT NULL DEFAULT ''
);

INSERT INTO erpc_runtime (singleton) VALUES (true)
ON CONFLICT (singleton) DO NOTHING;
~~~

- [x] **Step 2: Test Open and migration behavior with sqlmock**

Assert PingContext is called, the embedded schema is executed once, and errors are wrapped with operation context.

~~~go
func Open(ctx context.Context, dsn string) (*sql.DB, error)
func Migrate(ctx context.Context, db *sql.DB) error
~~~

- [x] **Step 3: Run the focused test and confirm it fails**

Run: go test ./internal/database -count=1

Expected: FAIL because the package does not exist.

- [x] **Step 4: Implement Open and Migrate with database/sql**

Use a 5-second startup context, pgx stdlib driver name pgx, PingContext, and go:embed for schema.sql. Do not log the DSN.

- [x] **Step 5: Wire database startup before auth and HTTP startup**

main must open, migrate, and defer Close before constructing stores. A PostgreSQL startup failure must stop Admin; it must not affect an already-running external eRPC process.

- [ ] **Step 6: Verify and commit**

~~~powershell
go test ./internal/database ./internal/config -count=1
go build ./cmd/admin
git add Admin/internal/database Admin/cmd/admin/main.go
git commit -m "feat(admin): add postgres persistence"
~~~

Expected: tests and build pass.

### Task 3: Move the administrator account to PostgreSQL

**Files:**
- Modify: Admin/internal/auth/store.go
- Modify: Admin/internal/auth/store_test.go
- Modify: Admin/internal/server/server_test.go
- Modify: Admin/cmd/admin/main.go

- [x] **Step 1: Replace file-store tests with PostgreSQL behavior tests**

Keep the existing behavior: empty database requires setup, first setup succeeds, second setup returns ErrAlreadySetup, correct password authenticates, and wrong password fails. Assert the SQL value is a bcrypt hash and never the plaintext password.

~~~go
type Store struct {
    db *sql.DB
}

func NewStore(db *sql.DB) *Store
func (s *Store) RequiresSetup(ctx context.Context) (bool, error)
func (s *Store) Setup(ctx context.Context, username, password string) error
func (s *Store) Authenticate(ctx context.Context, username, password string) (bool, error)
~~~

- [x] **Step 2: Run auth and server tests and confirm failure**

Run: go test ./internal/auth ./internal/server -count=1

Expected: FAIL because Store still reads a JSON file and handlers do not pass request contexts.

- [x] **Step 3: Implement the PostgreSQL store**

Use INSERT for the singleton row and map PostgreSQL unique violation to ErrAlreadySetup. Keep username validation at 3-64 characters and password validation at 8-72 bytes. Keep sessions in memory for 24 hours.

- [x] **Step 4: Preserve an existing account once**

When legacyAuthFile exists and admin_users is empty, decode its version 1 JSON, insert the existing bcrypt hash, and rename the file to admin-auth.json.migrated. Never re-hash and never read the plaintext password because it is not present.

~~~go
func MigrateLegacyFile(ctx context.Context, db *sql.DB, path string) error
~~~

- [x] **Step 5: Update auth handlers to propagate database errors safely**

Setup and login use r.Context(). Database failures return HTTP 500 with a Chinese generic message; username existence and password mismatch still share the same HTTP 401 message.

- [ ] **Step 6: Verify and commit**

~~~powershell
go test ./internal/auth ./internal/server -count=1
git add Admin/internal/auth Admin/internal/server Admin/cmd/admin/main.go
git commit -m "feat(admin): persist administrator in postgres"
~~~

Expected: PASS and no plaintext password appears in fixtures or SQL arguments.

### Task 4: Add full-document parsing, validation, and revisions

**Files:**
- Create: Admin/internal/configdoc/document.go
- Create: Admin/internal/configdoc/document_test.go
- Create: Admin/internal/configdoc/validator.go
- Create: Admin/internal/configdoc/validator_test.go
- Create: Admin/internal/revisions/store.go
- Create: Admin/internal/revisions/store_test.go

- [x] **Step 1: Test YAML and JSON round trips without eRPC structs**

The parser must preserve unknown keys, duration strings, plaintext endpoint URLs, and integer values. JSON decoding must use json.Decoder.UseNumber.

~~~go
type Document struct {
    Payload json.RawMessage
    YAML    []byte
    Hash    string
}

func ParseYAML(data []byte) (Document, error)
func ParseJSON(data []byte) (Document, error)
~~~

- [ ] **Step 2: Test the eRPC CLI validator with the Go helper-process pattern**

The test helper returns exit 0 with a JSON validation report for valid input and exit 1 with a report containing errors for invalid input. This keeps tests runnable on Windows without a real eRPC binary.

~~~go
type Validator struct {
    Binary     string
    RuntimeDir string
}

type ValidationResult struct {
    Valid  bool
    Report json.RawMessage
}

func (v Validator) Validate(ctx context.Context, doc Document) (ValidationResult, error)
~~~

- [x] **Step 3: Run focused tests and confirm failure**

Run: go test ./internal/configdoc -count=1

Expected: FAIL because the package does not exist.

- [x] **Step 4: Implement generic conversion and CLI validation**

Write validation YAML to a temporary file under runtimeDir, execute erpc validate <file>, parse stdout as JSON even when the command exits with status 1, and delete the temporary file. Return infrastructure failures separately from validation failures. Never include document content in errors or logs.

- [x] **Step 5: Define immutable revision storage**

~~~go
type Revision struct {
    Revision    int64
    Payload     json.RawMessage
    ContentHash string
    CreatedBy   string
    CreatedAt   time.Time
}

var ErrConflict = errors.New("configuration revision conflict")

func (s *Store) Latest(ctx context.Context) (Revision, error)
func (s *Store) Get(ctx context.Context, revision int64) (Revision, error)
func (s *Store) List(ctx context.Context, limit int) ([]Revision, error)
func (s *Store) Create(ctx context.Context, baseRevision int64, doc configdoc.Document, actor string) (Revision, error)
func (s *Store) Restore(ctx context.Context, baseRevision, sourceRevision int64, actor string) (Revision, error)
~~~

- [x] **Step 6: Make Create atomic with a PostgreSQL table lock**

Inside one transaction, execute LOCK TABLE config_revisions IN SHARE ROW EXCLUSIVE MODE, read COALESCE(MAX(revision), 0), compare it with baseRevision, and insert only when equal. Restore reads the old payload and inserts it as a new row; it never changes an old row.

- [ ] **Step 7: Test revision success, conflict, list, and restore**

Use sqlmock to assert lock, comparison, insert, commit, rollback, and ordering by revision DESC. A validation failure is tested above the store and must never call Create.

- [ ] **Step 8: Verify and commit**

~~~powershell
go test ./internal/configdoc ./internal/revisions -count=1
git add Admin/internal/configdoc Admin/internal/revisions
git commit -m "feat(admin): add versioned erpc configuration"
~~~

Expected: PASS.

### Task 5: Manage one local Windows eRPC process

**Files:**
- Create: Admin/internal/runtime/manager.go
- Create: Admin/internal/runtime/manager_test.go
- Create: Admin/internal/runtime/process_windows.go
- Create: Admin/internal/runtime/state.go
- Create: Admin/internal/runtime/state_test.go
- Modify: Admin/internal/erpc/client.go
- Modify: Admin/internal/erpc/client_test.go
- Modify: Admin/internal/registry/registry.go
- Modify: Admin/internal/registry/registry_test.go
- Modify: Admin/cmd/admin/main.go

- [ ] **Step 1: Define and test runtime status transitions**

~~~go
type Status struct {
    State           string    `json:"state"`
    PID             int       `json:"pid,omitempty"`
    LatestRevision  int64     `json:"latestRevision"`
    RunningRevision int64     `json:"runningRevision"`
    BinaryVersion   string    `json:"binaryVersion"`
    BinaryCommit    string    `json:"binaryCommit"`
    StartedAt       time.Time `json:"startedAt,omitempty"`
    LastError       string    `json:"lastError,omitempty"`
}

const (
    StateStopped  = "stopped"
    StateStarting = "starting"
    StateRunning  = "running"
    StateStopping = "stopping"
    StateFailed   = "failed"
    StateExternal = "external"
)
~~~

Tests cover stopped -> starting -> running, running -> stopping -> stopped, failed start retaining the prior running revision, and latest != running producing pending changes.

- [ ] **Step 2: Implement Windows process-group launch and graceful stop**

Launch the exact configured executable with arguments start <revision-yaml> and a new process group:

~~~go
cmd.SysProcAttr = &syscall.SysProcAttr{
    CreationFlags: windows.CREATE_NEW_PROCESS_GROUP,
}
~~~

Stop with windows.GenerateConsoleCtrlEvent(windows.CTRL_BREAK_EVENT, uint32(pid)), wait up to shutdownTimeout, then call Process.Kill only after the timeout. Capture stdout/stderr to rotating files capped by a simple size check; do not add a logging framework.

- [ ] **Step 3: Test process commands with a helper child process**

Use the test binary as the child command. Assert only one Start can run, Restart performs stop then start, no revision is available returns a typed error, and failed validation never launches a process.

- [x] **Step 4: Write revision-specific runtime YAML**

Use data/runtime/revision-<revision>/erpc.yaml, validate it again, and start from that exact path. Existing files are immutable artifacts; never overwrite another revision directory.

- [ ] **Step 5: Resolve the managed Admin connection from the applied document**

Add a configdoc helper that reads server.httpPortV4 and one secret Admin auth strategy from the generic document. Connect through 127.0.0.1 when eRPC binds 0.0.0.0. Reject managed startup with a clear error when no usable local HTTP listener or secret strategy exists. Tests must prove that editing the latest unapplied Admin secret does not replace the running registry token.

~~~go
type ManagedConnection struct {
    BaseURL   string
    AdminToken string
}

func ResolveManagedConnection(doc configdoc.Document) (ManagedConnection, error)
~~~

Replace the YAML target list in registry with one concurrency-safe SetTarget/ClearTarget pair. Set the registry target only after process readiness and clear it after a confirmed stop.

- [x] **Step 6: Persist and verify ownership**

Persist PID, process start time, and running revision in erpc_runtime. On Admin startup, verify the PID exists and its creation time matches before adopting it. If either check fails, clear stale state. If the configured port is responding but ownership cannot be proven, return state external and refuse Stop.

- [ ] **Step 7: Read eRPC version headers after readiness**

Extend the existing client to capture X-ERPC-Version and X-ERPC-Commit. Start becomes successful only after the generated listener responds or the startup timeout expires. Store the headers and running revision only after readiness.

- [x] **Step 8: Wire shutdown**

When Admin receives Ctrl+C or SIGTERM, gracefully stop the managed eRPC child before closing PostgreSQL and the Admin HTTP server. A crash may leave eRPC running; ownership recovery handles the next Admin start.

- [ ] **Step 9: Verify and commit**

~~~powershell
go test ./internal/runtime ./internal/erpc ./internal/registry -count=1
go build ./cmd/admin
git add Admin/internal/runtime Admin/internal/erpc Admin/internal/registry Admin/cmd/admin/main.go
git commit -m "feat(admin): manage local erpc process"
~~~

Expected: tests and build pass on Windows.

### Task 6: Expose the configuration and runtime HTTP API

**Files:**
- Modify: Admin/internal/server/server.go
- Modify: Admin/internal/server/server_test.go
- Modify: Admin/cmd/admin/main.go

- [x] **Step 1: Add route tests before handlers**

Cover authentication plus these routes:

~~~text
GET  /api/runtime
POST /api/runtime/start
POST /api/runtime/stop
POST /api/runtime/restart
GET  /api/config
POST /api/config/import
POST /api/config/validate
POST /api/config
GET  /api/config/revisions
GET  /api/config/revisions/{revision}
POST /api/config/revisions/{revision}/restore
~~~

Expected status mapping: 400 malformed document, 401 unauthenticated, 404 missing revision, 409 stale baseRevision or illegal runtime transition, 422 eRPC validation failure, and 500 infrastructure failure.

- [x] **Step 2: Use one save request for forms and upstream CRUD**

~~~go
type saveConfigRequest struct {
    BaseRevision int64           `json:"baseRevision"`
    Format       string          `json:"format"`
    Content      json.RawMessage `json:"content"`
}
~~~

format is json or yaml. For yaml, content is a JSON string containing YAML text. Parse, validate, and create one revision. Do not add separate persistent upstream endpoints.

- [x] **Step 3: Keep plaintext detail behind authentication**

Revision lists return metadata only. GET /api/config and GET /api/config/revisions/{revision} return the full plaintext document because the user explicitly selected that behavior. Never include full payloads in handler logs or error strings.

- [x] **Step 4: Implement runtime commands as empty-body POSTs**

Return the new Status after each successful command. Reject concurrent transitions through Manager state rather than adding an HTTP-specific lock.

- [ ] **Step 5: Verify and commit**

~~~powershell
go test ./internal/server -count=1
go test ./... -count=1
git add Admin/internal/server Admin/cmd/admin/main.go
git commit -m "feat(admin): expose config and process controls"
~~~

Expected: all Admin tests pass.

### Task 7: Add the Chinese runtime overview

**Files:**
- Create: web/src/layout/AppShell.tsx
- Create: web/src/pages/Overview.tsx
- Modify: web/src/App.tsx
- Modify: web/src/app/api.ts
- Modify: web/src/styles.css
- Modify: web/src/app/api.test.ts

- [ ] **Step 1: Add API types and tests**

~~~ts
export type RuntimeStatus = {
  state: "stopped" | "starting" | "running" | "stopping" | "failed" | "external";
  pid?: number;
  latestRevision: number;
  runningRevision: number;
  binaryVersion: string;
  binaryCommit: string;
  startedAt?: string;
  lastError?: string;
};
~~~

Test GET /api/runtime and POST start/stop/restart request methods, cookies, and Chinese API error display.

- [ ] **Step 2: Split the existing shell without changing authentication**

Move AppShell from App.tsx into layout/AppShell.tsx. Keep Redux auth state and server cookie behavior unchanged. Add routes /overview, /upstreams, /settings, /advanced, and /revisions; redirect /targets to /overview.

- [x] **Step 3: Build the overview controls**

Show process state, PID, eRPC version/commit, latest revision, running revision, last error, and the existing topology counts. Use icon buttons with tooltips for refresh and text+icon buttons for Start, Stop, and Restart. Disable illegal actions while a mutation is pending.

- [x] **Step 4: Mark unapplied configuration clearly**

When latestRevision differs from runningRevision, show 有未应用配置 and make Restart the primary action. Do not auto-restart after a save.

- [ ] **Step 5: Verify and commit**

~~~powershell
Set-Location web
pnpm test
pnpm run build
git add src
git commit -m "feat(web): add erpc runtime overview"
~~~

Expected: tests and production build pass.

### Task 8: Add upstream CRUD and common configuration forms

**Files:**
- Create: web/src/pages/Upstreams.tsx
- Create: web/src/pages/Settings.tsx
- Create: web/src/components/ConfigSaveBar.tsx
- Modify: web/src/app/api.ts
- Modify: web/src/styles.css

- [x] **Step 1: Add full-config query and save mutation**

~~~ts
export type ConfigDocument = {
  latestRevision: number;
  runningRevision: number;
  config: Record<string, unknown>;
};

export type SaveConfigInput = {
  baseRevision: number;
  format: "json";
  content: Record<string, unknown>;
};
~~~

On a successful save, invalidate config, revisions, and runtime queries. On HTTP 409, show 配置已被其他页面更新，请刷新后重试.

- [ ] **Step 2: Implement project-scoped upstream table editing**

Read and edit projects[].upstreams in a local form copy. Add, edit, and delete use Ant Design Form and Modal. Validate non-empty IDs, duplicate IDs within a project, and required endpoint values before save. Unknown upstream keys must survive object spreads.

- [ ] **Step 3: Keep persistent and live actions separate**

Each row has 编辑 and 删除 for the desired document plus 临时摘除/恢复 for the running process. Add a 重启后生效 tag to persistent edits. Existing cordon APIs and Query invalidation remain unchanged.

- [ ] **Step 4: Add common service controls**

Settings uses Ant Design switches and numeric inputs for server.listenV4, httpHostV4, httpPortV4, listenV6, httpHostV6, httpPortV6, grpcEnabled, gRPC ports, metrics.enabled, and metrics.port. Every listener control displays 重启后生效.

- [ ] **Step 5: Separate polling controls**

Present EVM upstream statePollerInterval/statePollerDebounce, network fallbackStatePollerDebounce, and SVM statePollerDebounce in separate labeled groups. The Admin observation poll interval is shown as an Admin bootstrap value, not written into the eRPC document.

- [ ] **Step 6: Add the minimum failsafe forms**

Expose retry, timeout, hedge, circuit breaker, and consensus blocks without enumerating methods, vendors, chains, or unknown error shapes. Preserve unmatched keys in each object.

- [ ] **Step 7: Verify and commit**

~~~powershell
pnpm test
pnpm run build
git add src
git commit -m "feat(web): manage erpc configuration"
~~~

Expected: tests and build pass; no save triggers restart.

### Task 9: Add complete structured configuration and revision history

**Files:**
- Create: web/src/pages/Advanced.tsx
- Create: web/src/pages/Revisions.tsx
- Modify: web/src/app/api.ts
- Modify: web/src/styles.css
- Create: web/src/config/fields.ts

- [ ] **Step 1: Add the pinned eRPC field schema**

Describe the current root groups from common.Config and their nested fields as
Chinese form metadata. Reuse Ant Design controls already installed; add no form
generator or YAML dependency. Arrays use repeatable rows and nested drawers.

- [ ] **Step 2: Add first-configuration defaults**

When no revision exists, show fields prefilled from the original eRPC example:
log level DEBUG, HTTP host 0.0.0.0, HTTP port 4000, project ID main, and one
editable upstream row. Saving builds a JSON payload and calls the existing
validate and revision endpoints.

- [ ] **Step 3: Replace advanced YAML editing**

Replace the text area with sectioned Chinese fields covering logLevel,
clusterKey, server, healthCheck, admin, database, projects, rateLimiters,
metrics, proxyPools, and tracing. Merge edited values into the current payload
so unknown keys are preserved. Validation errors are shown beside the relevant
section where possible.

- [ ] **Step 4: Add immutable history**

List revision, hash prefix, creator, and creation time. Detail view fetches the full revision only after selection. Restore requires confirmation and creates a new latest revision; it does not restart eRPC.

- [ ] **Step 5: Test initial creation, validation failure, and restore cache updates**

Use Vitest to assert the initial fields build the expected payload, invalid
values never save, unknown payload keys survive edits, and successful restore
invalidates config/revisions/runtime queries.

- [ ] **Step 6: Verify and commit**

~~~powershell
pnpm test
pnpm run build
git add package.json pnpm-lock.yaml src
git commit -m "feat(web): add structured config and history"
~~~

Expected: tests and build pass.

### Task 10: End-to-end Windows verification and documentation

**Files:**
- Modify: specs/admin-web/feature.md only if implementation behavior differs
- Create: Admin/README.md

- [x] **Step 1: Prepare PostgreSQL and environment**

Create an empty erpc_admin database and set the DSN without writing it to Git:

~~~powershell
$env:ERPC_ADMIN_DATABASE_URL = "postgres://admin:admin@127.0.0.1:5432/erpc_admin?sslmode=disable"
~~~

- [x] **Step 2: Run all automated checks**

~~~powershell
Set-Location E:/go/goProject/eRPC/Admin
go test ./... -count=1
go build ./cmd/admin

Set-Location E:/go/goProject/eRPC/web
pnpm test
pnpm run build
~~~

Expected: every command exits 0.

- [x] **Step 3: Verify the first-run flow manually**

Start Admin, create the administrator, complete the Chinese first-configuration
form, and confirm revision 1 exists. Verify the database contains a bcrypt
password hash and the plaintext RPC URL entered in the form.

- [ ] **Step 4: Verify save versus apply**

Edit an upstream and save revision 2. Confirm eRPC remains on revision 1 and the UI shows 有未应用配置. Restart, confirm the generated revision-2 YAML is used, and confirm runningRevision becomes 2 only after readiness.

- [ ] **Step 5: Verify runtime controls and rollback**

Stop and start eRPC from the overview. Restore revision 1, confirm a new revision 3 is created, restart, and confirm runningRevision becomes 3. Verify temporary cordon/uncordon still changes runtime immediately without creating revision 4.

- [ ] **Step 6: Verify failure boundaries**

Submit invalid field values and confirm no revision is created. Occupy the
configured eRPC port and confirm Start fails without killing the external
process. Stop PostgreSQL while eRPC runs and confirm eRPC remains available
while Admin config writes fail cleanly.

- [x] **Step 7: Write the Windows operator README**

Document PostgreSQL DSN environment setup, Admin startup command, initial field
setup, generated runtime directory, plaintext-secret warning, and recovery when
the UI reports 外部进程.

- [ ] **Step 8: Check repository boundaries and commit**

~~~powershell
git status --short
git diff --check
git diff --name-only
~~~

Expected: implementation changes are limited to Admin/, web/, specs/admin-web/, and docs/superpowers/plans/. No eRPC root source or root module metadata changed.

~~~powershell
git add Admin/README.md specs/admin-web/feature.md
git commit -m "docs(admin): document managed erpc workflow"
~~~

## Final acceptance gate

- [x] PostgreSQL is the only authoritative config store.
- [x] Login passwords are bcrypt hashes; eRPC config secrets remain plaintext by explicit decision.
- [x] Invalid documents create no revision.
- [x] Save never restarts eRPC.
- [ ] Start/restart uses and records the latest valid revision.
- [x] Running versus latest revision is visible in Chinese.
- [x] Persistent upstream CRUD and immediate cordon are visually distinct.
- [ ] Replace the YAML editor with sectioned Chinese fields for all current
  root configuration groups and nested settings.
- [ ] Preserve unknown keys when structured form values are merged and saved.
- [ ] First configuration can be created without importing or writing YAML.
- [x] Admin never terminates a process it cannot prove it owns.
- [x] eRPC root source and public YAML schema are unchanged.
