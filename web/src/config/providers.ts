import type { ConfigPayload } from "../app/api";
import { fromFormDocument, mergeKnownConfig, toFormDocument, type ConfigSchema } from "./document";

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

const apiKey = (): ProviderSettingField => ({
  key: "apiKey",
  label: "API 密钥",
  kind: "secret",
  required: true,
  example: "your-api-key",
});

export const providerCatalog: ProviderDefinition[] = [
  {
    value: "goldsky",
    label: "Goldsky",
    fields: [
      { key: "secret", label: "访问密钥", kind: "secret", required: true, example: "your-secret" },
      { key: "tier", label: "服务等级", kind: "text", defaultText: "standard", example: "standard" },
      {
        key: "endpoint",
        label: "服务地址",
        kind: "text",
        defaultText: "https://edge.goldsky.com",
        example: "https://edge.goldsky.com",
      },
    ],
  },
  {
    value: "alchemy",
    label: "Alchemy",
    refreshDefault: "24h",
    fields: [
      apiKey(),
      {
        key: "chainsUrl",
        label: "链目录地址",
        kind: "text",
        defaultText: "https://app-api.alchemy.com/trpc/config.getNetworkConfig",
        example: "https://app-api.alchemy.com/trpc/config.getNetworkConfig",
      },
      { key: "creditUnits", label: "方法积分", kind: "credit-units", example: "eth_call = 26" },
    ],
  },
  { value: "blastapi", label: "BlastAPI", fields: [apiKey()] },
  {
    value: "conduit",
    label: "Conduit",
    refreshDefault: "24h",
    fields: [
      apiKey(),
      {
        key: "networksUrl",
        label: "网络目录地址",
        kind: "text",
        defaultText: "https://api.conduit.xyz/public/network/all",
        example: "https://api.conduit.xyz/public/network/all",
      },
    ],
  },
  {
    value: "drpc",
    label: "dRPC",
    refreshDefault: "24h",
    fields: [
      apiKey(),
      {
        key: "chainsUrl",
        label: "链目录地址",
        kind: "text",
        defaultText: "https://lb.drpc.org/networks",
        example: "https://lb.drpc.org/networks",
      },
      { key: "creditUnits", label: "方法积分", kind: "credit-units", example: "eth_call = 1" },
    ],
  },
  { value: "dwellir", label: "Dwellir", fields: [apiKey()] },
  {
    value: "envio",
    label: "Envio",
    fields: [
      { key: "rootDomain", label: "根域名", kind: "text", defaultText: "rpc.hypersync.xyz", example: "rpc.hypersync.xyz" },
      { ...apiKey(), required: false },
    ],
  },
  { value: "etherspot", label: "Etherspot", fields: [apiKey()] },
  { value: "infura", label: "Infura", fields: [apiKey()] },
  { value: "pimlico", label: "Pimlico", fields: [{ ...apiKey(), example: "public" }] },
  {
    value: "quicknode",
    label: "QuickNode",
    refreshDefault: "1h",
    fields: [
      apiKey(),
      { key: "tagIds", label: "标签 ID", kind: "number-tags", example: "1, 2" },
      { key: "tagLabels", label: "标签名称", kind: "tags", example: "archive, realtime" },
      { key: "creditUnits", label: "方法积分", kind: "credit-units", example: "eth_call = 20" },
    ],
  },
  { value: "llama", label: "Llama", fields: [apiKey()] },
  {
    value: "thirdweb",
    label: "Thirdweb",
    fields: [{ key: "clientId", label: "客户端 ID", kind: "secret", required: true, example: "your-client-id" }],
  },
  {
    value: "repository",
    label: "公共节点仓库",
    refreshDefault: "1h",
    fields: [
      {
        key: "repositoryUrl",
        label: "仓库地址",
        kind: "text",
        defaultText: "https://evm-public-endpoints.erpc.cloud",
        example: "https://evm-public-endpoints.erpc.cloud",
      },
    ],
  },
  {
    value: "superchain",
    label: "Superchain",
    refreshDefault: "24h",
    fields: [
      {
        key: "registryUrl",
        label: "注册表地址",
        kind: "text",
        defaultText: "https://raw.githubusercontent.com/ethereum-optimism/superchain-registry/main/chainList.json",
        example: "https://raw.githubusercontent.com/ethereum-optimism/superchain-registry/main/chainList.json",
      },
    ],
  },
  { value: "tenderly", label: "Tenderly", fields: [apiKey()] },
  {
    value: "chainstack",
    label: "Chainstack",
    refreshDefault: "1h",
    fields: [
      apiKey(),
      { key: "project", label: "项目", kind: "text", example: "my-project" },
      { key: "organization", label: "组织", kind: "text", example: "my-organization" },
      { key: "region", label: "区域", kind: "text", example: "eu-central" },
      { key: "provider", label: "底层供应商", kind: "text", example: "chainstack" },
      { key: "type", label: "节点类型", kind: "text", example: "full" },
    ],
  },
  { value: "onfinality", label: "OnFinality", fields: [apiKey()] },
  {
    value: "erpc",
    label: "eRPC",
    fields: [
      { key: "endpoint", label: "服务地址", kind: "text", required: true, example: "https://rpc.example.com" },
      { key: "secret", label: "访问密钥", kind: "secret", example: "your-secret" },
    ],
  },
  { value: "blockpi", label: "BlockPI", fields: [apiKey()] },
  { value: "ankr", label: "Ankr", fields: [apiKey()] },
  {
    value: "routemesh",
    label: "RouteMesh",
    fields: [
      apiKey(),
      { key: "baseURL", label: "基础地址", kind: "text", defaultText: "lb.routemes.sh", example: "lb.routemes.sh" },
    ],
  },
  { value: "blockdaemon", label: "Blockdaemon", fields: [apiKey()] },
  { value: "satelink", label: "Satelink", fields: [{ ...apiKey(), required: false }] },
];

