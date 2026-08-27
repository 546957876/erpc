import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const advanced = readFileSync(new URL("./pages/Advanced.tsx", import.meta.url), "utf8");
const settings = readFileSync(new URL("./pages/Settings.tsx", import.meta.url), "utf8");
const upstreams = readFileSync(new URL("./pages/Upstreams.tsx", import.meta.url), "utf8");
const providerFields = readFileSync(new URL("./pages/ProviderFormFields.tsx", import.meta.url), "utf8");
const configFields = readFileSync(new URL("./config/ConfigFields.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const rpcDebug = readFileSync(new URL("./pages/RpcDebug.tsx", import.meta.url), "utf8");
const revisions = readFileSync(new URL("./pages/Revisions.tsx", import.meta.url), "utf8");

describe("field-only configuration UI", () => {
  it("never asks the operator to edit or import YAML", () => {
    expect(advanced).not.toMatch(/Input\.TextArea|yaml-editor|粘贴完整的 erpc\.yaml/i);
    expect(settings).not.toMatch(/导入 erpc\.yaml/i);
    expect(upstreams).not.toMatch(/导入 erpc\.yaml/i);
  });

  it("renders the generated schema as Chinese field controls", () => {
    expect(advanced).toMatch(/ConfigFields/);
    expect(advanced).toMatch(/完整配置/);
    expect(advanced).toMatch(/首次配置/);
  });

  it("exports a reusable renderer for one schema definition", () => {
    expect(configFields).toMatch(/export function ConfigDefinitionFields/);
    expect(configFields).toMatch(/ref: definition/);
  });

  it("only enables revision saves for real configuration changes", () => {
    expect(advanced).toMatch(/configDocumentsEqual/);
    expect(settings).toMatch(/configDocumentsEqual/);
    expect(advanced.match(/disabled=\{!dirty\}/g)).toHaveLength(2);
    expect(settings).toMatch(/disabled=\{!dirty\}/);
  });

  it("keeps the latest saved baseline across asynchronous config refreshes", () => {
    expect(advanced).toMatch(/baseRevision: loadedRevision\.current/);
    expect(settings).toMatch(/const loadedRevision = useRef\(0\)/);
    expect(settings).toMatch(/dirty \|\| revision < loadedRevision\.current/);
    expect(settings).toMatch(/baseRevision: loadedRevision\.current/);
    expect(settings).not.toMatch(/String\(payload\.logLevel\)\.toUpperCase\(\)/);
  });

  it("makes eRPC Admin internal authentication explicit and distinct from Web login", () => {
    expect(settings).toMatch(/eRPC Admin 密钥标识/);
    expect(settings).toMatch(/eRPC Admin 内部密钥/);
    expect(settings).toMatch(/不是 Admin Web 登录账号/);
    expect(settings).toMatch(/admin\.auth/);
  });

  it("explains upstream identity and accepts vendor-neutral RPC addresses", () => {
    expect(upstreams).toMatch(/名称（唯一标识）/);
    expect(upstreams).toMatch(/不是链 ID/);
    expect(upstreams).toMatch(/不是 RPC 服务厂商/);
    expect(upstreams).toMatch(/任意 HTTP\/HTTPS RPC/);
  });

  it("manages direct RPC nodes and vendor providers in one table", () => {
    expect(upstreams).toMatch(/listProviders/);
    expect(upstreams).toMatch(/ProviderFormFields/);
    expect(upstreams).toMatch(/自定义 RPC 节点/);
    expect(upstreams).toMatch(/providerOptions/);
    expect(upstreams).toMatch(/defaultPageSize:\s*20/);
  });

  it("generates project-unique identifiers and validates before saving", () => {
    expect(upstreams).toMatch(/randomUniqueId/);
    expect(upstreams).toMatch(/随机生成/);
    expect(upstreams).toMatch(/useValidateConfig/);
    expect(upstreams).toMatch(/validate\.mutateAsync/);
  });

  it("uses a Chinese grouped selector and binds the generated name to the input", () => {
    const idStart = upstreams.indexOf('label="名称（唯一标识）"');
    const accessModeField = upstreams.slice(upstreams.indexOf('name="accessMode"'), idStart);
    const idField = upstreams.slice(idStart, upstreams.indexOf('{accessMode === "custom"', idStart));

    expect(accessModeField).toMatch(/<Select/);
    expect(accessModeField).not.toMatch(/<AutoComplete/);
    expect(upstreams).toMatch(/label: "直接接入"/);
    expect(upstreams).toMatch(/label: "公共节点"/);
    expect(upstreams).toMatch(/label: "eRPC 内置厂商"/);
    expect(upstreams).toMatch(/其他 \/ 未收录 eRPC 厂商/);
    expect(idField).toMatch(/<Form\.Item name="id" noStyle/);
  });

  it("explains the generated node name format in Chinese", () => {
    expect(providerFields).toMatch(/自动生成的节点名称格式/);
    expect(providerFields).toMatch(/通常无需修改/);
    expect(providerFields).toMatch(/alchemy-main-evm:56/);
    expect(providerFields).toMatch(/allowCustomVendor/);
    expect(providerFields).toMatch(/customProviderAccessMode/);
  });

  it("replaces vendor settings and keeps payload and revision on one snapshot", () => {
    expect(upstreams).toMatch(/form\.setFieldValue\("settings",/);
    expect(upstreams).toMatch(/knownProviderOptions\.some\(\(option\) => option\.value === value\) \? value : customProviderAccessMode/);
    expect(upstreams).toMatch(/if \(previousVendor === nextVendor\) return/);
    expect(upstreams).toMatch(/const \[editingSnapshot, setEditingSnapshot\]/);
    expect(upstreams).toMatch(/baseRevision: base\.revision/);
    expect(upstreams).toMatch(/await current\.refetch\(\)/);
    expect(upstreams).toMatch(/当前配置版本 v\{latestConfig\?\.revision\}/);
    expect(upstreams).toMatch(/厂商代码不能使用系统保留值/);
    expect(upstreams).not.toMatch(/loadedRevision/);
  });

  it("provides Chinese node health and RPC debug routes while preserving old links", () => {
    expect(app).toMatch(/to="\/health">节点健康/);
    expect(app).toMatch(/to="\/rpc-debug">RPC 调试/);
    expect(app).toMatch(/path="\/topology\/:targetId" element=\{<LegacyTopologyRedirect/);
    expect(app).toMatch(/path="\/targets\/\*" element=\{<Navigate to="\/health"/);
  });

  it("keeps RPC networks and methods open in both test modes", () => {
    expect(rpcDebug).toMatch(/运行中 eRPC/);
    expect(rpcDebug).toMatch(/已保存节点/);
    expect(rpcDebug).toMatch(/项目访问密钥（可选）/);
    expect(rpcDebug).toMatch(/allowClientDirectives/);
    expect(rpcDebug).toMatch(/<AutoComplete/);
    expect(rpcDebug).toMatch(/name="method"/);
    expect(rpcDebug).toMatch(/useSavedUpstreamTest/);
    expect(rpcDebug).toMatch(/useRuntimeRPCTest/);
    expect(rpcDebug).toMatch(/PowerShell/);
    expect(rpcDebug).toMatch(/curl\.exe/);
    expect(rpcDebug).toMatch(/命令中包含真实密钥/);
    expect(rpcDebug).toMatch(/requestSequence/);
    expect(rpcDebug).toMatch(/runtimeProjectIDs/);
    expect(rpcDebug).toMatch(/eRPC 管理接口返回 401/);
  });

  it("exposes editable health timing and one-click upstream probes", () => {
    expect(app).toMatch(/EVM 状态轮询周期/);
    expect(app).toMatch(/选路重算周期/);
    expect(app).toMatch(/健康指标统计窗口/);
    expect(app).toMatch(/SVM 状态轮询防抖/);
    expect(app).toMatch(/disabled=\{!healthDirty\}/);
    expect(app).toMatch(/放弃未保存的健康配置/);
    expect(app).toMatch(/项目需要访问密钥/);
    expect(app).toMatch(/未测试/);
    expect(app).toMatch(/aria-label="测试 RPC"/);
    expect(upstreams).toMatch(/useSavedUpstreamTest/);
    expect(upstreams).toMatch(/aria-label="测试 RPC"/);
  });

  it("allows deleting historical configuration revisions with a confirmation", () => {
    expect(revisions).toMatch(/useDeleteConfigRevision/);
    expect(revisions).toMatch(/useRuntimeStatus/);
    expect(revisions).toMatch(/DeleteOutlined/);
    expect(revisions).toMatch(/最新版本和运行记录引用的版本不能删除/);
    expect(revisions).toMatch(/row\.revision === runtimeRevision/);
  });
});
