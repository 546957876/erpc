# Independent Admin Control Plane Implementation Plan

## Scope

Create two independent applications under the repository directory: `Admin/`
for a Go control-plane proxy and `web/` for a React operator workspace. Do not
modify existing eRPC source, root Go metadata, pnpm workspace metadata, or the
root lockfile.

## Backend tasks

1. Add `Admin/go.mod`, sample YAML, and config loading with target URL/token
   environment resolution and optional web-token authentication.
2. Add a JSON-RPC client for eRPC `POST /admin`, preserving unknown response
   fields and returning bounded, credential-free errors.
3. Add an in-memory target registry and poller. Poll `erpc_taxonomy` on the
   configured interval and expose healthy/degraded/offline/unauthorized state.
4. Add HTTP handlers for target snapshots, taxonomy, project health, cordons,
   and uncordons. Validate target IDs and request bodies.
5. Add unit tests for config, JSON-RPC framing/error mapping, poll transitions,
   auth, routes, and cordon proxy payloads.

## Frontend tasks

1. Scaffold standalone Vite React TypeScript app with Ant Design dark theme,
   Tailwind CSS, React Router, Redux Toolkit, React Redux, redux-persist, and
   TanStack Query.
2. Add session slice persisted only to `sessionStorage`; send the Admin web
   token as a request header and never expose eRPC tokens.
3. Add `/login`, `/targets`, and `/targets/:targetId` routes with protected
   navigation, target selector, status summary, topology table, project health
   view, and cordon/uncordon actions.
4. Add responsive layout and empty/loading/error states. Keep the UI dense and
   operational: no URL CRUD, marketing copy, or card mosaic.

## Verification

```text
cd Admin
go test ./...
go build ./cmd/admin

cd ../web
pnpm install
pnpm run build
```

Run Admin against a local eRPC endpoint and verify `/api/targets`, taxonomy,
project health, and cordon/uncordon flows. Confirm `git diff` contains no
changes outside `Admin/`, `web/`, and the independent design documents.
