# Independent eRPC Admin Web Design

**Status:** Approved for implementation
**Date:** 2026-08-26

## Goal

Build a standalone operator control plane beside eRPC. It monitors one or more
already-running eRPC instances, reads their existing `POST /admin` JSON-RPC
interface, and exposes a browser workspace for topology, health, and cordon
operations. The control plane does not edit `erpc.yaml`, write eRPC storage, or
modify eRPC source code.

## Repository boundaries

- `Admin/` is an independent Go module and process.
- `web/` is an independent React/Vite application.
- The eRPC root module, Go packages, workspace file, and lockfile are not
  changed by this feature.
- The Admin process is the credential boundary. eRPC admin tokens are loaded
  from environment variables and are never sent to the browser.

## Configuration

Admin has a small local YAML file. It stores target metadata, not eRPC config:

```yaml
listen: 127.0.0.1:8090
pollInterval: 10s
authFile: data/admin-auth.json
targets:
  - id: local-erpc
    baseUrl: http://127.0.0.1:4000
    adminTokenEnv: ERPC_LOCAL_ADMIN_TOKEN
```

`baseUrl` points at an eRPC HTTP listener. Admin appends `/admin` when needed.
Target definitions are loaded at startup; v1 has no database and no target
create/edit/delete UI. A restart reloads this file and rebuilds snapshots.
`authFile` stores the single administrator username and bcrypt password hash.
It never stores the plaintext password.

## Administrator authentication

`GET /api/auth/status` is public and reports whether initial setup is required
and whether the current browser session is authenticated. When no account file
exists, `/login` presents a create-administrator form. `POST /api/auth/setup`
validates the username and password, atomically creates the account file, and
immediately signs in the browser. Setup is permanently closed after that file
exists; a second setup request returns HTTP 409.

After setup, `/login` presents only username and password fields. Successful
`POST /api/auth/login` creates a cryptographically random server-side session
and sends an `HttpOnly`, `SameSite=Strict` cookie. `POST /api/auth/logout`
removes that session and clears the cookie. Sessions are intentionally
in-memory and expire after 24 hours, so an Admin restart requires login again
without recreating the administrator. All non-auth `/api` endpoints require a
valid session cookie.

## Runtime behavior

The poller calls `erpc_taxonomy` for every target at `pollInterval`. A successful
response refreshes the target snapshot and reports `healthy`. A failed request
reports `degraded` when an earlier snapshot exists and `offline` otherwise;
HTTP 401 is reported as `unauthorized`. eRPC itself continues to own endpoint
health checks, request-time failover, and rotation. Admin is an observer and
operator control surface, not a second health engine.

The browser can request project health (`erpc_project`), list whole-upstream
cordons (`erpc_listCordoned`), and issue `erpc_cordonUpstream` or
`erpc_uncordonUpstream`. These operations are proxied by Admin with the target
token held server-side.

## HTTP API

The Admin process exposes JSON endpoints for the web app:

| Endpoint | Purpose |
|---|---|
| `GET /api/auth/status` | Report setup and current session state |
| `POST /api/auth/setup` | Create the first and only administrator |
| `POST /api/auth/login` | Start a username/password session |
| `POST /api/auth/logout` | End the current session |
| `GET /api/targets` | Target connection state and last taxonomy snapshot |
| `GET /api/targets/{id}/taxonomy` | Fresh taxonomy from eRPC |
| `GET /api/targets/{id}/projects/{projectId}` | Project config and live health |
| `GET /api/targets/{id}/cordons?projectId=...` | Whole-upstream cordons |
| `POST /api/targets/{id}/cordon` | Proxy cordon request |
| `POST /api/targets/{id}/uncordon` | Proxy uncordon request |

The browser never receives or stores an Admin token. eRPC target tokens remain
separate environment variables and are only attached by the Admin process when
it calls each target's `/admin` endpoint.

## Web workspace

The first screen is a dark, compact operational shell. React Router owns URL
state; Redux Toolkit owns current authenticated UI state; the server cookie is
the source of truth for the session. TanStack Query owns server state and
refetching; Ant Design supplies tables, forms, tags, drawers, and notifications;
Tailwind supplies layout and spacing.

Routes are `/login`, `/targets`, and `/targets/:targetId`. `/login` switches
between first-run setup and normal sign-in based on `/api/auth/status`. The
target page keeps
the comparison surface as a table: connection status, project/network/upstream
counts, vendor, and cordon actions. There is no marketing hero and no write
form for RPC URLs in v1.

## Security and failure handling

- Administrator passwords are bcrypt hashed and the account file is created
  atomically with owner-only permissions where the operating system supports it.
- Login failures return one generic message so callers cannot distinguish an
  unknown username from a wrong password.
- eRPC tokens are read from environment variables once at startup and omitted
  from logs, JSON responses, and browser storage.
- Unknown target IDs return 404; malformed JSON returns 400; failed eRPC calls
  return bounded error messages without request credentials.
- A target remains visible after a poll failure so operators can distinguish a
  stale snapshot from an empty topology.
- Cordon/uncordon responses invalidate the corresponding Query cache.

## Acceptance criteria

1. `Admin` builds and tests as an independent Go module on Windows without
   Docker or imports from the eRPC module.
2. `web` installs and builds independently with pnpm.
3. Starting Admin with one target polls eRPC at the configured interval and
   exposes the target status through `/api/targets`.
4. The web app can inspect projects and cordon/uncordon an existing upstream
   without learning the eRPC token.
5. Existing eRPC files and behavior have no diff.
6. First launch creates exactly one administrator; later launches show only
   username/password login and preserve the account across process restarts.
