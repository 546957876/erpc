# Effective Default Configuration Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Initialize Admin with a runnable eRPC default revision and render every supported eRPC field as a Chinese control that shows its exact effective default, help text, example, and override state without persisting untouched defaults.

**Architecture:** PostgreSQL revisions remain sparse, immutable operator override documents. Admin validates `{}` as revision 1, asks the configured `erpc.exe dump --format json` command for the effective view, then overlays the original overrides so dump redaction never replaces editable secrets. The Web form displays the effective view but records only changed paths; generated schema metadata and a checked-in Chinese catalog describe every current field and fail coverage tests when upstream adds one.

**Tech Stack:** Go 1.25, PostgreSQL/database/sql, eRPC CLI, React 19, Ant Design 6, TanStack Query, TypeScript 5.9, Vitest.

---

## File structure

- `Admin/internal/configdoc/validator.go`: validate and dump one temporary override document through the configured eRPC binary.
- `Admin/internal/configdoc/document.go`: generic JSON-object overlay that restores explicit values after eRPC dump redaction.
- `Admin/cmd/admin/initial.go`: validate and create the one system-default initial revision without changing existing revisions.
- `Admin/internal/server/managed.go`: return override, effective, and default payloads for the current revision.
- `web/scripts/generate-config-schema.go`: generate field ownership, comments, inline fields, type information, and deprecation markers.
- `web/src/config/metadata.ts`: complete Chinese field catalog and strict metadata resolution.
- `web/src/config/document.ts`: materialize effective values and patch sparse overrides from changed form paths.
- `web/src/config/ConfigFields.tsx`: Chinese labels, help popovers, default/custom state, and reset-to-default command.
- `web/src/pages/Advanced.tsx`: own the effective form and sparse draft override state.
- `web/src/pages/Settings.tsx` and `web/src/pages/Upstreams.tsx`: save through the same sparse-override helpers.

### Task 1: Materialize defaults and create revision 1

**Files:**
- Modify: `Admin/internal/configdoc/document.go`
- Modify: `Admin/internal/configdoc/document_test.go`
- Modify: `Admin/internal/configdoc/validator.go`
- Modify: `Admin/internal/configdoc/validator_test.go`
- Create: `Admin/cmd/admin/initial.go`
- Create: `Admin/cmd/admin/initial_test.go`
- Modify: `Admin/cmd/admin/main.go`

- [ ] **Step 1: Write failing config-document tests**

Add assertions that `{}` is a valid document and that deep object overlay replaces explicit scalars/secrets, recursively merges objects, and replaces arrays as a unit.

