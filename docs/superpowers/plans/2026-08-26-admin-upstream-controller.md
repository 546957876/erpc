# Admin Upstream Controller Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in, connector-backed Admin API that can create, update, delete, and reconcile explicit EVM upstreams without restarting eRPC.

**Architecture:** A versioned AdminUpstreamStore persists desired state through data.Connector, while AdminUpstreamController prepares and atomically swaps per-upstream runtime instances in UpstreamsRegistry. The writer applies immediately; other replicas watch a persisted CounterInt64State revision and reconcile, with PostgreSQL's existing fallback poll covering missed notifications.

**Tech Stack:** Go 1.25, existing data.Connector implementations, existing upstream and project registries, JSON-RPC Admin transport, Prometheus client, tygo-generated TypeScript config types.

---

## Execution order and boundaries

Implement this plan before the Admin Web plan. It deliberately ends with a
complete, curl-usable backend and does not introduce the embedded SPA route.
Keep the controller focused on explicit EVM upstreams; provider-generated
upstreams and the generic controller in plans/001-dynamic-config-controller.md
remain outside this change.

The database is desired state. A failed local bootstrap leaves the previous
runtime upstream serving and exposes an apply error. The store never returns
unredacted endpoint data through the Admin API.

## File map

- Modify: common/config.go
  Add AdminUpstreamsConfig under AdminConfig.
- Modify: common/defaults.go
  Add the admin connector scope and connector defaults.
- Modify: common/defaults_test.go
  Pin the new default table and connection-pool values.
- Modify: common/validation.go
  Validate the opt-in connector.
- Create: common/validation_test.go
  Cover missing and valid connector configurations.
- Modify: typescript/config/src/generated.ts
  Regenerate AdminUpstreamsConfig with tygo; do not hand-edit.
- Create: erpc/admin_upstream_store.go
  Own the storage codec, index, optimistic revisions, and watch signal.
- Create: erpc/admin_upstream_store_test.go
  Cover seeding, CRUD, conflicts, raw-field preservation, and signal order.
- Create: erpc/admin_upstream_test_connector_test.go
  Provide a deterministic Connector test double with List deliberately unsupported.
- Modify: upstream/registry.go
  Add prepared managed-upstream lifecycle and atomic add/replace/remove.
- Create: upstream/registry_managed_test.go
  Cover swaps, removals, collision rejection, and context cancellation.
- Create: erpc/admin_upstream_controller.go
  Own startup seeding, reconcile state, immediate apply, and watches.
- Create: erpc/admin_upstream_controller_test.go
  Cover startup, partial reconciliation, and missed-notification recovery.
- Modify: erpc/erpc.go
  Construct and bootstrap the store/controller when enabled.
- Modify: erpc/projects_registry.go
  Configure a prepared upstream from resolved network config without recursively
  bootstrapping that network.
- Create: erpc/admin_upstreams_api.go
  Parse and serve the four Admin JSON-RPC methods.
- Modify: erpc/admin.go
  Dispatch the four methods.
- Create: erpc/admin_upstreams_api_test.go
  Pin the wire contract, secrecy, auth transport, and conflict data.
- Create: erpc/admin_upstream_metrics.go
  Define bounded-cardinality controller metrics.
- Modify: docs/pages/operation/admin.mdx
  Document the config, methods, failure modes, edge cases, and metrics.
- Modify: docs/pages/config/projects/upstreams.mdx
  Explain that the database becomes authoritative for explicit upstreams.

### Task 1: Configuration boundary and connector defaults

**Files:**
- Modify: common/config.go
- Modify: common/defaults.go
- Modify: common/defaults_test.go
- Modify: common/validation.go
- Create: common/validation_test.go
- Regenerate: typescript/config/src/generated.ts

- [ ] **Step 1: Write failing defaults and validation tests**

Add table-driven tests with these exact cases:

~~~go
func TestAdminUpstreamsConfig_SetDefaults(t *testing.T) {
    cfg := &AdminConfig{
        Upstreams: &AdminUpstreamsConfig{
            Connector: &ConnectorConfig{
                Id:     "admin-postgres",
                Driver: DriverPostgreSQL,
                PostgreSQL: &PostgreSQLConnectorConfig{
                    ConnectionUri: "postgresql://user:pass@localhost:5432/erpc",
                },
            },
        },
    }
    require.NoError(t, cfg.SetDefaults())
    assert.Equal(t, "erpc_admin", cfg.Upstreams.Connector.PostgreSQL.Table)
    assert.Equal(t, 1, cfg.Upstreams.Connector.PostgreSQL.MinConns)
    assert.Equal(t, 4, cfg.Upstreams.Connector.PostgreSQL.MaxConns)
}

