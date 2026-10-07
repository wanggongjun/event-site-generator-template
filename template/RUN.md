# 运行独立活动实例 v4

内容源是生成它的唯一XLSX与公共素材；生成JSON不另编辑，飞书只处理业务审核与私有问答。需要Node24，在本目录执行一次：

```sh
npm ci
npm run build
npm test
npm run test:frontend
```

访问生产启动时显示的活动网站地址，六页直接呈现活动内容。内部测试工具与输出不作为本项目的用户入口。

## 真实接入

按 `backend/.env.example` 将数据库、短信和飞书已有应用身份放部署Secret或被忽略的 `.env.production`。先取得对明确目标多维表的读权限，再运行只读plan。申请该资源的必要应用权限和协作者权限，由负责人处理，不自动创建凭据或扩权。

```sh
node --env-file=.env.production backend/feishu-init.js --plan
# 负责人确认plan具体资源与新增项后：
node --env-file=.env.production backend/feishu-init.js --apply --authorize-base=<plan的appToken>
node --env-file=.env.production --env-file=.env.feishu.ids backend/check.js
node --env-file=.env.production --env-file=.env.feishu.ids backend/start.js
```

已有兼容三表会复用，重复apply不重建、不删原数据。冲突看内部报告；check默认不发送短信或写飞书，不能以通过check代替端到端验收。首次启动在指定本活动数据库加表/加列，已存在记录保留。默认真实模式缺配置会失败，不能称作完整系统。

真实容量和相关报名/投稿/补料窗口仍缺时，回到唯一XLSX向负责人确认并补齐，不能猜；访客正常按钮可见，提交失败才显示简短错误。审核只在飞书，约60秒同步。用户我的问题仅自己可读，飞书一条问题一份可更新回复。

停止原启动终端Ctrl+C，等待“Shutdown complete”及终端返回后再启动。内嵌开发PG用官方pg_ctl正常停机，等待进程退出，不taskkill；外部生产PG不由应用停机。不要直接关闭终端或强杀Node。每活动独立slug/数据库，不能删除postmaster.pid绕过所有者保护。更新只改原XLSX/公共素材、重新生成和build并正常重启，保留数据库、附件、env。

Windows在实例根执行 `npm run test:windows` 可跑隔离回归，自动测试走受控IPC停机，不能代替真实终端Ctrl+C检查；Linux运行会明确SKIP，不是Windows通过。开发端口/路径与PowerShell命令见 `backend/development/README.md`。

详细API、告警与备份恢复见backend/README.md。外部发布、采购、推仓库及权限修改需单独授权。
