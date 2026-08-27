# Admin Alchemy Account Import Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

Goal: Add a PostgreSQL-backed Admin Alchemy account vault with single/NDJSON/array paste import, CRUD, and explicit projection into standard eRPC Alchemy Providers without modifying eRPC core.

Architecture: Store complete imported account objects in an Admin-owned alchemy_accounts table. Keep account import separate from runtime configuration; an explicit apply action reads selected accounts, edits the latest configuration document through the existing provider helpers, validates it, and creates a new immutable revision. The existing manual Alchemy provider remains unchanged.

Tech Stack: Go 1.25, database/sql with pgx, PostgreSQL JSONB, existing Admin HTTP router, React 19, TypeScript, Ant Design, React Router, TanStack Query, Vitest.

Spec: docs/superpowers/specs/2026-08-28-admin-alchemy-account-import-design.md

## Global Constraints

- PostgreSQL remains the only Admin data store; SQLite is not added.
- Do not modify eRPC core, thirdparty/alchemy.go, Vendor interfaces, or the public eRPC config schema.
- Existing manual eRPC 内置厂商 -> Alchemy（手动 API Key） remains available and unchanged.
- Import accepts single JSON objects, NDJSON, and JSON arrays; server validation requires top-level email and api_key and preserves unknown fields.
- Full account payloads stay in Admin PostgreSQL; only settings.apiKey is projected into eRPC ProviderConfig.
- Import and apply are separate actions; import never restarts eRPC, and apply only creates a new revision.
- All user-facing copy and errors are Chinese; no secret values appear in logs, errors, batch summaries, or ordinary tables.
- Existing 2 MiB Admin request-body limit remains the initial import limit.
- New production code is covered by tests written and observed failing before implementation.

---

### Task 1: Account Model And Import Parser

Files:
- Create: Admin/internal/alchemyaccounts/model.go
- Create: Admin/internal/alchemyaccounts/parser.go
- Create: Admin/internal/alchemyaccounts/parser_test.go

Interfaces:
- Produces Account, ImportRecord, ImportResult, and ParseImport(text string) (ImportResult, error) for the database and HTTP layers.
- ImportResult exposes normalized records, skipped duplicates inside the request, and row-scoped validation errors without returning secrets in error strings.
- Account includes ID, Email, Name, ProviderID, APIKey, and Payload.

- [ ] Step 1: Write failing parser tests

Add tests for one object, two NDJSON objects, an array, blank lines, a non-object value, truncated JSON, missing email, missing api_key, duplicate email in one batch, preservation of unknown nested checkpoint, and secret-free error text.

- [ ] Step 2: Run parser tests and verify the expected failure

    Set-Location E:\go\goProject\eRPC\Admin
    go test ./internal/alchemyaccounts -run TestParseImport -count=1

Expected: package or parser symbols are missing and the tests fail for the missing implementation.

- [ ] Step 3: Implement the minimal parser

Use encoding/json.Decoder to decode successive JSON values. Accept an object, an array of objects, or multiple objects separated by whitespace. Require trimmed non-empty top-level email and api_key; preserve the complete object as JSON. Normalize only the comparison email with strings.TrimSpace and strings.ToLower. Generate a stable provider ID from a safe email slug plus a deterministic suffix derived from the normalized email.

- [ ] Step 4: Run parser tests and verify they pass

Run the same focused command and confirm all parser cases pass with no secret values in failures.

- [ ] Step 5: Commit the parser

    git add Admin/internal/alchemyaccounts
    git commit -m "feat(admin): add Alchemy account import parser"

### Task 2: PostgreSQL Account Store And Migration

Files:
- Modify: Admin/internal/database/schema.sql
- Create: Admin/internal/alchemyaccounts/store.go
- Create: Admin/internal/alchemyaccounts/store_test.go
- Modify: Admin/internal/database/database_test.go

Interfaces:
- Store with NewStore(db *sql.DB) *Store.
- Methods: Import, List, Get, Update, Delete.
- The store writes email, name, provider_id, api_key, and complete payload together and uses a normalized-email uniqueness constraint.

- [ ] Step 1: Write failing SQL-store tests

Use sqlmock to assert the migration contains alchemy_accounts, import inserts complete JSONB payloads, exact duplicates are skipped, conflicting email data fails without a partial insert, list/detail/update/delete use the expected queries, and a missing row maps to sql.ErrNoRows.

- [ ] Step 2: Run the store tests and verify failure

    Set-Location E:\go\goProject\eRPC\Admin
    go test ./internal/alchemyaccounts ./internal/database -run Test(Account|Migrate) -count=1

Expected: missing store and schema behavior causes failures.

- [ ] Step 3: Add the PostgreSQL table and store

Add alchemy_accounts with identity ID, email, name, provider ID, API key, JSONB payload, timestamps, and a unique index on normalized email. Wrap a batch import in one transaction. Treat identical existing payloads as skipped; treat same-email different-payload rows as a conflict; do not commit newly inserted rows if any validation or conflict remains.

