# Admin Upstream And Provider Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Manage fixed RPC nodes and every existing eRPC provider from one Chinese Admin Web page, including random IDs and full ProviderConfig CRUD.

**Architecture:** Keep eRPC and Admin APIs unchanged. Add one pure TypeScript provider domain module, reuse the generated schema renderer for provider overrides, and adapt the existing upstream page into a unified table and conditional drawer. The current sparse revision/validation flow remains the persistence boundary.

**Tech Stack:** React 19, TypeScript 5.9, Ant Design 6, React Query, Vitest, browser Web Crypto.

---

### Task 1: Vendor Catalog And Random IDs

**Files:**
- Create: `web/src/config/providers.ts`
- Create: `web/src/config/providers.test.ts`
- Modify: `web/src/config/upstreams.ts`
- Modify: `web/src/config/upstreams.test.ts`

- [ ] **Step 1: Write failing catalog and random-ID tests**

Add tests that define the required open-set behavior before implementation:

```ts
import { describe, expect, it } from "vitest";
import { providerDefinition, providerOptions } from "./providers";
import { randomUniqueId } from "./upstreams";

describe("厂商目录", () => {
  it("包含 eRPC 当前注册的 24 个厂商", () => {
    expect(providerOptions().map((item) => item.value)).toEqual([
      "goldsky", "alchemy", "blastapi", "conduit", "drpc", "dwellir",
      "envio", "etherspot", "infura", "pimlico", "quicknode", "llama",
      "thirdweb", "repository", "superchain", "tenderly", "chainstack",
      "onfinality", "erpc", "blockpi", "ankr", "routemesh", "blockdaemon",
      "satelink",
    ]);
  });

  it("未知厂商仍可走开放设置路径", () => {
    expect(providerDefinition("future-vendor")).toMatchObject({
      value: "future-vendor",
      label: "future-vendor",
      fields: [],
    });
  });
});

it("随机名称带前缀并跳过当前项目内冲突", () => {
  const values = ["00000000-0000-0000-0000-000000000000", "11111111-1111-1111-1111-111111111111"];
  expect(randomUniqueId("rpc", new Set(["rpc-00000000"]), () => values.shift()!)).toBe("rpc-11111111");
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
pnpm --dir web exec vitest run src/config/providers.test.ts src/config/upstreams.test.ts
```

Expected: FAIL because `providers.ts`, `providerDefinition`, `providerOptions`, and `randomUniqueId` do not exist.

- [ ] **Step 3: Implement the open vendor catalog and native random helper**

Create catalog types and values without a closed union:

