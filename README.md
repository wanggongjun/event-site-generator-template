# 活动网站与系统生成模板 v4

可重复运行的代码模板，由唯一 XLSX 和配套公共素材生成一场独立的中文会议、论坛或实训活动。保留panshi原站的公开端视觉与认证交互，后台收敛为固定的参会报名、在线投稿和私有问答模型，不需要下一位 Agent 从零重写应用。交付分为两部分：可复用模板源码包，以及由活动资料生成的实际活动实例包。

v4 默认使用真实服务，飞书是唯一审核与回复入口。缺凭据仍可生成代码、物料和静态六页，但不能称为完整生产系统。代码/本地测试/真实服务验收分开记录，见 [验证边界](docs/VALIDATION.md)。本次不推送或部署任何真实系统。

## 1. 一次准备资料

执行入口为 [SKILL.md](SKILL.md)。先检查已有资料，一次收齐缺少的活动内容与接入资料，详细字段见 [配置契约](docs/config-schema.md)，原手册与横幅处理见 [内容输入](docs/content-input.md)。

- 内容：名称、日期/时区、场馆/地址、简介、机构、分日日程、须知、食宿、交通、联系人、资料、FAQ、品牌与素材授权
- 开放：真实容量、报名窗口、投稿窗口、补料截止时间；未知就留空，开放前询问负责人
- 接入：HTTPS域名、独立PostgreSQL、短信服务、目标飞书多维表链接/应用身份、该资源读写和建表授权、负责人的飞书协作者权限

内容只编辑指定XLSX/公共素材，飞书不编辑嘉宾日程等活动事实。密码、App Secret、数据库URL和短信密钥只放部署Secret或被忽略的本地env，不能放聊天、内容表或GitHub。

## 2. 安装、生成、测试

需要Node 24、Python 3.11+，首次安装使用官方包仓库。在模板根目录建立项目环境：

```sh
python3 -m venv .venv
.venv/bin/python -m pip install --cache-dir .cache/pip -r requirements.txt
.venv/bin/python scripts/create_sample.py input/new-event
# 编辑唯一内容表，清空虚构示例，替换全部事实/品牌/素材
.venv/bin/python scripts/validate_config.py input/new-event/event.xlsx
.venv/bin/python scripts/generate.py input/new-event/event.xlsx
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
```

Windows PowerShell用 `py -3 -m venv .venv`，后续Python路径替换为 `.\.venv\Scripts\python.exe`，无需激活或改执行策略。

生成器打印唯一输出目录，默认 `generated/<event.slug>`。进入它，安装一次依赖：

```sh
npm ci
npm run build
npm test
npm run test:frontend
```

不要用 `npm --ignore-scripts`，内嵌测试PostgreSQL需要官方依赖的安装脚本。后端回归使用专用临时真实PostgreSQL；TEST_DATABASE_URL只能指向可丢弃专用测试库。协议mock不连接真实飞书或发送短信。

公开配置镜像只含活动内容，`config.json`和manifest保留内部核验信息。用户入口是运行服务提供的六页网站，物料直接展示活动事实。页面检查工具仅在测试目录，测试输出不进入成品包。

## 3. 飞书三表 plan / apply

先把应用身份/密钥和目标多维表链接放实例根 `.env.production`，只填写 `.env.example` 中有说明的接入项；实际密钥留在安全部署配置。支持飞书base链接和可解析为Bitable的wiki链接。详细权限与恢复步骤见 [接入与运行](docs/deployment-handoff.md)。

```sh
# 只读检查，列出将复用/新增的三表与字段，不写入多维表
node --env-file=.env.production backend/feishu-init.js --plan
node --env-file=.env.production backend/feishu-init.js --dry-run
# 负责人明确批准plan中的指定资源和新增项后，使用plan返回的appToken
node --env-file=.env.production backend/feishu-init.js --apply --authorize-base=<plan返回的appToken>
```

