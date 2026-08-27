import { useEffect, useMemo, useRef, useState } from "react";
import { App as AntApp, Alert, Button, Drawer, Empty, Form, Input, Layout, Menu, Modal, Result, Select, Space, Spin, Table, Tag, Tooltip, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ApiOutlined, CheckCircleOutlined, CloudServerOutlined, ControlOutlined, DashboardOutlined, ExperimentOutlined, FormOutlined, HistoryOutlined, LoginOutlined, LogoutOutlined, PlayCircleOutlined, QuestionCircleOutlined, RadarChartOutlined, ReloadOutlined, SafetyCertificateOutlined, SaveOutlined, StopOutlined } from "@ant-design/icons";
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { loginAdministrator, logoutAdministrator, setupAdministrator, useAuthStatus, useCordon, useCordons, useCurrentConfig, useProject, useRuntimeRPCTest, useSaveConfig, useTargets, useTaxonomy, useValidateConfig, type Project, type RpcTestResult, type TargetSnapshot, type Taxonomy, type Upstream } from "./app/api";
import { connected, disconnected, useAppDispatch, useAppSelector } from "./app/store";
import { OverviewPage } from "./pages/Overview";
import { UpstreamsPage } from "./pages/Upstreams";
import { SettingsPage } from "./pages/Settings";
import { AdvancedPage } from "./pages/Advanced";
import { RevisionsPage } from "./pages/Revisions";
import { RpcDebugPage, rpcResultSucceeded } from "./pages/RpcDebug";
import { configSchema } from "./config/ConfigFields";
import { configDocumentsEqual, extractOverrides, materializeEffectiveConfig } from "./config/document";
import { healthSettingsEqual, readProjectHealthSettings, updateProjectHealthSettings, type ProjectHealthSettings } from "./config/health";

const { Header, Sider, Content } = Layout;

