import { useEffect, useRef, useState } from "react";
import { DeleteOutlined, EditOutlined, PlusOutlined, SyncOutlined } from "@ant-design/icons";
import { Alert, AutoComplete, Button, Drawer, Form, Input, Modal, Popconfirm, Select, Space, Spin, Table, Tag, Tooltip, message } from "antd";
import { useCurrentConfig, useSaveConfig, useValidateConfig, type ConfigPayload } from "../app/api";
import { configSchema } from "../config/ConfigFields";
import { extractOverrides, materializeEffectiveConfig, type ConfigSchema } from "../config/document";
import {
  addProvider,
  decodeProviderOverrides,
  listProviders,
  mergeProviderSettings,
  providerDefinition,
  providerOptions,
  removeProvider,
  splitProviderSettings,
  updateProvider,
  encodeProviderOverrides,
  type ExtraSettingRow,
  type NetworkMode,
  type ProviderOverrideFormRow,
  type ProviderRow,
} from "../config/providers";
import { addUpstream, listUpstreams, randomUniqueId, removeUpstream, updateUpstream, type UpstreamRow } from "../config/upstreams";
import { ProviderFormFields } from "./ProviderFormFields";

type DirectRow = UpstreamRow & { kind: "upstream" };
type ConnectionRow = DirectRow | ProviderRow;
type EditorState = ConnectionRow | "new" | null;
type ConnectionForm = {
  accessMode: string;
  projectIndex: number;
  id: string;
  endpoint?: string;
  type?: string;
  vendor?: string;
  settings?: Record<string, unknown>;
  extraSettings?: ExtraSettingRow[];
  networkMode?: NetworkMode;
  networks?: string[];
  upstreamIdTemplate?: string;
  overrides?: ProviderOverrideFormRow[];
};

const upstreamSchema: ConfigSchema = { ...configSchema, root: { kind: "object", ref: "UpstreamConfig" } };

