# 独立活动后端 v3

Node24 + PostgreSQL。默认真实短信与飞书三表；不创建网站admin/账号。活动内容只由唯一XLSX生成，飞书只处理审核/私有问题回复。密钥放部署Secret/env，原`.env.example`不含可用凭据。

## 启动与接入

实例根先`npm ci`、`npm run build`。按`.env.example`安全提供PUBLIC_ORIGIN、DATABASE_URL、SMS provider和既有FEISHU应用。PUBLIC_ORIGIN须真实HTTPS且精确匹配浏览器Origin，三张table ID必须不同。

```sh
node --env-file=.env.production backend/feishu-init.js --plan
node --env-file=.env.production backend/feishu-init.js --dry-run
# 明确授权指定base及plan新增项后：
node --env-file=.env.production backend/feishu-init.js --apply --authorize-base=<plan appToken>
node --env-file=.env.production --env-file=.env.feishu.ids backend/check.js
node --env-file=.env.production --env-file=.env.feishu.ids backend/start.js
```

FEISHU_BITABLE_URL支持官方base/wiki目标（wiki必须解析到bitable），或已知APP_TOKEN。plan只读、列出复用/新增/冲突，apply只加表/字段、不删记录、不改权限；缺选项/类型冲突停止，不全量替换已有SingleSelect属性。重复apply复用已完成操作。建表资源授权、应用scope和协作者权限分别验证，check只证明结构读取和运行配置，不能代表真实写出/回读/短信验收。

首次生产start在本活动数据库建表/加列，保留已有业务。check不做迁移，未初始化会明确报告。一个库只能属于一个活动slug，不能偷偷复用另一活动账号。

## 私有API

写请求要求相同PUBLIC_ORIGIN和JSON，认证cookie HttpOnly、SameSite=Strict，真实模式Secure。

- GET /api/public/config：仅公开活动内容，无来源笔记、准备度、hero诊断或runtime模式
- POST /api/auth/sms/request：{phone,purpose:'register'|'reset'}；成功只表示提供方请求已受理，无公开验证码
- POST /api/auth/register：{phone,password,code}
- POST /api/auth/login：{phone,password}
- POST /api/auth/reset：{phone,password,code}，成功后撤销所有旧session
- POST /api/auth/logout
- GET/PATCH /api/me/profile，共用资料首次申请后锁定，手机号不可自改
- GET/POST /api/me/attendance，需资料完整/真实容量及开放窗口
- GET/PUT /api/me/submission，保存单份草稿；POST /api/me/submission/submit正式提交
- POST /api/me/submission/supplement，只{note,attachmentIds}，需needs_materials和补料窗口，审核轮次+1
- POST /api/me/files：{name,contentBase64}，仅真实PDF/DOCX/PPTX，按配置大小/附件数及账户配额；GET /api/me/files/:id必须本人
- GET /api/me/questions：{questions:[{id,question,reply,createdAt,repliedAt}]}，只本人记录
- POST /api/me/questions：{question,requestId}，问题trim后1–5000字符，requestId为UUID或10–80字母数字_-；首次201，同键同内容重试200，同键不同内容409；可靠DB提交后返回{question:记录}
- GET /api/me/questions/:id：仅本人，否则404；不提供用户自改/删除/追问API

未回复reply=''、repliedAt=null；工作人员回复更改后同步覆盖该条单个回复。没有即时聊天、公开FAQ转换或消息通知。每次读取均用session user_id过滤，不能用请求body指定归属。内部备注仅存在DB和飞书，公共与个人API都不返回。

提交状态：draft草稿、under_review审核中、needs_materials需补材料、accepted录用/报名批准、rejected未录用/报名未批准。报名只批准/拒绝；投稿一人一份，录用自动参会，与独立批准报名按人去重，容量只软提醒工作人员，不收费。

## 飞书审核与同步

固定表schema见feishu-schema.js，init自动发现/创建报名、投稿、问答。工作人员编辑审核状态、反馈（对本人可见）、内部备注（不可见）或问答回复。程序不从飞书编辑活动内容、不猜用户归属。不要改用户ID/问题ID/审核轮次等机器归属列。

约60秒同步，先拉取核对映射与审核轮次再应用，旧轮次不覆盖补料；工作人员状态纠错可在同一轮反映。随后单批次共享三表索引、逐条写出隔离失败。除真正补料新轮外写出不覆盖工作人员列，问答写出从不覆盖回复。稳定业务键与官方client_token在成功响应丢失/本地确认失败后避免重复记录。

DB是接收事实：已提交业务行和附件保留直到正常更新，飞书暂时失败继续重试，不把失败写成发送完成，不停止展示页。sync_health及内部日志记录最近尝试/成功、连续失败和简短错误，不提供公开运维面板。

```sh
node --env-file=.env.production --env-file=.env.feishu.ids backend/sync.js
node --env-file=.env.production --env-file=.env.feishu.ids backend/check.js
```

同步失败保留数据；修复网络/scope/协作者权限/表结构后重跑。生产备份整库（包括files BYTEA、问题回复、映射和历史），同时保存内容表/公共素材/IDs；在新的隔离数据库恢复演练后再经负责人批准切换。用官方pg_dump/pg_restore或托管PG PITR，不复制运行目录、不删除PG锁文件、不用重初始化替代恢复。更详细执行清单在模板docs/deployment-handoff.md。

## 开发和测试

明确开发命令、测试验证码与持久化生命周期回归见 development/README.md。生产与公开端不提供这些工具入口。

## 验证边界

npm test真实隔离PostgreSQL，飞书transport/SMS有明确mock。覆盖归属、DB接收失败、同步恢复、稳定键幂等、旧轮次、内部备注、初始化冲突/权限、缺配置生产拒绝等。它不证明真实租户连通。无真实凭据时必须记录真实短信/飞书端到端、部署/TLS和真实浏览器未验。