function RequireSession({ children }: { children: React.ReactNode }) {
  const dispatch = useAppDispatch();
  const isConnected = useAppSelector((state) => state.session.authenticated);
  const auth = useAuthStatus();
  useEffect(() => {
    if (auth.data?.authenticated) dispatch(connected());
    else if (auth.data) dispatch(disconnected());
  }, [auth.data, dispatch]);
  if (auth.isLoading || (auth.data?.authenticated && !isConnected)) return <div className="login-screen"><Spin size="large" /></div>;
  if (auth.isError) return <Result status="error" title="无法连接管理服务" subTitle={auth.error.message} />;
  return auth.data?.authenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

function AppShell() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const targets = useTargets();
  const [selectedTarget, setSelectedTarget] = useState("");
  const targetId = selectedTarget || targets.data?.[0]?.id || "";
  const activeTarget = targets.data?.find((item) => item.id === targetId);

  async function logout() {
    try {
      await logoutAdministrator();
    } finally {
      dispatch(disconnected());
      queryClient.clear();
      navigate("/login", { replace: true });
    }
  }

  return (
    <Layout className="app-shell">
      <Sider breakpoint="lg" collapsedWidth="0" theme="dark" className="!border-r !border-[#202a31]">
        <div className="brand-mark"><span className="brand-pulse" /> eRPC <small>管理后台</small></div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[menuKey(location.pathname)]}
          items={[
            { key: "overview", icon: <DashboardOutlined />, label: <NavLink to="/overview">运行概览</NavLink> },
            { key: "health", icon: <RadarChartOutlined />, label: <NavLink to="/health">节点健康</NavLink> },
            { key: "rpc-debug", icon: <ExperimentOutlined />, label: <NavLink to="/rpc-debug">RPC 调试</NavLink> },
            { key: "upstreams", icon: <ApiOutlined />, label: <NavLink to="/upstreams">上游管理</NavLink> },
            { key: "settings", icon: <ControlOutlined />, label: <NavLink to="/settings">服务设置</NavLink> },
            { key: "advanced", icon: <FormOutlined />, label: <NavLink to="/advanced">完整配置</NavLink> },
            { key: "revisions", icon: <HistoryOutlined />, label: <NavLink to="/revisions">配置版本</NavLink> },
          ]}
          className="!border-0 !bg-transparent"
        />
        <div className="sider-foot">
          <div className="sider-caption">运维控制台</div>
          <div className="sider-note">配置、版本与本机 eRPC 进程统一由 Admin 管理。</div>
        </div>
      </Sider>
      <Layout>
        <Header className="topbar">
          <div className="topbar-title">运维中心 <span>/</span> {pageTitle(location.pathname)}</div>
          <Space size={12}>
            {location.pathname.startsWith("/health") && <Select
              value={targetId || undefined}
              placeholder="选择节点"
              loading={targets.isLoading}
              options={(targets.data || []).map((item) => ({ value: item.id, label: item.id }))}
              onChange={(value) => { setSelectedTarget(value); navigate(`/health/${encodeURIComponent(value)}`); }}
              className="target-select"
            />}
            <Tooltip title="刷新当前数据"><Button type="text" icon={<ReloadOutlined />} onClick={() => void queryClient.invalidateQueries()} /></Tooltip>
            <Tooltip title="退出登录"><Button type="text" icon={<LogoutOutlined />} onClick={() => void logout()} /></Tooltip>
          </Space>
        </Header>
        <Content className="workspace">
          {targets.isError && <Alert type="error" showIcon message="管理 API 不可用" description={targets.error.message} className="mb-4" />}
          <Routes>
            <Route path="/overview" element={<OverviewPage />} />
            <Route path="/upstreams" element={<UpstreamsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/advanced" element={<AdvancedPage />} />
            <Route path="/revisions" element={<RevisionsPage />} />
            <Route path="/health" element={<TargetsPage snapshots={targets.data || []} loading={targets.isLoading} />} />
            <Route path="/health/:targetId" element={<TargetPage fallback={activeTarget} />} />
            <Route path="/rpc-debug" element={<RpcDebugPage />} />
            <Route path="/topology" element={<LegacyTopologyRedirect />} />
            <Route path="/topology/:targetId" element={<LegacyTopologyRedirect />} />
            <Route path="/targets/*" element={<Navigate to="/health" replace />} />
            <Route path="*" element={<Navigate to="/overview" replace />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
}

function LoginPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const auth = useAuthStatus();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const setupRequired = Boolean(auth.data?.setupRequired);

  async function connect() {
    if (setupRequired && password !== confirmation) {
      setError("两次输入的密码不一致");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (setupRequired) await setupAdministrator(username, password);
      else await loginAdministrator(username, password);
      dispatch(connected());
      queryClient.setQueryData(["auth"], { setupRequired: false, authenticated: true });
      navigate("/overview", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "连接失败");
    } finally {
      setBusy(false);
    }
  }

  if (auth.isLoading) return <div className="login-screen"><Spin size="large" /></div>;
  if (auth.isError) return <Result status="error" title="无法连接管理服务" subTitle={auth.error.message} />;
  if (auth.data?.authenticated) return <Navigate to="/overview" replace />;

  return (
    <div className="login-screen">
      <div className="login-panel">
        <div className="brand-mark large"><span className="brand-pulse" /> eRPC <small>管理后台</small></div>
        <div className="eyebrow">{setupRequired ? "首次使用" : "管理员登录"}</div>
        <h1>{setupRequired ? "创建管理员账号" : "登录管理后台"}</h1>
        <p className="muted">{setupRequired ? "这是首次启动。创建后将关闭注册入口，以后使用该账号登录。" : "请输入管理员账号和密码。eRPC 凭据始终只保留在 Admin 服务端。"}</p>
        <div className="login-fields">
          <label className="field-label" htmlFor="username"><span className="field-title">管理员账号</span><Input id="username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" placeholder="3-64 个字符" size="large" /></label>
          <label className="field-label" htmlFor="password"><span className="field-title">密码</span><Input.Password id="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={setupRequired ? "new-password" : "current-password"} onPressEnter={() => { if (!setupRequired) void connect(); }} placeholder="8-72 个字节" size="large" /></label>
          {setupRequired && <label className="field-label" htmlFor="password-confirmation"><span className="field-title">确认密码</span><Input.Password id="password-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" onPressEnter={() => void connect()} placeholder="再次输入密码" size="large" /></label>}
        </div>
        {error && <Alert type="error" showIcon message={error} className="mt-4" />}
        <Button type="primary" size="large" block icon={<LoginOutlined />} loading={busy} onClick={() => void connect()} className="mt-5">{setupRequired ? "创建并进入后台" : "登录"}</Button>
        <div className="login-meta"><SafetyCertificateOutlined /> 密码只以安全哈希形式保存在 Admin 服务端。</div>
      </div>
    </div>
  );
}

function TargetsPage({ snapshots, loading }: { snapshots: TargetSnapshot[]; loading: boolean }) {
  const navigate = useNavigate();
  if (loading && snapshots.length === 0) return <div className="center-state"><Spin size="large" /></div>;
  if (!loading && snapshots.length === 0) return <Empty description="暂无已配置节点" className="center-state" />;
  return (
    <section className="page-enter">
      <div className="page-heading">
        <div><div className="eyebrow">运维控制台</div><h1>节点健康</h1><p className="muted">查看 eRPC 实例、上游存活状态和最近一次健康快照。</p></div>
        <Tag icon={<CloudServerOutlined />} color="cyan">{snapshots.length} 个节点</Tag>
      </div>
      <div className="target-list">
        {snapshots.map((snapshot) => {
          const counts = countTopology(topologyProjects(snapshot.taxonomy));
          return <button key={snapshot.id} type="button" className="target-row" onClick={() => navigate(`/health/${encodeURIComponent(snapshot.id)}`)}>
            <div className="target-main"><StatusDot status={snapshot.status} /><div><strong>{snapshot.id}</strong><span>{snapshot.baseUrl}</span></div></div>
            <div className="target-metrics"><span>{counts.projects} 个项目</span><span>{counts.upstreams} 个上游</span><span>{snapshot.latencyMs ?? "-"} ms</span></div>
            <div className="target-state"><Tag color={statusColor(snapshot.status)}>{statusLabel(snapshot.status)}</Tag><span className="row-arrow">→</span></div>
          </button>;
        })}
      </div>
    </section>
  );
}

function TargetPage({ fallback }: { fallback?: TargetSnapshot }) {
  const { targetId = "" } = useParams();
  const navigate = useNavigate();
  const decodedTargetId = decodeURIComponent(targetId);
  const targets = useTargets();
  const snapshot = targets.data?.find((item) => item.id === decodedTargetId) || fallback;
  const taxonomy = useTaxonomy(decodedTargetId);
  const currentConfig = useCurrentConfig();
  const saveConfig = useSaveConfig();
  const validateConfig = useValidateConfig();
  const rpcTest = useRuntimeRPCTest(decodedTargetId);
  const projects = topologyProjects(taxonomy.data);
  const [projectId, setProjectId] = useState("");
  const selectedProject = projectId || projects[0]?.id || "";
  const [selectedRow, setSelectedRow] = useState<TopologyRow | null>(null);
  const cordons = useCordons(decodedTargetId, selectedProject);
  const isCordoned = new Set((cordons.data?.cordoned || []).map((item) => item.upstream));
  const [apiMessage, contextHolder] = message.useMessage();
  const [healthForm] = Form.useForm<ProjectHealthSettings>();
  const [healthDirty, setHealthDirty] = useState(false);
  const healthBaseline = useRef<ProjectHealthSettings | null>(null);
  const [probeStates, setProbeStates] = useState<Record<string, ProbeState>>({});
  const [probingRowKey, setProbingRowKey] = useState("");
  const [authProbeRow, setAuthProbeRow] = useState<TopologyRow | null>(null);
  const [probeSecret, setProbeSecret] = useState("");
  const [modal, modalContextHolder] = Modal.useModal();

  const rows = useMemo<TopologyRow[]>(() => projects.flatMap((project) => (Array.isArray(project.networks) ? project.networks : []).flatMap((network) => (Array.isArray(network.upstreams) ? network.upstreams : []).map((upstream) => ({ key: topologyRowKey(decodedTargetId, project.id, network.id, upstream.id), projectId: project.id, networkId: network.id, networkAlias: network.alias, upstream })) )), [decodedTargetId, projects]);
  const effectiveConfig = useMemo(() => currentConfig.data?.effectivePayload || materializeEffectiveConfig(currentConfig.data?.payload || {}, currentConfig.data?.defaultPayload || {}, configSchema), [currentConfig.data?.defaultPayload, currentConfig.data?.effectivePayload, currentConfig.data?.payload]);
  const configProjects = Array.isArray(effectiveConfig.projects) ? effectiveConfig.projects : [];
  const matchingProjectIndexes = configProjects.flatMap((value, index) => String(asRecord(value).id || "") === selectedProject ? [index] : []);
  const configProjectIndex = matchingProjectIndexes.length === 1 ? matchingProjectIndexes[0] : -1;
  const mutateCordon = useCordon(decodedTargetId, true);
  const mutateUncordon = useCordon(decodedTargetId, false);

  useEffect(() => {
    if (healthDirty || configProjectIndex < 0) return;
    const values = readProjectHealthSettings(effectiveConfig, configProjectIndex);
    healthBaseline.current = values;
    healthForm.setFieldsValue(values);
    setHealthDirty(false);
  }, [configProjectIndex, currentConfig.data?.revision, effectiveConfig, healthDirty, healthForm]);

  function changeProject(value?: string) {
    const nextProject = value || "";
    if (!healthDirty) {
      setProjectId(nextProject);
      return;
    }
    modal.confirm({
      title: "放弃未保存的健康配置？",
      content: "切换项目会丢弃当前修改。",
      okText: "放弃修改",
      okButtonProps: { danger: true },
      cancelText: "继续编辑",
      onOk: () => {
        healthBaseline.current = null;
        setHealthDirty(false);
        setProjectId(nextProject);
      },
    });
  }

  async function toggle(row: typeof rows[number]) {
    const mutation = isCordoned.has(row.upstream.id) ? mutateUncordon : mutateCordon;
    try {
      await mutation.mutateAsync({ projectId: row.projectId, upstream: row.upstream.id, reason: "Admin Web operator action" });
      await cordons.refetch();
      apiMessage.success(isCordoned.has(row.upstream.id) ? "上游已恢复接入" : "上游已摘除");
    } catch (err) {
      apiMessage.error(err instanceof Error ? err.message : "操作失败");
    }
  }

  function healthOverrides(values: ProjectHealthSettings) {
    if (configProjectIndex < 0) throw new Error("无法确定项目配置");
    const next = updateProjectHealthSettings(effectiveConfig, configProjectIndex, values, healthBaseline.current || undefined);
    return extractOverrides(next, currentConfig.data?.defaultPayload || {}, configSchema, currentConfig.data?.payload || {});
  }

  async function saveHealth(values: ProjectHealthSettings) {
    try {
      const overrides = healthOverrides(values);
      if (configDocumentsEqual(overrides, currentConfig.data?.payload || {})) return;
      const validation = await validateConfig.mutateAsync({ payload: overrides });
      if (!validation.valid) {
        apiMessage.error(validation.errors[0] || "健康配置校验未通过");
        return;
      }
      const revision = await saveConfig.mutateAsync({ payload: overrides, baseRevision: currentConfig.data?.revision || 0 });
      healthBaseline.current = values;
      setHealthDirty(false);
      apiMessage.success(`健康配置已保存为 v${revision.revision}，重启 eRPC 后生效`);
    } catch (error) {
      apiMessage.error(error instanceof Error ? error.message : "健康配置保存失败");
    }
  }

  async function probe(row: TopologyRow, projectSecret = ""): Promise<"complete" | "unauthorized"> {
    const method = row.networkId.startsWith("svm:") ? "getHealth" : row.networkId.startsWith("evm:") ? "eth_chainId" : "";
    if (!method) {
      navigate("/rpc-debug");
      return "complete";
    }
    setProbingRowKey(row.key);
    setProbeStates((current) => ({ ...current, [row.key]: { status: "unknown", label: "测试中" } }));
    try {
      const result = await rpcTest.mutateAsync({ projectId: row.projectId, networkId: row.networkId, upstreamId: row.upstream.id, projectSecret: projectSecret || undefined, method, params: [] });
      const detail = `${result.durationMs} ms${result.upstream ? `，实际上游 ${result.upstream}` : ""}`;
      const state = runtimeProbeState(result, row.upstream.id);
      setProbeStates((current) => ({ ...current, [row.key]: state }));
      if (state.status === "healthy") {
        apiMessage.success(`RPC 测试通过：${detail}`);
      } else if (state.status === "unauthorized") {
        if (!projectSecret) {
          setAuthProbeRow(row);
          setProbeSecret("");
        }
        apiMessage.warning(projectSecret ? "项目访问密钥无效，请检查后重试" : "项目启用了访问认证，请输入项目密钥后重试");
        return "unauthorized";
      } else if (state.label === "定向未生效") {
        apiMessage.warning(`RPC 响应成功，但实际使用的是 ${result.upstream}；请检查 allowClientDirectives`);
      } else if (state.status === "unknown") {
        apiMessage.warning("RPC 响应成功，但 eRPC 未返回实际上游，无法确认是否命中所选节点");
      } else {
        apiMessage.warning(`RPC 返回错误（HTTP ${result.httpStatus}）：${detail}`);
      }
    } catch (error) {
      setProbeStates((current) => ({ ...current, [row.key]: { status: "offline", label: "连接失败" } }));
      apiMessage.error(error instanceof Error ? error.message : "RPC 测试失败");
    } finally {
      setProbingRowKey("");
    }
    return "complete";
  }

  async function retryAuthenticatedProbe() {
    if (!authProbeRow) return;
    if (!probeSecret) {
      apiMessage.warning("请输入项目访问密钥");
      return;
    }
    const outcome = await probe(authProbeRow, probeSecret);
    if (outcome === "complete") {
      setAuthProbeRow(null);
      setProbeSecret("");
    }
  }

  if (taxonomy.isLoading && !taxonomy.data) return <div className="center-state"><Spin size="large" /></div>;
  if (taxonomy.isError) {
    const adminAuthUnavailable = snapshot?.status === "unauthorized" || taxonomy.error.message.includes("401") || taxonomy.error.message.includes("错误码 -32603");
    if (adminAuthUnavailable) {
      return <Result status="warning" title="eRPC 管理接口未授权" subTitle="请在“服务设置”启用 eRPC Admin 接口并配置内部密钥，保存新版本后重启 eRPC。Admin Web 登录账号与该内部密钥是两套凭据。" extra={<Button type="primary" onClick={() => navigate("/settings")}>前往服务设置</Button>} />;
    }
    return <Result status="error" title="无法加载拓扑" subTitle={taxonomy.error.message} />;
  }
  const counts = countTopology(projects);
  const columns: ColumnsType<typeof rows[number]> = [
    { title: "上游", dataIndex: ["upstream", "id"], render: (_value, row) => {
      const state = isCordoned.has(row.upstream.id) ? { status: "degraded", label: "已摘除" } : probeStates[row.key] || { status: "unknown", label: "未测试" };
      return <div className="table-primary"><StatusDot status={state.status} /><span>{row.upstream.id}</span><Tag color={statusColor(state.status)}>{state.label}</Tag></div>;
    } },
    { title: "项目", dataIndex: "projectId", width: 150, render: (value) => <span className="mono">{value}</span> },
    { title: "网络", dataIndex: "networkId", render: (value, row) => <span className="mono">{row.networkAlias || value}</span> },
    { title: "厂商", dataIndex: ["upstream", "vendor"], render: (value) => value || <span className="muted">未上报</span> },
    { title: "操作", key: "action", width: 220, render: (_value, row) => <Space><Tooltip title="请求跳过缓存并定向测试；是否生效由项目 allowClientDirectives 决定"><Button size="small" aria-label="测试 RPC" icon={<PlayCircleOutlined />} loading={probingRowKey === row.key} disabled={rpcTest.isPending && probingRowKey !== row.key} onClick={() => void probe(row)} /></Tooltip><Button size="small" onClick={() => setSelectedRow(row)}>健康详情</Button><Button size="small" danger={isCordoned.has(row.upstream.id)} icon={isCordoned.has(row.upstream.id) ? <CheckCircleOutlined /> : <StopOutlined />} onClick={() => void toggle(row)}>{isCordoned.has(row.upstream.id) ? "恢复接入" : "摘除"}</Button></Space> },
  ];

  return <AntApp>
    {contextHolder}
    {modalContextHolder}
    <section className="page-enter">
      <div className="page-heading">
        <div><div className="eyebrow">节点 / {decodedTargetId}</div><h1>节点健康</h1><p className="muted">查看运行拓扑、调整健康轮询参数并验证上游响应。</p></div>
        <Space><StatusDot status={snapshot?.status || "offline"} /><Tag color={statusColor(snapshot?.status || "offline")}>{statusLabel(snapshot?.status || "offline")}</Tag></Space>
      </div>
      {snapshot?.lastError && snapshot.status !== "healthy" && <Alert type="warning" showIcon message="最近一次轮询未完成" description={snapshot.lastError} className="mb-4" />}
      <div className="stat-strip">
        <Stat label="项目数" value={counts.projects} />
        <Stat label="网络数" value={counts.networks} />
        <Stat label="上游数" value={counts.upstreams} />
        <Stat label="轮询延迟" value={`${snapshot?.latencyMs ?? "-"} ms`} />
        <Stat label="最近成功" value={snapshot?.lastSuccessAt ? formatTime(snapshot.lastSuccessAt) : "从未成功"} />
      </div>
      {currentConfig.isError ? <Alert type="warning" showIcon message="无法读取持久配置，健康参数暂不可编辑" className="mb-5" /> : matchingProjectIndexes.length > 1 ? <Alert type="error" showIcon message="配置中存在重复项目标识，无法安全编辑健康参数" className="mb-5" /> : configProjectIndex >= 0 && <div className="settings-section">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h2 className="!mb-1">项目健康策略</h2><span className="muted">项目 {selectedProject} · 保存新版本后重启生效</span></div><Tag color="cyan">运行默认值已填充</Tag></div>
        <Form<ProjectHealthSettings>
          form={healthForm}
          layout="vertical"
          onValuesChange={(_, values) => {
            setHealthDirty(Boolean(healthBaseline.current && !healthSettingsEqual(values, healthBaseline.current)));
          }}
          onFinish={(values) => void saveHealth(values)}
        >
          <div className="form-grid">
            <Form.Item name="statePollerInterval" label={<HealthFieldLabel title="EVM 状态轮询周期" help="每个 EVM 上游主动查询最新块、最终块和同步状态的周期。运行默认值 30s。" />} rules={[{ required: true, whitespace: true }]}><Input placeholder="30s" /></Form.Item>
            <Form.Item name="selectionEvalInterval" label={<HealthFieldLabel title="选路重算周期" help="eRPC 根据健康指标重新计算上游顺序的周期。运行默认值 15s。" />} rules={[{ required: true, whitespace: true }]}><Input placeholder="15s" /></Form.Item>
            <Form.Item name="scoreMetricsWindowSize" label={<HealthFieldLabel title="健康指标统计窗口" help="错误率和延迟等指标的滚动统计窗口。运行时缺省回退为 1m。" />} rules={[{ required: true, whitespace: true }]}><Input placeholder="1m" /></Form.Item>
            <Form.Item name="svmStatePollerDebounce" label={<HealthFieldLabel title="SVM 状态轮询防抖" help="限制 SVM 节点槽位与健康状态刷新频率。运行默认值 400ms。" />} rules={[{ required: true, whitespace: true }]}><Input placeholder="400ms" /></Form.Item>
          </div>
          <Button type="primary" htmlType="submit" icon={<SaveOutlined />} disabled={!healthDirty} loading={saveConfig.isPending || validateConfig.isPending}>保存健康配置</Button>
        </Form>
      </div>}
      <div className="toolbar-row"><Select value={selectedProject || undefined} placeholder="筛选项目" allowClear options={projects.map((project) => ({ value: project.id, label: project.id }))} onChange={changeProject} /><span className="muted">已发现 {rows.length} 个上游</span></div>
      <Table rowKey="key" columns={columns} dataSource={selectedProject ? rows.filter((row) => row.projectId === selectedProject) : rows} pagination={{ pageSize: 20, hideOnSinglePage: true }} className="ops-table" scroll={{ x: 760 }} />
      <HealthDrawer targetId={decodedTargetId} row={selectedRow} onClose={() => setSelectedRow(null)} />
      <Modal
        title="项目需要访问密钥"
        open={Boolean(authProbeRow)}
        okText="使用密钥重试"
        cancelText="取消"
        confirmLoading={rpcTest.isPending}
        onOk={() => void retryAuthenticatedProbe()}
        onCancel={() => { setAuthProbeRow(null); setProbeSecret(""); }}
      >
        <p className="muted">项目 {authProbeRow?.projectId} 返回 HTTP 401。密钥只用于本次运行态测试，不会保存。</p>
        <Input.Password value={probeSecret} onChange={(event) => setProbeSecret(event.target.value)} onPressEnter={() => void retryAuthenticatedProbe()} autoComplete="off" placeholder="输入项目访问密钥" />
      </Modal>
    </section>
  </AntApp>;
}

type TopologyRow = { key: string; projectId: string; networkId: string; networkAlias?: string; upstream: Upstream };
type ProbeState = { status: "healthy" | "degraded" | "offline" | "unauthorized" | "unknown"; label: string };

function HealthDrawer({ targetId, row, onClose }: { targetId: string; row: TopologyRow | null; onClose: () => void }) {
  const project = useProject(targetId, row?.projectId || "");
  const details = row ? upstreamHealthDetails(project.data?.health, row.upstream.id, row.networkId) : null;
  return <Drawer title={row ? `健康检查 / ${row.upstream.id}` : "健康检查"} open={Boolean(row)} onClose={onClose} size={440}>
    {project.isLoading ? <Spin /> : project.isError ? <Alert type="error" message={project.error.message} /> : <>
      <div className="drawer-kv"><span>项目</span><strong>{row?.projectId}</strong></div>
      <div className="drawer-kv"><span>网络</span><strong>{row?.networkId}</strong></div>
      <div className="drawer-kv"><span>运行状态</span><Tag color="cyan">来自 eRPC 实时数据</Tag></div>
      {details ? <pre className="json-view">{JSON.stringify(details, null, 2)}</pre> : <Alert type="info" showIcon message="eRPC 尚未返回该上游的运行指标" />}
    </>}
  </Drawer>;
}

function Stat({ label, value }: { label: string; value: string | number }) { return <div className="stat-cell"><span>{label}</span><strong>{value}</strong></div>; }

function HealthFieldLabel({ title, help }: { title: string; help: string }) {
  return <span className="inline-flex items-center gap-2">{title}<Tooltip title={help}><QuestionCircleOutlined className="text-[#79918f]" /></Tooltip></span>;
}

function StatusDot({ status }: { status: string }) { return <span className={`status-dot status-${status}`} aria-label={statusLabel(status)} />; }

export function topologyProjects(taxonomy: Taxonomy | null | undefined): Project[] {
  return Array.isArray(taxonomy?.projects) ? taxonomy.projects : [];
}

export function topologyRowKey(targetID: string, projectID: string, networkID: string, upstreamID: string): string {
  return JSON.stringify([targetID, projectID, networkID, upstreamID]);
}

export function countTopology(projects: Project[] | null | undefined) {
  const safeProjects = Array.isArray(projects) ? projects : [];
  return safeProjects.reduce((total, project) => {
    const networks = Array.isArray(project.networks) ? project.networks : [];
    return { projects: total.projects + 1, networks: total.networks + networks.length, upstreams: total.upstreams + networks.reduce((count, network) => count + (Array.isArray(network.upstreams) ? network.upstreams.length : 0), 0) };
  }, { projects: 0, networks: 0, upstreams: 0 });
}

export function upstreamHealthDetails(health: unknown, upstreamID: string, networkID: string): Record<string, unknown> | null {
  const upstreams = asRecord(health).upstreams;
  if (!Array.isArray(upstreams)) return null;
  const matches = upstreams
    .filter((value) => value && typeof value === "object" && !Array.isArray(value))
    .map(asRecord)
    .filter((value) => String(value.id ?? "") === upstreamID && String(value.networkId ?? "") === networkID);
  return matches.length === 1 ? matches[0] : null;
}

export function runtimeProbeState(result: RpcTestResult, expectedUpstreamID: string): ProbeState {
  if (result.httpStatus === 401) return { status: "unauthorized", label: "需认证" };
  if (!rpcResultSucceeded(result)) return { status: "degraded", label: "RPC 错误" };
  if (result.upstream === expectedUpstreamID) return { status: "healthy", label: "测试通过" };
  if (result.upstream) return { status: "degraded", label: "定向未生效" };
  return { status: "unknown", label: "响应成功" };
}

function statusColor(status: string) { return status === "healthy" ? "green" : status === "degraded" ? "gold" : status === "unauthorized" ? "red" : "default"; }

function statusLabel(status: string) { return ({ healthy: "正常", degraded: "降级", offline: "离线", unauthorized: "未授权", unknown: "未测试" } as Record<string, string>)[status] || status; }

function formatTime(value: string) { return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value)); }
function menuKey(path: string) { return path.startsWith("/health") || path.startsWith("/topology") || path.startsWith("/targets") ? "health" : path.startsWith("/rpc-debug") ? "rpc-debug" : path.startsWith("/upstreams") ? "upstreams" : path.startsWith("/settings") ? "settings" : path.startsWith("/advanced") ? "advanced" : path.startsWith("/revisions") ? "revisions" : "overview"; }
function pageTitle(path: string) { return ({ overview: "运行概览", health: "节点健康", "rpc-debug": "RPC 调试", upstreams: "上游管理", settings: "服务设置", advanced: "完整配置", revisions: "配置版本" } as Record<string, string>)[menuKey(path)]; }

function LegacyTopologyRedirect() {
  const { targetId } = useParams();
  return <Navigate to={targetId ? `/health/${encodeURIComponent(targetId)}` : "/health"} replace />;
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

export function App() {
  return <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="*" element={<RequireSession><AppShell /></RequireSession>} />
  </Routes>;
}
