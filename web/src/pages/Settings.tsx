import { useEffect, useRef, useState } from "react";
import { Alert, Button, Form, Input, InputNumber, Select, Space, Spin, Switch, message } from "antd";
import { SaveOutlined } from "@ant-design/icons";
import { useCurrentConfig, useSaveConfig, type ConfigPayload } from "../app/api";
import { configSchema } from "../config/ConfigFields";
import { configDocumentsEqual, deleteOverride, extractOverrides, materializeEffectiveConfig } from "../config/document";

type SettingsForm = { logLevel: string; listenV4: boolean; httpHostV4: string; httpPortV4: number; listenV6: boolean; httpPortV6?: number; adminEnabled: boolean; adminSecretId?: string; adminSecretValue?: string; statePollerInterval?: string };

const LOG_LEVEL_OPTIONS = ["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL", "PANIC", "DISABLED"].map((value) => ({ value, label: value }));

export function SettingsPage() {
  const current = useCurrentConfig();
  const save = useSaveConfig();
  const [form] = Form.useForm<SettingsForm>();
  const [dirty, setDirty] = useState(false);
  const [apiMessage, contextHolder] = message.useMessage();
  const savedOverrides = useRef<ConfigPayload>({});
  const loadedRevision = useRef(0);
  const adminEnabled = Form.useWatch("adminEnabled", form);
  useEffect(() => {
    const revision = current.data?.revision || 0;
    if (current.isLoading || dirty || revision < loadedRevision.current) return;
    const payload = current.data?.effectivePayload || materializeEffectiveConfig(current.data?.payload || {}, current.data?.defaultPayload || {}, configSchema);
    const server = record(payload.server);
    const project = Array.isArray(payload.projects) ? record(payload.projects[0]) : {};
    const defaults = record(record(project.upstreamDefaults).evm);
    const admin = record(payload.admin);
    const strategies: unknown[] = Array.isArray(record(admin.auth).strategies) ? record(admin.auth).strategies : [];
    const secretStrategy = strategies.find((strategy) => record(strategy).type === "secret");
    const secret = record(record(secretStrategy).secret);
    form.setFieldsValue({
      logLevel: payload.logLevel == null ? undefined : String(payload.logLevel),
      listenV4: server.listenV4 == null ? undefined : Boolean(server.listenV4),
      httpHostV4: server.httpHostV4 == null ? undefined : String(server.httpHostV4),
      httpPortV4: server.httpPortV4 == null ? undefined : Number(server.httpPortV4),
      listenV6: server.listenV6 == null ? undefined : Boolean(server.listenV6),
      httpPortV6: server.httpPortV6 == null ? undefined : Number(server.httpPortV6),
      adminEnabled: payload.admin != null,
      adminSecretId: typeof secret.id === "string" ? secret.id : undefined,
      adminSecretValue: typeof secret.value === "string" && secret.value !== "REDACTED" ? secret.value : undefined,
      statePollerInterval: defaults.statePollerInterval == null ? undefined : String(defaults.statePollerInterval),
    });
    savedOverrides.current = current.data?.payload || {};
    loadedRevision.current = revision;
    setDirty(false);
  }, [current.data?.defaultPayload, current.data?.effectivePayload, current.data?.payload, current.data?.revision, current.isLoading, dirty, form]);

  function buildSettingsOverrides(values: SettingsForm): ConfigPayload {
    const payload = structuredClone(current.data?.effectivePayload || materializeEffectiveConfig(current.data?.payload || {}, current.data?.defaultPayload || {}, configSchema)) as ConfigPayload;
    const server = record(payload.server);
    Object.assign(server, { listenV4: values.listenV4, httpHostV4: values.httpHostV4, httpPortV4: values.httpPortV4, listenV6: values.listenV6 });
    if (values.httpPortV6) server.httpPortV6 = values.httpPortV6; else delete server.httpPortV6;
    payload.server = server;
    payload.logLevel = values.logLevel;
    if (values.adminEnabled) {
      const admin = record(payload.admin);
      const auth = record(admin.auth);
      const strategies = Array.isArray(auth.strategies) ? structuredClone(auth.strategies) : [];
      const secretIndex = strategies.findIndex((strategy) => record(strategy).type === "secret");
      if (values.adminSecretValue?.trim()) {
        const existing = secretIndex >= 0 ? record(strategies[secretIndex]) : {};
        strategies[secretIndex >= 0 ? secretIndex : strategies.length] = {
          ...existing,
          type: "secret",
          secret: { ...record(existing.secret), id: values.adminSecretId?.trim() || "admin", value: values.adminSecretValue.trim() },
        };
      }
      auth.strategies = strategies;
      admin.auth = auth;
      payload.admin = admin;
    }
    if (!values.adminEnabled) delete payload.admin;
    if (Array.isArray(payload.projects) && payload.projects.length > 0) {
      const project = record(payload.projects[0]);
      const upstreamDefaults = record(project.upstreamDefaults);
      const evm = record(upstreamDefaults.evm);
      if (values.statePollerInterval?.trim()) evm.statePollerInterval = values.statePollerInterval.trim();
      else delete evm.statePollerInterval;
      upstreamDefaults.evm = evm;
      project.upstreamDefaults = upstreamDefaults;
      payload.projects[0] = project;
    }
    let overrides = extractOverrides(payload, current.data?.defaultPayload || {}, configSchema, current.data?.payload || {});
    if (!values.statePollerInterval?.trim()) overrides = deleteOverride(overrides, ["projects", 0, "upstreamDefaults", "evm", "statePollerInterval"]);
    return overrides;
  }

  async function submit(values: SettingsForm) {
    const overrides = buildSettingsOverrides(values);
    if (configDocumentsEqual(overrides, savedOverrides.current)) return;
    try {
      const revision = await save.mutateAsync({ payload: overrides, baseRevision: loadedRevision.current });
      savedOverrides.current = overrides;
      loadedRevision.current = revision.revision;
      setDirty(false);
      apiMessage.success(`配置版本 v${revision.revision} 已保存`);
    } catch (error) { apiMessage.error(error instanceof Error ? error.message : "保存失败"); }
  }

  if (current.isLoading) return <div className="center-state"><Spin size="large" /></div>;
  if (!current.data?.revision) return <Alert type="info" showIcon message="请先在“完整配置”中完成首次配置" />;
  return <section className="page-enter settings-page">
    {contextHolder}
    <div className="page-heading"><div><div className="eyebrow">常用运行参数</div><h1>服务设置</h1><p className="muted">修改后保存为新版本，重启 eRPC 后生效。</p></div></div>
    <Form form={form} layout="vertical" onValuesChange={(_, values) => setDirty(!configDocumentsEqual(buildSettingsOverrides(values), savedOverrides.current))} onFinish={(values) => void submit(values)} className="settings-form">
      <div className="settings-section"><h2>HTTP 服务</h2><div className="form-grid"><Form.Item name="listenV4" label="启用 IPv4" valuePropName="checked"><Switch /></Form.Item><Form.Item name="httpHostV4" label="IPv4 监听地址" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="httpPortV4" label="IPv4 HTTP 端口" rules={[{ required: true }]}><InputNumber min={1} max={65535} className="w-full" /></Form.Item><Form.Item name="listenV6" label="启用 IPv6" valuePropName="checked"><Switch /></Form.Item><Form.Item name="httpPortV6" label="IPv6 HTTP 端口"><InputNumber min={1} max={65535} className="w-full" /></Form.Item></div></div>
      <div className="settings-section"><h2>运维与轮询</h2><div className="form-grid"><Form.Item name="adminEnabled" label="启用 eRPC Admin 接口" valuePropName="checked"><Switch /></Form.Item><Form.Item name="logLevel" label="日志级别"><Select allowClear options={LOG_LEVEL_OPTIONS} /></Form.Item><Form.Item name="statePollerInterval" label="首个项目默认状态轮询周期"><Input allowClear placeholder="例如 30s；留空使用系统默认" /></Form.Item><Form.Item name="adminSecretId" label="eRPC Admin 密钥标识" extra="用于 eRPC 内部管理认证；不是 Admin Web 登录账号。"><Input disabled={!adminEnabled} placeholder="例如 admin" /></Form.Item><Form.Item name="adminSecretValue" label="eRPC Admin 内部密钥" extra="启用管理接口时必填；Admin 用它读取拓扑、健康和上游状态。" rules={[({ getFieldValue }) => ({ required: Boolean(getFieldValue("adminEnabled")), whitespace: true, message: "启用 eRPC Admin 接口时请输入内部密钥" })]}><Input.Password disabled={!adminEnabled} autoComplete="new-password" placeholder="请输入 eRPC 管理密钥" /></Form.Item></div></div>
      <Space><Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={save.isPending} disabled={!dirty}>保存新版本</Button></Space>
    </Form>
  </section>;
}

function record(value: unknown): Record<string, any> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}; }
