# Managed eRPC Admin Web Design

**Status:** Approved for implementation
**Date:** 2026-08-26

## Goal

Build a standalone Chinese operator control plane beside eRPC. The Admin
process owns one local eRPC process, stores versioned eRPC configuration in
PostgreSQL, and uses the unmodified eRPC executable to validate and run the
selected configuration. The browser manages the desired configuration while
the running eRPC process continues using the revision with which it started.

The already-built monitoring, project health, and cordon controls remain part
of the product. This document supersedes the earlier v1 restriction that Admin
was only a read-only observer with YAML-defined targets.

## Confirmed decisions

| Area | Decision |
|---|---|
| Managed scope | One local eRPC instance |
| Process owner | Admin starts, stops, and restarts `erpc.exe` |
| Configuration source | PostgreSQL is authoritative |
| eRPC integration | Admin generates YAML; eRPC remains unchanged |
| Persistence shape | One complete operator override document per immutable revision; effective values come from the pinned eRPC defaults |
| Apply behavior | Saving never restarts eRPC; start/restart uses the latest valid revision |
| Upstream operations | Persistent CRUD through revisions plus immediate cordon/uncordon |
| Version display | Latest config revision, running config revision, eRPC version, and commit |
| Invalid configuration | Reject without creating a revision |
| Poll settings | Admin observation polling and eRPC state polling are presented separately |
| Port settings | Saved as eRPC config and applied only after restart |
| Configuration secrets | Stored in PostgreSQL as plaintext and viewable/editable after Admin login |
| Initial setup | Admin automatically creates revision 1 from the current eRPC defaults; no field entry is required |
| Configuration UI | Users never write or paste YAML; Admin generates YAML internally |
| Language | Chinese only; no i18n layer |

## Repository boundaries

- `Admin/` remains an independent Go module and process.
- `web/` remains an independent React/Vite application.
- eRPC root packages, public config structs, startup behavior, and `/admin`
  methods are not changed.
- The unimplemented root plan `plans/001-dynamic-config-controller.md` is not a
  dependency. If upstream later ships it, Admin may add an adapter in a
  separate change.
- Admin bootstrap settings stay outside the managed eRPC document: Admin listen
  address, PostgreSQL DSN environment name, eRPC executable path, runtime
  directory, and Admin polling interval.

## Runtime flow

```text
Browser
  -> authenticated Admin HTTP API
  -> PostgreSQL immutable config revisions
  -> generated runtime/revision-<n>/erpc.yaml
  -> erpc validate <generated-yaml>
  -> erpc start <generated-yaml>
  -> local eRPC process
  -> configured RPC upstreams
```

Admin continues calling the running eRPC `/admin` endpoint for topology,
project health, and cordon operations. It authenticates with the secret from
the running revision, not the latest edited revision. That prevents an unapplied
credential edit from breaking access to the current process.

## PostgreSQL model

Use PostgreSQL, not SQLite. Keep the schema small and do not normalize every
eRPC field.

### `admin_users`

Contains the single administrator username and bcrypt password hash. The user
password is never stored in plaintext. Existing first-run setup and in-memory
24-hour sessions remain; only account persistence moves from the JSON file to
PostgreSQL.

### `config_revisions`

Each row is immutable and contains:

- monotonically increasing `revision`;
- the complete operator override document as `jsonb`;
- SHA-256 content hash;
- creation time and administrator username.

The override document is open-ended. It stores every explicit operator choice
but omits untouched system defaults. Admin combines it with the default snapshot
generated from the pinned eRPC source to produce the effective configuration
shown by the Web application. When Admin writes YAML, it writes the overrides;
the unmodified eRPC process applies the same defaults during `SetDefaults`.
Therefore an untouched field follows a changed upstream default after an eRPC
upgrade, while a customized field remains fixed. The running revision together
with the recorded eRPC binary version and commit identifies which defaults were
used at runtime.

Structured form updates merge into the current override document so unknown
object keys from a newer eRPC revision are preserved. The Web application owns
field metadata for the pinned eRPC version and must be updated when upstream
adds configuration fields. Users are never required to edit YAML as a
compatibility fallback.

### `erpc_runtime`

A singleton row records the managed PID, process start time, running revision,
binary version, binary commit, and last process error. The latest revision is
`MAX(config_revisions.revision)` and is not duplicated in another table.

## Configuration lifecycle

