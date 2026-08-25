import { useMemo, useState } from "react";
import { App as AntApp, Alert, Button, Drawer, Empty, Input, Layout, Menu, Result, Select, Space, Spin, Table, Tag, Tooltip, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { CheckCircleOutlined, CloudServerOutlined, DisconnectOutlined, LoginOutlined, LogoutOutlined, RadarChartOutlined, ReloadOutlined, SafetyCertificateOutlined, StopOutlined } from "@ant-design/icons";
import { Navigate, NavLink, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { apiRequest, useCordon, useCordons, useProject, useTargets, useTaxonomy, type Project, type TargetSnapshot, type Upstream } from "./app/api";
import { connected, disconnected, useAppDispatch, useAppSelector } from "./app/store";

const { Header, Sider, Content } = Layout;

function RequireSession({ children }: { children: React.ReactNode }) {
  const isConnected = useAppSelector((state) => state.session.connected);
  return isConnected ? <>{children}</> : <Navigate to="/login" replace />;
}

function AppShell() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const token = useAppSelector((state) => state.session.webToken);
  const targets = useTargets(token);
  const [selectedTarget, setSelectedTarget] = useState("");
  const targetId = selectedTarget || targets.data?.[0]?.id || "";
  const activeTarget = targets.data?.find((item) => item.id === targetId);

  return (
    <Layout className="min-h-screen bg-[#0b0f13]">
      <Sider breakpoint="lg" collapsedWidth="0" theme="dark" className="!border-r !border-[#202a31]">
        <div className="brand-mark"><span className="brand-pulse" /> eRPC <small>ADMIN</small></div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname.startsWith("/targets") ? "targets" : "targets"]}
          items={[{ key: "targets", icon: <RadarChartOutlined />, label: <NavLink to="/targets">Targets</NavLink> }]}
          className="!border-0 !bg-transparent"
        />
        <div className="sider-foot">
          <div className="sider-caption">CONTROL PLANE</div>
          <div className="sider-note">Health and cordon actions are proxied through Admin. RPC credentials stay server-side.</div>
        </div>
      </Sider>
      <Layout>
        <Header className="topbar">
          <div className="topbar-title">Operations <span>/</span> Targets</div>
          <Space size={12}>
            <Select
              value={targetId || undefined}
              placeholder="Select target"
              loading={targets.isLoading}
              options={(targets.data || []).map((item) => ({ value: item.id, label: item.id }))}
              onChange={(value) => { setSelectedTarget(value); navigate(`/targets/${encodeURIComponent(value)}`); }}
              className="target-select"
            />
            <Tooltip title="Refresh target list"><Button type="text" icon={<ReloadOutlined />} onClick={() => void targets.refetch()} /></Tooltip>
            <Button type="text" icon={<LogoutOutlined />} onClick={() => { dispatch(disconnected()); navigate("/login", { replace: true }); }} />
          </Space>
        </Header>
        <Content className="workspace">
          {targets.isError && <Alert type="error" showIcon message="Admin API unavailable" description={targets.error.message} className="mb-4" />}
          <Routes>
            <Route path="/targets" element={<TargetsPage snapshots={targets.data || []} loading={targets.isLoading} />} />
            <Route path="/targets/:targetId" element={<TargetPage token={token} fallback={activeTarget} />} />
            <Route path="*" element={<Navigate to={targetId ? `/targets/${encodeURIComponent(targetId)}` : "/targets"} replace />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
}

function LoginPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function connect() {
    setBusy(true);
    setError("");
    try {
      await apiRequest("/api/targets", token);
      dispatch(connected(token));
      if (!token) sessionStorage.setItem("erpc-admin-empty-session", "1");
      navigate("/targets", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to connect");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-panel">
        <div className="brand-mark large"><span className="brand-pulse" /> eRPC <small>ADMIN</small></div>
        <div className="eyebrow">OPERATOR ACCESS</div>
        <h1>Connect to your control plane.</h1>
        <p className="muted">Enter the Admin Web token. eRPC RPC tokens never leave the Admin process.</p>
        <label className="field-label" htmlFor="web-token">Admin Web token</label>
        <Input.Password id="web-token" value={token} onChange={(event) => setToken(event.target.value)} onPressEnter={() => void connect()} placeholder="Optional for trusted local development" size="large" />
        {error && <Alert type="error" showIcon message={error} className="mt-4" />}
        <Button type="primary" size="large" block icon={<LoginOutlined />} loading={busy} onClick={() => void connect()} className="mt-5">Connect</Button>
        <div className="login-meta"><SafetyCertificateOutlined /> Session is stored in this browser tab only.</div>
      </div>
    </div>
  );
}

function TargetsPage({ snapshots, loading }: { snapshots: TargetSnapshot[]; loading: boolean }) {
  const navigate = useNavigate();
  if (loading && snapshots.length === 0) return <div className="center-state"><Spin size="large" /></div>;
  if (!loading && snapshots.length === 0) return <Empty description="No targets configured" className="center-state" />;
  return (
    <section className="page-enter">
      <div className="page-heading">
        <div><div className="eyebrow">CONTROL PLANE</div><h1>Targets</h1><p className="muted">Connected eRPC instances and their latest topology snapshot.</p></div>
        <Tag icon={<CloudServerOutlined />} color="cyan">{snapshots.length} configured</Tag>
      </div>
      <div className="target-list">
        {snapshots.map((snapshot) => {
          const counts = countTopology(snapshot.taxonomy?.projects || []);
          return <button key={snapshot.id} type="button" className="target-row" onClick={() => navigate(`/targets/${encodeURIComponent(snapshot.id)}`)}>
            <div className="target-main"><StatusDot status={snapshot.status} /><div><strong>{snapshot.id}</strong><span>{snapshot.baseUrl}</span></div></div>
            <div className="target-metrics"><span>{counts.projects} projects</span><span>{counts.upstreams} upstreams</span><span>{snapshot.latencyMs ?? "-"} ms</span></div>
            <div className="target-state"><Tag color={statusColor(snapshot.status)}>{snapshot.status}</Tag><span className="row-arrow">→</span></div>
          </button>;
        })}
      </div>
    </section>
  );
}

function TargetPage({ token, fallback }: { token: string; fallback?: TargetSnapshot }) {
  const { targetId = "" } = useParams();
  const decodedTargetId = decodeURIComponent(targetId);
  const targets = useTargets(token);
  const snapshot = targets.data?.find((item) => item.id === decodedTargetId) || fallback;
  const taxonomy = useTaxonomy(token, decodedTargetId);
  const [projectId, setProjectId] = useState("");
  const selectedProject = projectId || taxonomy.data?.projects[0]?.id || "";
  const [selectedRow, setSelectedRow] = useState<{ projectId: string; networkId: string; upstream: Upstream } | null>(null);
  const cordons = useCordons(token, decodedTargetId, selectedProject);
  const isCordoned = new Set((cordons.data?.cordoned || []).map((item) => item.upstream));
  const [apiMessage, contextHolder] = message.useMessage();

  const rows = useMemo(() => (taxonomy.data?.projects || []).flatMap((project) => project.networks.flatMap((network) => network.upstreams.map((upstream) => ({ key: `${project.id}/${network.id}/${upstream.id}`, projectId: project.id, networkId: network.id, networkAlias: network.alias, upstream })) )), [taxonomy.data]);
  const mutateCordon = useCordon(token, decodedTargetId, true);
  const mutateUncordon = useCordon(token, decodedTargetId, false);

  async function toggle(row: typeof rows[number]) {
    const mutation = isCordoned.has(row.upstream.id) ? mutateUncordon : mutateCordon;
    try {
      await mutation.mutateAsync({ projectId: row.projectId, upstream: row.upstream.id, reason: "Admin Web operator action" });
      await cordons.refetch();
      apiMessage.success(isCordoned.has(row.upstream.id) ? "Upstream uncordoned" : "Upstream cordoned");
    } catch (err) {
      apiMessage.error(err instanceof Error ? err.message : "Action failed");
    }
  }

  if (taxonomy.isLoading && !taxonomy.data) return <div className="center-state"><Spin size="large" /></div>;
  if (taxonomy.isError) return <Result status="error" title="Could not load topology" subTitle={taxonomy.error.message} />;
  const counts = countTopology(taxonomy.data?.projects || []);
  const columns: ColumnsType<typeof rows[number]> = [
    { title: "Upstream", dataIndex: ["upstream", "id"], render: (_value, row) => <div className="table-primary"><StatusDot status={isCordoned.has(row.upstream.id) ? "degraded" : "healthy"} /><span>{row.upstream.id}</span></div> },
    { title: "Project", dataIndex: "projectId", width: 150, render: (value) => <span className="mono">{value}</span> },
    { title: "Network", dataIndex: "networkId", render: (value, row) => <span className="mono">{row.networkAlias || value}</span> },
    { title: "Vendor", dataIndex: ["upstream", "vendor"], render: (value) => value || <span className="muted">unreported</span> },
    { title: "Action", key: "action", width: 150, render: (_value, row) => <Space><Button size="small" onClick={() => setSelectedRow(row)}>Health</Button><Button size="small" danger={isCordoned.has(row.upstream.id)} icon={isCordoned.has(row.upstream.id) ? <CheckCircleOutlined /> : <StopOutlined />} onClick={() => void toggle(row)}>{isCordoned.has(row.upstream.id) ? "Uncordon" : "Cordon"}</Button></Space> },
  ];

  return <AntApp>
    {contextHolder}
    <section className="page-enter">
      <div className="page-heading">
        <div><div className="eyebrow">TARGET / {decodedTargetId}</div><h1>Runtime topology</h1><p className="muted">Read-only discovery from eRPC, with explicit operator cordons.</p></div>
        <Space><StatusDot status={snapshot?.status || "offline"} /><Tag color={statusColor(snapshot?.status || "offline")}>{snapshot?.status || "offline"}</Tag></Space>
      </div>
      {snapshot?.lastError && snapshot.status !== "healthy" && <Alert type="warning" showIcon message="Latest poll did not complete" description={snapshot.lastError} className="mb-4" />}
      <div className="stat-strip">
        <Stat label="Projects" value={counts.projects} />
        <Stat label="Networks" value={counts.networks} />
        <Stat label="Upstreams" value={counts.upstreams} />
        <Stat label="Poll latency" value={`${snapshot?.latencyMs ?? "-"} ms`} />
        <Stat label="Last success" value={snapshot?.lastSuccessAt ? formatTime(snapshot.lastSuccessAt) : "never"} />
      </div>
      <div className="toolbar-row"><Select value={selectedProject || undefined} placeholder="Filter project" allowClear options={(taxonomy.data?.projects || []).map((project) => ({ value: project.id, label: project.id }))} onChange={(value) => setProjectId(value || "")} /><span className="muted">{rows.length} discovered upstreams</span></div>
      <Table rowKey="key" columns={columns} dataSource={selectedProject ? rows.filter((row) => row.projectId === selectedProject) : rows} pagination={{ pageSize: 20, hideOnSinglePage: true }} className="ops-table" scroll={{ x: 760 }} />
      <HealthDrawer token={token} targetId={decodedTargetId} row={selectedRow} onClose={() => setSelectedRow(null)} />
    </section>
  </AntApp>;
}

function HealthDrawer({ token, targetId, row, onClose }: { token: string; targetId: string; row: { projectId: string; networkId: string; upstream: Upstream } | null; onClose: () => void }) {
  const project = useProject(token, targetId, row?.projectId || "");
  return <Drawer title={row ? `Health / ${row.upstream.id}` : "Health"} open={Boolean(row)} onClose={onClose} width={440}>
    {project.isLoading ? <Spin /> : project.isError ? <Alert type="error" message={project.error.message} /> : <>
      <div className="drawer-kv"><span>Project</span><strong>{row?.projectId}</strong></div>
      <div className="drawer-kv"><span>Network</span><strong>{row?.networkId}</strong></div>
      <div className="drawer-kv"><span>Runtime health</span><Tag color="cyan">Live from eRPC</Tag></div>
      <pre className="json-view">{JSON.stringify(project.data?.health ?? {}, null, 2)}</pre>
    </>}
  </Drawer>;
}

function Stat({ label, value }: { label: string; value: string | number }) { return <div className="stat-cell"><span>{label}</span><strong>{value}</strong></div>; }

function StatusDot({ status }: { status: string }) { return <span className={`status-dot status-${status}`} aria-label={status} />; }

function countTopology(projects: Project[]) { return projects.reduce((total, project) => ({ projects: total.projects + 1, networks: total.networks + project.networks.length, upstreams: total.upstreams + project.networks.reduce((count, network) => count + network.upstreams.length, 0) }), { projects: 0, networks: 0, upstreams: 0 }); }

function statusColor(status: string) { return status === "healthy" ? "green" : status === "degraded" ? "gold" : status === "unauthorized" ? "red" : "default"; }

function formatTime(value: string) { return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value)); }

export function App() {
  return <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="*" element={<RequireSession><AppShell /></RequireSession>} />
  </Routes>;
}
