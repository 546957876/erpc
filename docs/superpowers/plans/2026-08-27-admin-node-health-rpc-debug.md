# Admin Node Health And RPC Debug Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add configuration-aware node health controls and two-path RPC testing to the Chinese Admin Web without modifying eRPC core behavior.

**Architecture:** Add one shared stdlib HTTP JSON-RPC probe to the existing Admin eRPC client package. Expose it through one managed-revision endpoint and one target endpoint, then reuse the current topology UI as the health workspace and add one RPC debugger page. Existing revision, validation, React Query, routing, and Ant Design patterns remain authoritative.

**Tech Stack:** Go 1.25 stdlib HTTP, existing Admin packages, React 19, TypeScript 5.9, React Query, React Router, Ant Design 6, Tailwind CSS 4, Vitest.

---

### Task 1: Shared Admin RPC Probe

**Files:**
- Modify: `Admin/internal/erpc/client.go`
- Test: `Admin/internal/erpc/client_test.go`

- [x] **Step 1: Write failing tests**

Add tests that call the desired `Client.TestRPC` and `TestEndpoint` APIs against
`httptest.Server`. Assert the exact JSON-RPC envelope, open `networkId` and
method strings, the `true` skip-cache directive, optional upstream directive,
absence of the Admin token on data-plane requests, safe diagnostic headers,
raw response body, non-2xx result,
2 MiB limit, and opaque transport errors.

- [x] **Step 2: Verify RED**

Run:

```powershell
go test ./internal/erpc -run 'Test.*RPC' -count=1
```

Expected: compile failure because the probe contracts do not exist.

- [x] **Step 3: Implement the minimum shared sender**

Add these open-string contracts:

```go
type TestRequest struct {
	ProjectID string          `json:"projectId"`
	NetworkID string          `json:"networkId,omitempty"`
	UpstreamID string         `json:"upstreamId,omitempty"`
	Method string             `json:"method"`
	Params json.RawMessage    `json:"params,omitempty"`
}

type TestResult struct {
	HTTPStatus int    `json:"httpStatus"`
	DurationMs int64  `json:"durationMs"`
	Body       string `json:"body"`
	Upstream   string `json:"upstream,omitempty"`
	Upstreams  string `json:"upstreams,omitempty"`
	Cache      string `json:"cache,omitempty"`
}
```

Keep `baseURL` on `Client`, implement `Client.TestRPC`, exported
`TestEndpoint`, and one private sender using the existing 8-second timeout and
2 MiB response limit. Validate only protocol invariants: non-empty project,
network where required, method, and absolute HTTP(S) endpoint.

- [x] **Step 4: Verify GREEN**

Run the focused test again and require exit 0.

### Task 2: Authenticated Direct And Runtime Endpoints

**Files:**
- Modify: `Admin/internal/server/server.go`
- Modify: `Admin/internal/server/managed.go`
- Test: `Admin/internal/server/server_test.go`
- Test: `Admin/internal/server/managed_test.go`
- Modify: `Admin/README.md`

- [x] **Step 1: Write failing handler tests**

Cover unauthorized calls, exact revision lookup, missing/duplicate
project/upstream IDs, invalid endpoint schemes, direct success while runtime is
stopped, target-not-found, runtime pass-through, and safe 502 errors.

- [x] **Step 2: Verify RED**

```powershell
go test ./internal/server -run 'Test.*RPCTest|Test.*UpstreamTest' -count=1
```

Expected: 404 or compile failure because routes/helpers are absent.

- [x] **Step 3: Implement managed revision lookup**

Handle `POST /api/config/upstreams/test` before the generic config fallthrough.
Decode `erpc.TestRequest` plus `revision`, call `Revisions.Get`, unmarshal only
the project/upstream fields needed for endpoint lookup, reject ambiguous IDs,
and call `erpc.TestEndpoint`. Never accept or return the endpoint URL.

- [x] **Step 4: Implement runtime target routing**

Add `POST /api/targets/{targetId}/rpc-test` beside taxonomy/project/cordon
routes. Decode the same request, call `target.Client.TestRPC`, and return the
result. Transport failures use the existing safe error envelope with a new
generic Chinese message.

- [x] **Step 5: Verify GREEN and document the boundary**

Run the focused server tests, then update `Admin/README.md` with both routes,
authentication, no-arbitrary-URL behavior, and restart semantics.

### Task 3: Frontend API And Pure RPC Debug Helpers

**Files:**
- Modify: `web/src/app/api.ts`
- Modify: `web/src/app/api.test.ts`
- Create: `web/src/pages/RpcDebug.tsx`
- Create: `web/src/pages/RpcDebug.test.ts`

