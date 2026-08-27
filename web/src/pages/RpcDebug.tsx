import { useEffect, useMemo, useRef, useState } from "react";
import { CopyOutlined, PlayCircleOutlined } from "@ant-design/icons";
import { Alert, AutoComplete, Button, Form, Input, Segmented, Select, Space, Spin, Switch, Tag, message } from "antd";
import {
  useCurrentConfig,
  useRuntimeRPCTest,
  useSavedUpstreamTest,
  useTargets,
  useTaxonomy,
  type ConfigPayload,
  type ConfigRevision,
  type Project,
  type RpcTestResult,
} from "../app/api";
import { listUpstreams, type UpstreamRow } from "../config/upstreams";
import { listProviders, renderProviderUpstreamID } from "../config/providers";

export const RPC_NETWORK_PRESETS = [
  { value: "evm:1", label: "Ethereum 主网" },
  { value: "evm:56", label: "BNB Smart Chain 主网" },
  { value: "evm:4663", label: "Robinhood 主网" },
  { value: "svm:mainnet-beta", label: "Solana 主网" },
];

type DebugMode = "saved" | "runtime";
type DebugForm = {
  projectId: string;
  upstreamId?: string;
  networkId?: string;
  projectSecret?: string;
  method: string;
  params: string;
};

export function parseRPCParams(value: string): unknown[] | Record<string, unknown> {
  if (!value.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("请求参数必须是合法 JSON");
  }
  if (!Array.isArray(parsed) && (parsed === null || typeof parsed !== "object")) {
    throw new Error("请求参数必须是 JSON 数组或对象");
  }
  return parsed as unknown[] | Record<string, unknown>;
}

