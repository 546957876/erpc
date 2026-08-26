import { Button, Popconfirm, Spin, Table, Tag, message } from "antd";
import { HistoryOutlined, RollbackOutlined } from "@ant-design/icons";
import { useConfigRevisions, useRestoreConfig, type ConfigRevision } from "../app/api";

export function RevisionsPage() {
  const revisions = useConfigRevisions();
  const restore = useRestoreConfig();
  const [apiMessage, contextHolder] = message.useMessage();
  if (revisions.isLoading) return <div className="center-state"><Spin size="large" /></div>;
  async function restoreRevision(revision: number) {
    try {
      const created = await restore.mutateAsync(revision);
      apiMessage.success(`已从 v${revision} 创建新版本 v${created.revision}`);
    } catch (error) { apiMessage.error(error instanceof Error ? error.message : "恢复失败"); }
  }
  const latest = Math.max(0, ...(revisions.data || []).map((item) => item.revision));
  return <section className="page-enter">
    {contextHolder}
    <div className="page-heading"><div><div className="eyebrow">不可变更记录</div><h1>配置版本</h1><p className="muted">恢复历史配置会创建一个新的版本。</p></div><Tag icon={<HistoryOutlined />} color="cyan">{revisions.data?.length || 0} 个版本</Tag></div>
    <Table<ConfigRevision> rowKey="revision" dataSource={revisions.data || []} pagination={false} className="ops-table" columns={[
      { title: "版本", dataIndex: "revision", render: (value) => <strong className="mono">v{value}</strong> },
      { title: "状态", dataIndex: "revision", render: (value) => value === latest ? <Tag color="green">最新</Tag> : <Tag>历史</Tag> },
      { title: "创建时间", dataIndex: "createdAt", render: (value) => value ? new Date(value).toLocaleString("zh-CN") : "-" },
      { title: "创建者", dataIndex: "createdBy", render: (value) => value || "administrator" },
      { title: "内容哈希", dataIndex: "contentHash", render: (value) => <span className="mono">{value?.slice(0, 16) || "-"}</span> },
      { title: "操作", key: "action", render: (_, row) => <Popconfirm title={`从 v${row.revision} 创建新版本？`} okText="确认" cancelText="取消" onConfirm={() => void restoreRevision(row.revision)}><Button size="small" icon={<RollbackOutlined />} disabled={row.revision === latest}>恢复为新版本</Button></Popconfirm> },
    ]} />
  </section>;
}