func TestAdminUpstreamsConfig_ValidateRequiresConnector(t *testing.T) {
    cfg := &AdminConfig{Upstreams: &AdminUpstreamsConfig{}}
    err := cfg.Validate()
    require.ErrorContains(t, err, "admin.upstreams.connector is required")
}
~~~

Also add a passing memory-connector validation case so the configuration layer
does not hard-code PostgreSQL as the only possible Connector implementation.

- [ ] **Step 2: Run the focused tests and confirm the red state**

Run:

    go test ./common -run "TestAdminUpstreamsConfig" -count=1

Expected: compilation fails because AdminUpstreamsConfig and AdminConfig.Upstreams
do not exist.

- [ ] **Step 3: Add the opt-in schema**

Add these fields and no scheduling knobs:

~~~go
type AdminConfig struct {
    Auth         *AuthConfig           `yaml:"auth" json:"auth"`
    CORS         *CORSConfig           `yaml:"cors" json:"cors"`
    AllowMethods []string              `yaml:"allowMethods,omitempty" json:"allowMethods,omitempty"`
    DenyMethods  []string              `yaml:"denyMethods,omitempty" json:"denyMethods,omitempty"`
    Upstreams    *AdminUpstreamsConfig `yaml:"upstreams,omitempty" json:"upstreams,omitempty"`
}

type AdminUpstreamsConfig struct {
    Connector *ConnectorConfig `yaml:"connector" json:"connector"`
}
~~~

Add connectorScopeAdmin. PostgreSQL and DynamoDB default their table to
erpc_admin. PostgreSQL uses the auth-sized defaults MinConns=1 and MaxConns=4.
AdminConfig.SetDefaults calls Connector.SetDefaults(connectorScopeAdmin) only
when admin.upstreams is present. AdminConfig.Validate returns the exact
missing-connector error from Step 1, then delegates to Connector.Validate.

- [ ] **Step 4: Run defaults and validation tests**

Run:

    go test ./common -run "TestAdminUpstreamsConfig" -count=1

Expected: PASS.

- [ ] **Step 5: Regenerate TypeScript config types**

Use the repository's tygo configuration:

    go run github.com/gzuidhof/tygo@v0.2.21 generate

Expected: typescript/config/src/generated.ts contains
AdminConfig.upstreams?: AdminUpstreamsConfig and an AdminUpstreamsConfig
interface containing connector: ConnectorConfig.

Run:

    pnpm --filter @erpc-cloud/config build

Expected: PASS.

- [ ] **Step 6: Commit the schema**

    git add common/config.go common/defaults.go common/defaults_test.go common/validation.go common/validation_test.go typescript/config/src/generated.ts
    git commit -m "feat(admin): configure dynamic upstream storage"

### Task 2: Versioned connector-backed desired-state store

**Files:**
- Create: erpc/admin_upstream_store.go
- Create: erpc/admin_upstream_store_test.go
- Create: erpc/admin_upstream_test_connector_test.go

- [ ] **Step 1: Add a deterministic Connector test double**

Implement a test-only connector with separate dataMu and lockMu mutexes,
synchronous Set/Delete, ErrRecordNotFound from Get, an unsupported List method,
and a buffered watch channel. The essential shape is:

~~~go
type adminTestConnector struct {
    dataMu    sync.RWMutex
    lockMu    sync.Mutex
    rows      map[string][]byte
    published []data.CounterInt64State
    watchCh   chan data.CounterInt64State
}

func (c *adminTestConnector) key(partitionKey, rangeKey string) string {
    return partitionKey + "|" + rangeKey
}

func (c *adminTestConnector) List(context.Context, string, int, string) ([]data.KeyValuePair, string, error) {
    return nil, "", fmt.Errorf("List must not be used by AdminUpstreamStore")
}
~~~

Its Lock method acquires lockMu and returns a DistributedLock whose Unlock
releases it. PublishCounterInt64 appends the value and sends it to watchCh.

- [ ] **Step 2: Write failing store contract tests**

Add these exact test names:

~~~go
func TestAdminUpstreamStore_InitializeSeedsYamlOnce(t *testing.T)
func TestAdminUpstreamStore_InitializeDoesNotOverwriteExistingState(t *testing.T)
func TestAdminUpstreamStore_LoadUsesIndexWithoutList(t *testing.T)
func TestAdminUpstreamStore_CreateUpdateDeleteRevisions(t *testing.T)
func TestAdminUpstreamStore_RejectsDuplicateAndStaleRevision(t *testing.T)
func TestAdminUpstreamStore_UpdatePreservesEndpointAndUnknownFields(t *testing.T)
func TestAdminUpstreamStore_DeleteMakesOrphanUnreachable(t *testing.T)
func TestAdminUpstreamStore_PersistsSignalBeforePublish(t *testing.T)
func TestAdminUpstreamStore_MemorySupportsImmediateConsecutiveWrites(t *testing.T)
~~~

