import { useEffect, useMemo, useState } from "react";
import { DeleteOutlined, EditOutlined, ImportOutlined, PlayCircleOutlined, SaveOutlined } from "@ant-design/icons";
import { Alert, Button, Drawer, Empty, Form, Input, Modal, Popconfirm, Select, Space, Spin, Table, Tag, message } from "antd";
import { useApplyAlchemyAccount, useAlchemyAccount, useAlchemyAccounts, useDeleteAlchemyAccount, useImportAlchemyAccounts, useUpdateAlchemyAccount, useCurrentConfig, type AlchemyAccount } from "../app/api";
import { configSchema } from "../config/ConfigFields";
import { materializeEffectiveConfig } from "../config/document";

export type AlchemyPreviewRow = { email: string; apiKey: string };

export function parseAlchemyPreview(text: string): AlchemyPreviewRow[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  let values: unknown[];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    values = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    try {
      const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      values = lines.map((line) => JSON.parse(line));
    } catch {
      throw new Error("JSON 格式无效，请检查对象或 NDJSON 行内容");
    }
  }
  return values.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`第 ${index + 1} 条必须是 JSON 对象`);
    const row = value as Record<string, unknown>;
    const email = typeof row.email === "string" ? row.email.trim() : "";
    const apiKey = typeof row.api_key === "string" ? row.api_key.trim() : "";
    if (!email || !apiKey) throw new Error(`第 ${index + 1} 条缺少 email 或 api_key`);
    return { email, apiKey };
  });
}