export function providerOptions() {
  return providerCatalog.map(({ value, label }) => ({ value, label }));
}

export function providerDefaultSettings(value: string): Record<string, unknown> {
  return Object.fromEntries(providerDefinition(value).fields
    .filter((field) => field.defaultText !== undefined)
    .map((field) => [field.key, field.defaultText]));
}

export function providerDefinition(value: string): ProviderDefinition {
  return providerCatalog.find((item) => item.value === value) || { value, label: value, fields: [] };
}

/** Keep the UI's provider preview identical to eRPC's generated upstream IDs. */
export function renderProviderUpstreamID(template: string, vendor: string, providerID: string, networkID: string): string {
  let result = template || "<PROVIDER>-<NETWORK>";
  result = result.replaceAll("<VENDOR>", vendor).replaceAll("<PROVIDER>", providerID).replaceAll("<NETWORK>", networkID);
  result = result.replaceAll("<EVM_CHAIN_ID>", networkID.startsWith("evm:") ? networkID.slice("evm:".length) : "N/A");
  return result;
}

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

export type ExtraSettingRow = {
  key: string;
  type: "string" | "number" | "boolean" | "json";
  value: string;
};
export type ProviderOverrideFormRow = {
  key: string;
  value: Record<string, unknown>;
  raw: Record<string, unknown>;
};

export function listProviders(payload: ConfigPayload): ProviderRow[] {
  const projects = Array.isArray(payload.projects) ? payload.projects : [];
  return projects.flatMap((projectValue, projectIndex) => {
    const project = record(projectValue);
    const projectId = String(project.id || `项目 ${projectIndex + 1}`);
    const providers = Array.isArray(project.providers) ? project.providers : [];
    return providers.map((item, providerIndex) => {
      const raw = record(item);
      const onlyNetworks = stringList(raw.onlyNetworks);
      const ignoreNetworks = stringList(raw.ignoreNetworks);
      const networkMode: NetworkMode = onlyNetworks.length > 0 ? "only" : ignoreNetworks.length > 0 ? "ignore" : "all";
      return {
        key: `provider/${projectIndex}/${projectId}/${String(raw.id || "")}/${providerIndex}`,
        kind: "provider" as const,
        projectIndex,
        providerIndex,
        projectId,
        id: String(raw.id || ""),
        vendor: String(raw.vendor || ""),
        networkMode,
        networks: networkMode === "only" ? onlyNetworks : networkMode === "ignore" ? ignoreNetworks : [],
        raw,
      };
    });
  });
}

export function addProvider(payload: ConfigPayload, input: ProviderInput): ConfigPayload {
  const next = structuredClone(payload) as ConfigPayload;
  const project = projectAt(next, input.projectIndex);
  const values = normalizeProviderInput(input);
  validateProvider(values, project, undefined);
  const providers = Array.isArray(project.providers) ? [...project.providers] : [];
  providers.push(buildProvider({}, values));
  project.providers = providers;
  const projects = Array.isArray(next.projects) ? next.projects : [];
  projects[input.projectIndex] = project;
  next.projects = projects;
  return next;
}