Use an initial raw config containing an unknown future field:

~~~json
{
  "id": "bnb-01",
  "type": "evm",
  "endpoint": "https://rpc.example.test/key",
  "evm": {"chainId": 56},
  "futureOption": {"mode": "keep-me"}
}
~~~

After a patch that changes only evm.statePollerInterval, assert the stored
endpoint and futureOption are byte-equivalent JSON values. After API projection,
assert the endpoint secret is absent.

- [ ] **Step 3: Run the store tests and confirm the red state**

Run:

    go test ./erpc -run "TestAdminUpstreamStore_" -count=1

Expected: compilation fails because NewAdminUpstreamStore and store types do not
exist.

- [ ] **Step 4: Implement the storage records and codec**

Define these exact ownership types:

~~~go
const adminUpstreamSchemaVersion = 1

type adminUpstreamIndex struct {
    SchemaVersion   int      `json:"schemaVersion"`
    Initialized     bool     `json:"initialized"`
    DesiredRevision int64    `json:"desiredRevision"`
    IDs             []string `json:"ids"`
}

type storedAdminUpstream struct {
    SchemaVersion int             `json:"schemaVersion"`
    Revision      int64           `json:"revision"`
    UpdatedAt     time.Time       `json:"updatedAt"`
    UpdatedBy     string          `json:"updatedBy"`
    Config        json.RawMessage `json:"config"`
}

type AdminUpstreamSnapshot struct {
    ProjectID      string
    DesiredRevision int64
    Items          map[string]storedAdminUpstream
}

type AdminUpstreamStore struct {
    logger    *zerolog.Logger
    connector data.Connector
    actor     string
    now       func() time.Time
    cacheMu   sync.RWMutex
    snapshots map[string]*AdminUpstreamSnapshot
}
~~~

Construct it with NewAdminUpstreamStore(logger, connector, actor). Every new Go
test file in this plan that creates a store, controller, registry, or HTTP
server includes:

~~~go
func init() {
    util.ConfigureTestLogger()
}
~~~

Use an internal alias when decoding or encoding typed UpstreamConfig:

~~~go
type storedUpstreamConfig common.UpstreamConfig

func decodeStoredUpstream(raw json.RawMessage) (*common.UpstreamConfig, error) {
    var cfg storedUpstreamConfig
    if err := common.SonicCfg.Unmarshal(raw, &cfg); err != nil {
        return nil, fmt.Errorf("decode stored upstream config: %w", err)
    }
    return (*common.UpstreamConfig)(&cfg), nil
}
~~~

For YAML seeding, build a value of `storedUpstreamConfig` (including its nested
Evm pointer) before marshaling; do not call `json.Marshal(yamlCfg)` because the
custom public serializer would permanently discard the endpoint secret on the
first migration.

Never marshal a common.UpstreamConfig directly for storage because its public
MarshalJSON redacts endpoint credentials.

- [ ] **Step 5: Implement initialization, loading, and mutations**

Use these keys:

~~~go
func adminUpstreamPartition(projectID string) string {
    return "admin/upstreams/v1/" + projectID
}

func adminUpstreamSignalKey(projectID string) string {
    return adminUpstreamPartition(projectID) + "/revision"
}
~~~

Implement:

~~~go
func (s *AdminUpstreamStore) InitializeProject(ctx context.Context, projectID string, yamlUpstreams []*common.UpstreamConfig) (*AdminUpstreamSnapshot, error)
func (s *AdminUpstreamStore) LoadProject(ctx context.Context, projectID string) (*AdminUpstreamSnapshot, error)
func (s *AdminUpstreamStore) Create(ctx context.Context, projectID string, raw json.RawMessage) (*AdminUpstreamSnapshot, error)
func (s *AdminUpstreamStore) Update(ctx context.Context, projectID, upstreamID string, expectedRevision int64, raw json.RawMessage) (*AdminUpstreamSnapshot, error)
func (s *AdminUpstreamStore) Delete(ctx context.Context, projectID, upstreamID string, expectedRevision int64) (*AdminUpstreamSnapshot, error)
func (s *AdminUpstreamStore) WatchProject(ctx context.Context, projectID string) (<-chan data.CounterInt64State, func(), error)
~~~

All writes acquire connector.Lock with key partition+"/lock" and a 15-second
TTL. Store complete local snapshots only after their item/index writes succeed.
When loading under the lock, compare the connector snapshot with the cached
snapshot and use the one with the higher desiredRevision. Read the connector
index first; when the cached revision is equal or newer, return the cached deep
copy without fetching connector items. Fetch connector items only when its
index revision is newer. A connector ErrRecordNotFound may use an initialized
cached snapshot. This supports the
Memory connector's asynchronous cache admission without allowing an older
local snapshot to override a newer revision from another replica. Return deep
copies so callers cannot mutate the cache. Sort index IDs before encoding for
stable snapshots. Initialization writes
each YAML item, then the initialized index at desiredRevision=1, then persists
CounterInt64State at signal partition/range "value", then publishes. If the
index already exists, load it and ignore YAML.