```ts
export type ProviderSettingKind = "text" | "secret" | "tags" | "number-tags" | "credit-units";
export type ProviderSettingField = {
  key: string;
  label: string;
  kind: ProviderSettingKind;
  required?: boolean;
  defaultText?: string;
  example: string;
};
export type ProviderDefinition = {
  value: string;
  label: string;
  fields: ProviderSettingField[];
  refreshDefault?: string;
};

const apiKey = (): ProviderSettingField => ({ key: "apiKey", label: "API 密钥", kind: "secret", required: true, example: "your-api-key" });

export const providerCatalog: ProviderDefinition[] = [
  { value: "goldsky", label: "Goldsky", fields: [
    { key: "secret", label: "访问密钥", kind: "secret", required: true, example: "your-secret" },
    { key: "tier", label: "服务等级", kind: "text", defaultText: "standard", example: "standard" },
    { key: "endpoint", label: "服务地址", kind: "text", defaultText: "https://edge.goldsky.com", example: "https://edge.goldsky.com" },
  ] },
  { value: "alchemy", label: "Alchemy", refreshDefault: "24h", fields: [apiKey(), { key: "chainsUrl", label: "链目录地址", kind: "text", defaultText: "Alchemy 官方目录", example: "https://app-api.alchemy.com/trpc/config.getNetworkConfig" }, { key: "creditUnits", label: "方法积分", kind: "credit-units", example: "eth_call = 26" }] },
  { value: "blastapi", label: "BlastAPI", fields: [apiKey()] },
  { value: "conduit", label: "Conduit", refreshDefault: "24h", fields: [apiKey(), { key: "networksUrl", label: "网络目录地址", kind: "text", defaultText: "Conduit 官方目录", example: "https://api.conduit.xyz/public/network/all" }] },
  { value: "drpc", label: "dRPC", refreshDefault: "24h", fields: [apiKey(), { key: "chainsUrl", label: "链目录地址", kind: "text", defaultText: "https://lb.drpc.org/networks", example: "https://lb.drpc.org/networks" }, { key: "creditUnits", label: "方法积分", kind: "credit-units", example: "eth_call = 1" }] },
  { value: "dwellir", label: "Dwellir", fields: [apiKey()] },
  { value: "envio", label: "Envio", fields: [{ key: "rootDomain", label: "根域名", kind: "text", defaultText: "rpc.hypersync.xyz", example: "rpc.hypersync.xyz" }, { ...apiKey(), required: false }] },
  { value: "etherspot", label: "Etherspot", fields: [apiKey()] },
  { value: "infura", label: "Infura", fields: [apiKey()] },
  { value: "pimlico", label: "Pimlico", fields: [{ ...apiKey(), example: "public" }] },
  { value: "quicknode", label: "QuickNode", refreshDefault: "1h", fields: [apiKey(), { key: "tagIds", label: "标签 ID", kind: "number-tags", example: "1, 2" }, { key: "tagLabels", label: "标签名称", kind: "tags", example: "archive, realtime" }, { key: "creditUnits", label: "方法积分", kind: "credit-units", example: "eth_call = 20" }] },
  { value: "llama", label: "Llama", fields: [apiKey()] },
  { value: "thirdweb", label: "Thirdweb", fields: [{ key: "clientId", label: "客户端 ID", kind: "secret", required: true, example: "your-client-id" }] },
  { value: "repository", label: "公共节点仓库", refreshDefault: "1h", fields: [{ key: "repositoryUrl", label: "仓库地址", kind: "text", defaultText: "https://evm-public-endpoints.erpc.cloud", example: "https://evm-public-endpoints.erpc.cloud" }] },
  { value: "superchain", label: "Superchain", refreshDefault: "24h", fields: [{ key: "registryUrl", label: "注册表地址", kind: "text", defaultText: "eRPC 内置官方地址", example: "https://raw.githubusercontent.com/ethereum-optimism/superchain-registry/main/chainList.json" }] },
  { value: "tenderly", label: "Tenderly", fields: [apiKey()] },
  { value: "chainstack", label: "Chainstack", refreshDefault: "1h", fields: [apiKey(),
    { key: "project", label: "项目", kind: "text", example: "my-project" },
    { key: "organization", label: "组织", kind: "text", example: "my-organization" },
    { key: "region", label: "区域", kind: "text", example: "eu-central" },
    { key: "provider", label: "底层供应商", kind: "text", example: "chainstack" },
    { key: "type", label: "节点类型", kind: "text", example: "full" },
  ] },
  { value: "onfinality", label: "OnFinality", fields: [apiKey()] },
  { value: "erpc", label: "eRPC", fields: [{ key: "endpoint", label: "服务地址", kind: "text", required: true, example: "https://rpc.example.com" }, { key: "secret", label: "访问密钥", kind: "secret", example: "your-secret" }] },
  { value: "blockpi", label: "BlockPI", fields: [apiKey()] },
  { value: "ankr", label: "Ankr", fields: [apiKey()] },
  { value: "routemesh", label: "RouteMesh", fields: [apiKey(), { key: "baseURL", label: "基础地址", kind: "text", defaultText: "lb.routemes.sh", example: "lb.routemes.sh" }] },
  { value: "blockdaemon", label: "Blockdaemon", fields: [apiKey()] },
  { value: "satelink", label: "Satelink", fields: [{ ...apiKey(), required: false }] },
];

export function providerOptions() { return providerCatalog.map(({ value, label }) => ({ value, label })); }
export function providerDefinition(value: string): ProviderDefinition {
  return providerCatalog.find((item) => item.value === value) || { value, label: value, fields: [] };
}
```

Add the generic helper to `upstreams.ts`:

