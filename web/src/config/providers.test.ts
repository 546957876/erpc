import { describe, expect, it } from "vitest";
import {
  addProvider,
  decodeExtraSettings,
  decodeProviderOverrides,
  encodeExtraSettings,
  encodeProviderOverrides,
  listProviders,
  mergeProviderSettings,
  providerDefinition,
  providerOptions,
  removeProvider,
  splitProviderSettings,
  updateProvider,
} from "./providers";
import type { ConfigSchema } from "./document";

const upstreamSchema: ConfigSchema = {
  root: { kind: "object", ref: "UpstreamConfig" },
  definitions: {
    UpstreamConfig: {
      fields: [
        { key: "id", node: { kind: "string" }, owner: "UpstreamConfig" },
        { key: "type", node: { kind: "string" }, owner: "UpstreamConfig" },
      ],
    },
  },
};

function providerPayload(count = 0) {
  return {
    projects: [
      {
        id: "main",
        futureProjectField: "keep",
        providers: Array.from({ length: count }, (_, index) => ({
          id: `provider-${index}`,
          vendor: index % 2 ? "alchemy" : "future-vendor",
          settings: { apiKey: `key-${index}`, futureSetting: { ordinal: index } },
          upstreamIdTemplate: "<PROVIDER>-<NETWORK>",
          futureProviderField: { ordinal: index },
        })),
      },
      { id: "backup", providers: [{ id: "provider-0", vendor: "repository", upstreamIdTemplate: "<PROVIDER>-<NETWORK>" }] },
    ],
  };
}

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

  it("显示源码中的真实厂商默认地址", () => {
    expect(providerDefinition("alchemy").fields.find((field) => field.key === "chainsUrl")?.defaultText)
      .toBe("https://app-api.alchemy.com/trpc/config.getNetworkConfig");
    expect(providerDefinition("superchain").fields.find((field) => field.key === "registryUrl")?.defaultText)
      .toBe("https://raw.githubusercontent.com/ethereum-optimism/superchain-registry/main/chainList.json");
  });
});

describe("Provider CRUD", () => {
  it("读取大量 Provider 时保留项目边界和稳定位置", () => {
    const rows = listProviders(providerPayload(160));

    expect(rows).toHaveLength(161);
    expect(rows[159]).toMatchObject({ projectIndex: 0, providerIndex: 159, id: "provider-159", vendor: "alchemy" });
    expect(rows[160]).toMatchObject({ projectIndex: 1, providerIndex: 0, projectId: "backup" });
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
  });

  it("新增完整 Provider 只修改目标项目", () => {
    const payload = providerPayload();
    const next = addProvider(payload, {
      projectIndex: 0,
      id: "alchemy-main",
      vendor: "alchemy",
      settings: { apiKey: "plain-key", creditUnits: { eth_call: 26 } },
      networkMode: "only",
      networks: ["evm:1", "evm:56", "evm:56"],
      upstreamIdTemplate: "<PROVIDER>-<NETWORK>",
      overrides: { "*": { type: "evm", futureOverride: true } },
    });

    expect((next.projects as any[])[0].providers[0]).toEqual({
      id: "alchemy-main",
      vendor: "alchemy",
      settings: { apiKey: "plain-key", creditUnits: { eth_call: 26 } },
      onlyNetworks: ["evm:1", "evm:56"],
      upstreamIdTemplate: "<PROVIDER>-<NETWORK>",
      overrides: { "*": { type: "evm", futureOverride: true } },
    });
    expect((next.projects as any[])[1].providers).toHaveLength(1);
    expect((payload.projects as any[])[0].providers).toHaveLength(0);
  });

  it("修改时保留未来字段并切换网络范围", () => {
    const payload = providerPayload(8);
    const target = listProviders(payload)[6];
    const next = updateProvider(payload, target, {
      projectIndex: 0,
      id: "renamed",
      vendor: "future-vendor",
      settings: { token: "plain" },
      networkMode: "ignore",
      networks: ["svm:solana:mainnet"],
      upstreamIdTemplate: "<VENDOR>-<NETWORK>",
    });
    const changed = (next.projects as any[])[0].providers[6];

    expect(changed).toMatchObject({
      id: "renamed",
      vendor: "future-vendor",
      settings: { token: "plain" },
      ignoreNetworks: ["svm:solana:mainnet"],
      upstreamIdTemplate: "<VENDOR>-<NETWORK>",
      futureProviderField: { ordinal: 6 },
    });
    expect(changed.onlyNetworks).toBeUndefined();
  });

  it("删除中间 Provider 不会错删相邻项或另一个项目", () => {
    const payload = providerPayload(160);
    const target = listProviders(payload).find((row) => row.projectId === "main" && row.id === "provider-80")!;
    const next = removeProvider(payload, target);

    expect(listProviders(next)).toHaveLength(160);
    expect((next.projects as any[])[0].providers.some((item: any) => item.id === "provider-80")).toBe(false);
    expect((next.projects as any[])[1].providers[0].id).toBe("provider-0");
  });

  it("校验同项目重复名称、必填字段和网络格式", () => {
    const payload = providerPayload(2);
    const base = {
      projectIndex: 0,
      id: "new-provider",
      vendor: "future-vendor",
      networkMode: "all" as const,
      upstreamIdTemplate: "<PROVIDER>-<NETWORK>",
    };

    expect(() => addProvider(payload, { ...base, id: "provider-1" })).toThrow("同一项目内");
    expect(() => addProvider(payload, { ...base, projectIndex: 1 })).not.toThrow();
    expect(() => addProvider(payload, { ...base, id: " " })).toThrow("实例名称");
    expect(() => addProvider(payload, { ...base, vendor: " " })).toThrow("厂商");
    expect(() => addProvider(payload, { ...base, upstreamIdTemplate: " " })).toThrow("节点名称模板");
    expect(() => addProvider(payload, { ...base, networkMode: "only", networks: ["56"] })).toThrow("网络标识");
  });
});