### Initial setup

After PostgreSQL initialization, Admin validates an empty override document with
the configured eRPC binary and automatically creates revision 1 as the system
default configuration. This is not an unconfigured state: eRPC applies its
normal `Config.SetDefaults` behavior, including listeners, health checks,
metrics, and the default project behavior. The operator can start it without
filling in any field.

The Web application renders the effective default values directly in their
controls. Each untouched field is marked `系统默认`; the raw YAML key is shown
only inside its help content. Editing a value creates an explicit override and
changes the marker to `自定义`. `恢复默认` removes that override and immediately
shows the current eRPC default again. Fields without defaults remain visibly
unset and explain what must be supplied before the related optional feature can
be enabled.

### Save

Structured forms submit one complete override document. Values equal to the
current system default are removed from the override document unless the field
has no default. Admin converts the overrides to YAML internally and validates
them with the exact eRPC binary before inserting a revision. An invalid document
returns field-oriented errors and consumes no revision number. A `baseRevision`
field prevents two browser tabs from silently overwriting each other; stale
writes return HTTP 409.

### Apply

Saving does not touch the running process. Starting or restarting selects the
latest valid revision, writes a revision-specific YAML artifact, validates it
again, and starts eRPC with that file. The runtime row is updated only after
the new process is confirmed reachable.

Stopping leaves both revision numbers unchanged. The UI reports one of:

- `未启动`;
- `运行中，配置为最新版本`;
- `运行中，有未应用配置`;
- `启动失败`;
- `外部进程，Admin 不会强制终止`.

### Rollback

Revisions never move backward. Restoring an old revision validates its document
and inserts a new latest revision. The operator then explicitly restarts eRPC.

## Process ownership

- Admin controls only the eRPC process it started.
- Start is rejected when another process already owns the configured eRPC port.
- Stop requests graceful termination first and force-kills only after a bounded
  timeout.
- Admin persists PID and process start time. After an Admin restart it verifies
  both before treating the process as owned, preventing PID-reuse kills.
- If ownership cannot be proven, Admin shows the process as external and does
  not terminate it.
- Standard output and standard error are captured in bounded local log files;
  configuration payloads and plaintext secrets are never logged.

## Upstream management

Persistent create, edit, and delete operations modify
`projects[].upstreams` in the complete desired document and save a new revision.
They do not need separate backend CRUD tables or eRPC methods. The UI validates
duplicate IDs and required endpoint/network fields before submitting, while
eRPC remains the final validator.

Immediate temporary disable/enable continues using the existing
`erpc_cordonUpstream` and `erpc_uncordonUpstream` methods against the running
revision. The UI must distinguish:

- `临时摘除`: immediate runtime action, no config revision;
- `修改配置`: persistent desired state, restart required.

## Configuration workspace

The application remains dark, compact, and Chinese-only. React Router owns URL
state, Redux Toolkit owns authenticated UI state, TanStack Query owns server
state, Ant Design supplies controls, and Tailwind supplies layout.

Required pages:

- `运行概览`: process status, start/stop/restart, latest/running revision,
  binary version/commit, ports, last error, and topology summary;
- `上游管理`: project-scoped upstream table, add/edit/delete, and separate
  temporary cordon controls;
- `服务设置`: log level, cluster key, IPv4/IPv6 HTTP, gRPC, Metrics, Admin
  auth, health checks, proxy pools, tracing, and restart-required indicators;
- `项目与网络`: project, provider, network, architecture, chain, auth, and
  project-level policy fields;
- `轮询与容错`: Admin observation interval shown separately from EVM/SVM state
  polling, retry, hedge, timeout, circuit breaker, consensus, and selection
  policy settings;
- `缓存与限流`: database connectors and policies plus rate-limiter budgets and
  rules;
- `完整配置`: sectioned Chinese field forms for every field supported by the
  pinned eRPC version, without a YAML input or editor;
- `配置版本`: immutable history, comparison metadata, view, and restore-as-new.

Frequently used fields remain visible; uncommon groups are collapsed by
section. Arrays use add/edit/delete controls, booleans use switches, bounded
choices use selects, numeric values use number inputs, and durations and open
string fields use validated text inputs. There is no YAML text area, import
box, or editable source mode.

### Field metadata and help