Create starts the resource revision at 1. Update increments only that resource
revision. Every successful mutation increments desiredRevision once. Delete
writes the index without the ID, persists/publishes the project signal, then
best-effort deletes the now-unreachable item; log a wrapped cleanup error but do
not make the desired deletion fail.

- [ ] **Step 6: Run store tests**

Run:

    go test ./erpc -run "TestAdminUpstreamStore_" -count=1

Expected: PASS, including the test connector's List failure remaining unused.

- [ ] **Step 7: Commit the store**

    git add erpc/admin_upstream_store.go erpc/admin_upstream_store_test.go erpc/admin_upstream_test_connector_test.go
    git commit -m "feat(admin): persist versioned upstream state"

### Task 3: Managed runtime lifecycle in UpstreamsRegistry

**Files:**
- Modify: upstream/registry.go
- Create: upstream/registry_managed_test.go

- [ ] **Step 1: Write failing lifecycle tests**

Set up every gock response before constructing the registry, call
util.ResetGock at the beginning and defer another reset, and include:

~~~go
func init() {
    util.ConfigureTestLogger()
}

func TestUpstreamsRegistry_CommitManagedAddsPreparedUpstream(t *testing.T)
func TestUpstreamsRegistry_CommitManagedReplacesSnapshotThenCancelsOld(t *testing.T)
func TestUpstreamsRegistry_RemoveManagedStopsNewSelectionAndCancels(t *testing.T)
func TestUpstreamsRegistry_ManagedUpdateMovesNetworksAtomically(t *testing.T)
func TestUpstreamsRegistry_ManagedRejectsProviderIDCollision(t *testing.T)
func TestUpstreamsRegistry_NormalRegistrationDoesNotDuplicateManagedID(t *testing.T)
func TestUpstreamsRegistry_ConfigureFailureDoesNotRegisterManagedCandidate(t *testing.T)
~~~

For replacement, retain the old pointer from GetSortedUpstreams, commit the new
candidate, assert subsequent reads see only the new pointer, then assert a test
cancel hook for the old instance fired. Existing readers may still hold the old
pointer; do not wait for them.

- [ ] **Step 2: Run focused tests and confirm the red state**

Run:

    go test ./upstream -run "TestUpstreamsRegistry_.*Managed" -count=1

Expected: compilation fails because the managed lifecycle methods do not exist.

- [ ] **Step 3: Add the prepared-candidate API**

Add:

~~~go
type ManagedUpstreamCandidate struct {
    upstream   *Upstream
    cancel     context.CancelFunc
    cancelOnce sync.Once
}

type managedUpstreamRuntime struct {
    upstream *Upstream
    cancel   context.CancelFunc
}
~~~

Add managedUpstreams map[string]managedUpstreamRuntime under upstreamsMu and
these methods:

~~~go
func (u *UpstreamsRegistry) PrepareManagedUpstream(ctx context.Context, cfg *common.UpstreamConfig) (*ManagedUpstreamCandidate, error)
func (u *UpstreamsRegistry) CommitManagedUpstream(candidate *ManagedUpstreamCandidate) error
func (u *UpstreamsRegistry) RemoveManagedUpstream(id string) error
func (u *UpstreamsRegistry) GetUpstream(id string) (*Upstream, bool)
func (c *ManagedUpstreamCandidate) Cancel()
~~~

PrepareManagedUpstream creates context.WithCancel(u.appCtx), calls NewUpstream
with that child context through a new private newUpstreamWithContext helper,
bootstraps using the request context, and synchronously calls a renamed
configureUpstream callback. On any error it cancels the child context. The
normal bootstrap task must also configure synchronously before registration;
remove the current callback goroutine so no selectable upstream can briefly
exist without its network config. Candidate.Cancel is idempotent and lets the
controller stop an uncommitted candidate after a storage conflict without
accessing upstream package internals.

- [ ] **Step 4: Implement atomic commit and removal**

Under upstreamsMu:

1. Reject an existing ID unless it is already in managedUpstreams.
2. Remove the old pointer from allUpstreams and its normal/shadow network slice.
3. Insert the candidate into the correct new network slice.
4. Store fresh copies in networkUpstreamsAtomic for both the old and new normal
   networks when the network changed.
5. Replace managedUpstreams[id], storing candidate.Cancel as the runtime cancel
   function so every cancellation path shares the same sync.Once.