describe("厂商设置转换", () => {
  it("已知设置与开放设置可无损拆分和合并", () => {
    const settings = { apiKey: "plain", chainsUrl: "https://chains.example", future: { nested: [1, true] } };
    const split = splitProviderSettings("alchemy", settings);

    expect(split.known).toEqual({ apiKey: "plain", chainsUrl: "https://chains.example" });
    expect(split.extra).toEqual([{ key: "future", type: "json", value: '{"nested":[1,true]}' }]);
    expect(mergeProviderSettings("alchemy", split.known, split.extra)).toEqual(settings);
  });

  it("开放设置保留字符串、数字、布尔和 JSON 类型", () => {
    const source = { text: "001", count: 2, enabled: false, nested: { values: [1, 2] } };
    expect(decodeExtraSettings(encodeExtraSettings(source, new Set()))).toEqual(source);
  });

  it("拒绝重复键和错误类型", () => {
    expect(() => decodeExtraSettings([{ key: "x", type: "number", value: "NaN" }])).toThrow("数字");
    expect(() => decodeExtraSettings([{ key: "x", type: "boolean", value: "yes" }])).toThrow("布尔");
    expect(() => decodeExtraSettings([{ key: "x", type: "json", value: "{" }])).toThrow("JSON");
    expect(() => decodeExtraSettings([{ key: "x", type: "string", value: "a" }, { key: "x", type: "string", value: "b" }])).toThrow("重复");
  });

  it("转换标签与方法积分并校验已知厂商必填参数", () => {
    expect(mergeProviderSettings("quicknode", {
      apiKey: "plain",
      tagIds: ["1", 2],
      tagLabels: ["archive", "realtime"],
      creditUnits: [{ method: "eth_call", units: 20 }],
    }, [])).toEqual({
      apiKey: "plain",
      tagIds: [1, 2],
      tagLabels: ["archive", "realtime"],
      creditUnits: { eth_call: 20 },
    });
    expect(() => mergeProviderSettings("alchemy", {}, [])).toThrow("API 密钥");
  });

  it("兼容 QuickNode 已有的单个标签值", () => {
    expect(mergeProviderSettings("quicknode", { apiKey: "plain", tagIds: "7", tagLabels: "archive" }, [])).toMatchObject({
      tagIds: [7],
      tagLabels: ["archive"],
    });
  });

  it("把已有标签和方法积分转换成可编辑表单值", () => {
    const split = splitProviderSettings("quicknode", {
      apiKey: "plain",
      tagIds: 7,
      tagLabels: "archive",
      creditUnits: { eth_call: 20, eth_getLogs: 30 },
    });

    expect(split.known).toEqual({
      apiKey: "plain",
      tagIds: ["7"],
      tagLabels: ["archive"],
      creditUnits: [
        { method: "eth_call", units: 20 },
        { method: "eth_getLogs", units: 30 },
      ],
    });
    expect(mergeProviderSettings("quicknode", split.known, split.extra)).toEqual({
      apiKey: "plain",
      tagIds: [7],
      tagLabels: ["archive"],
      creditUnits: { eth_call: 20, eth_getLogs: 30 },
    });
  });
});

describe("Provider 覆盖配置转换", () => {
  it("编辑已知字段时保留未知字段", () => {
    const rows = encodeProviderOverrides({
      "evm:*": { id: "generated", type: "evm", futureOverride: { keep: true } },
    }, upstreamSchema);
    rows[0].value.type = "future-chain";

    expect(decodeProviderOverrides(rows, upstreamSchema)).toEqual({
      "evm:*": { id: "generated", type: "future-chain", futureOverride: { keep: true } },
    });
  });

  it("拒绝空白和重复覆盖规则", () => {
    const row = { key: "*", value: {}, raw: {} };
    expect(() => decodeProviderOverrides([{ ...row, key: " " }], upstreamSchema)).toThrow("匹配规则");
    expect(() => decodeProviderOverrides([row, { ...row }], upstreamSchema)).toThrow("重复");
  });
});
