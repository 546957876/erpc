import { Alert, Button, Space, Spin, Tag, message } from "antd";
import { PauseCircleOutlined, PlayCircleOutlined, ReloadOutlined, SettingOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { useCurrentConfig, useRuntimeAction, useRuntimeStatus } from "../app/api";

export function OverviewPage() {
  const navigate = useNavigate();
  const runtime = useRuntimeStatus();
  const current = useCurrentConfig();
  const start = useRuntimeAction("start");
  const stop = useRuntimeAction("stop");
  const restart = useRuntimeAction("restart");
  const [apiMessage, contextHolder] = message.useMessage();
  const status = runtime.data;
  const busy = start.isPending || stop.isPending || restart.isPending;

  async function operate(action: "start" | "stop" | "restart") {
    const mutation = action === "start" ? start : action === "stop" ? stop : restart;
    try {
      await mutation.mutateAsync();
      apiMessage.success(action === "start" ? "eRPC 已启动" : action === "stop" ? "eRPC 已停止" : "eRPC 已重启");
    } catch (error) {
      apiMessage.error(error instanceof Error ? error.message : "运行操作失败");
    }
  }

  if ((runtime.isLoading || current.isLoading) && !status) return <div className="center-state"><Spin size="large" /></div>;
  return <section className="page-enter">
    {contextHolder}
    <div className="page-heading">
      <div><div className="eyebrow">本机实例</div><h1>运行概览</h1><p className="muted">配置保存与进程应用相互独立。</p></div>
      <Space wrap>
        <Button icon={<SettingOutlined />} onClick={() => navigate("/advanced")}>编辑配置</Button>
        {status?.state === "running" ? <Button danger icon={<PauseCircleOutlined />} loading={busy} onClick={() => void operate("stop")}>停止</Button> : <Button type="primary" icon={<PlayCircleOutlined />} loading={busy} disabled={!current.data?.revision} onClick={() => void operate("start")}>启动</Button>}
        <Button icon={<ReloadOutlined />} loading={busy} disabled={status?.state !== "running"} onClick={() => void operate("restart")}>重启并应用最新配置</Button>
      </Space>
    </div>
    {(runtime.isError || current.isError) && <Alert type="error" showIcon message="管理服务不可用" description={(runtime.error || current.error)?.message} className="mb-4" />}
    {status?.lastError && <Alert type="warning" showIcon message="最近一次进程异常" description={status.lastError} className="mb-4" />}
    <div className="runtime-panel">
      <div className="runtime-primary"><StatusLight running={status?.state === "running"} /><div><span>进程状态</span><strong>{status?.state === "running" ? "运行中" : "已停止"}</strong></div></div>
      <RuntimeValue label="进程 PID" value={status?.pid || "-"} />
      <RuntimeValue label="运行配置版本" value={status?.runningRevision ? `v${status.runningRevision}` : "未应用"} />
      <RuntimeValue label="最新配置版本" value={status?.latestRevision ? `v${status.latestRevision}` : "尚未创建"} />
      <div className="runtime-version-state">{status?.outOfDate ? <Tag color="gold">等待重启应用</Tag> : <Tag color="green">版本一致</Tag>}</div>
    </div>
    <div className="detail-band">
      <RuntimeValue label="eRPC 版本" value={status?.binaryVersion || "未读取"} />
      <RuntimeValue label="构建提交" value={status?.binaryCommit || "当前二进制未注入"} />
      <RuntimeValue label="进程启动时间" value={status?.processStartedAt ? new Date(status.processStartedAt).toLocaleString("zh-CN") : "-"} />
      <RuntimeValue label="配置哈希" value={current.data?.contentHash?.slice(0, 16) || "-"} />
    </div>
  </section>;
}

function StatusLight({ running }: { running: boolean }) { return <span className={`status-light ${running ? "running" : "stopped"}`} />; }
function RuntimeValue({ label, value }: { label: string; value: string | number }) { return <div className="runtime-value"><span>{label}</span><strong>{value}</strong></div>; }