- [x] **Step 1: Write failing frontend tests**

Define tests for both mutation paths, encoded target IDs, unknown network and
method pass-through, the four network presets, params parsing (`[]`, object,
empty, invalid, scalar), public path generation, PowerShell/curl command
generation, and JSON/non-JSON result formatting.

- [x] **Step 2: Verify RED**

```powershell
pnpm exec vitest run src/app/api.test.ts src/pages/RpcDebug.test.ts
```

Expected: missing exports or module failure.

- [x] **Step 3: Add React Query mutations and pure helpers**

Add `useSavedUpstreamTest` and `useRuntimeRPCTest` to `api.ts`. In
`RpcDebug.tsx`, export the open preset data and pure parsers/generators before
building the component. Do not add a method or chain enum.

- [x] **Step 4: Verify GREEN**

Run the focused Vitest command and require all tests to pass.

### Task 4: RPC Debug Page And Upstream Quick Test

**Files:**
- Modify: `web/src/pages/RpcDebug.tsx`
- Modify: `web/src/pages/Upstreams.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/styles.css`
- Modify: `web/src/config-ui.test.js`

- [x] **Step 1: Add failing UI contract tests**

Assert Chinese `节点健康` and `RPC 调试` navigation, old-route redirects,
segmented direct/runtime modes, open network and method controls, result
diagnostics, and the static-upstream test action.

- [x] **Step 2: Verify RED**

```powershell
pnpm exec vitest run src/config-ui.test.js
```

Expected: missing labels/routes/actions.

- [x] **Step 3: Build the debugger with existing controls**

Use Ant Design `Segmented`, `Select`, `AutoComplete`, `Input`, `Input.TextArea`,
`Descriptions`, and `Typography`. Derive direct candidates from
`listUpstreams(effectivePayload)`, runtime candidates from taxonomy, and derive
the public base URL from browser hostname plus effective eRPC port while
keeping it editable. Use existing query data; add no global state or dependency.

- [x] **Step 4: Add one-click static tests**

Add a test icon to static upstream table rows. Use `eth_chainId` only for
`evm`, `getHealth` only for `svm`, and direct unknown protocols to the open RPC
debugger instead of guessing.

- [x] **Step 5: Wire routes and responsive styles**

Rename `/topology` UI/routes to `/health`, add `/rpc-debug`, preserve redirects,
and add only the layout/result styles needed at desktop and mobile widths.

- [x] **Step 6: Verify GREEN**

Run the UI contract test, TypeScript check, and the focused RPC tests.

### Task 5: Project Health Timing Controls

**Files:**
- Modify: `web/src/App.tsx`
- Create: `web/src/config/health.ts`
- Create: `web/src/config/health.test.ts`

- [x] **Step 1: Write failing pure update tests**

Test reading and changing one selected project's
`upstreamDefaults.evm.statePollerInterval`,
`networkDefaults.selectionPolicy.evalInterval`,
`scoreMetricsWindowSize`, and `networkDefaults.svm.statePollerDebounce` while
preserving other projects and unknown fields.

- [x] **Step 2: Verify RED**

```powershell
pnpm exec vitest run src/config/health.test.ts
```

Expected: missing health-setting helpers.

- [x] **Step 3: Add the project-scoped form**

Load defaults from `effectivePayload`, save through `extractOverrides`, validate
before `useSaveConfig`, use the current revision as the conflict base, and
disable save until the computed sparse document changes. Keep all labels/help
in Chinese and never describe zero as disabling EVM polling.

- [x] **Step 4: Verify GREEN**

Run topology, document, and configuration UI tests.

### Task 6: Regression, Browser Review, And Commit

**Files:**
- Modify: `specs/admin-web/feature.md`
- Modify only source/test files required by failures.

- [x] **Step 1: Run backend verification**

```powershell
go test ./... -count=1
go vet ./...
go build -o admin.exe ./cmd/admin
```

Expected: all Admin packages pass and build succeeds.

- [x] **Step 2: Run frontend verification**

```powershell
pnpm test
pnpm build
```

Expected: Vitest, TypeScript, and Vite production build exit 0. The existing
bundle-size warning may remain informational.

- [x] **Step 3: Verify the real UI**

With services supplied by the operator, inspect `/health` and `/rpc-debug` at
desktop and mobile widths. Confirm no overlap, open custom network/method input,
long response wrapping, direct test before restart, and runtime test diagnostics.

- [x] **Step 4: Review and commit**

Run `git diff --check`, verify no endpoint credentials appear in the diff,
request spec and code-quality review, resolve all important findings, then
commit one logical feature change using Conventional Commits.
