# 活动网站与系统生成模板 v2

可重复运行的代码模板，由唯一 XLSX 和配套公共素材生成一场独立的中文会议、论坛或实训活动。保留磐石原站的公开端视觉与认证交互，后台收敛为固定的参会报名和在线投稿模型，不需要下一位 Agent 从零重写应用。v2 单独交付，不改动 v1、原仓库、线上系统或旧学员数据，也不自动发布。

交付分为两部分：可复用模板源码包，以及由原始会议手册生成的实际活动实例包。手册实例可在本地运行，但缺失的运营事实仍然未知，报名和投稿最终提交暂不开放。

## 安装一次，生成实例

需要 Node 24、Python 3.11+；首次安装需要官方包仓库网络。在模板包根目录建立项目专用虚拟环境，不向系统 Python 或用户目录安装。

Linux / macOS：

```sh
python3 -m venv .venv
.venv/bin/python -m pip install --cache-dir .cache/pip -r requirements.txt
```

Windows PowerShell（无需激活脚本或修改执行策略）：

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --cache-dir .cache/pip -r requirements.txt
```

以下 Python 命令展示 Linux/macOS 路径；Windows 将 `.venv/bin/python` 替换为 `.\.venv\Scripts\python.exe`。所有配置校验、生成和 Python 测试使用这个项目环境。

从原始文档开始时，先按下文“从 PDF/Word 手册建立新输入”建立唯一输入。本独立生成包没有真实手册预填工作簿、转录答案或已生成活动。虚构示例只提供格式，先清空全部不来自新资料的事实，然后逐页录入；重复名称、日期、地址和机构名单使用固定引用。

```sh
.venv/bin/python scripts/create_sample.py input/new-event
# 按原资料编辑唯一XLSX，未知运营事实留空；若有原横幅，先查看与规范事实相符
# 可选：.venv/bin/python scripts/bind_hero.py input/new-event/event.xlsx --confirm-current-facts
.venv/bin/python scripts/validate_config.py input/new-event/event.xlsx
.venv/bin/python scripts/generate.py input/new-event/event.xlsx
# 进入生成器打印的唯一实例目录
npm install
npm run build
npm test
npm run demo
```

若拿到的是已经生成的活动实例包，直接进入它的根目录，按 `RUN.md` 执行上述四条 npm 命令，不需要重新安装模板 Python 环境。每个生成实例只安装一次 Node 依赖；更新内容不重复安装，也不用在 `template/` 另装一套。

打开终端显示的精确地址，默认 `http://localhost:3000`。默认使用实际本地 PostgreSQL 16，数据保存在实例 `backend/data/postgres`；短信和飞书是醒目标记的模拟服务，绝不会发送真实短信或写入真实飞书。注册界面显示本地模拟验证码，审核模拟台位于 `/simulation`，默认约一分钟同步，也可点“立即同步”。模拟模式仅监听本机。

不要使用 `npm --ignore-scripts`，内嵌 PostgreSQL 的安装脚本需要准备原生文件链接。停止时在原启动终端按 Ctrl+C，等待 Node 和 PostgreSQL 完整退出及停机日志，再重新启动。下次启动保留账号、附件和业务记录。

同机演示端口冲突时先停止另一实例，或指定独立端口：

```sh
PORT=3001 PG_PORT=55433 PUBLIC_ORIGIN=http://localhost:3001 npm run demo
```

Windows PowerShell：

```powershell
$env:PORT='3001'; $env:PG_PORT='55433'; $env:PUBLIC_ORIGIN='http://localhost:3001'
npm run demo
```

浏览器地址必须与 `PUBLIC_ORIGIN` 一致。不同活动必须有独立 slug、输出目录和数据库。自行提供 PostgreSQL 时通过环境变量设置 `DATABASE_URL`；真实模式另需 HTTPS 与真实服务配置，见 [后端运行说明](template/backend/README.md) 和 [交接清单](docs/deployment-handoff.md)。

## 一份事实源，未知事实留空

活动事实只在 XLSX 的规范字段填写一次；介绍、须知、FAQ 等需要重复展示事实时使用下面的固定引用。公共素材从工作簿相对路径引用。生成 JSON、网页、Word、海报、宣传稿和飞书均不是另一个可编辑事实源。工作簿不存密码、数据库 URL 或短信/飞书密钥；账号、私有附件及审核记录保存在独立运行时数据库。