export function AlchemyAccountsPage() {
  const [text, setText] = useState("");
  const [page, setPage] = useState(1);
  const [selectedID, setSelectedID] = useState(0);
  const [editOpen, setEditOpen] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [apiMessage, contextHolder] = message.useMessage();
  const accounts = useAlchemyAccounts(20, (page - 1) * 20);
  const detail = useAlchemyAccount(selectedID);
  const current = useCurrentConfig();
  const importer = useImportAlchemyAccounts();
  const updater = useUpdateAlchemyAccount();
  const remover = useDeleteAlchemyAccount();
  const applier = useApplyAlchemyAccount();
  const [form] = Form.useForm<{ name: string; payload: string }>();
  const [applyForm] = Form.useForm<{ projectId: string; networkMode: "all" | "only" | "ignore"; networks: string }>();
  const previewState = useMemo(() => {
    if (!text.trim()) return { rows: [] as AlchemyPreviewRow[], error: "" };
    try {
      return { rows: parseAlchemyPreview(text), error: "" };
    } catch (error) {
      return { rows: [] as AlchemyPreviewRow[], error: error instanceof Error ? error.message : "预览失败" };
    }
  }, [text]);
  const preview = previewState.rows;
  const previewError = previewState.error;
  const projects = useMemo(() => {
    const payload = current.data?.effectivePayload || materializeEffectiveConfig(current.data?.payload || {}, current.data?.defaultPayload || {}, configSchema);
    return Array.isArray(payload.projects) ? payload.projects.map((project) => project as Record<string, unknown>).filter((project) => typeof project.id === "string").map((project) => String(project.id)) : [];
  }, [current.data]);

  useEffect(() => {
    if (!editOpen || !detail.data?.payload) return;
    form.setFieldsValue({ name: detail.data.name, payload: JSON.stringify(detail.data.payload, null, 2) });
  }, [detail.data, editOpen, form]);

  function openEdit(account: AlchemyAccount) {
    setSelectedID(account.id);
    form.resetFields();
    form.setFieldsValue({ name: account.name, payload: "" });
    setEditOpen(true);
  }

  async function submitImport() {
    try {
      const result = await importer.mutateAsync(text);
      apiMessage.success(`已导入 ${result.created} 个账号，跳过 ${result.skipped} 个重复账号`);
      setText("");
      setPage(1);
    } catch (error) { apiMessage.error(error instanceof Error ? error.message : "导入失败"); }
  }

  async function submitEdit(values: { name: string; payload: string }) {
    if (!detail.data) return;
    try {
      const payload = JSON.parse(values.payload) as Record<string, unknown>;
      const email = String(payload.email || detail.data.email);
      const apiKey = String(payload.api_key || detail.data.apiKey);
      await updater.mutateAsync({ id: detail.data.id, input: { email, name: values.name.trim() || email, providerId: detail.data.providerId, apiKey, payload } });
      apiMessage.success("账号已更新");
      setEditOpen(false);
    } catch (error) { apiMessage.error(error instanceof Error ? error.message : "账号内容无效"); }
  }

  async function submitApply(values: { projectId: string; networkMode: "all" | "only" | "ignore"; networks: string }) {
    if (!selectedID) return;
    try {
      const revision = await applier.mutateAsync({ id: selectedID, input: { projectId: values.projectId, networkMode: values.networkMode, networks: values.networks?.split(/[,\n]/).map((item) => item.trim()).filter(Boolean) } });
      apiMessage.success(`已生成配置版本 v${revision.revision}，重启 eRPC 后生效`);
      setApplyOpen(false);
    } catch (error) { apiMessage.error(error instanceof Error ? error.message : "应用账号失败"); }
  }

  function confirmDelete(account: AlchemyAccount) {
    void remover.mutateAsync(account.id).then(() => apiMessage.success("账号已删除")).catch((error) => apiMessage.error(error instanceof Error ? error.message : "删除失败"));
  }

  return <section className="page-enter">
    {contextHolder}
    <div className="page-heading"><div><div className="eyebrow">凭据账号库</div><h1>Alchemy 账号</h1><p className="muted">先导入账号资料，再选择项目应用 API Key。导入和应用彼此独立，应用不会自动重启 eRPC。</p></div><Tag color="cyan">{accounts.data?.total || 0} 个账号</Tag></div>
    <div className="account-import-panel">
      <div className="provider-section-heading"><div><strong>粘贴导入</strong><p>支持单个 JSON、JSON 数组或每行一个 JSON 对象。未知字段会完整保存在 Admin 数据库。</p></div><Button type="primary" icon={<ImportOutlined />} disabled={!text.trim() || Boolean(previewError)} loading={importer.isPending} onClick={() => void submitImport()}>导入账号</Button></div>
      <Input.TextArea value={text} onChange={(event) => setText(event.target.value)} placeholder={'{"email":"name@example.com","api_key":"your-api-key"}'} autoSize={{ minRows: 5, maxRows: 12 }} />
      {previewError && <Alert type="error" showIcon message={previewError} className="mt-3" />}
      {preview.length > 0 && <Table<AlchemyPreviewRow> size="small" rowKey="email" pagination={false} dataSource={preview} className="ops-table mt-4" columns={[{ title: "邮箱", dataIndex: "email" }, { title: "API Key", dataIndex: "apiKey", render: (value) => <span className="mono">{value}</span> }]} />}
    </div>
    {accounts.isLoading ? <div className="center-state"><Spin size="large" /></div> : accounts.data?.items.length ? <Table<AlchemyAccount> rowKey="id" dataSource={accounts.data.items} loading={accounts.isFetching} className="ops-table" pagination={{ current: page, pageSize: 20, total: accounts.data.total, onChange: setPage, showSizeChanger: false }} columns={[{ title: "名称", dataIndex: "name", render: (value) => <strong>{value}</strong> }, { title: "邮箱", dataIndex: "email" }, { title: "API Key", dataIndex: "apiKey", render: (value) => <span className="mono">{value}</span> }, { title: "Provider ID", dataIndex: "providerId", render: (value) => <span className="mono">{value}</span> }, { title: "操作", key: "actions", render: (_, account) => <Space><Button size="small" icon={<PlayCircleOutlined />} onClick={() => { setSelectedID(account.id); applyForm.resetFields(); setApplyOpen(true); }}>应用到项目</Button><Button size="small" icon={<EditOutlined />} onClick={() => openEdit(account)}>编辑</Button><Popconfirm title="删除这个账号？" description="如果最新配置正在引用它，删除会被拒绝。" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => confirmDelete(account)}><Button size="small" danger icon={<DeleteOutlined />} /></Popconfirm></Space> }]} /> : <Empty description="暂无 Alchemy 账号，请先粘贴导入" />}
    <Drawer title="编辑 Alchemy 账号" open={editOpen} onClose={() => setEditOpen(false)} width={620} extra={<Button type="primary" icon={<SaveOutlined />} loading={updater.isPending} onClick={() => void form.submit()}>保存</Button>}><Form form={form} layout="vertical" onFinish={(values) => void submitEdit(values)}><Form.Item name="name" label="显示名称" rules={[{ required: true, message: "请输入显示名称" }]}><Input /></Form.Item><Form.Item name="payload" label="完整账号 JSON" rules={[{ required: true, message: "请输入 JSON" }]}><Input.TextArea autoSize={{ minRows: 16, maxRows: 30 }} /></Form.Item></Form></Drawer>
    <Modal title="应用 Alchemy 账号" open={applyOpen} onCancel={() => setApplyOpen(false)} onOk={() => void applyForm.submit()} confirmLoading={applier.isPending} okText="生成配置版本" cancelText="取消"><Form form={applyForm} layout="vertical" initialValues={{ networkMode: "all" }} onFinish={(values) => void submitApply(values)}><Form.Item name="projectId" label="目标项目" rules={[{ required: true, message: "请选择项目" }]}><Select placeholder="选择项目" options={projects.map((project) => ({ value: project, label: project }))} loading={current.isLoading} /></Form.Item><Form.Item name="networkMode" label="网络范围"><Select options={[{ value: "all", label: "全部网络" }, { value: "only", label: "仅包含指定网络" }, { value: "ignore", label: "排除指定网络" }]} /></Form.Item><Form.Item noStyle shouldUpdate>{({ getFieldValue }) => getFieldValue("networkMode") === "all" ? null : <Form.Item name="networks" label="网络标识" rules={[{ required: true, message: "请输入网络标识" }]}><Input placeholder="例如 evm:56, evm:1" /></Form.Item>}</Form.Item></Form></Modal>
  </section>;
}