6. Release the lock, then cancel the old child context.

Remove follows the same snapshot order, deletes managedUpstreams[id], releases
the lock, then cancels. A missing managed ID returns a wrapped not-found error.
Update doRegisterBootstrappedUpstream so a normal/provider registration with an
already-registered ID is ignored and logged; it must not append a second pointer
to allUpstreams.

- [ ] **Step 5: Run lifecycle and existing registry tests**

Run:

    go test ./upstream -run "TestUpstreamsRegistry_(.*Managed|NormalRegistration|Bootstrap)" -count=1

Expected: PASS.

Run:

    go test ./upstream -count=1

Expected: PASS.

- [ ] **Step 6: Commit runtime lifecycle**

    git add upstream/registry.go upstream/registry_managed_test.go
    git commit -m "feat(upstream): add managed runtime lifecycle"

### Task 4: Controller startup and reconciliation

**Files:**
- Create: erpc/admin_upstream_controller.go
- Create: erpc/admin_upstream_controller_test.go
- Modify: erpc/erpc.go
- Modify: erpc/projects_registry.go

- [ ] **Step 1: Write failing controller tests**

Add:

~~~go
func TestAdminUpstreamController_StartupSeedsAndAppliesStoredUpstreams(t *testing.T)
func TestAdminUpstreamController_ExistingStoreWinsOverChangedYaml(t *testing.T)
func TestAdminUpstreamController_ReconcileCreateUpdateDelete(t *testing.T)
func TestAdminUpstreamController_FailedUpdateKeepsOldRuntime(t *testing.T)
func TestAdminUpstreamController_PartialApplyDoesNotAdvanceAppliedRevision(t *testing.T)
func TestAdminUpstreamController_WatchReloadsNewerRevision(t *testing.T)
func TestNewERPC_AdminStoreReadFailureStopsStartup(t *testing.T)
func TestNewERPC_AdminUpstreamsDisabledPreservesStaticBootstrap(t *testing.T)
~~~

The failed-update test starts with a working gock endpoint, then persists an
endpoint whose bootstrap probe fails. Assert registry.GetUpstream still returns
the old instance while ListProject reports desired status "error".

- [ ] **Step 2: Run the focused tests and confirm the red state**

Run:

    go test ./erpc -run "Test(AdminUpstreamController|NewERPC_Admin)" -count=1

Expected: compilation fails because AdminUpstreamController is undefined.

- [ ] **Step 3: Define controller state and public operations**

Use:

~~~go
type AdminUpstreamApplyState string

const (
    AdminUpstreamApplied AdminUpstreamApplyState = "applied"
    AdminUpstreamPending AdminUpstreamApplyState = "pending"
    AdminUpstreamError   AdminUpstreamApplyState = "error"
)

type AdminUpstreamLocalStatus struct {
    State   AdminUpstreamApplyState `json:"state"`
    Error   string                  `json:"error,omitempty"`
}

type AdminUpstreamController struct {
    appCtx     context.Context
    logger     *zerolog.Logger
    cfg        *common.Config
    store      *AdminUpstreamStore
    projects   *ProjectsRegistry
    mu         sync.RWMutex
    desired   map[string]*AdminUpstreamSnapshot
    applied   map[string]int64
    statuses  map[string]map[string]AdminUpstreamLocalStatus
}
~~~

Implement:

~~~go
func NewAdminUpstreamController(appCtx context.Context, logger *zerolog.Logger, cfg *common.Config, store *AdminUpstreamStore, projects *ProjectsRegistry, initial map[string]*AdminUpstreamSnapshot) *AdminUpstreamController
func (c *AdminUpstreamController) Bootstrap(ctx context.Context)
func (c *AdminUpstreamController) Reconcile(ctx context.Context, snapshot *AdminUpstreamSnapshot)
func (c *AdminUpstreamController) ListProject(projectID string) (*AdminUpstreamListResult, error)
func (c *AdminUpstreamController) Create(ctx context.Context, projectID string, raw json.RawMessage) (*AdminUpstreamMutationResult, error)
func (c *AdminUpstreamController) Update(ctx context.Context, projectID, upstreamID string, expectedRevision int64, patch map[string]json.RawMessage) (*AdminUpstreamMutationResult, error)
func (c *AdminUpstreamController) Delete(ctx context.Context, projectID, upstreamID string, expectedRevision int64) (*AdminUpstreamMutationResult, error)
~~~

- [ ] **Step 4: Implement validation, patching, and reconcile order**

For create and update:

1. Decode an EVM UpstreamConfig; reject nil/non-EVM types.
2. Copy the containing project's UpstreamDefaults onto the candidate with
   UpstreamConfig.SetDefaults.
3. Validate against c.cfg with endpoint checks enabled, without inventing
   vendor, method, or chain allowlists.
