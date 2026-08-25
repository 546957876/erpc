# eRPC Admin Web - Feature Design

**Status**: Review
**Last revised**: 2026-08-26

## Goal

Add an embedded, dark-mode Admin Web for managing explicit EVM upstreams.
Operators can add, edit, delete, cordon, and inspect many RPC endpoints without
editing YAML or restarting eRPC. Existing request-time failover and periodic
state polling continue to decide whether an upstream receives traffic.

The feature must remain isolated from upstream eRPC development: frontend
source lives under `web/`, backend changes stay in the existing admin and
upstream ownership boundaries, and disabling dynamic upstream management keeps
today's startup and routing behavior unchanged.

## Confirmed decisions

- Source location: `web/` in this repository.
- Delivery: built assets embedded in the eRPC Go binary.
- URLs: `GET /admin/` serves the SPA; existing `POST /admin` remains the
  authenticated JSON-RPC admin endpoint.
- Frontend: React, TypeScript, Vite, Ant Design, and Tailwind CSS.
- Theme: dark and compact by default.
- Authentication: the operator enters the existing admin secret token; it is
  stored in browser `sessionStorage` only.
- First writable resource: explicit EVM upstreams only.
- Projects, networks, providers, failsafe settings, and full config are
  read-only in v1.
- Persistence: the Admin upstream store uses `data.Connector`; production uses
  PostgreSQL. Memory remains useful for focused tests and local UI work.
- Scope: a focused upstream controller, not the generic whole-config controller
  proposed by `plans/001-dynamic-config-controller.md`.

## Page direction

### Option A - table with edit drawer (recommended)

```text
+----------------------------------------------------------------------------+
| eRPC Admin   Project [main v]   32 nodes / 28 healthy    Refresh   Session  |
+------------+---------------------------------------------------------------+
| Upstreams  | Upstreams                         Search  Status  [+ Add node] |
| Projects R | 32 total | 28 healthy | 2 degraded | 2 cordoned               |
| Networks R +---------------------------------------------------------------+
| Config   R | State   ID       Network   Vendor   Endpoint   Lag  Last check |
|            | OK      bnb-01   evm:56    alchemy  bnb-...    0    4s ago     |
|            | WARN    bnb-02   evm:56    custom   https:...  3    8s ago     |
|            | OFF     bnb-03   evm:56    custom   https:...  -    cordoned   |
|            |                                                               |
+------------+----------------------------------------------+----------------+
                                                       click | Edit drawer    |
                                                             | endpoint       |
                                                             | chain ID       |
                                                             | poll interval  |
                                                             | tags / raw view|
                                                             | [Save]         |
                                                             +----------------+
```

This layout keeps the comparison surface wide when there are dozens of nodes.
The drawer preserves the table context while adding or editing one node. On a
narrow screen the navigation collapses and the drawer becomes full width.

### Option B - permanent master/detail split

```text
+----------------------------------------------------------------------------+
| eRPC Admin   Project [main v]                                  [+ Add node] |
+------------+-----------------------------+--------------------------------+
| Upstreams  | Search / filters            | bnb-02                         |
| Projects R | OK   bnb-01  42 ms           | Status: degraded               |
| Networks R | WARN bnb-02  380 ms          | Endpoint: https://...          |
| Config   R | OFF bnb-03  cordoned         | Chain: evm:56                  |
|            |                              | Poll interval: 30s             |
|            |                              | [Edit] [Cordon] [Delete]       |
+------------+-----------------------------+--------------------------------+
```

The detail is always visible, but the node list loses columns and cross-node
comparison becomes harder as the fleet grows.

| Criterion | Option A: table + drawer | Option B: master/detail |
|---|---|---|
| Many-node scanning | Best | Limited |
| Compare lag, latency, and state | Best | Requires selecting rows |
| Editing context | Good | Best |
| Small screens | Drawer becomes full width | Awkward three-column collapse |
| Implementation size | Smaller | Larger persistent selection state |

The design proceeds with Option A unless review changes it.

### Login

```text
+------------------------------------------+
| eRPC Admin                               |
|                                          |
| Admin secret token                       |
| [**************************************]  |
|                           [Connect]       |
|                                          |
| Authentication errors appear here.       |
+------------------------------------------+
```

There is no account system in v1. A successful lightweight admin request opens
the workspace; closing the browser session removes the token.

## Frontend structure

Ant Design owns behavior-heavy controls: table, form, drawer, modal,
confirmation, status tags, tooltips, and notifications. Tailwind owns page
layout, spacing, responsive behavior, and small typography adjustments. Theme
colors, control density, radius, and component states come from Ant Design
tokens; Tailwind does not override Ant Design internals.

The workspace contains:

- A compact top bar with project selection, connection state, counts, refresh,
  and session exit.
- A restrained navigation rail. `Upstreams` is writable; projects, networks,
  and config are visibly read-only.
- One wide upstream table. No dashboard card mosaic.
- A right drawer for create/edit, current health, and a read-only raw config
  view.
- A destructive confirmation modal for delete and the existing cordon action.

