# 昆明动物所2026 AI for Science实训营

正式域名：https://kiz-ai-camp-2026.tashan.ac.cn

本实例基于 wanggongjun/event-site-generator-template v5，保留他山手机号验证码登录、通用资料同步、私有OSS附件和飞书审核。只开放培训报名，不开放论文投稿。

## 更新与发布

部署源码位于私有仓库 TashanGKD/panshi-forum-2026 的独立分支 deploy/kiz-ai-camp-2026。该分支的推送只触发 Kunming AI camp 工作流，不更新论坛 main，不重启磐石论坛。流水线执行生产构建、打包、部署和只读上线核验，不运行模拟报名或短信测试。

本地模板与内容源位于 D:/kiz2026aicamp/kiz-ai-camp，活动事实维护在 input/kiz-ai-camp-2026/event.xlsx。先修改模板和工作簿，再执行 scripts/generate.py 生成 generated/kiz-ai-camp-2026，构建后从该实例分支发布。请勿只改生成文件后又覆盖生成。源Word为内部策划书，不作为公开下载资料发布。

## 会务操作

本营在原论坛飞书Base下有独立的 kiz-ai-camp-2026报名审核 表。旧论坛表和报名记录不改动。

- 审核时填写“当前状态”：待审核、审核中、需补充材料、已通过、未通过。
- 同时把“审核对应版本”填成当前“资料版本”，避免旧审核覆盖学员更新。
- “公开意见”会展示给该学员；会务备注仅供内部工作人员。
- 财务单独填写“缴费状态”：待确认、已缴费、未缴费、已退款；“缴费公开说明”展示给该学员。
- 报名修改后重新待审核，保留历史。缴费状态独立，不因报名审核自动改变。
- 学员从“注册报名”或“个人中心”登录查询。证明材料仅本人及授权会务人员可查看。
- 系统保留表用于兼容模板数据模型，不开放投稿入口，不要向其中录入报名。

费用暂定所有身份100元（拟），会场为（暂无）。正式收款账户按用户确认采用Word中的账户。实际转账由学员完成，本站不代扣款、不伪造支付成功。缴费凭证发送至会务邮箱，财务核验后更新飞书。

线上报名于2026-11-21 00:00:00（Asia/Shanghai，即11月20日24:00）关闭。之后按网站说明现场报名；既有学员仍可登录查询。

## 服务器

- 主机：8.147.58.40。
- 独立目录：/opt/events/kiz-ai-camp-2026/production。
- 应用：kiz-ai-camp-2026.service，只监听127.0.0.1:18316。
- 独立资料客户端：kiz-ai-camp-2026-profile，回环端口18914，沿用中央资料库；不替换现有认证和资料进程。
- Nginx：/www/server/panel/vhost/nginx/kiz-ai-camp-2026.tashan.ac.cn.conf。
- 私有OSS前缀：kiz-ai-camp-2026/production/，专用RAM身份只允许该前缀。
- shared/app.env、shared/profile.env、shared/oss-identity.json、shared/profile-secret仅保留在服务器，禁止提交Git。

每日03:20由 kiz-ai-camp-2026-backup.timer 备份SQLite、发布配置及恢复所需私有配置至shared/backups。备份目录权限700，文件600。附件原件保存在私有OSS；禁止删除活动前缀。备份包含凭据，仅供服务器管理员恢复。

kiz-ai-camp-2026-tls.timer 每日两次检查本站证书续期。发布失败恢复本站上一版链接和Nginx配置，保留报名数据及既有发布包。

## 验证范围

每次发布必须确认工作流成功、公开deployment.json对应当前提交，以及首页、健康接口、未登录账号接口响应符合预期。构建成功不代表部署完成。未经用户授权不发送验证码或创建真实报名记录；这类端到端验证与只读上线核验分别记录。