export function updateProvider(payload: ConfigPayload, location: ProviderLocation, input: ProviderInput): ConfigPayload {
  const next = structuredClone(payload) as ConfigPayload;
  const project = projectAt(next, location.projectIndex);
  const providers = Array.isArray(project.providers) ? [...project.providers] : [];
  if (!providers[location.providerIndex]) throw new Error("厂商实例不存在");
  const values = normalizeProviderInput({ ...input, projectIndex: location.projectIndex });
  validateProvider(values, project, location.providerIndex);
  providers[location.providerIndex] = buildProvider(record(providers[location.providerIndex]), values);
  project.providers = providers;
  const projects = Array.isArray(next.projects) ? next.projects : [];
  projects[location.projectIndex] = project;
  next.projects = projects;
  return next;
}

export function removeProvider(payload: ConfigPayload, location: ProviderLocation): ConfigPayload {
  const next = structuredClone(payload) as ConfigPayload;
  const project = projectAt(next, location.projectIndex);
  const providers = Array.isArray(project.providers) ? [...project.providers] : [];
  if (location.providerIndex < 0 || location.providerIndex >= providers.length) throw new Error("厂商实例不存在");
  providers.splice(location.providerIndex, 1);
  project.providers = providers;
  const projects = Array.isArray(next.projects) ? next.projects : [];
  projects[location.projectIndex] = project;
  next.projects = projects;
  return next;
}

export function encodeExtraSettings(settings: Record<string, unknown>, knownKeys: Set<string>): ExtraSettingRow[] {
  return Object.entries(settings).filter(([key]) => !knownKeys.has(key)).map(([key, value]) => {
    if (typeof value === "string") return { key, type: "string" as const, value };
    if (typeof value === "number") return { key, type: "number" as const, value: String(value) };
    if (typeof value === "boolean") return { key, type: "boolean" as const, value: String(value) };
    return { key, type: "json" as const, value: JSON.stringify(value) };
  });
}

export function decodeExtraSettings(rows: ExtraSettingRow[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const row of rows || []) {
    const key = row.key.trim();
    if (!key) throw new Error("请输入厂商参数名称");
    if (Object.hasOwn(result, key)) throw new Error(`厂商参数 ${key} 重复`);
    if (row.type === "string") result[key] = row.value;
    else if (row.type === "number") {
      const value = Number(row.value);
      if (!Number.isFinite(value)) throw new Error(`厂商参数 ${key} 必须是数字`);
      result[key] = value;
    } else if (row.type === "boolean") {
      if (row.value !== "true" && row.value !== "false") throw new Error(`厂商参数 ${key} 必须是布尔值 true 或 false`);
      result[key] = row.value === "true";
    } else {
      try {
        result[key] = JSON.parse(row.value);
      } catch {
        throw new Error(`厂商参数 ${key} 不是有效 JSON`);
      }
    }
  }
  return result;
}

export function splitProviderSettings(vendor: string, settings: Record<string, unknown>) {
  const fields = providerDefinition(vendor).fields;
  const knownKeys = new Set(fields.map((field) => field.key));
  const known: Record<string, unknown> = {};
  for (const field of fields) {
    if (!Object.hasOwn(settings, field.key)) continue;
    const value = settings[field.key];
    if (field.kind === "tags" || field.kind === "number-tags") known[field.key] = stringList(value);
    else if (field.kind === "credit-units" && !Array.isArray(value)) {
      known[field.key] = Object.entries(record(value)).map(([method, units]) => ({ method, units }));
    } else known[field.key] = structuredClone(value);
  }
  return { known, extra: encodeExtraSettings(settings, knownKeys) };
}

export function mergeProviderSettings(vendor: string, known: Record<string, unknown>, extra: ExtraSettingRow[]): Record<string, unknown> {
  const definition = providerDefinition(vendor);
  const knownKeys = new Set(definition.fields.map((field) => field.key));
  for (const row of extra || []) if (knownKeys.has(row.key.trim())) throw new Error(`厂商参数 ${row.key.trim()} 重复`);
  const result = decodeExtraSettings(extra || []);

  for (const field of definition.fields) {
    const raw = known[field.key];
    if (isEmptySetting(raw)) {
      if (field.required) throw new Error(`请输入${field.label}`);
      continue;
    }
    if (field.kind === "tags") {
      result[field.key] = stringList(raw);
    } else if (field.kind === "number-tags") {
      const values = (Array.isArray(raw) ? raw : [raw]).map((value) => Number(value));
      if (values.some((value) => !Number.isInteger(value))) throw new Error(`${field.label}必须是整数`);
      result[field.key] = values;
    } else if (field.kind === "credit-units") {
      result[field.key] = creditUnits(raw);
    } else {
      result[field.key] = typeof raw === "string" ? raw.trim() : raw;
    }
  }
  return result;
}

export function encodeProviderOverrides(overrides: Record<string, unknown>, upstreamSchema: ConfigSchema): ProviderOverrideFormRow[] {
  return Object.entries(overrides).map(([key, value]) => {
    const raw = structuredClone(record(value));
    return { key, value: toFormDocument(raw, upstreamSchema), raw };
  });
}