4. PrepareManagedUpstream before committing desired state.
5. For update, merge only endpoint, chainId, vendorName, tags, and
   evm.statePollerInterval into the retained raw JSON object. Reject every other
   patch key. A missing endpoint keeps the old secret; an empty endpoint fails.
6. Commit the store mutation using expectedRevision.
7. CommitManagedUpstream. If the store reports a conflict, cancel the prepared
   candidate and do not touch runtime state.

Reconcile compares the index IDs to current managed IDs. Prepare and commit each
new/changed item independently; remove IDs absent from desired. Record per-item
errors and advance applied[project] only when every desired action succeeds.
Never hold the controller mutex across connector I/O or bootstrap probes.

- [ ] **Step 5: Wire startup without double-registering YAML upstreams**

In NewERPC, when cfg.Admin.Upstreams is present:

1. Construct data.NewConnector from the configured connector.
2. Initialize/load every project before NewProjectsRegistry.
3. Retain returned initial snapshots in a map.
4. Build shallow runtime copies of project configs, set only those copies'
   Upstreams slices to nil, and pass the copies to NewProjectsRegistry. Keep
   cfg.Projects unchanged as the read-only file configuration.
5. After NewProjectsRegistry returns, populate each PreparedProject.Config.Upstreams
   from the initial desired snapshot before Bootstrap. UpstreamsRegistry has
   already captured the nil bootstrap slice, so this restores runtime config
   visibility without double registration.
6. In projects_registry.go, replace the callback's recursive GetNetwork call
   with networksRegistry.resolveNetworkConfig followed by
   ups.SetNetworkConfig. This lets managed candidates be configured before they
   enter a routing snapshot.
7. Construct AdminUpstreamController after ProjectsRegistry.
8. Return an error if any authoritative store read fails.

On every successful desired snapshot, update PreparedProject.Config.Upstreams
under cfgMu to the decoded desired list so erpc_project reflects the managed
runtime config. Keep the original startup path byte-for-byte equivalent when
admin.upstreams is absent.
ERPC.Bootstrap first calls projectsRegistry.Bootstrap(ctx), then
adminUpstreamController.Bootstrap(ctx) when non-nil. Controller Bootstrap
immediately reconciles initial snapshots and starts one watch goroutine per
project. On any observed revision newer than the local desired revision, load
the index and reconcile.

- [ ] **Step 6: Run controller tests**

Run:

    go test ./erpc -run "Test(AdminUpstreamController|NewERPC_Admin)" -count=1

Expected: PASS.

- [ ] **Step 7: Commit controller wiring**

    git add erpc/admin_upstream_controller.go erpc/admin_upstream_controller_test.go erpc/erpc.go erpc/projects_registry.go
    git commit -m "feat(admin): reconcile dynamic upstreams"

### Task 5: Authenticated Admin JSON-RPC CRUD contract

**Files:**
- Create: erpc/admin_upstreams_api.go
- Create: erpc/admin_upstreams_api_test.go
- Modify: erpc/admin.go

- [ ] **Step 1: Write failing wire-contract tests**

Add exact cases for:

~~~go
func TestAdminListUpstreams_ReturnsRedactedDesiredAndLocalState(t *testing.T)
func TestAdminCreateUpstream_RequiresProjectIDAndEndpoint(t *testing.T)
func TestAdminCreateUpstream_RejectsDuplicateID(t *testing.T)
func TestAdminUpdateUpstream_OmittedEndpointPreservesSecret(t *testing.T)
func TestAdminUpdateUpstream_RejectsUnknownPatchField(t *testing.T)
func TestAdminUpdateUpstream_StaleRevisionReturnsConflictData(t *testing.T)
func TestAdminDeleteUpstream_RequiresExpectedRevision(t *testing.T)
func TestAdminUpstreamMethods_DisabledWithoutController(t *testing.T)
func TestHttpServer_AdminUpstreamMethodsRequireAdminToken(t *testing.T)
~~~

Pin the revision-conflict envelope:

~~~json
{
  "jsonrpc": "2.0",
  "id": 7,
  "error": {
    "code": -32000,
    "message": "upstream revision conflict",
    "data": {
      "kind": "revision_conflict",
      "currentRevision": 3
    }
  }
}
~~~

Pin auth failure as HTTP 401 or JSON-RPC code -32016 so the frontend has a
stable logout signal.

- [ ] **Step 2: Run focused Admin tests and confirm the red state**

Run:

    go test ./erpc -run "Test(Admin(List|Create|Update|Delete)Upstream|AdminUpstreamMethods|HttpServer_AdminUpstream)" -count=1

Expected: unsupported-method failures because the dispatch cases do not exist.

- [ ] **Step 3: Define request and response wire types**

Use one object in params and these shapes:

