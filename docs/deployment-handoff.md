# v4 接入、权限与上线检查

这是执行者的内部接入说明，不放进公开活动页面。没有真实凭据可以生成代码和静态页，不能宣布生产就绪。真实容量、报名/投稿/补料窗口仍缺时，交付前问负责人确认。

## 首轮要拿到的接入材料

- 指定活动、唯一内容XLSX、公开素材授权、真实容量与相关窗口
- 目标HTTPS域名及部署位置，独立PostgreSQL连接由Secret/env提供
- 既有短信提供方及已批准签名/模板，凭据放Secret/env
- 目标飞书多维表完整base或wiki链接，既有应用APP_ID/APP_SECRET由Secret/env提供
- 对这个目标资源的读取授权，以及plan中建表/加字段的明确授权
- 应用API权限与多维表的应用协作者权限；实际审核/回复工作人员的人员访问权限

不让客户猜table ID。执行者先解析链接，运行plan列出资源、表和字段，再用获批apply保存IDs。用户的资源授权不会自动开启应用scope或协作者权限；执行者不会创建密钥、扩权或邀请人员。

## 1. 固定三表初始化

实例目录的 `backend/.env.example` 是完整变量说明。真实密钥写部署Secret或被忽略的 `.env.production`，不能写内容表、聊天和GitHub。默认APP_MODE=real，FEISHU_MODE=real，生产HTTPS来源必须精确匹配浏览器地址。

```sh
node --env-file=.env.production backend/feishu-init.js --plan
node --env-file=.env.production backend/feishu-init.js --dry-run
```

两者只读取多维表结构（认证token交换使用官方POST，但不修改表资源），返回appToken、匹配表、将新增的表/字段、冲突和权限错误。支持官方feishu.cn的 `/base/<token>` 与 `/wiki/<node token>` 链接；wiki需应用能读该节点，且目标必须是Bitable。也可直接用FEISHU_BITABLE_APP_TOKEN。链接/token不一致会停止。

固定表名：报名、投稿、问答。异名但辨识列和类型兼容的单一表会复用，多个候选要求明确选择。既有类型冲突、缺机器状态选项或重复字段名不会自动改坏原表，先报负责人处理并重新plan。只新增缺表/字段，不删除记录、不替换选项、不改视图权限。

负责人明确批准对应base及plan新增项后：

```sh
node --env-file=.env.production backend/feishu-init.js --apply --authorize-base=<plan返回的appToken>
```

apply只在指定现有base内做加法，完成再检查schema，保存 `.env.feishu.ids`：APP_TOKEN及三TABLE_ID，无secret。已完全适配时 `--plan --output=.env.feishu.ids` 可只读保存IDs。重复/中断后先plan，已完成操作会被发现复用，不重复创建。失败报告保留completed operations，不用删原表重来。

## 2. 权限的三个层次

1. 资源/行为授权：负责人批准读该base、以及具体新增表/字段，apply要求精确appToken
2. 应用API权限：管理员在开发者后台给既有应用授权并发布需要的API。按下方官方API页的当前“权限要求”确认表/字段读取创建、记录读写、附件上传以及wiki（若使用）权限
3. 协作者/人员权限：应用还要被允许访问目标base；工作人员应能编辑审核状态/反馈/内部备注或问答回复，网站用户不能获授这三表访问权

计划中 `app_scope` 与 `resource_permission` 分别报告，不把“用户说可以建表”当作服务权限。plan/只读check通过不证明写权限。apply实际成功只证明本次用到的建表/字段写权限，记录更新和附件上传仍要端到端核验。脚本不创建凭据、改变授权或邀请人员。

