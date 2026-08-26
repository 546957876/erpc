import { useEffect, useRef, useState } from "react";
import { Alert, Button, Form, Space, Spin, Tag, message } from "antd";
import { CheckCircleOutlined, SaveOutlined } from "@ant-design/icons";
import { useCurrentConfig, useSaveConfig, useValidateConfig, type ConfigPayload, type ValidationResult } from "../app/api";
import { ConfigFields, configSchema } from "../config/ConfigFields";
import { configDocumentsEqual, createInitialConfig, deleteOverride, extractOverrides, fromFormDocument, materializeEffectiveConfig, toFormDocument, valueAtPath } from "../config/document";

export function AdvancedPage() {
  const current = useCurrentConfig();
  const validate = useValidateConfig();
  const save = useSaveConfig();
  const [form] = Form.useForm<ConfigPayload>();
  const [dirty, setDirty] = useState(false);
  const [draftOverrides, setDraftOverrides] = useState<ConfigPayload>({});
  const [result, setResult] = useState<ValidationResult>();
  const [apiMessage, contextHolder] = message.useMessage();
  const savedOverrides = useRef<ConfigPayload>({});
  const loadedRevision = useRef(0);

  useEffect(() => {
    const revision = current.data?.revision || 0;
    if (current.isLoading || dirty || revision < loadedRevision.current) return;
    const overrides = current.data?.payload || createInitialConfig();
    const defaults = current.data?.defaultPayload || {};
    const effective = current.data?.effectivePayload || materializeEffectiveConfig(overrides, defaults, configSchema);
    form.setFieldsValue(toFormDocument(effective, configSchema));
    savedOverrides.current = overrides;
    loadedRevision.current = revision;
    setDraftOverrides(overrides);
  }, [current.data?.defaultPayload, current.data?.effectivePayload, current.data?.payload, current.data?.revision, current.isLoading, dirty, form]);

  function updateDraft(next: ConfigPayload) {
    setDraftOverrides(next);
    setDirty(!configDocumentsEqual(next, savedOverrides.current));
  }

  async function buildPayload() {
    const formValue = await form.validateFields();
    const edited = fromFormDocument(formValue, configSchema);
    const defaults = current.data?.defaultPayload || {};
    const next = extractOverrides(edited, defaults, configSchema, draftOverrides);
    updateDraft(next);
    return next;
  }

  async function runValidation() {
    try {
      const payload = await buildPayload();
      const next = await validate.mutateAsync({ payload });
      setResult(next);
      return { result: next, payload };
    } catch (error) {
      apiMessage.error(error instanceof Error ? error.message : "配置校验失败");
      return undefined;
    }
  }

  async function saveRevision() {
    const validation = await runValidation();
    if (!validation?.result.valid) return;
    try {
      const revision = await save.mutateAsync({ payload: validation.payload, baseRevision: loadedRevision.current });
      savedOverrides.current = validation.payload;
      loadedRevision.current = revision.revision;
      updateDraft(validation.payload);
      apiMessage.success(`配置版本 v${revision.revision} 已保存`);
    } catch (error) {
      apiMessage.error(error instanceof Error ? error.message : "保存失败");
    }
  }

  if (current.isLoading) return <div className="center-state"><Spin size="large" /></div>;
  const firstSetup = !current.data?.revision || (current.data?.createdBy === "system-default" && isEmptyPayload(current.data?.payload));
  return <section className="page-enter">
    {contextHolder}
    <div className="page-heading"><div><div className="eyebrow">字段化配置</div><h1>完整配置</h1><p className="muted">{firstSetup ? "首次配置：填写节点信息后保存为版本 v1。" : `当前表单基于版本 v${current.data?.revision}，修改后重启 eRPC 生效。`}</p></div><Space><Button icon={<CheckCircleOutlined />} loading={validate.isPending} onClick={() => void runValidation()}>校验</Button><Button type="primary" icon={<SaveOutlined />} loading={save.isPending} disabled={!dirty} onClick={() => void saveRevision()}>保存新版本</Button></Space></div>
    {current.isError && <Alert type="error" showIcon message="无法读取配置" description={current.error.message} className="mb-4" />}
    {firstSetup && <Alert type="info" showIcon message="首次配置" description="基础监听参数已预填。请在“项目”中填写 RPC 地址和链 ID，校验通过后即可保存。" className="mb-4" />}
    {result && <ValidationSummary result={result} />}
    <Form form={form} layout="vertical" onValuesChange={() => { setResult(undefined); const edited = fromFormDocument(form.getFieldsValue(true), configSchema); updateDraft(extractOverrides(edited, current.data?.defaultPayload || {}, configSchema, draftOverrides)); }} className="structured-config-form"><ConfigFields overrides={draftOverrides} defaults={current.data?.defaultPayload || {}} onReset={(path) => { const value = valueAtPath(current.data?.defaultPayload || {}, path); form.setFieldValue(path, value.exists ? value.value : undefined); updateDraft(deleteOverride(draftOverrides, path)); setResult(undefined); }} /></Form>
    <div className="config-save-bar"><span>{dirty ? "有未保存修改" : firstSetup ? "使用系统默认配置" : "已与最新版本同步"}</span><Button type="primary" icon={<SaveOutlined />} loading={save.isPending} disabled={!dirty} onClick={() => void saveRevision()}>保存新版本</Button></div>
  </section>;
}

function isEmptyPayload(payload?: ConfigPayload): boolean {
  return !payload || Object.keys(payload).length === 0;
}

function ValidationSummary({ result }: { result: ValidationResult }) {
  const errors = Array.isArray(result.errors) ? result.errors : [];
  const warnings = Array.isArray(result.warnings) ? result.warnings : [];
  if (result.valid && warnings.length === 0) return <Alert type="success" showIcon message="配置校验通过" className="mb-4" />;
  return <Alert type={result.valid ? "warning" : "error"} showIcon message={result.valid ? "配置可用，但存在警告" : "配置校验未通过"} description={<Space direction="vertical" size={4}>{errors.map((item) => <span key={item}>{item}</span>)}{warnings.map((item) => <Tag color="gold" key={item}>{item}</Tag>)}</Space>} className="mb-4" />;
}