~~~go
type adminListUpstreamsParams struct {
    ProjectID string `json:"projectId"`
}

type adminCreateUpstreamParams struct {
    ProjectID string          `json:"projectId"`
    Config    json.RawMessage `json:"config"`
}

type adminUpdateUpstreamParams struct {
    ProjectID        string                     `json:"projectId"`
    UpstreamID       string                     `json:"upstreamId"`
    ExpectedRevision int64                      `json:"expectedRevision"`
    Patch            map[string]json.RawMessage `json:"patch"`
}

type adminDeleteUpstreamParams struct {
    ProjectID        string `json:"projectId"`
    UpstreamID       string `json:"upstreamId"`
    ExpectedRevision int64  `json:"expectedRevision"`
}
~~~

AdminUpstreamListResult includes projectId, desiredRevision, appliedRevision,
and items. Each item includes revision, redacted config, endpointConfigured,
localStatus, and runtime health when a local Upstream exists. Mutation results
include the changed item or deleted ID plus desiredRevision, appliedRevision,
and localStatus.

- [ ] **Step 4: Implement strict decoding and error mapping**

Decode params by re-marshalling params[0] into the concrete struct and reject
missing fields. Map known store/controller errors to JSON-RPC errors:

~~~go
func adminRevisionConflict(current int64) error {
    return common.NewErrJsonRpcExceptionInternal(
        0,
        common.JsonRpcErrorCallException,
        "upstream revision conflict",
        nil,
        map[string]interface{}{
            "data": map[string]interface{}{
                "kind":            "revision_conflict",
                "currentRevision": current,
            },
        },
    )
}
~~~

Use JsonRpcErrorInvalidArgument for validation/unknown patch fields and
JsonRpcErrorServerSideException with data.kind "storage_error" or "apply_error"
for operational failures. Never include endpoint values or connector errors
that contain credentials in the public data object.

- [ ] **Step 5: Add dispatch cases**

Add:

~~~go
case "erpc_listUpstreams":
    return e.handleListUpstreams(ctx, nq)
case "erpc_createUpstream":
    return e.handleCreateUpstream(ctx, nq)
case "erpc_updateUpstream":
    return e.handleUpdateUpstream(ctx, nq)
case "erpc_deleteUpstream":
    return e.handleDeleteUpstream(ctx, nq)
~~~

When adminUpstreamController is nil, all four methods return unsupported with a
message that dynamic upstream management is disabled. Existing allowMethods and
denyMethods filtering remains authoritative because it runs before dispatch.

- [ ] **Step 6: Run API and HTTP tests**

Run:

    go test ./erpc -run "Test(Admin(List|Create|Update|Delete)Upstream|AdminUpstreamMethods|HttpServer_AdminUpstream)" -count=1

Expected: PASS.

- [ ] **Step 7: Commit the API**

    git add erpc/admin.go erpc/admin_upstreams_api.go erpc/admin_upstreams_api_test.go
    git commit -m "feat(admin): expose upstream CRUD methods"

### Task 6: Bounded observability

**Files:**
- Create: erpc/admin_upstream_metrics.go
- Modify: erpc/admin_upstream_controller.go
- Modify: erpc/admin_upstream_controller_test.go

- [ ] **Step 1: Add failing metrics assertions**

Use prometheus/testutil to assert one successful create, one failed update, and
one partial reconcile. Verify no metric descriptor includes upstreamId,
endpoint, vendor, or chain labels.

~~~go
func TestAdminUpstreamController_MetricsUseBoundedLabels(t *testing.T)
func TestAdminUpstreamController_MetricsTrackReconcileAndApply(t *testing.T)
~~~

- [ ] **Step 2: Run metrics tests and confirm the red state**

Run:

    go test ./erpc -run "TestAdminUpstreamController_Metrics" -count=1

Expected: FAIL because the metric collectors do not exist.

- [ ] **Step 3: Add the exact collectors**

Define:

~~~go
var adminUpstreamDesiredRevision = promauto.NewGaugeVec(
    prometheus.GaugeOpts{Name: "erpc_admin_upstream_desired_revision"},
    []string{"project"},
)
var adminUpstreamAppliedRevision = promauto.NewGaugeVec(
    prometheus.GaugeOpts{Name: "erpc_admin_upstream_applied_revision"},
    []string{"project"},
)
var adminUpstreamReconcileTotal = promauto.NewCounterVec(
    prometheus.CounterOpts{Name: "erpc_admin_upstream_reconcile_total"},
    []string{"project", "result"},
)
var adminUpstreamApplyTotal = promauto.NewCounterVec(
    prometheus.CounterOpts{Name: "erpc_admin_upstream_apply_total"},
    []string{"project", "operation", "result"},
)
var adminUpstreamApplyDuration = promauto.NewHistogramVec(
    prometheus.HistogramOpts{Name: "erpc_admin_upstream_apply_duration_seconds"},
    []string{"project", "operation"},
)
~~~

