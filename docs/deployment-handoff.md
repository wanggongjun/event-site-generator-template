# 测试与正式部署

每个生成实例带 .github/workflows/deploy.yml。staging 分支使用 GitHub Environment `staging`，main 使用 `production`；两者分别设置 Secrets/Variables。不要把生成模板仓库本身当作活动发布仓库。

## 首次准备

- Node 24、systemd、Nginx；独立域名/DNS/TLS。按 ops/nginx.conf.example 建该环境自己的虚拟主机，先 nginx -t，再 reload。证书申请按当前服务器既有工具完成，不接管其他虚拟主机。
- 服务目录固定派生为 `/opt/events/<slug>/<environment>`；提前创建 shared/app.env（0600），数据目录为其 shared/data。首次运行自动建 SQLite 业务恢复表；不使用原活动数据库。
- 端口各环境不同。服务名 `event-<slug>-<environment>`，env 的 PUBLIC_ORIGIN、PORT、DEPLOY_ENV、FORUM_DATA_DIR、OSS 前缀与部署目标一致。
- 各环境独立飞书两表和 OSS 授权；测试认证及总库使用测试资源。模板不会替你创建中央认证测试栈或复制正式用户数据库。
- GitHub Environment Secrets：DEPLOY_HOST、DEPLOY_USER、SSH_PRIVATE_KEY、SSH_KNOWN_HOSTS、OSS_BUCKET、OSS_REGION、OSS_ACCESS_KEY_ID、OSS_ACCESS_KEY_SECRET；Variables：EVENT_DOMAIN、EVENT_PORT。SSH 用户需有获批的 sudo 部署权限。
- 私有 app.env 中填认证、资料总库、飞书与 OSS 参数。配置好后运行 check:integration，再实际测试验证码、提交和审核。机密不写入仓库。

## 更新

更新原 Word/XLSX/素材 → 比对差异 → 生成 → 构建/回归 → staging 发布和登录后视觉验收 → 按该活动上线授权进入 main。

工作流先上传公开下载至该环境 OSS，再打包 dist/backend/config（不含材料原件、测试身份服务、凭据和数据库）。服务端核对活动/环境/资源路径，切换 current，检查本地 healthz 及公开 deployment.json 的提交版本。失败恢复原 current 和服务；首次失败停止新服务。旧 release 不自动删除。

## 回退与重建

回退：将 current 指向该环境已有的上一 release，重启该环境服务，核对 revision。业务数据和 OSS 不随回退删除。

重建测试：新建独立前缀、空表、数据目录和 env，再部署同一分支。不要删除正式表、跨环境复用 state 或用生产总库测试写入。本轮没有真实服务器部署结果，模板工作流与 Linux 配置仍需在具备权限的独立测试目标实际执行。
