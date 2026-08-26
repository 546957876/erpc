# Admin 保存状态与上游字段说明 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 仅在配置发生真实变化时允许保存，并把上游节点名称与链 ID、协议类型、RPC 厂商区分清楚。

**Architecture:** 复用 `document.ts` 现有递归深比较，比较页面生成的稀疏覆盖配置与当前已保存稀疏配置。Advanced 与 Settings 都继续走原有 `extractOverrides` 保存路径；上游页面只调整中文字段说明，不扩展 Provider 管理。

**Tech Stack:** React 19、TypeScript、Ant Design、TanStack Query、Vitest

---

### Task 1: 导出并验证配置文档比较

**Files:**
- Modify: `web/src/config/document.ts`
- Test: `web/src/config/document.test.ts`

- [x] **Step 1: 写失败测试**

在 `document.test.ts` 导入 `configDocumentsEqual`，并增加真实稀疏配置的未修改、修改、改回测试：

```ts
it("detects real sparse configuration changes and reversions", () => {
  const defaults = { server: { httpPortV4: 4000 } };
  const saved = {};
  const changed = extractOverrides({ server: { httpPortV4: 4100 } }, defaults, smallSchema, saved);
  const reverted = extractOverrides({ server: { httpPortV4: 4000 } }, defaults, smallSchema, changed);

  expect(configDocumentsEqual(saved, {})).toBe(true);
  expect(configDocumentsEqual(saved, changed)).toBe(false);
  expect(configDocumentsEqual(saved, reverted)).toBe(true);
  expect(configDocumentsEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
});
```

- [x] **Step 2: 运行测试并确认失败**

Run: `pnpm --dir web exec vitest run src/config/document.test.ts`

Expected: FAIL，提示 `configDocumentsEqual` 尚未导出。

- [x] **Step 3: 最小实现**

把现有私有 `deepEqual` 原地改名并导出，递归调用同步改名；`diffValues` 直接复用它：

```ts
export function configDocumentsEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((item, index) => configDocumentsEqual(item, right[index]));
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length && leftKeys.every((key) => Object.hasOwn(right, key) && configDocumentsEqual(left[key], right[key]));
  }
  return false;
}
```

- [x] **Step 4: 运行测试并确认通过**

Run: `pnpm --dir web exec vitest run src/config/document.test.ts`

Expected: PASS。

### Task 2: Advanced 与 Settings 使用真实差异控制保存

**Files:**
- Modify: `web/src/pages/Advanced.tsx`
- Modify: `web/src/pages/Settings.tsx`
- Test: `web/src/config-ui.test.js`

- [x] **Step 1: 写失败测试**

在 `config-ui.test.js` 增加静态接线测试，确保两个页面都使用配置比较，且保存按钮由 `dirty` 控制：

```js
it("only enables revision saves for real configuration changes", () => {
  expect(advanced).toMatch(/configDocumentsEqual/);
  expect(settings).toMatch(/configDocumentsEqual/);
  expect(advanced.match(/disabled=\{!dirty\}/g)).toHaveLength(2);
  expect(settings).toMatch(/disabled=\{!dirty\}/);
});
```

- [x] **Step 2: 运行测试并确认失败**

Run: `pnpm --dir web exec vitest run src/config-ui.test.js`

Expected: FAIL，因为 Settings 尚无 `dirty`，Advanced 首次配置仍可无修改保存。

- [x] **Step 3: 修改 Advanced**

导入 `useRef` 与 `configDocumentsEqual`，保存一份当前已保存稀疏配置作为比较基线；所有表单修改和恢复默认都通过同一个本地函数更新状态：

```ts
const savedOverrides = useRef<ConfigPayload>({});
const loadedRevision = useRef(0);

function updateDraft(next: ConfigPayload) {
  setDraftOverrides(next);
  setDirty(!configDocumentsEqual(next, savedOverrides.current));
}
```

加载新版本时同步两个 ref；保存成功时立即把提交 payload 和返回 revision 写入 ref，避免查询刷新前拿旧版本覆盖刚保存的表单。两处按钮都使用：

```tsx
disabled={!dirty}
```

首次默认配置未改动时底部状态显示 `使用系统默认配置`。

- [x] **Step 4: 修改 Settings**

把现有 `submit` 中生成稀疏覆盖配置的代码提取为页面内 `buildSettingsOverrides(values)`，提交和 `onValuesChange` 共用同一结果：

```tsx
onValuesChange={(_, values) => setDirty(!configDocumentsEqual(buildSettingsOverrides(values), savedOverrides.current))}
```

