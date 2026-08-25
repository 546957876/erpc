# Admin Account Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the browser-entered Admin Web token with first-run creation of one persistent administrator account and normal username/password login.

**Architecture:** The standalone Admin process owns a bcrypt-hashed account file and an in-memory random-session registry. Public auth endpoints drive first-run setup and login; all operational APIs require the resulting HttpOnly cookie. The React app asks the auth status endpoint which form to render and keeps no credential in Redux or browser storage.

**Tech Stack:** Go 1.25, `golang.org/x/crypto/bcrypt`, `net/http`, React 19, React Router, Redux Toolkit, TanStack Query, Ant Design.

---

### Task 1: Persistent single-administrator store

**Files:**
- Create: `Admin/internal/auth/store.go`
- Create: `Admin/internal/auth/store_test.go`
- Modify: `Admin/go.mod`
- Modify: `Admin/internal/config/config.go`
- Modify: `Admin/internal/config/config_test.go`
- Modify: `Admin/admin.yaml.example`

- [ ] Write tests proving an empty store requires setup, setup writes no plaintext password, correct credentials authenticate, wrong credentials fail, and a second setup is rejected.
- [ ] Run `go test ./internal/auth ./internal/config` and confirm failure because the auth store and `authFile` config do not exist.
- [ ] Implement the minimal mutex-protected JSON file store using bcrypt and atomic create/rename. Validate trimmed usernames at 3-64 characters and passwords at 8-128 characters.
- [ ] Add `authFile` with default `data/admin-auth.json` to config parsing and runtime config.
- [ ] Run `go test ./internal/auth ./internal/config` and confirm all tests pass.

### Task 2: Cookie sessions and auth HTTP endpoints

**Files:**
- Create: `Admin/internal/auth/sessions.go`
- Create: `Admin/internal/auth/sessions_test.go`
- Modify: `Admin/internal/server/server.go`
- Modify: `Admin/internal/server/server_test.go`
- Modify: `Admin/cmd/admin/main.go`

- [ ] Write handler tests for auth status before setup, successful setup with `HttpOnly`/`SameSite=Strict` cookie, rejected second setup, generic failed login, successful login, logout, and denial of `/api/targets` without a session.
- [ ] Run `go test ./internal/auth ./internal/server` and confirm the new endpoint tests fail.
- [ ] Implement 24-hour random server-side sessions and the four `/api/auth/*` routes, then protect the existing operational routes with the session cookie.
- [ ] Wire the account store and session registry from `cmd/admin/main.go`; remove Admin Web token resolution while retaining eRPC target token environment variables.
- [ ] Run `go test ./...` in `Admin` and confirm all packages pass.

### Task 3: First-run setup and normal login UI

**Files:**
- Modify: `web/src/app/api.ts`
- Modify: `web/src/app/store.ts`
- Modify: `web/src/main.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/styles.css`

- [ ] Add typed calls for auth status, setup, login, and logout; make all requests use same-origin cookies and remove token headers/arguments.
- [ ] Reduce Redux session state to an authenticated boolean and remove persisted credential storage.
- [ ] Render create-account fields when `setupRequired` is true and username/password login otherwise; require matching passwords only during setup.
- [ ] Make the protected route wait for auth status, redirect unauthenticated browsers to `/login`, and clear server/query state on logout.
- [ ] Run `pnpm run build` and confirm TypeScript and Vite builds pass.

### Task 4: End-to-end verification

**Files:**
- Modify: `specs/admin-web/feature.md`

- [ ] Start Admin with a temporary empty auth path and verify `/login` shows account creation.
- [ ] Create an administrator, verify the topology page loads, log out, and verify `/login` now shows only username/password login.
- [ ] Restart Admin with the same auth file, verify setup stays closed, sign in again, and confirm `local-erpc`, project `main`, and upstream `alchemy-bnb` render.
- [ ] Run `go test ./...`, `go build ./cmd/admin`, `pnpm run build`, and `git diff --check`.