The field list is generated from `common.Config` and all transitively referenced
configuration structs. The generated schema records the owning Go type, YAML
key, value type, source comment, and deprecation state. A generated default
snapshot comes from the same `common.Config.SetDefaults` path used by eRPC;
conditional defaults such as a gRPC host inheriting the HTTP host are recorded
as inheritance rules instead of guessed literals. `erpc.dist.yaml` and the
matching pages under `docs/pages/config/` provide examples and operational
notes.

Every supported field has checked-in Chinese metadata keyed by owning config
type and YAML field. The UI shows a `?` help icon containing:

- what the field controls;
- its current effective default, inheritance rule, or `无默认值`;
- the accepted format, unit, choices, or useful range where known;
- one safe example;
- restart impact and important risk notes where applicable;
- the original YAML key for technical troubleshooting.

There is no automatic word-by-word translation fallback. Schema generation or
tests fail when a new upstream field lacks a Chinese name, explanation, example,
or explicit default classification. Deprecated fields are preserved when read
but are hidden from normal editing and identified in help metadata. Sensitive
fields keep password-style controls while remaining viewable on explicit user
action, per the accepted plaintext-secret decision.

## Ports and polling

The UI treats the following as separate concepts:

- Admin observation polling: how often Admin refreshes topology;
- EVM `statePollerInterval` / `statePollerDebounce`;
- network `fallbackStatePollerDebounce`;
- SVM `statePollerDebounce`;
- other connector-specific intervals such as DynamoDB state polling.

Likewise, eRPC HTTP IPv4/IPv6, gRPC, and Metrics listeners have separate enable,
host, and port controls. These fields are configuration only and never mutate
live listeners; the UI marks them `重启后生效`. The Admin Web listen port is a
bootstrap concern and is not part of the eRPC config revision.

## Security boundaries

- The confirmed deployment stores eRPC configuration secrets in PostgreSQL as
  plaintext so the authenticated operator can view and edit them.
- Admin account passwords remain bcrypt hashes; the plaintext decision does not
  apply to login passwords.
- All config and process APIs require the existing HttpOnly, SameSite session.
- Lists and logs do not contain full config payloads. A dedicated authenticated
  detail request returns plaintext fields for editing.
- Generated YAML also contains plaintext secrets and is written only under the
  configured runtime directory.
- PostgreSQL users, backups, and filesystem readers with access to those data
  can read the secrets; this is an accepted single-user deployment tradeoff.

## Admin HTTP API

The existing auth, topology, project, and cordon routes remain. Add the minimum
write surface:

| Endpoint | Purpose |
|---|---|
| `GET /api/runtime` | Managed process and version status |
| `POST /api/runtime/start` | Start latest valid revision |
| `POST /api/runtime/stop` | Gracefully stop the managed process |
| `POST /api/runtime/restart` | Apply latest valid revision by restart |
| `GET /api/config` | Latest full document and latest/running revision |
| `POST /api/config/validate` | Validate without saving |
| `POST /api/config` | Validate and create an immutable revision |
| `GET /api/config/revisions` | List revision metadata |
| `GET /api/config/revisions/{revision}` | Read one full revision |
| `POST /api/config/revisions/{revision}/restore` | Copy an old revision into a new latest revision |

Upstream forms use `GET/POST /api/config`; separate persistent upstream CRUD
endpoints would duplicate the same revision logic and are intentionally omitted.

## Acceptance criteria

1. Admin connects to PostgreSQL and persists the single administrator and
   immutable operator-override config revisions.
2. Admin automatically creates revision 1 from the current eRPC defaults; the
   operator can start without entering configuration fields.
3. Saving a valid edit increments the revision without restarting eRPC.
4. Admin starts, stops, and restarts one local eRPC process on Windows.
5. Restart generates YAML from the latest revision and updates the running
   revision only after eRPC becomes reachable.
6. The UI clearly shows whether running and latest revisions match.
7. Upstream add/edit/delete creates revisions; cordon/uncordon remains an
   immediate runtime operation.
8. Chinese field forms cover the complete configuration supported by the
   pinned eRPC version; every field has a help icon, default classification, and
   safe example, and users never write or paste YAML.
9. RPC URLs and other eRPC secrets are viewable/editable after login, but never
   written to application logs.
10. No eRPC root source or public config schema changes are required.
11. Untouched controls display effective defaults without persisting them as
    overrides; editing and restoring a field visibly switches between `自定义`
    and `系统默认`.