Allowed result values are success/partial/error for reconcile and success/error
for apply. Allowed operation values are create/update/delete. Logs include
project, upstreamId, desiredRevision, appliedRevision, operation, and wrapped
error, but never endpoint or admin token.

- [ ] **Step 4: Run metrics tests**

Run:

    go test ./erpc -run "TestAdminUpstreamController_Metrics" -count=1

Expected: PASS.

- [ ] **Step 5: Commit observability**

    git add erpc/admin_upstream_metrics.go erpc/admin_upstream_controller.go erpc/admin_upstream_controller_test.go
    git commit -m "feat(admin): observe upstream reconciliation"

### Task 7: Operator and agent documentation

**Files:**
- Modify: docs/pages/operation/admin.mdx
- Modify: docs/pages/config/projects/upstreams.mdx

- [ ] **Step 1: Update the Admin page's visible promise**

Add dynamic explicit-upstream management to the visible Admin API capability
list and a complete config example rooted at admin:

~~~yaml
admin:
  auth:
    strategies:
      - type: secret
        secret:
          value: "your-admin-secret"
  upstreams:
    connector:
      id: admin-postgres
      driver: postgresql
      postgresql:
        connectionUri: "postgresql://user:password@db.example.com:5432/erpc"
~~~

Keep hostnames and secrets neutral. Explain that health checks and request-time
failover remain the existing eRPC mechanisms; this feature changes desired
membership, not routing policy.

- [ ] **Step 2: Update the Admin AISection**

Add to Config schema the exact nil default for admin.upstreams, the connector
default table erpc_admin, and PostgreSQL MinConns=1/MaxConns=4 with GitHub
permalinks to the new common/defaults.go lines.

Document all four methods with exact request and response examples. Add numbered
edge cases for first-run YAML seeding, database authority after initialization,
endpoint redaction/preservation, expectedRevision conflicts, failed apply
retaining the old runtime, provider-generated read-only entries, write-method
disablement when the block is absent, and 30-second PostgreSQL fallback polling.

Add an Observability subsection listing all five exact metric names and labels.

- [ ] **Step 3: Update the upstream configuration AISection**

State that projects[].upstreams is the one-time seed only when
admin.upstreams.connector is enabled and no index exists. Explain that later
YAML changes do not overwrite database desired state, while providers remain
file/provider controlled.

- [ ] **Step 4: Build docs and inspect generated agent text**

Run:

    pnpm --dir docs build

Expected: PASS and generated Admin/upstream llms text includes the new config
field, methods, edge cases, and metrics. Do not hand-edit generated .llms.txt
files.

- [ ] **Step 5: Commit docs**

    git add docs/pages/operation/admin.mdx docs/pages/config/projects/upstreams.mdx
    git commit -m "docs(admin): document dynamic upstreams"

### Task 8: Backend integration verification

**Files:**
- Verify all files changed by Tasks 1-7.

- [ ] **Step 1: Format generated and authored files**

Run:

    make fmt
    pnpm -r run format

Expected: both commands exit 0 and a second run produces no diff.

- [ ] **Step 2: Run focused race tests**

Run:

    go test -race ./upstream -run "TestUpstreamsRegistry_.*Managed" -count=1
    go test -race ./erpc -run "Test(AdminUpstream|Admin(List|Create|Update|Delete)Upstream|NewERPC_Admin)" -count=1

Expected: PASS with no race reports.

- [ ] **Step 3: Run repository build and daily-driver tests**

Run:

    make build
    make test-fast

Expected: PASS.

- [ ] **Step 4: Exercise the JSON-RPC contract on Windows**

Start eRPC with a local test configuration and use PowerShell:

~~~powershell
$headers = @{
  "content-type" = "application/json"
  "x-erpc-secret-token" = $env:ERPC_ADMIN_TOKEN
}
$body = @{
  jsonrpc = "2.0"
  id = 1
  method = "erpc_listUpstreams"
  params = @(@{ projectId = "main" })
} | ConvertTo-Json -Depth 8
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:4000/admin" -Headers $headers -Body $body
~~~

Expected: a result containing projectId, desiredRevision, appliedRevision, and
redacted items. Repeat with create/update/delete and verify expectedRevision
conflicts refetch cleanly and endpoint secrets never appear.

- [ ] **Step 5: Review the final diff and commit any verification-only fixes**

Run:

    git diff --check
    git status --short

Expected: no whitespace errors and only intentional files. If formatting or
verification required source changes, commit those exact files with:

    git commit -m "fix(admin): complete upstream controller verification"

Do not create an empty commit when no verification fixes were needed.