The table initially exposes status, ID, network, vendor, redacted endpoint,
head lag, recent latency/error signal when available, last health update, and
row actions. Search and project/status filters are client-side for v1 because a
single project's upstream list is expected to remain small enough to return in
one response.

Create covers ID, endpoint, optional chain ID, vendor name, tags, and
`evm.statePollerInterval`. Update patches endpoint, chain ID, vendor name, tags,
or poll interval; the ID is immutable. The raw view is inspect-only in v1.
Patching only these fields preserves unedited and future config fields instead
of making an older UI replace an object it does not understand.

## Runtime architecture

```text
Browser
  | GET /admin/                 POST /admin (JSON-RPC + secret token)
  v                             v
embedded web.FS          existing AdminHandleRequest
                                      |
                                      v
                           UpstreamConfigController
                            |                    |
                            v                    v
                    data.Connector       UpstreamsRegistry
                    PostgreSQL           atomic snapshots
                            |
                  revision notify/watch
                            |
                 other eRPC instances reconcile
```

### Configuration boundary

Dynamic management is opt-in through a new `admin.upstreams.connector` block.
The controller uses the existing `data.Connector` contract rather than
depending directly on PostgreSQL APIs. PostgreSQL is the documented production
configuration; connector implementations remain an open set.

When the block is absent, no controller, storage access, watcher, or Admin Web
write methods are enabled. Existing file-configured eRPC behavior is unchanged.

### Initial migration

On the first startup with dynamic management enabled, the controller takes a
distributed project lock. If the project store has no initialization marker,
it seeds `projects[].upstreams` into the store and writes revision 1. From that
point, the store is authoritative for explicit upstreams; later edits to that
project's YAML `upstreams` list do not overwrite database state.

Provider-generated upstreams remain file/provider controlled and read-only.
They are not copied into the Admin store.

If the authoritative store cannot be read during startup, initialization fails
instead of silently falling back to a possibly stale YAML list. Projects that
do not enable dynamic management continue to start normally.

### Storage model

Each explicit upstream is one versioned JSON value under a project partition:

```text
partition: admin/upstreams/v1/<projectId>
range:     <upstreamId>
value:     { revision, updatedAt, updatedBy, config }

signal:    admin/upstreams/v1/<projectId>/revision
marker:    admin/upstreams/v1/<projectId>/_initialized
```

`revision` on each value is that upstream's resource version. The signal is a
separate project-wide monotonic revision used only to trigger reconciliation.
Create requires no resource version; update and delete compare the caller's
`expectedRevision` with the stored upstream under the lock.

Writes take the existing distributed connector lock, compare the resource
version, persist the change, persist the incremented project revision, and then
publish that revision with `PublishCounterInt64`. The writing instance
reconciles immediately. Other instances receive `WatchCounterInt64`;
PostgreSQL's existing 30-second fallback poll covers missed notifications.

The storage codec must not call `UpstreamConfig.MarshalJSON`, because that
public serializer intentionally redacts endpoint credentials. Storage uses an
internal unredacted alias while API responses use the redacting serializer.
The controller retains the stored raw JSON object alongside its typed,
validated projection so an update preserves fields this UI version does not
understand.

### Safe apply and removal

Each managed upstream receives its own child context. This is required because
today an upstream's state poller is tied to the whole application context and
the registry has registration but no removal lifecycle.

For create or update, the controller applies project defaults, validates the
candidate, constructs it, and bootstraps it before changing routing snapshots.
Only a ready candidate is atomically inserted or swapped into the registry.
After a successful swap, the old upstream child context is cancelled so its
poller stops. Requests that already hold the old pointer may finish.

For delete, the registry first removes the upstream from new selection
snapshots and then cancels its child context. A failed create/update keeps the
last applied upstream serving traffic and records the apply error for the Admin
response and logs.

The database represents desired state. The Admin response reports whether the
instance serving this request is `applied`, `pending`, or `error`, together
with desired and locally applied project revisions. Notifications drive the
other instances, but v1 does not aggregate confirmation from every replica.

## Admin API

All methods use the existing authenticated `POST /admin` JSON-RPC transport.

| Method | Purpose |
|---|---|
| `erpc_listUpstreams` | Return desired/applied project revisions and stored explicit upstream configs with local apply status. |
| `erpc_createUpstream` | Validate and create an EVM upstream; duplicate IDs fail. |
| `erpc_updateUpstream` | Patch the v1-editable fields using `expectedRevision`; omitted endpoint preserves the existing secret. |
| `erpc_deleteUpstream` | Delete one upstream using `expectedRevision`; missing IDs fail. |
| `erpc_cordonUpstream` | Existing method; temporarily remove an applied upstream from routing. |
| `erpc_uncordonUpstream` | Existing method; return a cordoned upstream to routing. |
| `erpc_project` | Existing read path for runtime health and project config. |
| `erpc_taxonomy` / `erpc_config` | Existing read paths for navigation and read-only views. |