export function UpstreamsPage() {
  const current = useCurrentConfig();
  const save = useSaveConfig();
  const validate = useValidateConfig();
  const [editing, setEditing] = useState<EditorState>(null);
  const [form] = Form.useForm<ConnectionForm>();
  const [apiMessage, messageContext] = message.useMessage();
  const [modal, modalContext] = Modal.useModal();
  const loadedRevision = useRef(0);
  const selectedVendor = useRef("");
  const vendorChangePending = useRef(false);
  const accessMode = Form.useWatch("accessMode", form) || "custom";
  const vendor = Form.useWatch("vendor", form) || (accessMode === "custom" ? "" : accessMode);
  const networkMode = Form.useWatch("networkMode", form) || "all";
  const payload = current.data?.effectivePayload || materializeEffectiveConfig(current.data?.payload || {}, current.data?.defaultPayload || {}, configSchema);
  const projects = Array.isArray(payload?.projects) ? payload.projects.map(record) : [];
  const directRows: DirectRow[] = listUpstreams(payload).map((row) => ({ ...row, kind: "upstream" }));
  const providerRows = listProviders(payload);
  const rows: ConnectionRow[] = [...directRows, ...providerRows].sort((left, right) => left.projectIndex - right.projectIndex || left.id.localeCompare(right.id));

  useEffect(() => {
    const revision = current.data?.revision || 0;
    if (revision > loadedRevision.current) loadedRevision.current = revision;
  }, [current.data?.revision]);

  function openEditor(row?: ConnectionRow) {
    if (!row) {
      selectedVendor.current = "";
      setEditing("new");
      form.resetFields();
      form.setFieldsValue({
        accessMode: "custom",
        projectIndex: 0,
        id: "",
        endpoint: "",
        type: "evm",
        vendor: "",
        settings: {},
        extraSettings: [],
        networkMode: "all",
        networks: [],
        upstreamIdTemplate: "<PROVIDER>-<NETWORK>",
        overrides: [],
      });
      return;
    }
    setEditing(row);
    form.resetFields();
    if (row.kind === "upstream") {
      selectedVendor.current = "";
      form.setFieldsValue({ accessMode: "custom", projectIndex: row.projectIndex, id: row.id, endpoint: row.endpoint, type: row.type || "" });
      return;
    }
    const settings = splitProviderSettings(row.vendor, record(row.raw.settings));
    selectedVendor.current = row.vendor;
    form.setFieldsValue({
      accessMode: row.vendor,
      projectIndex: row.projectIndex,
      id: row.id,
      vendor: row.vendor,
      settings: settings.known,
      extraSettings: settings.extra,
      networkMode: row.networkMode,
      networks: row.networks,
      upstreamIdTemplate: String(row.raw.upstreamIdTemplate || "<PROVIDER>-<NETWORK>"),
      overrides: encodeProviderOverrides(record(row.raw.overrides), upstreamSchema),
    });
  }

  function closeEditor() {
    setEditing(null);
    form.resetFields();
  }

  function changeAccessMode(value: string) {
    if (editing !== "new") return;
    if (value === "custom") {
      selectedVendor.current = "";
      form.setFieldsValue({ vendor: "", settings: {}, extraSettings: [] });
      return;
    }
    selectedVendor.current = value;
    form.setFieldsValue({ vendor: value, settings: {}, extraSettings: [] });
  }

  async function selectVendor(value: string) {
    const nextVendor = value.trim();
    const previousVendor = selectedVendor.current;
    if (!nextVendor) {
      form.setFieldValue("vendor", previousVendor);
      return;
    }
    if (!previousVendor || previousVendor === nextVendor || editing === "new") {
      selectedVendor.current = nextVendor;
      form.setFieldsValue({ vendor: nextVendor, settings: {}, extraSettings: [] });
      return;
    }
    if (vendorChangePending.current) return;
    vendorChangePending.current = true;
    form.setFieldValue("vendor", previousVendor);
    try {
      const confirmed = await modal.confirm({
        title: "切换 RPC 厂商？",
        content: "厂商专用参数会被清空，网络范围、节点名称模板和覆盖配置会保留。",
        okText: "切换并清空",
        cancelText: "取消",
      });
      if (confirmed) {
        selectedVendor.current = nextVendor;
        form.setFieldsValue({ vendor: nextVendor, settings: {}, extraSettings: [] });
      }
    } finally {
      vendorChangePending.current = false;
    }
  }

  function generateId() {
    const projectIndex = Number(form.getFieldValue("projectIndex") || 0);
    const existing = new Set(rows.filter((row) => row.projectIndex === projectIndex).map((row) => row.id));
    const source = accessMode === "custom" ? "rpc" : vendor || accessMode || "provider";
    const prefix = source.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "provider";
    form.setFieldValue("id", randomUniqueId(prefix, existing));
  }

  async function persist(nextPayload: ConfigPayload, success: string) {
    const overrides = extractOverrides(nextPayload, current.data?.defaultPayload || {}, configSchema, current.data?.payload || {});
    const validation = await validate.mutateAsync({ payload: overrides });
    if (!validation.valid) throw new Error(validation.errors[0] || "配置校验未通过");
    const revision = await save.mutateAsync({ payload: overrides, baseRevision: loadedRevision.current || current.data?.revision || 0 });
    loadedRevision.current = revision.revision;
    apiMessage.success(`${success}，已生成版本 v${revision.revision}`);
    closeEditor();
  }

  async function submit(values: ConnectionForm) {
    try {
      const editingRow = editing === "new" ? null : editing;
      const providerMode = editingRow ? editingRow.kind === "provider" : values.accessMode !== "custom";
      let next: ConfigPayload;
      if (providerMode) {
        const providerVendor = String(values.vendor || values.accessMode || "").trim();
        const input = {
          projectIndex: values.projectIndex,
          id: values.id,
          vendor: providerVendor,
          settings: mergeProviderSettings(providerVendor, record(values.settings), values.extraSettings || []),
          networkMode: values.networkMode || "all",
          networks: values.networks || [],
          upstreamIdTemplate: values.upstreamIdTemplate || "",
          overrides: decodeProviderOverrides(values.overrides || [], upstreamSchema),
        };
        next = editingRow?.kind === "provider" ? updateProvider(payload, editingRow, input) : addProvider(payload, input);
      } else {
        const input = { projectIndex: values.projectIndex, id: values.id, endpoint: values.endpoint || "", type: values.type || "" };
        next = editingRow?.kind === "upstream" ? updateUpstream(payload, editingRow, input) : addUpstream(payload, input);
      }
      await persist(next, editing === "new" ? "接入项已添加" : "接入项已更新");
    } catch (error) {
      apiMessage.error(error instanceof Error ? error.message : "保存失败");
    }
  }

  async function remove(row: ConnectionRow) {
    try {
      const next = row.kind === "provider" ? removeProvider(payload, row) : removeUpstream(payload, row);
      await persist(next, row.kind === "provider" ? "厂商实例已删除" : "RPC 节点已删除");
    } catch (error) {
      apiMessage.error(error instanceof Error ? error.message : "删除失败");
    }
  }

  if (current.isLoading) return <div className="center-state"><Spin size="large" /></div>;
  if (!current.data?.revision) return <Alert type="info" showIcon message="请先在“完整配置”中完成首次配置" />;
  return <section className="page-enter">
    {messageContext}
    {modalContext}
    <div className="page-heading">
      <div><div className="eyebrow">持久配置</div><h1>上游管理</h1><p className="muted">统一管理 {directRows.length} 个自定义 RPC 节点和 {providerRows.length} 个厂商实例，当前配置版本 v{current.data.revision}。</p></div>
      <Button type="primary" icon={<PlusOutlined />} disabled={projects.length === 0} onClick={() => openEditor()}>添加上游</Button>
    </div>
    <Table<ConnectionRow>
      rowKey="key"
      dataSource={rows}
      className="ops-table"
      pagination={{ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: [20, 50, 100], showTotal: (total) => `共 ${total} 项` }}
      scroll={{ x: 920 }}
      columns={[
        { title: "名称", dataIndex: "id", width: 220, render: (value) => <strong>{value || "未命名"}</strong> },
        { title: "项目", dataIndex: "projectId", width: 160, render: (value) => <span className="mono">{value}</span> },
        { title: "接入方式", key: "mode", width: 170, render: (_, row) => row.kind === "provider" ? <Tag color="cyan">厂商 · {providerDefinition(row.vendor).label}</Tag> : <Tag>自定义 RPC 节点</Tag> },
        { title: "连接与参数", key: "config", ellipsis: true, render: (_, row) => row.kind === "provider" ? <span className="muted">已配置 {Object.keys(record(row.raw.settings)).length} 个厂商参数</span> : <span className="mono endpoint-cell">{safeEndpointSummary(row.endpoint)}</span> },
        { title: "网络范围", key: "networks", width: 180, render: (_, row) => row.kind === "provider" ? networkSummary(row) : <span className="muted">由节点配置决定</span> },
        { title: "操作", key: "action", width: 120, fixed: "right", render: (_, row) => <Space><Tooltip title="编辑"><Button size="small" icon={<EditOutlined />} onClick={() => openEditor(row)} /></Tooltip><Popconfirm title={`删除 ${row.id || "该接入项"}？`} description="保存后会生成一个新的配置版本。" okText="删除" cancelText="取消" onConfirm={() => void remove(row)}><Tooltip title="删除"><Button size="small" danger icon={<DeleteOutlined />} /></Tooltip></Popconfirm></Space> },
      ]}
    />
    <Drawer
      title={editing === "new" ? "添加上游" : "编辑上游"}
      open={Boolean(editing)}
      onClose={closeEditor}
      width="min(760px, 100vw)"
      destroyOnHidden
      extra={<Button type="primary" loading={save.isPending || validate.isPending} onClick={() => form.submit()}>保存新版本</Button>}
    >
      <Form form={form} layout="vertical" onFinish={(values) => void submit(values)}>
        <Form.Item name="projectIndex" label="所属项目" rules={[{ required: true, message: "请选择所属项目" }]}><Select disabled={editing !== "new"} options={projects.map((project, index) => ({ value: index, label: String(project.id || `项目 ${index + 1}`) }))} /></Form.Item>
        <Form.Item name="accessMode" label="接入方式" extra="选择自定义 RPC 地址，或让 eRPC 从厂商自动发现可用网络与节点。" rules={[{ required: true, message: "请选择接入方式" }]}>
          <AutoComplete
            disabled={editing !== "new"}
            options={[{ value: "custom", label: "自定义 RPC 节点" }, ...providerOptions().map((option) => ({ ...option, label: `厂商 ${option.label}` }))]}
            onChange={(value) => changeAccessMode(String(value))}
            filterOption={(input, option) => String(option?.label || option?.value || "").toLowerCase().includes(input.toLowerCase())}
            placeholder="选择自定义节点或 RPC 厂商"
          />
        </Form.Item>
        <Form.Item name="id" label="名称（唯一标识）" extra="这是同一项目内的唯一名称，不是链 ID，也不是 RPC 服务厂商。" rules={[{ required: true, whitespace: true, message: "请输入名称" }]}>
          <Space.Compact block><Input placeholder={accessMode === "custom" ? "例如 bsc-mainnet-1" : "例如 alchemy-main"} /><Tooltip title="随机生成"><Button aria-label="随机生成" icon={<SyncOutlined />} onClick={generateId} /></Tooltip></Space.Compact>
        </Form.Item>
        {accessMode === "custom" ? <>
          <Form.Item name="type" label="协议类型" extra="节点协议类型（如 evm、svm），不是 RPC 服务厂商。"><AutoComplete allowClear options={[{ value: "evm", label: "EVM" }, { value: "svm", label: "SVM" }]} placeholder="例如 evm、svm；也可填写 eRPC 支持的其他类型" /></Form.Item>
          <Form.Item name="endpoint" label="RPC 地址" extra="可填写任意 HTTP/HTTPS RPC，包括完整的 Alchemy RPC URL。" rules={[{ required: true, whitespace: true, message: "请输入 RPC 地址" }]}><Input.Password visibilityToggle autoComplete="off" /></Form.Item>
        </> : <ProviderFormFields vendor={vendor} networkMode={networkMode} onVendorSelected={selectVendor} />}
      </Form>
    </Drawer>
  </section>;
}

function safeEndpointSummary(value: string): string {
  try {
    const parsed = new URL(value);
    return `${parsed.protocol}//${parsed.host}/…`;
  } catch {
    return value ? "已配置 RPC 地址" : "未配置";
  }
}

function networkSummary(row: ProviderRow) {
  if (row.networkMode === "all") return <span className="muted">全部网络</span>;
  return <span className="muted">{row.networkMode === "only" ? "仅指定" : "排除"} {row.networks.length} 个网络</span>;
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}