保存按钮增加 `disabled={!dirty}`；加载配置与保存成功时同步 `savedOverrides` 并把 `dirty` 设为 `false`。保存失败不清理修改状态。

- [x] **Step 5: 运行测试并确认通过**

Run: `pnpm --dir web exec vitest run src/config-ui.test.js src/config/document.test.ts`

Expected: PASS。

### Task 3: 上游字段中文说明

**Files:**
- Modify: `web/src/pages/Upstreams.tsx`
- Modify: `web/src/config/metadata.ts`
- Modify: `web/src/config/upstreams.ts`
- Test: `web/src/config-ui.test.js`
- Test: `web/src/config/metadata.test.ts`
- Test: `web/src/config/upstreams.test.ts`

- [x] **Step 1: 写失败测试**

增加断言，要求简化编辑器和完整配置元数据明确 ID 不是链 ID，类型不是 RPC 厂商：

```ts
const upstreamId = metadataFor(["UpstreamConfig", "id"], { kind: "string" }, typed);
const upstreamType = metadataFor(["UpstreamConfig", "type"], { kind: "string" }, typed);
expect(upstreamId.label).toBe("节点名称（唯一标识）");
expect(upstreamId.description).toContain("不是链 ID");
expect(upstreamType.description).toContain("不是 RPC 厂商");
```

```js
expect(upstreams).toMatch(/节点名称（唯一标识）/);
expect(upstreams).toMatch(/不是链 ID/);
expect(upstreams).toMatch(/任意 HTTP\/HTTPS RPC/);
```

- [x] **Step 2: 运行测试并确认失败**

Run: `pnpm --dir web exec vitest run src/config-ui.test.js src/config/metadata.test.ts`

Expected: FAIL，现有界面仍显示“上游 ID”。

- [x] **Step 3: 最小文案修改**

将表格和表单中的 `上游 ID` 改为 `节点名称` / `节点名称（唯一标识）`；表单使用 Ant Design `extra` 增加：

```tsx
extra="这是节点的自定义名称，不是链 ID；同一项目内不能重复，例如 alchemy-bsc-mainnet-1。"
```

类型说明写明 `evm` / `svm` 是协议架构而非厂商；RPC 地址说明写明支持任意 HTTP/HTTPS RPC，包括完整 Alchemy URL。同步修改 `metadata.ts` 中 `UpstreamConfig.id`、`UpstreamConfig.type`、`UpstreamConfig.endpoint`。

- [x] **Step 4: 运行前端完整验证**

Run: `pnpm --dir web test`

Expected: 全部 Vitest 测试 PASS。

Run: `pnpm --dir web exec tsc -b`

Expected: 退出码 0。

Run: `pnpm --dir web build`

Expected: 构建成功；允许现有 bundle size 警告。

- [x] **Step 5: 检查改动范围**

Run: `git diff --check -- web/src/config/document.ts web/src/config/document.test.ts web/src/config/upstreams.ts web/src/config/upstreams.test.ts web/src/pages/Advanced.tsx web/src/pages/Settings.tsx web/src/pages/Upstreams.tsx web/src/config/metadata.ts web/src/config/metadata.test.ts web/src/config-ui.test.js docs/superpowers/plans/2026-08-26-admin-save-state-and-upstream-labels.md`

Expected: 无输出，退出码 0；不启动 Admin、Web 或 eRPC 服务。

### Task 4: 审查反馈加固

**Files:**
- Modify: `web/src/config/document.ts`
- Modify: `web/src/config/metadata.ts`
- Modify: `web/src/pages/Advanced.tsx`
- Modify: `web/src/pages/Settings.tsx`
- Test: `web/src/config/document.test.ts`
- Test: `web/src/config/metadata.test.ts`
- Test: `web/src/config-ui.test.js`

- [x] **Step 1: 用失败测试复现未知 Map 子字段丢失、删除项复活、网络数组错配和 ID 原位改名丢字段**

- [x] **Step 2: 在共享 `extractOverrides` 流程中递归保留仍存在的 Map 值，并让 Map 键集合保持表单权威**

- [x] **Step 3: 数组优先按稳定标识匹配，仅在长度不变时按位置兜底；补充别名和嵌套 EVM/SVM 网络标识**

- [x] **Step 4: 修复数组/Map 通配 schema 路径，使完整配置页命中拥有者中文元数据**

- [x] **Step 5: 两页以本地最新 revision 保存，并阻止异步旧查询覆盖 Settings 的第二次编辑**

- [x] **Step 6: 保留合法日志级别原始大小写，完成 31 个前端测试、TypeScript 编译和生产构建**