官方参考：[Token](https://open.feishu.cn/document/server-docs/authentication-management/access-token/tenant_access_token_internal)、[建表](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table/create)、[字段](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-field/create)、[记录创建](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-record/create)、[记录更新](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-record/update)、[附件上传](https://open.feishu.cn/document/server-docs/docs/drive-v1/media/upload_all)、[Wiki节点](https://open.feishu.cn/document/server-docs/docs/wiki-v2/space-node/get_node)。代码同时按官方SDK核对协议，来源清单在 `backend/feishu-schema.js`。mock协议回归不是真实租户验收。

## 3. check与启动

```sh
node --env-file=.env.production --env-file=.env.feishu.ids backend/check.js
node --env-file=.env.production --env-file=.env.feishu.ids backend/start.js
```

check核验活动事实、真实SMS配置格式、已加载运行必需IDs、飞书三表只读schema访问、数据库事件身份/必要表及持久化同步健康；不发短信、不写飞书、不建数据库表。初次尚未初始化数据库会明确报告，请先确认连接属于此活动且具备建表授权，再启动后端做加表/加列迁移并重新check。已有数据保留；其他活动/有未归属账户的数据库拒绝占用。

缺真实飞书、短信、数据库或HTTPS时默认启动失败；不回退simulation。开发模拟必须显式dev:simulation，NODE_ENV=production拒绝模拟。检查报告 `productionAcceptancePassed` 保持false，真实验收由执行者另外记录，不因为schema可读而声称生产就绪。

## 4. 真实预发布验收

用获授权的隔离预发布资源/测试账号进行，先核对收件数据与接入目标：

- 真实短信注册、密码登录和短信重置，失败没有假成功或公开code
- 参会申请进指定报名表，工作人员accepted/rejected反馈回到本人个人中心
- 投稿及附件进入指定表，录用自动参会并按人去重
- needs_materials → 用户补说明/附件 → 新审核轮次under_review → 再审核；旧轮次状态不覆盖新材料
- 飞书工作人员internal备注真实保存，任何用户API都看不到
- 两账号各提交问题；每条进入问答表，工作人员修改一份回复，约60秒同步；另一用户连直接记录URL也不可读
- 短暂关闭飞书访问/模拟超时，已DB接收的记录不丢，页面可用，恢复后重试去重；禁止故障时宣称真实处理完成
- 精确HTTPS来源、Cookie和部署退出/重启、备份恢复验证

## 5. 告警与备份恢复

同步每60秒执行，DB业务行是可靠待发送源；仅适配器确认后的snapshot标记已写出，远端业务键和UUIDv4 client_token防止“远端成功、本地确认失败”后重复。一个周期共享三表索引，逐记录错误不拖垮其他记录。数据库sync_health保存last_attempt、last_success、连续失败次数和简短错误；后台stderr输出内部错误，公开API只给简短业务失败。

部署日志采集/负责人或执行AI应观察连续失败和last_success停滞；未配监控时不要称自动告警已启用。check也返回syncHealth，执行AI每轮对话把新问题/未验风险反馈给负责人，不在成品网页放诊断。现场持续失败时保留DB，检查官方错误码、scope、协作者访问、网络及配额，修好后重跑sync，不删映射/原记录。

所有账户、附件BYTEA、申请、问题/回复、映射和审核历史在同一PostgreSQL。备份整库，同时安全保存唯一内容XLSX/公共素材、资源IDs和部署配置；secret用自己的安全备份渠道，勿进ZIP/GitHub。按业务能承受的RPO安排备份，要求更小损失窗口时用托管PG连续备份/PITR，不能把每日快照说成零数据损失。

数据库操作者在Secret/env中配置标准PGHOST/PGPORT/PGUSER/PGDATABASE/PGPASSWORD，使用与服务器兼容的官方PostgreSQL工具：

```sh
pg_dump --format=custom --file=/safe/backup/event-business.dump
# 定期在一个新的、仅本次演练用数据库中恢复，服务保持停止
pg_restore --exit-on-error --dbname=<新的演练数据库名> /safe/backup/event-business.dump
```

恢复前停止目标服务、核实备份活动slug、资源IDs和备份时间。先在隔离新库演练，核对用户/附件/申请/问题/映射/历史及两用户隔离，再经负责人批准切换；不要直接覆盖唯一生产库。旧备份比飞书审核轮次旧时会安全拒绝过期写出，应先人工核对差异，不重置映射来强推旧审核。不能复制正在运行的PG目录、删postmaster.pid或以重新初始化当恢复。