```ts
export function randomUniqueId(prefix: string, existing: Set<string>, randomUUID: () => string = () => crypto.randomUUID()): string {
  for (;;) {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
    const candidate = `${prefix || "rpc"}-${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the same Vitest command. Expected: PASS.

- [ ] **Step 5: Commit the pure catalog and helper**

```powershell
git add web/src/config/providers.ts web/src/config/providers.test.ts web/src/config/upstreams.ts web/src/config/upstreams.test.ts
git commit -m "feat(admin): define provider catalog and random ids"
```

### Task 2: Provider Form Conversion And CRUD

**Files:**
- Modify: `web/src/config/providers.ts`
- Modify: `web/src/config/providers.test.ts`

- [ ] **Step 1: Add failing tests for ProviderConfig round-trips and scale**

Cover add, edit, delete, project isolation, 160 providers, duplicate IDs,
network mode, typed settings, unknown settings, and opaque fields:

```ts
const input = {
  projectIndex: 0,
  id: "alchemy-main",
  vendor: "alchemy",
  settings: { apiKey: "plain-key", creditUnits: { eth_call: 26 } },
  networkMode: "only" as const,
  networks: ["evm:1", "evm:56"],
  upstreamIdTemplate: "<PROVIDER>-<NETWORK>",
  overrides: { "*": { type: "evm", futureOverride: true } },
};

it("新增 Provider 写入完整结构且不改变其他项目", () => {
  const next = addProvider(payload, input);
  expect((next.projects as any[])[0].providers[0]).toEqual({
    id: "alchemy-main", vendor: "alchemy",
    settings: { apiKey: "plain-key", creditUnits: { eth_call: 26 } },
    onlyNetworks: ["evm:1", "evm:56"],
    upstreamIdTemplate: "<PROVIDER>-<NETWORK>",
    overrides: { "*": { type: "evm", futureOverride: true } },
  });
  expect((payload.projects as any[])[0].providers).toBeUndefined();
});

it("未知厂商和未知字段在修改时保留", () => {
  const source = { projects: [{ id: "main", providers: [{
    id: "future-main", vendor: "future-vendor", settings: { token: "plain" },
    upstreamIdTemplate: "<PROVIDER>-<NETWORK>", futureProviderField: { keep: true },
  }] }] };
  const row = listProviders(source)[0];
  const next = updateProvider(source, row, { ...input, id: "renamed", vendor: "future-vendor" });
  expect((next.projects as any[])[0].providers[0].futureProviderField).toEqual({ keep: true });
});
```

- [ ] **Step 2: Run the provider tests and verify RED**

```powershell
pnpm --dir web exec vitest run src/config/providers.test.ts
```

Expected: FAIL because provider CRUD and conversion functions are missing.

- [ ] **Step 3: Implement immutable ProviderConfig CRUD**

Add these public contracts:

```ts
export type NetworkMode = "all" | "only" | "ignore";
export type ProviderLocation = { projectIndex: number; providerIndex: number };
export type ProviderInput = {
  projectIndex: number;
  id: string;
  vendor: string;
  settings?: Record<string, unknown>;
  networkMode: NetworkMode;
  networks?: string[];
  upstreamIdTemplate: string;
  overrides?: Record<string, Record<string, unknown>>;
};
export type ProviderRow = ProviderLocation & {
  key: string;
  kind: "provider";
  projectId: string;
  id: string;
  vendor: string;
  networkMode: NetworkMode;
  networks: string[];
  raw: Record<string, any>;
};

export function listProviders(payload: ConfigPayload): ProviderRow[];
export function addProvider(payload: ConfigPayload, input: ProviderInput): ConfigPayload;
export function updateProvider(payload: ConfigPayload, location: ProviderLocation, input: ProviderInput): ConfigPayload;
export function removeProvider(payload: ConfigPayload, location: ProviderLocation): ConfigPayload;
```

Normalize whitespace, require `id`, `vendor`, and `upstreamIdTemplate`, validate
every network with `/^evm:[1-9]\d*$/`, reject duplicate provider IDs only inside
the selected project, omit empty optional maps/lists, and write exactly one of
`onlyNetworks` or `ignoreNetworks`. Build updates from `{ ...base }` so unknown
provider fields survive.

- [ ] **Step 4: Implement typed extra-setting conversion**

Add reversible helpers used by the drawer:

```ts
export type ExtraSettingRow = { key: string; type: "string" | "number" | "boolean" | "json"; value: string };

export function encodeExtraSettings(settings: Record<string, unknown>, knownKeys: Set<string>): ExtraSettingRow[];
export function decodeExtraSettings(rows: ExtraSettingRow[]): Record<string, unknown>;
export function splitProviderSettings(vendor: string, settings: Record<string, unknown>): {
  known: Record<string, unknown>;
  extra: ExtraSettingRow[];
};
export function mergeProviderSettings(vendor: string, known: Record<string, unknown>, extra: ExtraSettingRow[]): Record<string, unknown>;
```

`decodeExtraSettings` rejects duplicate keys, non-finite numbers, invalid
booleans, and malformed JSON with Chinese errors. Empty known values are omitted;
`creditUnits` converts `{method, units}` rows to a number map, and QuickNode tag
IDs convert to numbers.

Also add override form helpers. They keep the raw value alongside its editable
schema form so `mergeKnownConfig` can restore fields unknown to this Web build:

```ts
export type ProviderOverrideFormRow = {
  key: string;
  value: Record<string, unknown>;
  raw: Record<string, unknown>;
};

export function encodeProviderOverrides(
  overrides: Record<string, unknown>,
  upstreamSchema: ConfigSchema,
): ProviderOverrideFormRow[] {
  return Object.entries(overrides).map(([key, rawValue]) => {
    const raw = record(rawValue);
    return { key, value: toFormDocument(raw, upstreamSchema), raw };
  });
}

export function decodeProviderOverrides(
  rows: ProviderOverrideFormRow[],
  upstreamSchema: ConfigSchema,
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const row of rows || []) {
    const key = row.key.trim();
    if (!key) throw new Error("请输入覆盖匹配规则");
    if (Object.hasOwn(result, key)) throw new Error("覆盖匹配规则不能重复");
    result[key] = mergeKnownConfig(row.raw || {}, fromFormDocument(row.value || {}, upstreamSchema), upstreamSchema);
  }
  return result;
}
```

Import the existing `ConfigSchema`, `toFormDocument`, `fromFormDocument`, and
`mergeKnownConfig` utilities. Build `upstreamSchema` at the call site as
`{ ...configSchema, root: { kind: "object", ref: "UpstreamConfig" } }` so the
pure conversion continues to use the generated eRPC contract.

- [ ] **Step 5: Run focused tests and verify GREEN**

```powershell
pnpm --dir web exec vitest run src/config/providers.test.ts src/config/upstreams.test.ts
```

Expected: PASS, including the 160-provider isolation case.

- [ ] **Step 6: Commit provider domain behavior**

```powershell
git add web/src/config/providers.ts web/src/config/providers.test.ts
git commit -m "feat(admin): add provider configuration crud"
```

### Task 3: Reuse The Generated UpstreamConfig Renderer

**Files:**
- Modify: `web/src/config/ConfigFields.tsx`
- Modify: `web/src/config-ui.test.js`

- [ ] **Step 1: Add a failing source-contract test**

```js
it("exports a definition-level field renderer for provider overrides", () => {
  const source = readFileSync(join(root, "src/config/ConfigFields.tsx"), "utf8");
  expect(source).toContain("export function ConfigDefinitionFields");
  expect(source).toContain('ref: definition');
});
```

- [ ] **Step 2: Run the source-contract test and verify RED**

```powershell
pnpm --dir web exec vitest run src/config-ui.test.js
```

Expected: FAIL because `ConfigDefinitionFields` is not exported.

- [ ] **Step 3: Export the minimal definition renderer**

Add one wrapper around the existing private `SchemaValue` rather than copying
the recursive renderer:

```tsx
export function ConfigDefinitionFields({
  definition,
  namePath = [],
  schemaPath = [definition],
  overrides = {},
  defaults = {},
}: ConfigFieldsProps & { definition: string; namePath?: (string | number)[]; schemaPath?: string[] }) {
  return <SchemaValue
    node={{ kind: "object", ref: definition }}
    namePath={namePath}
    schemaPath={schemaPath}
    statePath={namePath}
    context={{ overrides, defaults }}
  />;
}
```

Do not change root `ConfigFields` behavior.

- [ ] **Step 4: Run config tests and verify GREEN**

```powershell
pnpm --dir web exec vitest run src/config-ui.test.js src/config/document.test.ts src/config/metadata.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit renderer reuse**

```powershell
git add web/src/config/ConfigFields.tsx web/src/config-ui.test.js
git commit -m "refactor(admin): reuse schema fields for provider overrides"
```

### Task 4: Unified Upstream Drawer And Table

**Files:**
- Create: `web/src/pages/ProviderFormFields.tsx`
- Modify: `web/src/pages/Upstreams.tsx`
- Modify: `web/src/styles.css`
- Modify: `web/src/config-ui.test.js`

- [ ] **Step 1: Add failing UI source-contract tests**

Assert the page contains the approved operational controls:

```js
it("offers custom RPC and provider access modes in one upstream drawer", () => {
  const page = readFileSync(join(root, "src/pages/Upstreams.tsx"), "utf8");
  expect(page).toContain("接入方式");
  expect(page).toContain("自定义 RPC 节点");
  expect(page).toContain("randomUniqueId");
  expect(page).toContain("listProviders");
  expect(page).toContain("useValidateConfig");
  expect(page).toContain("pageSize: 20");
});
```

- [ ] **Step 2: Run the UI contract test and verify RED**

```powershell
pnpm --dir web exec vitest run src/config-ui.test.js
```

Expected: FAIL because the page only manages fixed upstreams.

- [ ] **Step 3: Build the provider field section**

`ProviderFormFields.tsx` receives the Ant Form instance, selected vendor, and
current raw settings. Render:

- provider ID with `SyncOutlined` icon button and `随机生成` tooltip
- searchable open vendor `AutoComplete`
- known fields from `providerDefinition(vendor)`
- `Select mode="tags"` for tag settings and network IDs
- a method/number `Form.List` for `creditUnits`
- `其他厂商参数` rows with key, type selector, and value input
- segmented network mode (`全部网络`, `仅指定网络`, `排除指定网络`)
- template input initialized to `<PROVIDER>-<NETWORK>`
- `overrides` pattern `Form.List`, each value rendered by
  `<ConfigDefinitionFields definition="UpstreamConfig" ... />`
- read-only refresh-default help when the catalog provides it

Use existing Ant Design controls and icons; add no package.

- [ ] **Step 4: Adapt UpstreamsPage to a unified discriminated row list**

Keep the existing persistence helper but add `useValidateConfig()` and a
`loadedRevision` ref. Before `useSaveConfig`, validate the sparse payload and
leave the drawer open on failure. After save, immediately update the ref.

Use this row model:

```ts
type ConnectionRow =
  | ({ kind: "upstream" } & UpstreamRow)
  | ProviderRow;

const rows: ConnectionRow[] = [
  ...listUpstreams(payload).map((row) => ({ ...row, kind: "upstream" as const })),
  ...listProviders(payload),
];
```

The add form's `accessMode` value is either `custom` or a vendor string. New
provider selection initializes `vendor`, blank settings, network mode `all`,
and template `<PROVIDER>-<NETWORK>`. Editing fixes the record kind but permits a
confirmed vendor change. Use the relevant immutable CRUD helper on submit and
delete. The settings summary must display field names/count only, never values.

Set Ant pagination to:

```tsx
pagination={{ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: [20, 50, 100], showTotal: (total) => `共 ${total} 条` }}
```

- [ ] **Step 5: Add restrained drawer/table styles**

Add only stable layout helpers used by the new controls:

```css
.id-input-row { display: grid; grid-template-columns: minmax(0, 1fr) 32px; gap: 8px; }
.id-random-button { width: 32px; height: 32px; }
.provider-field-note { color: var(--muted); font-size: 12px; }
.provider-map-row { display: grid; grid-template-columns: minmax(110px, 1fr) 110px minmax(160px, 2fr) 32px; gap: 8px; align-items: start; }
@media (max-width: 720px) { .provider-map-row { grid-template-columns: 1fr 96px 32px; } .provider-map-row .provider-map-value { grid-column: 1 / -1; } }
```

- [ ] **Step 6: Run focused tests and type checking**

```powershell
pnpm --dir web exec vitest run src/config/providers.test.ts src/config/upstreams.test.ts src/config-ui.test.js
pnpm --dir web exec tsc -b
```

Expected: both commands exit 0.

- [ ] **Step 7: Commit the unified page**

```powershell
git add web/src/pages/ProviderFormFields.tsx web/src/pages/Upstreams.tsx web/src/styles.css web/src/config-ui.test.js
git commit -m "feat(admin): manage providers with upstreams"
```

### Task 5: Full Regression Verification

**Files:**
- Modify only files required by failures caused by Tasks 1-4.

- [ ] **Step 1: Run all Web tests**

```powershell
pnpm --dir web test
```

Expected: every Vitest file passes with zero failures.

- [ ] **Step 2: Run TypeScript and production build verification**

```powershell
pnpm --dir web exec tsc -b
pnpm --dir web build
```

Expected: both exit 0. The existing Vite bundle-size warning is informational;
there must be no TypeScript or build error.

- [ ] **Step 3: Review the final diff against the design spec**

```powershell
git diff --check HEAD~3..HEAD
git status --short
```

Confirm all seven ProviderConfig fields are reachable, no secret is printed in
the table, unknown vendors/settings survive, no service was started, and only
the intended files were staged by each commit.

- [ ] **Step 4: Commit any verification-only corrections**

If a regression required a correction, first add a failing test reproducing it,
then apply the minimum fix and commit only those files:

```powershell
git add <exact corrected source and test files>
git commit -m "fix(admin): correct provider management regression"
```

If no correction is required, do not create an empty commit.