- [ ] Step 4: Run focused store and migration tests

    go test ./internal/alchemyaccounts ./internal/database -count=1

Expected: all focused tests pass.

- [ ] Step 5: Commit the account store

    git add Admin/internal/database/schema.sql Admin/internal/database/database_test.go Admin/internal/alchemyaccounts
    git commit -m "feat(admin): store imported Alchemy accounts in PostgreSQL"

### Task 3: Admin Account APIs And Runtime Wiring

Files:
- Modify: Admin/cmd/admin/main.go
- Modify: Admin/internal/server/server.go
- Modify: Admin/internal/server/managed.go
- Modify: Admin/internal/server/server_test.go
- Create: Admin/internal/server/alchemy_accounts.go
- Create: Admin/internal/server/alchemy_accounts_test.go

Interfaces:
- Extend ManagedDependencies with the account store.
- Add authenticated routes: POST /api/alchemy/accounts/import, GET /api/alchemy/accounts, GET/PATCH/DELETE /api/alchemy/accounts/{id}.
- Return Chinese errors, row-level import counts/errors, and account list/detail DTOs. The list contains email/name/API Key/status metadata; detail contains the complete payload.

- [ ] Step 1: Write failing HTTP tests

Cover unauthenticated rejection, import of two NDJSON records, malformed-row response without secrets, list pagination, detail retrieval, update preserving unknown fields, delete protection for an account referenced by the latest configuration, and successful delete for an unused account.

- [ ] Step 2: Run the HTTP tests and verify failure

    Set-Location E:\go\goProject\eRPC\Admin
    go test ./internal/server -run TestAlchemyAccount -count=1

Expected: route and dependency wiring are missing.

- [ ] Step 3: Wire the store and routes

Construct the store after migration in cmd/admin/main.go, pass it through ManagedDependencies, and handle the new paths in a focused server file. Decode { "text": "..." } through the existing body limit. Use the parser and store; never log the request text or include raw payloads in errors.

- [ ] Step 4: Implement latest-config delete protection

Read the latest revision and detect a matching generated provider ID or API Key under projects[].providers[]. Return HTTP 409 when the latest runtime snapshot still references the account; never alter historical revisions automatically.

- [ ] Step 5: Run the focused HTTP tests

    go test ./internal/server -run TestAlchemyAccount -count=1

Expected: all account API tests pass.

- [ ] Step 6: Commit the account APIs

    git add Admin/cmd/admin/main.go Admin/internal/server
    git commit -m "feat(admin): expose Alchemy account management API"

### Task 4: Apply Accounts To Config Revisions

Files:
- Modify: Admin/internal/server/managed.go
- Create: Admin/internal/server/alchemy_apply.go
- Create: Admin/internal/server/alchemy_apply_test.go
- Modify: Admin/internal/server/managed_crud_test.go

Interfaces:
- Add POST /api/alchemy/accounts/{id}/apply with {projectId, networkMode, networks} input.
- The apply service consumes the latest revision, account store, configdoc.Validator, and existing revision store; it produces a normal config revision response.

- [ ] Step 1: Write failing apply tests

Assert one account becomes one vendor: alchemy provider with only settings.apiKey, default template <PROVIDER>-<NETWORK>, stable provider ID, and a new revision. Assert repeated apply is idempotent, changed API Key updates the provider, manual Alchemy providers remain untouched, other projects remain unchanged, and invalid project/network input does not create a revision.

- [ ] Step 2: Run the apply tests and verify failure

    Set-Location E:\go\goProject\eRPC\Admin
    go test ./internal/server -run TestApplyAlchemyAccount -count=1

Expected: apply route/service is absent.

- [ ] Step 3: Implement the projection

Use the latest effective configuration document and existing JSON/config helpers. Add or update one standard provider in the selected project. Write only apiKey from the account; preserve all unrelated fields and opaque configuration. Run the existing validator and create a revision against the latest base revision. Do not call runtime start or restart.

- [ ] Step 4: Run apply tests and existing CRUD tests

    go test ./internal/server -run TestApplyAlchemyAccount -count=1
    go test ./internal/server -run TestManagedConfigCRUD -count=1

Expected: all apply and existing configuration CRUD tests pass.

- [ ] Step 5: Commit projection behavior

    git add Admin/internal/server
    git commit -m "feat(admin): apply Alchemy accounts to config revisions"

### Task 5: Web API Hooks And Account Library Page

Files:
- Modify: web/src/app/api.ts
- Modify: web/src/App.tsx
- Create: web/src/pages/AlchemyAccounts.tsx
- Create: web/src/pages/AlchemyAccounts.test.tsx
- Modify: web/src/styles.css