export function formatRPCBody(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

export function rpcResultSucceeded(result: RpcTestResult): boolean {
  if (result.httpStatus < 200 || result.httpStatus >= 300) return false;
  try {
    const body = JSON.parse(result.body) as Record<string, unknown>;
    return Boolean(body && !Array.isArray(body) && body.error == null && Object.prototype.hasOwnProperty.call(body, "result"));
  } catch {
    return false;
  }
}

export function buildPublicRPCUrl(baseURL: string, projectID: string, networkID: string): string {
  const separator = networkID.indexOf(":");
  if (!baseURL.trim() || !projectID.trim() || separator <= 0 || separator === networkID.length - 1) return "";
  const architecture = networkID.slice(0, separator);
  const network = networkID.slice(separator + 1);
  return `${baseURL.trim().replace(/\/+$/, "")}/${encodeURIComponent(projectID.trim())}/${encodeURIComponent(architecture)}/${encodeURIComponent(network)}`;
}

export function effectiveRPCPort(payload: Record<string, unknown>): number {
  const value = Number(record(record(payload).server).httpPortV4);
  return Number.isInteger(value) && value > 0 && value <= 65535 ? value : 4000;
}

export function effectiveRPCScheme(payload: ConfigPayload): "http" | "https" {
  return record(record(record(payload).server).tls).enabled === true ? "https" : "http";
}

export function detectPublicRPCBaseURL(targetBaseURL: string | undefined, payload: ConfigPayload, location: { hostname?: string } = typeof window === "undefined" ? {} : window.location): string {
  if (targetBaseURL?.trim()) {
    try {
      const parsed = new URL(targetBaseURL.trim());
      if ((parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.hostname) {
        parsed.pathname = parsed.pathname.replace(/\/admin\/?$/, "").replace(/\/+$/, "");
        parsed.search = "";
        parsed.hash = "";
        return parsed.toString().replace(/\/$/, "");
      }
    } catch {
      // Fall through to the local configuration-derived address.
    }
  }
  const hostname = location.hostname?.trim() || "127.0.0.1";
  return `${effectiveRPCScheme(payload)}://${hostname}:${effectiveRPCPort(payload)}`;
}

export function buildRPCCommands(url: string, method: string, params: unknown[] | Record<string, unknown>, projectSecret = "") {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  const quotedURL = url.replaceAll("'", "''");
  const quotedBody = body.replaceAll("'", "''");
  const quotedSecret = projectSecret.replaceAll("'", "''");
  const powershellHeaders = projectSecret ? ` -Headers @{ 'X-ERPC-Secret-Token' = '${quotedSecret}' }` : "";
  const curlHeaders = projectSecret ? ` -H 'X-ERPC-Secret-Token: ${quotedSecret}'` : "";
  return {
    powershell: `$body = '${quotedBody}'\nInvoke-RestMethod -Method Post -Uri '${quotedURL}' -ContentType 'application/json'${powershellHeaders} -Body $body`,
    curl: `curl.exe -X POST '${quotedURL}' -H 'Content-Type: application/json'${curlHeaders} --data-raw '${quotedBody}'`,
  };
}

export function secretForCopiedCommand(projectSecret: string, includeRealSecret: boolean): string {
  if (!projectSecret) return "";
  return includeRealSecret ? projectSecret : "<PROJECT_SECRET>";
}

export function runtimeProjectIDs(taxonomyProjects: Project[], payload: ConfigPayload): string[] {
  const configuredProjects = Array.isArray(payload.projects)
    ? payload.projects.flatMap((project) => {
      const id = record(project).id;
      return typeof id === "string" && id.trim() ? [id] : [];
    })
    : [];
  return [...new Set([...taxonomyProjects.map((project) => project.id), ...configuredProjects])];
}

export function runtimeUpstreamIDs(taxonomyProjects: Project[], payload: ConfigPayload, projectID: string, networkID: string): string[] {
  const runtime = taxonomyProjects
    .find((project) => project.id === projectID)
    ?.networks
    .flatMap((network) => Array.isArray(network.upstreams) ? network.upstreams.map((upstream) => upstream.id) : []) || [];
  const saved = listUpstreams(payload)
    .filter((row) => row.projectId === projectID)
    .map((row) => row.id);
  const generated = networkID.trim()
    ? listProviders(payload)
      .filter((row) => row.projectId === projectID && providerAllowsNetwork(row.networkMode, row.networks, networkID))
      .map((row) => renderProviderUpstreamID(String(row.raw.upstreamIdTemplate || "<PROVIDER>-<NETWORK>"), row.vendor, row.id || row.vendor, networkID))
    : [];
  return [...new Set([...runtime, ...saved, ...generated].filter(Boolean))];
}

export function savedUpstreamRows(config: Pick<ConfigRevision, "payload" | "effectivePayload">): UpstreamRow[] {
  return listUpstreams(config.effectivePayload || config.payload || {}).filter((row) => Boolean(row.endpoint));
}

export type SavedRequestToken = { revision: number; sequence: number };

export function savedRequestIsCurrent(token: SavedRequestToken, currentRevision: number, currentSequence: number): boolean {
  return token.revision === currentRevision && token.sequence === currentSequence;
}

export function savedResultForRevision<T>(result: T | null, resultRevision: number, currentRevision: number): T | null {
  return resultRevision === currentRevision ? result : null;
}

export function RpcDebugPage() {
  const current = useCurrentConfig();
  const targets = useTargets();
  const [mode, setMode] = useState<DebugMode>("runtime");
  const [targetID, setTargetID] = useState("");
  const activeTargetID = targetID || targets.data?.[0]?.id || "";
  const taxonomy = useTaxonomy(activeTargetID);
  const savedTest = useSavedUpstreamTest();
  const runtimeTest = useRuntimeRPCTest(activeTargetID);
  const [result, setResult] = useState<RpcTestResult | null>(null);
  const [error, setError] = useState("");
  const [publicBaseURL, setPublicBaseURL] = useState(() => detectPublicRPCBaseURL(undefined, {}));
  const [publicBaseEdited, setPublicBaseEdited] = useState(false);
  const [includeSecretInCommands, setIncludeSecretInCommands] = useState(false);
  const [form] = Form.useForm<DebugForm>();
  const [apiMessage, contextHolder] = message.useMessage();
  const requestSequence = useRef(0);
  const modeRef = useRef<DebugMode>(mode);
  const currentRevision = current.data?.revision || 0;
  const currentRevisionRef = useRef(currentRevision);
  const previousRevisionRef = useRef(currentRevision);
  currentRevisionRef.current = currentRevision;
  const projectID = Form.useWatch("projectId", form) || "";
  const networkID = Form.useWatch("networkId", form) || "";
  const method = Form.useWatch("method", form) || "";
  const paramsText = Form.useWatch("params", form) || "";
  const projectSecret = Form.useWatch("projectSecret", form) || "";

  const savedRows = useMemo(() => savedUpstreamRows(current.data || {}), [current.data?.effectivePayload, current.data?.payload]);
  const savedProjects = useMemo(() => [...new Set(savedRows.map((row) => row.projectId))], [savedRows]);
  const runtimeProjects = useMemo(() => Array.isArray(taxonomy.data?.projects) ? taxonomy.data.projects : [], [taxonomy.data?.projects]);
  const currentEffective = current.data?.effectivePayload || current.data?.payload || {};
  const availableProjectIDs = useMemo(() => mode === "saved" ? savedProjects : runtimeProjectIDs(runtimeProjects, currentEffective), [currentEffective, mode, runtimeProjects, savedProjects]);
  const projectOptions = availableProjectIDs.map((value) => ({ value, label: value }));
  const upstreamOptions = mode === "saved"
    ? savedRows.filter((row) => row.projectId === projectID).map((row) => ({ value: row.id, label: row.id }))
    : runtimeUpstreamIDs(runtimeProjects, currentEffective, projectID, networkID).map((value) => ({ value, label: value }));
  const activeTarget = targets.data?.find((target) => target.id === activeTargetID);
  const requestURL = buildPublicRPCUrl(publicBaseURL, projectID, networkID);
  const detectedBaseURL = detectPublicRPCBaseURL(activeTarget?.baseUrl, currentEffective);
  const testing = savedTest.isPending || runtimeTest.isPending;
  const commands = useMemo(() => {
    if (!requestURL || !method.trim()) return null;
    try { return buildRPCCommands(requestURL, method, parseRPCParams(paramsText), secretForCopiedCommand(projectSecret, includeSecretInCommands)); }
    catch { return null; }
  }, [includeSecretInCommands, method, paramsText, projectSecret, requestURL]);

  useEffect(() => {
    if (!publicBaseEdited) setPublicBaseURL(detectedBaseURL);
  }, [detectedBaseURL, publicBaseEdited]);

  useEffect(() => {
    const modeChanged = modeRef.current !== mode;
    modeRef.current = mode;
    const currentProject = form.getFieldValue("projectId") || "";
    if (!modeChanged && currentProject && availableProjectIDs.includes(currentProject)) return;
    requestSequence.current += 1;
    form.setFieldsValue({ projectId: availableProjectIDs[0] || "", upstreamId: undefined, projectSecret: undefined });
    setIncludeSecretInCommands(false);
    setResult(null);
    setError("");
  }, [availableProjectIDs, form, mode]);

  useEffect(() => {
    const previousRevision = previousRevisionRef.current;
    const revisionChanged = previousRevision !== currentRevision;
    previousRevisionRef.current = currentRevision;
    if (!revisionChanged || mode !== "saved") return;
    requestSequence.current += 1;
    setResult((previous) => savedResultForRevision(previous, previousRevision, currentRevision));
    setError("");
  }, [currentRevision, mode]);

  function invalidateResult() {
    requestSequence.current += 1;
    setResult(null);
    setError("");
  }

  async function run(values: DebugForm) {
    const sequence = ++requestSequence.current;
    const requestMode = mode;
    const requestToken: SavedRequestToken = { revision: currentRevision, sequence };
    const requestIsCurrent = () => requestMode !== "saved"
      ? sequence === requestSequence.current
      : savedRequestIsCurrent(requestToken, currentRevisionRef.current, requestSequence.current);
    setError("");
    setResult(null);
    try {
      const params = parseRPCParams(values.params || "");
      const response = requestMode === "saved"
        ? await savedTest.mutateAsync({ revision: currentRevision, projectId: values.projectId, upstreamId: values.upstreamId || "", method: values.method, params })
        : await runtimeTest.mutateAsync({ projectId: values.projectId, networkId: values.networkId || "", upstreamId: values.upstreamId || undefined, projectSecret: values.projectSecret || undefined, method: values.method, params });
      if (requestIsCurrent()) setResult(response);
    } catch (cause) {
      if (requestIsCurrent()) setError(cause instanceof Error ? cause.message : "RPC 测试失败");
    }
  }

  function chooseNetwork(value: string) {
    form.setFieldValue("networkId", value);
    if (value.startsWith("svm:")) form.setFieldValue("method", "getHealth");
    else if (value.startsWith("evm:")) form.setFieldValue("method", "eth_chainId");
  }

  async function copyText(value: string, success: string) {
    if (!value) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(value);
      apiMessage.success(success);
    } catch {
      apiMessage.error("浏览器未允许复制，请手动选择内容");
    }
  }

  if (current.isLoading || targets.isLoading) return <div className="center-state"><Spin size="large" /></div>;
  return <section className="page-enter">
    {contextHolder}
    <div className="page-heading">
      <div><div className="eyebrow">请求验证</div><h1>RPC 调试</h1><p className="muted">测试已保存节点，或通过运行中的 eRPC 验证完整路由。</p></div>
      <Segmented<DebugMode> value={mode} disabled={testing} options={[{ value: "runtime", label: "运行中 eRPC" }, { value: "saved", label: "已保存节点" }]} onChange={(value) => { invalidateResult(); setMode(value); }} />
    </div>
    {mode === "runtime" && activeTarget?.status === "unauthorized" && <Alert
      type="warning"
      showIcon
      message="eRPC 管理接口返回 401"
      description="当前运行版本没有可用的 admin.auth 管理认证，因此拓扑、健康和上游列表暂时不可见。项目与网络仍可直接测试；项目访问密钥不是 Admin 管理密钥。"
      className="mb-6"
    />}

    <div className="grid grid-cols-1 gap-9 xl:grid-cols-[minmax(0,1fr)_minmax(360px,.8fr)]">
      <Form<DebugForm>
        form={form}
        layout="vertical"
        disabled={testing}
        initialValues={{ method: "eth_chainId", params: "[]", networkId: "evm:56" }}
        onValuesChange={(changed) => {
          invalidateResult();
          if (Object.prototype.hasOwnProperty.call(changed, "projectSecret")) setIncludeSecretInCommands(false);
        }}
        onFinish={(values) => void run(values)}
      >
        {mode === "runtime" && <Form.Item label="eRPC 实例" required><Select value={activeTargetID || undefined} options={(targets.data || []).map((target) => ({ value: target.id, label: target.id }))} onChange={(value) => { invalidateResult(); setTargetID(value); form.setFieldsValue({ projectId: "", upstreamId: undefined, projectSecret: undefined }); setIncludeSecretInCommands(false); }} placeholder="选择运行实例" /></Form.Item>}
        <Form.Item name="projectId" label="项目" rules={[{ required: true, message: "请选择项目" }]}><Select options={projectOptions} placeholder="选择项目" onChange={() => { form.setFieldsValue({ upstreamId: undefined, projectSecret: undefined }); setIncludeSecretInCommands(false); }} /></Form.Item>
        {mode === "runtime" && <Form.Item name="projectSecret" label="项目访问密钥（可选）" tooltip="仅用于本次项目入口测试，不会使用或发送 Admin 管理密钥。"><Input.Password autoComplete="off" placeholder="项目启用 Secret 认证时填写" /></Form.Item>}
        {mode === "runtime" && <Form.Item name="networkId" label="网络 ID" rules={[{ required: true, whitespace: true, message: "请输入网络 ID" }]}><AutoComplete options={RPC_NETWORK_PRESETS} onSelect={chooseNetwork} placeholder="例如 evm:56，也可输入其他网络" /></Form.Item>}
        <Form.Item name="upstreamId" label={mode === "saved" ? "上游节点" : "指定上游（可选）"} tooltip={mode === "runtime" ? "由 eRPC 的 allowClientDirectives 设置决定是否允许指定节点和跳过缓存。" : undefined} rules={mode === "saved" ? [{ required: true, message: "请选择上游节点" }] : undefined}><Select allowClear showSearch options={upstreamOptions} placeholder={mode === "saved" ? "选择需要直连测试的节点" : "留空时由 eRPC 自动选择"} /></Form.Item>
        <Form.Item name="method" label="RPC 方法" rules={[{ required: true, whitespace: true, message: "请输入 RPC 方法" }]}><Input placeholder="例如 eth_chainId、getHealth" /></Form.Item>
        <Form.Item name="params" label="请求参数"><Input.TextArea autoSize={{ minRows: 5, maxRows: 12 }} spellCheck={false} className="font-mono" placeholder="[]" /></Form.Item>
        {mode === "saved" && savedRows.length === 0 && <Alert type="info" showIcon message="当前版本没有可直连测试的静态 RPC 节点" className="mb-4" />}
        <Button type="primary" htmlType="submit" icon={<PlayCircleOutlined />} loading={testing} disabled={mode === "saved" && savedRows.length === 0}>发送测试请求</Button>
      </Form>

      <div className="min-w-0 border-t border-[#26323a] pt-5">
        <div className="mb-6 text-sm font-semibold text-[#dce8e6]">请求与结果</div>
        {mode === "runtime" && <>
          <label className="field-label"><span className="field-title">公开访问基础地址</span><Input value={publicBaseURL} disabled={testing} onChange={(event) => { invalidateResult(); setPublicBaseEdited(true); setPublicBaseURL(event.target.value); }} /></label>
          <label className="field-label mt-4"><span className="field-title">完整 RPC 请求地址</span><Space.Compact block><Input value={requestURL} readOnly placeholder="选择项目并输入网络 ID" /><Button aria-label="复制请求地址" icon={<CopyOutlined />} disabled={!requestURL} onClick={() => void copyText(requestURL, "请求地址已复制")} /></Space.Compact></label>
          {projectSecret && <div className="mt-4 flex items-center gap-3 text-sm text-[#aab8bd]"><Switch size="small" checked={includeSecretInCommands} onChange={setIncludeSecretInCommands} /><span>命令中包含真实密钥</span></div>}
          {commands && <div className="mt-5 grid gap-4">
            <label className="field-label"><span className="field-title">PowerShell</span><Space.Compact block><Input.TextArea value={commands.powershell} readOnly autoSize={{ minRows: 3, maxRows: 5 }} className="font-mono" /><Button aria-label="复制 PowerShell 命令" icon={<CopyOutlined />} onClick={() => void copyText(commands.powershell, "PowerShell 命令已复制")} /></Space.Compact></label>
            <label className="field-label"><span className="field-title">curl.exe</span><Space.Compact block><Input.TextArea value={commands.curl} readOnly autoSize={{ minRows: 3, maxRows: 5 }} className="font-mono" /><Button aria-label="复制 curl 命令" icon={<CopyOutlined />} onClick={() => void copyText(commands.curl, "curl 命令已复制")} /></Space.Compact></label>
          </div>}
        </>}
        {error && <Alert type="error" showIcon message="测试失败" description={error} className="mt-5" />}
        {!error && !result && <div className="mt-7 border-t border-[#202a31] py-12 text-center text-sm text-[#718089]">尚未发送测试请求</div>}
        {result && <div className="mt-7 border-t border-[#202a31] pt-5">
          <Space wrap size={[8, 8]}>
            <Tag color={result.httpStatus >= 200 && result.httpStatus < 300 ? "green" : "red"}>HTTP {result.httpStatus}</Tag>
            <Tag color={rpcResultSucceeded(result) ? "green" : "red"}>{rpcResultSucceeded(result) ? "RPC 成功" : "RPC 错误"}</Tag>
            <Tag>{result.durationMs} ms</Tag>
            {result.upstream && <Tag color="cyan">上游 {result.upstream}</Tag>}
            {result.cache && <Tag>缓存 {result.cache}</Tag>}
          </Space>
          {result.upstreams && <div className="mt-4 text-xs text-[#819099] break-all">上游轨迹：<span className="mono">{result.upstreams}</span></div>}
          <pre className="json-view !max-h-[520px] min-h-48 whitespace-pre-wrap break-words">{formatRPCBody(result.body)}</pre>
        </div>}
      </div>
    </div>
  </section>;
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function providerAllowsNetwork(mode: string, networks: string[], networkID: string): boolean {
  if (mode === "only") return networks.includes(networkID);
  if (mode === "ignore") return !networks.includes(networkID);
  return true;
}