```go
effective, _ := ParseJSON([]byte(`{"server":{"httpPortV4":4000},"admin":{"token":"REDACTED"}}`))
overrides, _ := ParseJSON([]byte(`{"admin":{"token":"plain"}}`))
merged, err := Overlay(effective, overrides)
require.NoError(t, err)
require.JSONEq(t, `{"server":{"httpPortV4":4000},"admin":{"token":"plain"}}`, string(merged.Payload))
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `go test ./internal/configdoc -run 'Test(ParseEmptyObject|Overlay)' -count=1` from `Admin`.

Expected: FAIL because `Overlay` does not exist.

- [ ] **Step 3: Implement generic document overlay**

Decode both documents with `UseNumber`; recursively merge `map[string]any`; replace arrays and primitive values; build a new `Document` through the existing JSON/YAML/hash path. Never interpret eRPC field names.

- [ ] **Step 4: Write failing dump tests**

Inject a dump runner that returns effective JSON with a redacted value. Assert `Validator.Dump` executes the dump path, parses JSON, overlays the raw override, and wraps malformed output or command failures with operation context.

```go
validator := Validator{dump: func(context.Context, string) ([]byte, error) {
    return []byte(`{"server":{"httpPortV4":4000},"secret":"REDACTED"}`), nil
}}
effective, err := validator.Dump(ctx, mustDocument(`{"secret":"plain"}`))
require.NoError(t, err)
require.JSONEq(t, `{"server":{"httpPortV4":4000},"secret":"plain"}`, string(effective.Payload))
```

- [ ] **Step 5: Run the dump test and verify RED**

Run: `go test ./internal/configdoc -run TestValidatorDump -count=1`.

Expected: FAIL because `Dump` and its test runner do not exist.

- [ ] **Step 6: Implement `Validator.Dump`**

Reuse one private temporary-document helper for validate and dump. Production dump command is:

```go
exec.CommandContext(ctx, v.Binary, "--config", path, "dump", "--format", "json").CombinedOutput()
```

Parse output with `ParseJSON`, then call `Overlay(dumped, original)` so explicit endpoints, passwords, tokens, and settings remain raw.

- [ ] **Step 7: Write failing initial-revision tests**

Use small store/validator interfaces in `initial.go`. Cover: no row validates `{}` and creates revision 1 as `system-default`; an existing revision performs no validation or write; invalid dump/validation fails startup; a create conflict re-reads the winner and succeeds.

- [ ] **Step 8: Implement initial revision bootstrap and wire main**

```go
func ensureInitialRevision(ctx context.Context, store initialRevisionStore, validator initialValidator) (revisions.Revision, configdoc.Document, error)
```

Return both revision and the dumped default document. Call it after PostgreSQL migration and validator construction, before creating the runtime manager and HTTP server. Never modify an existing revision.

- [ ] **Step 9: Verify Task 1**

Run from `Admin`: `go test ./internal/configdoc ./cmd/admin -count=1`.

Expected: PASS.

### Task 2: Return override, effective, and default payloads

**Files:**
- Modify: `Admin/internal/server/managed.go`
- Modify: `Admin/internal/server/managed_test.go`
- Modify: `Admin/cmd/admin/main.go`
- Modify: `web/src/app/api.ts`
- Modify: `web/src/app/api.test.ts`

- [ ] **Step 1: Write failing managed API tests**

Construct revision 1 with `{}` and a fake dumper. `GET /api/config/current` must return:

```json
{
  "revision": 1,
  "payload": {},
  "effectivePayload": {"server": {"httpPortV4": 4000}},
  "defaultPayload": {"server": {"httpPortV4": 4000}}
}
```

For a later revision, assert explicit plaintext values replace dump redactions. Dump failure returns HTTP 500 without exposing document content.

- [ ] **Step 2: Run the API test and verify RED**

Run: `go test ./internal/server -run TestManagedCurrentConfig -count=1` from `Admin`.

Expected: FAIL because the two effective payloads are absent.

- [ ] **Step 3: Add the materializer boundary**

Extend managed dependencies with `Defaults configdoc.Document` and a `Dump(context.Context, configdoc.Document)` method. The current handler dumps the current revision and returns raw JSON fields, not encoded strings. Historical revision endpoints remain immutable raw override documents and do not pretend to use historical binary defaults.

- [ ] **Step 4: Update Web API types and tests**

```ts
export type ConfigRevision = {
  revision: number
  payload: ConfigPayload
  effectivePayload?: ConfigPayload
  defaultPayload?: ConfigPayload
  contentHash?: string
  createdBy?: string
  createdAt?: string
}
```

Assert `apiRequest` keeps these objects intact and error handling remains unchanged.

- [ ] **Step 5: Verify Task 2**

Run `go test ./internal/server -count=1` from `Admin` and `pnpm test src/app/api.test.ts` from `web`.

Expected: PASS.

### Task 3: Preserve sparse overrides in every form

**Files:**
- Modify: `web/src/config/document.ts`
- Modify: `web/src/config/document.test.ts`
- Modify: `web/src/pages/Advanced.tsx`
- Modify: `web/src/pages/Settings.tsx`
- Modify: `web/src/pages/Upstreams.tsx`

- [ ] **Step 1: Write failing pure-function tests**

Define and test:

```ts
materializeEffectiveConfig(overrides, defaults, schema)
applyFormChanges(overrides, changedValues, schema)
deleteOverride(overrides, path)
fieldState(overrides, defaults, path)
valueAtPath(document, path)
```

Object changes merge recursively, arrays replace as a unit, empty controls remove an override, unknown keys survive, and an untouched default never enters the override document.

- [ ] **Step 2: Run the document test and verify RED**

Run: `pnpm test src/config/document.test.ts` from `web`.

Expected: FAIL because the sparse-override helpers do not exist.

- [ ] **Step 3: Implement the pure transformations**

Reuse `structuredClone`, `Object.hasOwn`, and the generated schema. Do not add a form or immutable-data dependency. Keep maps converted to key/value rows only at the form boundary.

- [ ] **Step 4: Wire AdvancedPage**

Initialize the form from `effectivePayload`, retain `payload` as `draftOverrides`, and update only paths present in Ant Design's `changedValues`. Validate/save `draftOverrides`, never the full effective form. Reset removes one override and restores its value from `defaultPayload`; fields with no materialized default become unset.

- [ ] **Step 5: Reuse the same save model in Settings and Upstreams**

Replace their complete-document reconstruction with the shared sparse override helpers. An array edit may replace the corresponding array, but unrelated unknown root/object keys must remain unchanged.

- [ ] **Step 6: Verify Task 3**

Run: `pnpm test` from `web`.

Expected: all tests pass and the original unknown-key round trip remains covered.

### Task 4: Generate accurate schema source metadata

**Files:**
- Modify: `web/scripts/generate-config-schema.go`
- Create: `web/scripts/generate-config-schema_test.go`
- Modify: `web/src/config/schema.generated.json`
- Modify: `web/src/config/document.ts`
- Modify: `web/package.json`

- [ ] **Step 1: Write failing generator tests**

Assert generated fields include `owner`, `goName`, `goType`, source comment, and deprecation. Assert `ServerConfig.httpPort` is deprecated. Assert `IntegrityConfig` expands `yaml:",inline"` fields (`level`, `checks`, `budget`) and does not generate a fake `integritySettings` YAML key.

- [ ] **Step 2: Run generator tests and verify RED**

Run: `go test ./scripts -count=1` from `web`.

Expected: FAIL because the generated metadata and inline expansion are missing.

- [ ] **Step 3: Implement source-aware generation**

Use `go/parser`, `go/ast`, and `go/token` to read non-test Go files under `common/`. Reflection remains the authority for reachable types; AST supplies comments and field names. Parse YAML tag options, recursively expand inline structs, skip `yaml:"-"`, and detect `Deprecated:`/`@deprecated` case-insensitively.

- [ ] **Step 4: Make generation repeatable from Web commands**

Add:

```json
"generate:config": "go run ./scripts/generate-config-schema.go -out ./src/config/schema.generated.json",
"prebuild": "pnpm generate:config"
```

Do not generate during Vite runtime. Regenerate and check in the JSON so normal editor tooling can resolve it.

- [ ] **Step 5: Verify Task 4**

Run from `web`: `go test ./scripts -count=1`, `pnpm generate:config`, and `git diff --check -- src/config/schema.generated.json`.

Expected: PASS and deterministic generated output.

### Task 5: Complete Chinese metadata and field help

**Files:**
- Create: `web/src/config/metadata.ts`
- Create: `web/src/config/metadata.test.ts`
- Modify: `web/src/config/labels.ts`
- Modify: `web/src/config/ConfigFields.tsx`
- Modify: `web/src/pages/Advanced.tsx`
- Modify: `web/src/styles.css`
- Modify: `web/src/config-ui.test.js`

- [ ] **Step 1: Write failing metadata coverage tests**

Walk every generated definition and field. For each supported field require a resolved Chinese label, useful Chinese description, safe example, explicit default classification (`runtime`, `inherited`, `none`, or `deprecated`), and restart classification. Reject the old word-splitting fallback and labels that expose the raw YAML key as primary text. Allow technical acronyms such as HTTP, RPC, gRPC, EVM, SVM, TLS, JWT, Redis, PostgreSQL, and AWS.

- [ ] **Step 2: Run coverage tests and verify RED**

Run: `pnpm test src/config/metadata.test.ts src/config-ui.test.js` from `web`.

Expected: FAIL with the first uncovered generated field.

- [ ] **Step 3: Build the checked-in Chinese catalog**

Index metadata by `owner.field` with reusable entries only where semantics truly match. Use `common/config.go`, `common/config_integrity.go`, `common/defaults.go`, `erpc/projects_registry.go`, `erpc.dist.yaml`, and `docs/pages/config/` as evidence. Complex repeated names such as `enabled`, `type`, `mode`, `timeout`, `interval`, and `maxCount` require owner-specific descriptions. Do not use automatic word translation.

```ts
export type FieldMeta = {
  label: string
  description: string
  example: string
  defaultKind: "runtime" | "inherited" | "none" | "deprecated"
  defaultText?: string
  restartRequired: boolean
}
```

- [ ] **Step 4: Render help, state, and reset controls**

Use Ant Design `Tooltip`/`Popover` plus `QuestionCircleOutlined` and `UndoOutlined`. The primary label is Chinese only. Help shows purpose, effective/default rule, example, original YAML key, and restart note. Show compact `系统默认`, `自定义`, or `未设置` state; show reset only for custom fields. Deprecated fields are omitted from normal rendering but preserved in payloads.

- [ ] **Step 5: Verify responsive layout**

Ensure help icons and state markers cannot resize grid columns or overlap labels at desktop and mobile breakpoints. Keep cards limited to repeated list items and use the existing dark Ant Design theme.

- [ ] **Step 6: Verify Task 5 and the complete feature**

Run from `web`: `pnpm test` and `pnpm run build`. Run from `Admin`: `go test ./... -count=1` and `go build ./cmd/admin`. Run from the repository root: `git diff --check`.

Expected: all commands exit 0. Do not start Admin, Web, or eRPC; the user will run the existing Windows commands.
