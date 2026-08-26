import { useEffect, useMemo, useState } from "react";
import { App as AntApp, Alert, Button, Drawer, Empty, Input, Layout, Menu, Result, Select, Space, Spin, Table, Tag, Tooltip, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ApiOutlined, CheckCircleOutlined, CloudServerOutlined, ControlOutlined, DashboardOutlined, FormOutlined, HistoryOutlined, LoginOutlined, LogoutOutlined, RadarChartOutlined, ReloadOutlined, SafetyCertificateOutlined, StopOutlined } from "@ant-design/icons";
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { loginAdministrator, logoutAdministrator, setupAdministrator, useAuthStatus, useCordon, useCordons, useProject, useTargets, useTaxonomy, type Project, type TargetSnapshot, type Taxonomy, type Upstream } from "./app/api";
import { connected, disconnected, useAppDispatch, useAppSelector } from "./app/store";
import { OverviewPage } from "./pages/Overview";
import { UpstreamsPage } from "./pages/Upstreams";
import { SettingsPage } from "./pages/Settings";
import { AdvancedPage } from "./pages/Advanced";
import { RevisionsPage } from "./pages/Revisions";

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
            { key: "upstreams", icon: <ApiOutlined />, label: <NavLink to="/upstreams">上游管理</NavLink> },
            { key: "settings", icon: <ControlOutlined />, label: <NavLink to="/settings">服务设置</NavLink> },
            { key: "advanced", icon: <FormOutlined />, label: <NavLink to="/advanced">完整配置</NavLink> },
            { key: "revisions", icon: <HistoryOutlined />, label: <NavLink to="/revisions">配置版本</NavLink> },
            { key: "topology", icon: <RadarChartOutlined />, label: <NavLink to="/topology">实时拓扑</NavLink> },
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
            {location.pathname.startsWith("/topology") && <Select
              value={targetId || undefined}
              placeholder="选择节点"
              loading={targets.isLoading}
              options={(targets.data || []).map((item) => ({ value: item.id, label: item.id }))}
              onChange={(value) => { setSelectedTarget(value); navigate(`/topology/${encodeURIComponent(value)}`); }}
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
            <Route path="/topology" element={<TargetsPage snapshots={targets.data || []} loading={targets.isLoading} />} />
            <Route path="/topology/:targetId" element={<TargetPage fallback={activeTarget} />} />
            <Route path="/targets/*" element={<Navigate to="/topology" replace />} />
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
        <div><div className="eyebrow">运维控制台</div><h1>节点管理</h1><p className="muted">查看 eRPC 实例连接状态和最近一次拓扑快照。</p></div>
        <Tag icon={<CloudServerOutlined />} color="cyan">{snapshots.length} 个节点</Tag>
      </div>
      <div className="target-list">
        {snapshots.map((snapshot) => {
          const counts = countTopology(topologyProjects(snapshot.taxonomy));
          return <button key={snapshot.id} type="button" className="target-row" onClick={() => navigate(`/topology/${encodeURIComponent(snapshot.id)}`)}>
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
  const decodedTargetId = decodeURIComponent(targetId);
  const targets = useTargets();
  const snapshot = targets.data?.find((item) => item.id === decodedTargetId) || fallback;
  const taxonomy = useTaxonomy(decodedTargetId);
  const projects = topologyProjects(taxonomy.data);
  const [projectId, setProjectId] = useState("");
  const selectedProject = projectId || projects[0]?.id || "";
  const [selectedRow, setSelectedRow] = useState<{ projectId: string; networkId: string; upstream: Upstream } | null>(null);
  const cordons = useCordons(decodedTargetId, selectedProject);
  const isCordoned = new Set((cordons.data?.cordoned || []).map((item) => item.upstream));
  const [apiMessage, contextHolder] = message.useMessage();

  const rows = useMemo(() => projects.flatMap((project) => (Array.isArray(project.networks) ? project.networks : []).flatMap((network) => (Array.isArray(network.upstreams) ? network.upstreams : []).map((upstream) => ({ key: `${project.id}/${network.id}/${upstream.id}`, projectId: project.id, networkId: network.id, networkAlias: network.alias, upstream })) )), [projects]);
  const mutateCordon = useCordon(decodedTargetId, true);
  const mutateUncordon = useCordon(decodedTargetId, false);

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

  if (taxonomy.isLoading && !taxonomy.data) return <div className="center-state"><Spin size="large" /></div>;
  if (taxonomy.isError) return <Result status="error" title="无法加载拓扑" subTitle={taxonomy.error.message} />;
  const counts = countTopology(projects);
  const columns: ColumnsType<typeof rows[number]> = [
    { title: "上游", dataIndex: ["upstream", "id"], render: (_value, row) => <div className="table-primary"><StatusDot status={isCordoned.has(row.upstream.id) ? "degraded" : "healthy"} /><span>{row.upstream.id}</span></div> },
    { title: "项目", dataIndex: "projectId", width: 150, render: (value) => <span className="mono">{value}</span> },
    { title: "网络", dataIndex: "networkId", render: (value, row) => <span className="mono">{row.networkAlias || value}</span> },
    { title: "厂商", dataIndex: ["upstream", "vendor"], render: (value) => value || <span className="muted">未上报</span> },
    { title: "操作", key: "action", width: 180, render: (_value, row) => <Space><Button size="small" onClick={() => setSelectedRow(row)}>健康详情</Button><Button size="small" danger={isCordoned.has(row.upstream.id)} icon={isCordoned.has(row.upstream.id) ? <CheckCircleOutlined /> : <StopOutlined />} onClick={() => void toggle(row)}>{isCordoned.has(row.upstream.id) ? "恢复接入" : "摘除"}</Button></Space> },
  ];

  return <AntApp>
    {contextHolder}
    <section className="page-enter">
      <div className="page-heading">
        <div><div className="eyebrow">节点 / {decodedTargetId}</div><h1>运行拓扑</h1><p className="muted">从 eRPC 读取只读拓扑，可执行明确的上游摘除操作。</p></div>
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
      <div className="toolbar-row"><Select value={selectedProject || undefined} placeholder="筛选项目" allowClear options={projects.map((project) => ({ value: project.id, label: project.id }))} onChange={(value) => setProjectId(value || "")} /><span className="muted">已发现 {rows.length} 个上游</span></div>
      <Table rowKey="key" columns={columns} dataSource={selectedProject ? rows.filter((row) => row.projectId === selectedProject) : rows} pagination={{ pageSize: 20, hideOnSinglePage: true }} className="ops-table" scroll={{ x: 760 }} />
      <HealthDrawer targetId={decodedTargetId} row={selectedRow} onClose={() => setSelectedRow(null)} />
    </section>
  </AntApp>;
}

function HealthDrawer({ targetId, row, onClose }: { targetId: string; row: { projectId: string; networkId: string; upstream: Upstream } | null; onClose: () => void }) {
  const project = useProject(targetId, row?.projectId || "");
  return <Drawer title={row ? `健康检查 / ${row.upstream.id}` : "健康检查"} open={Boolean(row)} onClose={onClose} width={440}>
    {project.isLoading ? <Spin /> : project.isError ? <Alert type="error" message={project.error.message} /> : <>
      <div className="drawer-kv"><span>项目</span><strong>{row?.projectId}</strong></div>
      <div className="drawer-kv"><span>网络</span><strong>{row?.networkId}</strong></div>
      <div className="drawer-kv"><span>运行状态</span><Tag color="cyan">来自 eRPC 实时数据</Tag></div>
      <pre className="json-view">{JSON.stringify(project.data?.health ?? {}, null, 2)}</pre>
    </>}
  </Drawer>;
}

function Stat({ label, value }: { label: string; value: string | number }) { return <div className="stat-cell"><span>{label}</span><strong>{value}</strong></div>; }

function StatusDot({ status }: { status: string }) { return <span className={`status-dot status-${status}`} aria-label={statusLabel(status)} />; }

export function topologyProjects(taxonomy: Taxonomy | null | undefined): Project[] {
  return Array.isArray(taxonomy?.projects) ? taxonomy.projects : [];
}

export function countTopology(projects: Project[] | null | undefined) {
  const safeProjects = Array.isArray(projects) ? projects : [];
  return safeProjects.reduce((total, project) => {
    const networks = Array.isArray(project.networks) ? project.networks : [];
    return { projects: total.projects + 1, networks: total.networks + networks.length, upstreams: total.upstreams + networks.reduce((count, network) => count + (Array.isArray(network.upstreams) ? network.upstreams.length : 0), 0) };
  }, { projects: 0, networks: 0, upstreams: 0 });
}

function statusColor(status: string) { return status === "healthy" ? "green" : status === "degraded" ? "gold" : status === "unauthorized" ? "red" : "default"; }

function statusLabel(status: string) { return ({ healthy: "正常", degraded: "降级", offline: "离线", unauthorized: "未授权" } as Record<string, string>)[status] || status; }

function formatTime(value: string) { return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value)); }
function menuKey(path: string) { return path.startsWith("/upstreams") ? "upstreams" : path.startsWith("/settings") ? "settings" : path.startsWith("/advanced") ? "advanced" : path.startsWith("/revisions") ? "revisions" : path.startsWith("/topology") || path.startsWith("/targets") ? "topology" : "overview"; }
function pageTitle(path: string) { return ({ overview: "运行概览", upstreams: "上游管理", settings: "服务设置", advanced: "完整配置", revisions: "配置版本", topology: "实时拓扑" } as Record<string, string>)[menuKey(path)]; }

export function App() {
  return <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="*" element={<RequireSession><AppShell /></RequireSession>} />
  </Routes>;
}