Interfaces:
- Add typed AlchemyAccount, import result, and CRUD/apply API functions plus React Query hooks.
- Add route /alchemy-accounts and Chinese navigation label Alchemy 账号.
- The page provides a text area, preview table, import action, paginated account table, detail/edit drawer, delete confirmation, and apply-to-project action.

- [ ] Step 1: Write failing page/helper tests

Test the local preview parser adapter for single object and NDJSON, secret-free error rendering, disabled import with empty text, list rendering of email/API Key, preserving unknown JSON fields during edit, and apply success showing the new revision and 需要重启 notice.

- [ ] Step 2: Run Web tests and verify failure

    Set-Location E:\go\goProject\eRPC\web
    pnpm test -- --run src/pages/AlchemyAccounts.test.tsx

Expected: page and helper exports are missing.

- [ ] Step 3: Add API hooks and page

Use existing apiRequest, React Query, Ant Design table/drawer/modal, and current dark layout. Preview locally for responsiveness, but always submit {text} to the server for authoritative validation. Show email/API Key in the table, full payload only in the explicit detail editor, and Chinese row errors without credentials.

- [ ] Step 4: Add navigation and responsive styles

Add the route and menu item while keeping existing page routing. Use existing workspace/table/drawer styles; keep the textarea and preview usable on narrow screens without adding a new UI dependency.

- [ ] Step 5: Run focused Web tests

    pnpm test -- --run src/pages/AlchemyAccounts.test.tsx src/app/api.test.ts

Expected: account page and API hook tests pass.

- [ ] Step 6: Commit the account library page

    git add web/src/app/api.ts web/src/App.tsx web/src/pages/AlchemyAccounts.tsx web/src/pages/AlchemyAccounts.test.tsx web/src/styles.css
    git commit -m "feat(admin-web): add Alchemy account library"

### Task 6: Upstream Entry And Apply Workflow

Files:
- Modify: web/src/pages/Upstreams.tsx
- Modify: web/src/config/providers.ts
- Modify: web/src/config/providers.test.ts
- Modify: web/src/pages/AlchemyAccounts.tsx

Interfaces:
- Add the grouped access-mode option Alchemy 账号导入 without removing manual Alchemy.
- Selecting it opens the account selector/apply workflow and uses existing provider projection semantics.

- [ ] Step 1: Write failing UI/config tests

Assert both Alchemy access modes exist, account application produces a standard Alchemy provider, provider IDs remain unique, and manual provider CRUD behavior remains unchanged.

- [ ] Step 2: Run focused tests and verify failure

    Set-Location E:\go\goProject\eRPC\web
    pnpm test -- --run src/config/providers.test.ts

Expected: the new mode and workflow assertions fail.

- [ ] Step 3: Implement the new entry

Add the new Chinese option under eRPC 内置厂商, route the operator to the account selector/library, and expose project/network selection for apply. Do not add a second vendor value; all generated records use vendor: alchemy.

- [ ] Step 4: Run focused tests and full Web build

    pnpm test -- --run src/config/providers.test.ts src/pages/AlchemyAccounts.test.tsx
    pnpm build

Expected: focused tests pass and the production build exits successfully.

- [ ] Step 5: Commit the upstream entry

    git add web/src/pages/Upstreams.tsx web/src/config/providers.ts web/src/config/providers.test.ts web/src/pages/AlchemyAccounts.tsx
    git commit -m "feat(admin-web): add Alchemy account apply entry"

### Task 7: End-To-End Verification And Documentation

Files:
- Modify: Admin/README.md
- Modify: Admin/TODO.md
- Test: existing Admin and Web suites

- [ ] Step 1: Update operational documentation

Document the account import endpoint/UI, two-step import/apply behavior, PostgreSQL storage, 2 MiB initial limit, no automatic restart, and the warning that historical revisions can retain API Keys.

- [ ] Step 2: Run Admin verification

    Set-Location E:\go\goProject\eRPC\Admin
    go test ./... -count=1
    go build ./cmd/admin

Expected: exit code 0 for tests and build.

- [ ] Step 3: Run Web verification

    Set-Location E:\go\goProject\eRPC\web
    pnpm test -- --run
    pnpm build

Expected: all tests pass and the production build exits successfully.

- [ ] Step 4: Search the diff for leaked credentials and accidental eRPC changes

    Set-Location E:\go\goProject\eRPC
    git diff origin/codex/admin-web..HEAD -- thirdparty common cmd erpc
    rg -n -i 'Mariano|Lyra|mailbox_password|refresh_token|bearer_token|alch_[A-Za-z0-9]' Admin web docs/superpowers

Expected: no eRPC-core diff and no pasted credential values.

- [ ] Step 5: Mark the TODO items complete after evidence

Only mark implementation items complete after the corresponding focused and full commands have passed. Keep deferred limits or follow-up improvements explicitly unchecked.

- [ ] Step 6: Commit final documentation and verification updates

    git add Admin/README.md Admin/TODO.md
    git commit -m "docs(admin): document Alchemy account operations"