已有兼容报名、投稿、问答表会复用；缺表/字段只新增，状态类型/选项冲突或多重候选停止并报告，不删除原数据、不改协作者权限。重复执行会再发现已建表，不重复创建。apply默认保存 `.env.feishu.ids`（只有资源IDs，无密钥）；已兼容的只读plan可加 `--output=.env.feishu.ids` 保存IDs。

建表授权、应用API权限、表格协作者权限是三个独立条件。脚本不会创建凭据、开权限或邀请人员。只读plan通过也不证明写权限、附件上传或审核回读通过。

## 4. 接入检查与生产启动

```sh
node --env-file=.env.production --env-file=.env.feishu.ids backend/check.js
node --env-file=.env.production --env-file=.env.feishu.ids backend/start.js
# 无需常驻HTTP服务的一次同步：
node --env-file=.env.production --env-file=.env.feishu.ids backend/sync.js
```

首次生产启动会为此活动创建/加列自己的数据库表，已有记录保留；尚未初始化的数据库在check中会明确报告。初次启动前先核对连接属于此活动且具备建表授权。默认真实模式要求HTTPS来源、数据库、真实短信配置和三表IDs；缺飞书不能回退模拟。

后端先提交PostgreSQL再返回接收成功，飞书同步故障不会撤销已接收的报名/投稿/问题，也不停止静态展示。约60秒自动重试，稳定业务键/远端幂等键防重复，新补料有独立审核轮次。工作人员只在飞书修改审核状态、公开反馈、内部备注或问题回复。内部备注真实保存但不返回用户API。

## 5. 固定业务

- 六页：首页、交通住宿、联系我们、相关资料、静态FAQ、个人中心；录播仅内容表开启时展示
- 短信注册并设置密码、手机号密码登录、短信重置；已验证手机号不可自改
- 参会报名需审核；每账号一份投稿：草稿、审核中、需补材料、录用、未录用；提交后主字段锁定，补料只说明和附件
- 录用自动参会，与独立批准报名按人去重，共享软容量；不收费
- 我的问题：登录提交问题，仅本人查看记录和一份可更新回复；工作人员在第三张飞书表回复，后端同步

不增加网站admin/账号、通用流程引擎、支付发票、公开问答、实时聊天、追问、通知、后台禁用账号或强制重置密码、共享账号、多租户或活动内容反向同步。

## 开发与验收资料

开发测试命令集中在 `template/backend/development/README.md`。这些工具不出现在公开页面，也不作为客户展示或交付入口。真实服务验收与未验范围见 [验证边界](docs/VALIDATION.md)。

## 更新、备份与交付

只改原XLSX/公共素材，重新生成、build并正常重启。保留数据库、附件、env和未知用户文件，不更换已有slug。一个PG目录只允许一个运行所有者，不能删除postmaster.pid绕过保护。停止原启动终端Ctrl+C，等“Shutdown complete”及终端返回；不要强杀或直接关终端。Windows官方pg_ctl正常停机与一键回归见 [Windows运行说明](docs/windows.md)。

```sh
.venv/bin/python scripts/package_delivery.py --destination ../template-source-delivery --zip ../template-source.zip
.venv/bin/python scripts/package_instance.py --instance generated/<event.slug> --input input/new-event/event.xlsx --destination ../event-instance-delivery --zip ../event-instance.zip
```

两包分开；排除依赖、数据库、用户附件、日志、运行时env。实例source-input是追溯快照，不是第二份编辑源。备份、恢复、告警、真实预发布验收见 [接入与运行](docs/deployment-handoff.md)。生成/打包不授权购买服务、创建外部账号、推GitHub或部署。

## v4 源头修复

v4基于main `9d6f00c54b77aeb1a6aa78c5d6080df316ab386c`，修复Windows内嵌PG强杀/残留锁、重复关闭和跨平台权限断言。保留用户README的panshi命名与v3业务；没有Windows实机结果就明确未实测，详见 [验证边界](docs/VALIDATION.md)。本轮只交付源码，当前旧v3附件已移除；旧提交留在Git历史。
