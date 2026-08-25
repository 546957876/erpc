# eRPC Admin（Windows）

`Admin` 是独立于上游 eRPC 源码的本机管理服务。PostgreSQL 保存管理员账号和不可变配置版本；启动或重启时，Admin 校验最新版本、生成 YAML，并管理一个本地 eRPC 进程。

## 启动

```powershell
Set-Location E:\go\goProject\eRPC\Admin
$env:ERPC_ADMIN_DATABASE_URL = "postgres://<user>:<password>@127.0.0.1:5432/erpc_admin?sslmode=disable"
go build -o admin.exe ./cmd/admin
.\admin.exe -config .\admin.yaml
```

前端开发服务：

```powershell
Set-Location E:\go\goProject\eRPC\web
pnpm install
pnpm dev -- --port 8180
```

打开 `http://127.0.0.1:8180/login`。首次运行时创建唯一管理员；已有 `data/admin-auth.json` 会把原 bcrypt 哈希一次性迁入 PostgreSQL，并改名为 `.migrated`。

## 配置与运行

- 保存只创建新配置版本，不会自动重启 eRPC。
- 启动或重启会再次调用 `erpc.exe validate`，随后应用最新有效版本。
- 运行文件位于 `data/runtime/revision-<版本>/erpc.yaml`，日志位于 `data/runtime/erpc.log`。
- 停止时先发送 Windows `CTRL_BREAK`，超过 `shutdownTimeout` 才强制终止。
- Admin 只在 PID 与进程创建时间同时匹配时执行停止，避免误杀复用 PID 的其他进程。

## 数据与密钥

管理员密码只保存 bcrypt 哈希。按当前单机方案，eRPC RPC URL、Admin secret 和其他配置密钥会以明文保存于 PostgreSQL及生成的 YAML；数据库和 `Admin/data` 必须仅允许本机可信用户访问。

所有 eRPC 配置都通过中文字段表单维护。Admin 在保存和启动时内部生成
YAML，用户不需要编写、粘贴或理解 YAML。