- 仅知道活动日期时填写 `event.startDate/endDate`，不要编造午夜、日末或具体集合时刻；`startAt/endAt` 可为 null
- 未提供容量、报名/投稿窗口时留空，规范化为 null；不使用容量 1、1970 年或任意“无限开放”窗口凑齐配置
- 未提供面向人群或参训资格时留空，不从活动名称、人物身份或主题推断
- 某条日程时刻、地点未知时显示“时间待通知”“地点待通知”，不能写成 00:00—23:59
- `event.location` 保存场馆名，`travel.address` 保存完整街道地址，不在地址中再重复场馆和活动名

`config.readiness` 列出未决事实并独立判断参会报名和投稿准备度。已知真实容量加完整报名窗口才允许最终报名；已知真实容量加完整投稿窗口才允许最终投稿与补料。缺少其中一类窗口只影响相应流程，缺少容量影响两项最终提交。后端会重新计算并在实际 API 边界拒绝条件不齐的操作，不靠隐藏按钮保护。

预览状态仍允许注册、密码登录/重置、个人资料、私有文件和投稿草稿准备，继续遵守所有权、配额和已提交锁定规则；已知窗口仍按当前时间检查。`readiness.mode=ready` 仅表示配置事实齐全，不代表窗口当前开放、真实服务已验收或活动可以生产上线。它也独立于短信/飞书的 `simulation/real` 运行模式。

海报、指南与社媒文案省略未知容量和截止时间，预览物料明确标为草稿或会务预览。确认缺失事实后修改同一 XLSX 再生成，无需重置数据库。精确表头、字段与默认值见 [配置契约](docs/config-schema.md)。

## 正文引用与静态横幅同步

正文只支持这八个固定字面引用：`{{event.title}}`、`{{event.shortTitle}}`、`{{event.dateRange}}`、`{{event.location}}`、`{{travel.address}}`、`{{organizers.主办单位}}`、`{{organizers.协办单位}}`、`{{organizers.支持单位}}`。日期范围由规范日期派生，同角色机构按表中顺序用“、”连接。

例如 intro 的一个单元格可写：

“{{event.title}}将于{{event.dateRange}}在{{event.location}}举办，由{{organizers.主办单位}}主办。”

交通正文可写“会场：{{event.location}}。地址：{{travel.address}}。”。这些引用可用于 intro、亮点、交通正文，以及日程/须知/食宿/酒店/联系人说明/FAQ/资料/回放等允许的公共文字字段；不用于规范事实字段、URL、素材路径、日期、分组 ID 或密钥。引用不支持表达式、循环、计算、嵌套路径或任意变量；拼写错误、未闭合引用、引用空机构等会报明确错误。

生成器先校验规范事实，再对原 XLSX 文字一次性展开引用，随后由原 HTML/SVG/XML 输出层转义。每次更新只改名称、日期、场馆、地址或机构的规范字段并重新生成，网站与物料中的引用文字随之更新，不手工维护多份事实副本。

现成 PNG/JPG/WebP 横幅里的文字不会随 XLSX 自动改写。配置 `branding.heroImage` 后，先实际查看原图，逐项核对图中名称、日期、场地和品牌与当前规范字段一致，再从模板根目录执行：

```sh
.venv/bin/python scripts/bind_hero.py input/new-event/event.xlsx --confirm-current-facts
.venv/bin/python scripts/generate.py input/new-event/event.xlsx
```

`bind_hero.py` 仅在原图片旁生成 `<图片文件名>.facts.json`，记录图片和规范事实的派生哈希，不修改图片字节、不复制可编辑事实。没有现成横幅时跳过绑定，直接生成可编辑 SVG。

绑定缺失、损坏，或图片/名称/日期/场地/地址/机构/品牌更新时，生成器自动改用当前信息的可编辑横幅，并在配置、manifest、控制台与网站显示原因；不阻断内容生成或无关业务。若逐字查看后确认同一图片依然准确，可以再次运行确认命令，生成新的哈希绑定并复用原图。绑定不是永久禁用开关，脚本也不替人判断图片内容。图片及相邻元数据随规范公共素材和实例追溯快照一起保留，不手改哈希。

## 从 PDF/Word 手册建立新输入

若只拿到原始文档，没有规范 XLSX，先逐页提取并实际查看页面，不从目录、简介或原站旧内容猜完整资料：