export function decodeProviderOverrides(rows: ProviderOverrideFormRow[], upstreamSchema: ConfigSchema): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const row of rows || []) {
    const key = row.key.trim();
    if (!key) throw new Error("请输入覆盖匹配规则");
    if (Object.hasOwn(result, key)) throw new Error(`覆盖匹配规则 ${key} 重复`);
    const edited = fromFormDocument(record(row.value), upstreamSchema);
    result[key] = mergeKnownConfig(record(row.raw), edited, upstreamSchema);
  }
  return result;
}

function normalizeProviderInput(input: ProviderInput): ProviderInput {
  return {
    ...input,
    id: input.id.trim(),
    vendor: input.vendor.trim(),
    settings: structuredClone(record(input.settings)),
    networks: [...new Set((input.networks || []).map((value) => value.trim()).filter(Boolean))],
    upstreamIdTemplate: input.upstreamIdTemplate.trim(),
    overrides: structuredClone(record(input.overrides)) as Record<string, Record<string, unknown>>,
  };
}

function validateProvider(input: ProviderInput, project: Record<string, any>, editingIndex: number | undefined): void {
  if (!input.id) throw new Error("请输入厂商实例名称");
  if (!input.vendor) throw new Error("请选择或输入厂商");
  if (!input.upstreamIdTemplate) throw new Error("请输入生成节点名称模板");
  const providers = Array.isArray(project.providers) ? project.providers : [];
  if (providers.some((item, index) => index !== editingIndex && String(record(item).id || "").trim() === input.id)) {
    throw new Error("同一项目内的厂商实例名称不能重复");
  }
  if (input.networkMode !== "all") {
    if (!input.networks?.length) throw new Error("请至少填写一个网络标识");
    const invalid = input.networks.find((network) => !isPlausibleNetworkId(network));
    if (invalid) throw new Error(`网络标识 ${invalid} 格式不正确`);
  }
  for (const field of providerDefinition(input.vendor).fields) {
    if (field.required && isEmptySetting(input.settings?.[field.key])) throw new Error(`请输入${field.label}`);
  }
}

function buildProvider(base: Record<string, any>, input: ProviderInput): Record<string, any> {
  const provider: Record<string, any> = {
    ...base,
    id: input.id,
    vendor: input.vendor,
    upstreamIdTemplate: input.upstreamIdTemplate,
  };
  if (input.settings && Object.keys(input.settings).length > 0) provider.settings = structuredClone(input.settings);
  else delete provider.settings;
  delete provider.onlyNetworks;
  delete provider.ignoreNetworks;
  if (input.networkMode === "only") provider.onlyNetworks = structuredClone(input.networks || []);
  if (input.networkMode === "ignore") provider.ignoreNetworks = structuredClone(input.networks || []);
  if (input.overrides && Object.keys(input.overrides).length > 0) provider.overrides = structuredClone(input.overrides);
  else delete provider.overrides;
  return provider;
}

function creditUnits(raw: unknown): Record<string, number> {
  if (!Array.isArray(raw)) {
    const result: Record<string, number> = {};
    for (const [method, units] of Object.entries(record(raw))) {
      const value = Number(units);
      if (!method.trim() || !Number.isInteger(value) || value < 0) throw new Error("方法积分必须是非负整数");
      result[method.trim()] = value;
    }
    return result;
  }
  const result: Record<string, number> = {};
  for (const item of raw) {
    const row = record(item);
    const method = String(row.method || "").trim();
    const units = Number(row.units);
    if (!method) throw new Error("请输入 RPC 方法名称");
    if (Object.hasOwn(result, method)) throw new Error(`RPC 方法 ${method} 重复`);
    if (!Number.isInteger(units) || units < 0) throw new Error("方法积分必须是非负整数");
    result[method] = units;
  }
  return result;
}

function isPlausibleNetworkId(value: string): boolean {
  const parts = value.split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !part || /\s/.test(part))) return false;
  if (parts[0] === "evm") return parts.length === 2 && /^[1-9]\d*$/.test(parts[1]);
  return parts.every((part) => /^[A-Za-z0-9._-]+$/.test(part));
}

function isEmptySetting(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "") || (Array.isArray(value) && value.length === 0);
}

function stringList(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]).map((item) => String(item).trim()).filter(Boolean);
}

function projectAt(payload: ConfigPayload, index: number): Record<string, any> {
  if (!Array.isArray(payload.projects) || !payload.projects[index]) throw new Error("所属项目不存在");
  return record(payload.projects[index]);
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}