Create requires a full endpoint. Read responses continue to redact endpoint
credentials and include `endpointConfigured: true|false`. The edit form starts
the endpoint input empty; the client omits it unless the operator enters a new
value. Update treats a missing endpoint as "keep the stored value"; an empty
endpoint is invalid. The client never submits the redacted display string.
This lets operators change a poll interval or tag without the browser
retrieving or resubmitting an API key embedded in the URL.

Unknown upstream types and unknown patch fields are rejected explicitly in v1.
Unknown fields already present in stored config are preserved and returned
unchanged except for endpoint redaction; the controller does not invent vendor,
chain, or method allowlists.

## Observability

- `erpc_admin_upstream_desired_revision{project}` - latest project revision
  observed in the store.
- `erpc_admin_upstream_applied_revision{project}` - latest project revision
  fully applied by this instance.
- `erpc_admin_upstream_reconcile_total{project,result}` - reconciliation
  outcomes (`success`, `partial`, or `error`).
- `erpc_admin_upstream_apply_total{project,operation,result}` - create, update,
  and delete apply outcomes without an upstream-ID label.
- `erpc_admin_upstream_apply_duration_seconds{project,operation}` - local
  validation, bootstrap, and snapshot-swap duration.

Logs include project, upstream ID, desired revision, applied revision,
operation, and wrapped error. Endpoint values and admin tokens are omitted.

## HTTP and asset delivery

`web/embed.go` embeds `web/dist`. The HTTP server serves the SPA only for GET
and HEAD requests under `/admin/`; the exact existing POST `/admin` route keeps
its current JSON-RPC behavior. Unknown SPA paths fall back to `index.html`.

Hashed JS/CSS assets receive long-lived immutable caching. `index.html` uses
`no-store` so a binary upgrade is visible without a hard refresh. Development
uses the Vite server with `/admin` proxied to the Go server; production has one
listener and no CORS dependency.

## Security and errors

- The admin token is never placed in a URL, log, localStorage, or generated
  config file.
- The frontend bundle contains no RPC endpoint or PostgreSQL credentials.
- Full endpoint secrets never leave the server after creation.
- An authentication failure from either HTTP or the JSON-RPC envelope clears
  the in-memory session view and returns to login; the operator may retry
  without reloading the page.
- Validation, revision conflicts, storage failures, and apply failures are
  distinct UI messages. Raw internal errors are not rendered as HTML.
- Delete shows project, upstream ID, and redacted endpoint in a confirmation.
- The embedded app uses bundled dependencies and a restrictive CSP; it does not
  load scripts from a CDN.

## Testing and acceptance

Backend tests cover first-run seeding, restart recovery, create/update/delete,
duplicate IDs, stale revisions, endpoint preservation, endpoint redaction,
failed bootstrap retaining the old upstream, poller cancellation, atomic
selection snapshots, notification reconciliation, and unknown-field
round-tripping. Tests that log initialize `util.ConfigureTestLogger`; network
mocks follow the repository's gock ordering rules.

Frontend tests cover token/session behavior, JSON-RPC error mapping, list and
filter behavior, create/edit validation, optimistic conflict refresh, secret
endpoint preservation, destructive confirmation, and read-only navigation.

End-to-end acceptance on Windows:

1. Build the frontend and Go server without Docker.
2. Start eRPC with a local development connector or PostgreSQL.
3. Open `/admin/`, enter the admin token, and add an EVM endpoint.
4. Verify it becomes applied and receives a normal JSON-RPC request through
   eRPC.
5. Break the endpoint and verify existing health/failover logic removes it from
   useful rotation while other upstreams continue serving.
6. Edit `statePollerInterval`, restart eRPC, and verify the database value and
   upstream return.
7. Delete the upstream and verify it disappears from new routing snapshots and
   its poller stops.

## Implementation TODO

- [ ] Add the opt-in Admin upstream store config, defaults, validation, generated
  TypeScript types, and matching docs.
- [ ] Implement the connector-backed versioned upstream store and first-run
  seeding.
- [ ] Add per-upstream lifecycle cancellation and atomic registry
  add/replace/remove operations.
- [ ] Add the four Admin JSON-RPC CRUD methods with revision checks and endpoint
  secrecy rules.
- [ ] Add controller reconciliation, local apply status, multi-instance watch,
  metrics, and focused Go tests.
- [ ] Scaffold `web/` with React, TypeScript, Vite, Ant Design, and Tailwind.
- [ ] Build the session login, API client, shell, read-only navigation, upstream
  table, filters, drawer form, and destructive actions.
- [ ] Embed `web/dist`, add `/admin/` asset routing, and add the Vite development
  proxy.
- [ ] Update operator documentation and Windows startup commands.
- [ ] Run formatting, frontend tests/build, focused Go tests, `make build`, and
  the Windows end-to-end flow.

## Non-goals for v1

- Editing projects, networks, providers, retry/hedge/circuit-breaker policy,
  cache configuration, auth, rate limits, or the entire YAML document.
- Turning `plans/001` into a prerequisite or hot-reloading every config field.
- Managing provider-generated upstreams.
- User accounts, roles, token issuance, or persistent browser login.
- WebSocket/SSE live telemetry, charts, historical analytics, or a separate
  frontend deployment.
- SVM upstream CRUD.
