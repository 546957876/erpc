# Admin 保存状态与上游字段说明设计

## 目标

- Advanced 与 Settings 仅在表单内容相对当前已保存配置发生实际变化时允许保存。
- 用户修改后再改回原值，保存按钮重新禁用。
- 首次只有系统默认配置且没有修改时，保存按钮同样禁用。
- 上游编辑器明确区分节点名称、链 ID、协议类型和 RPC 地址。

## 最小实现

复用 `web/src/config/document.ts` 已有的配置规范化与深比较能力。两个页面都把当前表单转换成与保存接口相同的稀疏覆盖配置，再与 `current.data.payload` 比较；不使用 Ant Design 的 `isFieldsTouched`，因为它无法识别改回原值。

Advanced 保留现有草稿覆盖配置，但 `dirty` 改为实际差异结果。Settings 增加同样的差异状态，并用它控制唯一的保存按钮。保存成功且最新配置刷新后，两页按钮恢复禁用。

## 上游字段

- `节点名称（唯一标识）`：对应 `UpstreamConfig.id`，不是链 ID；同一项目内不可重复。示例：`alchemy-bsc-mainnet-1`。
- `类型`：协议架构，例如 `evm` 或 `svm`，不是 Alchemy 等厂商名称。
- `RPC 地址`：支持任意 HTTP/HTTPS RPC，包括完整 Alchemy URL。
- `链 ID`：对应 `evm.chainId`，与节点名称分离；本次不扩展简化上游编辑器，仍由完整配置页设置或由 eRPC 自动探测。

eRPC 的 `alchemy://API_KEY` 多链 Provider 模式保持原样可用。本次不把 Provider 管理塞进单节点上游抽屉，后续如需专门管理 `projects[].providers[]`，应作为独立界面实现。

## 错误与边界

- 当前配置尚未加载时保持按钮禁用。
- 表单校验失败时不保存。
- 保存失败时保留表单和可保存状态。
- 未知配置字段继续由现有 `extractOverrides` 流程保留。

## 验证

- 未修改时禁用。
- 修改后启用。
- 修改后改回原值再次禁用。
- 首次系统默认配置未修改时禁用。
- Advanced 与 Settings 保存成功后禁用。
- 上游 ID 文案明确说明其不是链 ID。
