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
        defaultText: "Alchemy 官方目录",
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
        defaultText: "eRPC 内置官方地址",
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

export function providerDefinition(value: string): ProviderDefinition {
  return providerCatalog.find((item) => item.value === value) || { value, label: value, fields: [] };
}