1. 保留完整简介、组织机构及其角色、全部参会须知、食宿、交通、联系人、资源和原地图，分别录入配置契约对应的工作表。
2. 日程逐日逐行录入 date、time、title、speaker、chair、location，主持人与其单位职务单独保存；表格跨行共享单元格用可选 Group 字段表达，不把四列压成叙述文本，不省略重复或跨页记录。以手册更新时段为准。
3. 在 sourceNotes 记录原文件、PDF实际页码/印刷页码及未提供事实。未知容量、运营窗口、准确整体时刻、资格和具体参访时刻/地点留空。
4. 配套原 PDF 和地图作为引用的公共素材。若明确获授权使用同活动原横幅，可取已有原素材，或使用已在原站真实浏览器核实的 [同活动原横幅链接](https://panshi-ai4s.tashan.chat/images/panshi-ai4s-camp-banner-20260825.png)（2048×512），下载原图并配置 heroImage；不要猜 URL，也不把复用权限扩展到新活动。
5. 介绍/交通等重复事实使用固定引用；场馆与街道地址分别填写。运行只读校验并核对全部源页，若使用现成横幅，实际查看一致后执行 `.venv/bin/python scripts/bind_hero.py input/event.xlsx --confirm-current-facts`；然后生成、构建、回归、导出并检查指南与物料。没有手册输入目录或复现 helper 也能按这一流程从零录入，不依赖任何预录转录答案。

## 新活动与生成内容

下一位 Agent 先读 `SKILL.md` 和配置契约，使用新的 XLSX 与必要公共素材，无需接触原仓库或本次开发聊天。

```sh
.venv/bin/python scripts/create_sample.py input/new-event
# 编辑唯一的 input/new-event/event.xlsx，替换全部示例事实、品牌与素材，修改 event.slug
.venv/bin/python scripts/validate_config.py input/new-event/event.xlsx
.venv/bin/python scripts/generate.py input/new-event/event.xlsx
```

生成命令打印唯一输出目录，默认 `generated/<event.slug>`。进入该目录按前述 npm 流程构建、测试和启动。`input/fictional-conference.xlsx` 是完整运营事实的虚构样例，用于演示固定业务闭环，不是实际手册缺失事实的来源。

生成内容包括：

- 六页中文站：首页、交通住宿、联系我们、相关资料、常见问题、个人中心；首页含日程，录播仅配置开启时展示
- 原横幅结构、白色粘性导航、蓝绿强调色、正文/侧栏骨架，以及原移动端 62px 圆角悬浮玻璃服务栏和活动信息抽屉
- 按天组织“时间、题目、主讲人、主持人”四列日程；地点跨列行、相邻共享单元格的可选分组，主持人独立保存
- 短信注册并设置密码、手机号密码登录、短信重置；独立参会报名与每人一份可保存草稿的在线投稿
- 有限补料、工作人员纠错、录用自动参会、同人去重与已知容量的软提醒
- 私有 PostgreSQL 附件、模拟/真实服务适配器，以及可编辑 SVG 横幅/海报、PNG、完整 Word/HTML 指南、社媒草稿和产物哈希清单

未提供现成横幅的新活动使用可编辑 SVG 框架：左上最多五个可替换品牌标识，右上系列文字，短展示标题，分开的日期与地点；无 brandmarks 时可回退到 `branding.logo`；两者都未给时不自动造品牌名，已给现成 heroImage 时不再叠加品牌图。背景由原图经 imagegen 去除旧文字和标识、保留科技图案后生成，与原图并非像素一致。原图片复用与新 SVG 框架是两种不同来源，不能声称所有新活动自动还原原横幅。详见 [来源说明](docs/PROVENANCE.md)。

不包含支付/发票/费用、课程助手、晚间活动、签到、撤稿、旧项目申请、共享账号、多租户或中央运营平台。当前仅有中文运行界面，不是任意表单或通用流程引擎。

## 更新、停机与复跑

只修改原 XLSX 的规范字段/配套素材，引用正文自动展开为新事实，再执行相同生成命令和 `npm run build`，正常重启服务。使用现成横幅时查看生成器的绑定结果：不再准确的图片更新为新图后确认，仍准确的图片可显式重新确认；不确认也会自动使用当前信息的可编辑版。生成器保留数据库、私有附件、运行时 `.env` 和未知非生成文件；拒绝未知非空输出目录及已有实例更换 slug。投稿提交后主要字段锁定，待补料仅开放说明与附件；共用资料在首次申请提交后锁定。

一个 PostgreSQL 数据目录只允许一个运行所有者。另一隔离会话看不到 PID 或端口不代表它已停止。不能删除 `postmaster.pid`、重建数据库或复制正在运行的 PG 目录来绕过保护。

模板根目录的生成回归：

```sh
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
```

已安装依赖的实例目录：

```sh
npm run build
npm test
npm run preview:offline
npm run test:frontend
```

`npm test` 使用独立临时真实 PostgreSQL，不调用真实短信/飞书；若设置 `TEST_DATABASE_URL`，必须是可丢弃的专用测试数据库。可选完整停机回归在模板根目录执行，复用一个已安装生成实例的依赖，不额外 npm 安装：

```sh
node template/backend/test/shutdown-lifecycle.mjs /absolute/path/to/new-fixture generated/<event.slug> .venv/bin/python
```

最后一个参数在 Windows 使用项目虚拟环境 Python 路径。fixture 必须是新目录，测试会保留证据，不重置已有测试数据。

## 六页静态导出与验证边界

`npm run preview:offline` 导出同一 React 组件的非交互 HTML，入口 `offline-preview/home.html`。它能检查内容、结构和公共链接，表单需要运行中的服务；它不是网页截图、触控验收或登录/提交交互测试。

本轮曾用云浏览器观察原公开站；生成实例的 localhost/file 访问被拒绝，执行环境 Chromium 也受限制，未绕过限制。已完成的构建、API、SSR 和 Word 渲染不能代表生成网站已通过桌面/手机浏览器验收。最新版的检查快照、独立审查及未验项目见 [验证摘要](docs/VALIDATION.md)。真实短信/飞书和生产部署仍需实际预发布验收。

PNG 需要中文字体及适用的 SVG 栅格化工具；缺少工具时保留 SVG 并在 manifest 报告未生成 PNG，不用拉丁字体代替中文字形。可编辑指南页数随真实内容和渲染环境自然变化，不限为三页。

## 分别打包模板与活动实例

在模板根目录执行，目标目录必须不存在或为空：

```sh
.venv/bin/python scripts/package_delivery.py --destination ../template-source-delivery --zip ../template-source.zip
.venv/bin/python scripts/package_instance.py --instance generated/<event.slug> --input input/new-event/event.xlsx --destination ../event-instance-delivery --zip ../event-instance.zip
```

模板包含可复用脚本、规则、输入、测试及应用源码，不含 `generated/` 活动实例。实例包含 manifest 定义的应用代码、公共素材、物料、独立 `RUN.md`，以及存在时的构建输出/六页静态导出。两者均排除 node_modules、缓存、PG 业务数据、私有用户附件、日志、运行时 `.env` 与旧 vendor 参考资料。

静态横幅的相邻 `.facts.json` 元数据随被引用的规范素材一并交付，`package_instance.py --input` 会保留它。实例中的可选 `source-input/` 是生成时的追溯快照，不是第二份持续编辑的活动配置；后续以负责人指定的原 XLSX 为准。生成不授权购买服务、创建外部账号、推送仓库或发布网站。公开分发前应核对原代码和品牌素材的使用许可。

## 文件索引

- `SKILL.md`：通用 LLM/Agent 的执行入口
- `docs/config-schema.md`：精确 XLSX 字段、分组和准备度契约
- `docs/PROVENANCE.md`：代码、原横幅、新背景和手册来源
- `docs/VALIDATION.md`：带日期的验证快照及真实未验项目
- `docs/deployment-handoff.md`：上线所需事实、服务、备份与权限
- `template/backend/README.md`：API、模拟器及真实适配器契约
- `scripts/generate.py`、`validate_config.py`：确定性生成与只读校验
- `scripts/text_refs.py`、`bind_hero.py`：固定正文引用与已核对静态横幅绑定
- `scripts/package_delivery.py`、`package_instance.py`：模板/实例分别交付


## v2.0 最终交付附件

实例源码、物料、离线预览、复核报告及视觉对比图集中在 [attachments/v2.0](attachments/v2.0/README.md)，不会混入模板运行目录。交付状态以 [2026-10-07 最新验收说明](attachments/v2.0/验收说明-2026-10-07.md) 为准。
