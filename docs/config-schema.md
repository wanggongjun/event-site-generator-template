# 单一 XLSX 配置契约（v1.0.0）

这份说明足够让另一位 LLM 在不查看原始会议代码、不使用任何旧活动内容的情况下，为一场新会议制作输入并生成可运行的网站。

## 1. 唯一事实源与第一条命令

每场会议只有一个可编辑配置源：一个 `.xlsx` 工作簿，外加与它同目录下的公共图片/下载素材。工作簿不存数据库连接、管理员账号、短信密钥、OAuth、邮件凭据或任何密码。运行时个人资料、报名、投稿、审核记录属于独立业务数据库，不回写工作簿，也不从 UI、飞书或代码反向同步配置。

从包根目录执行：

先在本模板包目录建立项目专用虚拟环境，不向系统Python或用户目录安装。

Linux / macOS：

```sh
python3 -m venv .venv
.venv/bin/python -m pip install --cache-dir .cache/pip -r requirements.txt
```

Windows PowerShell（不需要修改执行策略或激活脚本）：

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --cache-dir .cache/pip -r requirements.txt
```

以下Python命令展示Linux/macOS路径；Windows将`.venv/bin/python`替换为`.\.venv\Scripts\python.exe`。所有生成/测试均使用这个项目环境。

```sh
.venv/bin/python scripts/validate_config.py input/fictional-conference.xlsx
.venv/bin/python scripts/generate.py input/fictional-conference.xlsx
cd generated/aurora-research-forum-2027
npm install
npm run build
npm start
```

为新会议复制唯一输入，再修改它：

```sh
.venv/bin/python scripts/create_sample.py input/my-new-event
# 编辑 input/my-new-event/event.xlsx；务必修改 event.slug 和所有虚构示例内容。
.venv/bin/python scripts/validate_config.py input/my-new-event/event.xlsx
.venv/bin/python scripts/generate.py input/my-new-event/event.xlsx
```

可以用 `--output /path/to/independent-output` 指定目录。每场会议必须独立输出，使用独立账号与数据库/存储目录。即使活动名称相同，新的举办届次也应使用新 slug。脚本不会部署网站、创建线上账户或写入 GitHub。

## 2. 工作簿的精确结构

工作表名使用下列英文原样拼写；字段键区分大小写。第 1 行必须是精确表头，不加封面行、不合并表头、不增加未定义列。数据从第 2 行开始；完全空行被忽略。不能有公式、Excel 错误值、宏或额外工作表。日期时间填最终值，不能靠公式计算。

`event` 是必需工作表，表头是 `key,value,description`。`description` 是给填表者的中文说明，不参与生成。每个 key 只可出现一次，留空的可选值使用缺省行为。main facts 只在这里填写一次，横幅、海报、指南和宣传文本从同一规范化事实派生。

### event 字段

| key | 必填 | 类型与约束 |
|---|---|---|
| event.slug | 是 | 1–64 位小写字母、数字和单个连字符，如 spring-forum-2027；不能以连字符开始/结束 |
| event.title | 是 | 会议全称；任意新名称，无硬编码活动名 |
| event.shortTitle | 是 | 导航栏短名称 |
| event.subtitle | 否 | 副标题；默认空 |
| event.startAt | 是 | ISO 日期时间，例如 2031-06-14T09:00:00 |
| event.endAt | 是 | ISO 日期时间，晚于 startAt |
| event.timezone | 是 | IANA 时区，如 Asia/Shanghai、Europe/Paris、Etc/UTC |
| event.location | 是 | 会场名，网站、海报、指南共用 |
| event.capacity | 是 | 正整数，人数容量 |
| event.language | 否 | v1 仅接受 zh-CN；默认中文界面。内容文本按工作簿原文输出，不自动翻译 |
| event.siteUrl | 否 | 完整 http/https 网站 URL；默认空 |
| event.recordingsEnabled | 否 | true/false、Excel 布尔值、1/0 或 是/否；默认 false |
| attendance.openAt | 是 | 参会报名开放时间 |
| attendance.closeAt | 是 | 参会报名截止时间 |
| submission.openAt | 是 | 学术投稿开放时间 |
| submission.closeAt | 是 | 首次投稿截止时间 |
| submission.supplementCloseAt | 否 | 已提交投稿的补充附件截止时间；空白沿用 submission.closeAt |
| branding.primaryColor | 否 | #RRGGBB，默认 #5b9bd5；仅用于网页按钮/标题强调，不是统一海报主题色 |
| branding.heroImage | 否 | 工作簿目录内本地公共图片相对路径；空白使用生成的 /assets/hero.svg |
| branding.logo | 否 | 工作簿目录内本地公共图片相对路径；空白不显示 logo；用于网页横幅左上角 |
| home.target | 是 | 面向人群 |
| travel.address | 是 | 会场完整地址 |
| travel.mapUrl | 否 | 完整 http/https 地图 URL |

时间可使用不含偏移的 ISO 本地日期时间或 Excel 真日期时间，统一按 event.timezone 解释，生成 JSON 补充正确 UTC 偏移。如显式填写 `2031-06-14T09:00:00+08:00`，偏移必须与该时区在当日一致。夏令时不存在的本地时间拒绝；夏令时重复时段需要明确偏移。单独的 YYYY-MM-DD 不是有效截止时间。

排序关系必须同时满足：
- event.startAt < event.endAt
- attendance.openAt < attendance.closeAt
- submission.openAt < submission.closeAt
- submission.closeAt <= submission.supplementCloseAt（如填写）

报名、投稿和补充材料窗口由会务政策决定，可覆盖会议期间或会议结束后；不强制各截止时间早于活动开始/结束。补充截止留空时，生成配置沿用首次投稿截止，保持运行时字段完整。

参会报名与学术投稿互相独立，不存在“报名即投稿”的配置开关。

### defaults：小范围构建期替代项

可选工作表，表头同为 `key,value,description`，每个键至多一行。缺省值就是要求的 20MB、3 个附件、PDF/DOCX/PPTX、60 秒轮询。

| key | 默认值 | 可接受值 |
|---|---|---|
| profileOptionalFields | department,job,personalIntroduction | 逗号分隔的三个字段子集；用于是否展示这三项可选资料字段 |
| files.maxFileBytes | 20971520 | 正整数字节数，最多 20971520 |
| files.maxAttachments | 3 | 1–3 |
| files.allowedExtensions | pdf,docx,pptx | 这三个小写扩展名的非空子集；不带点 |
| sync.pollSeconds | 60 | 5–3600 秒 |

这不是通用表单引擎，不在工作簿内配置业务流程或任意新字段。运行时固定资料字段为：姓名、手机号（只读）、邮箱、单位、身份、研究方向；部门、职务、个人简介是可选项。在线投稿固定为：标题、摘要、关键词、作者与单位、报告人、附件、备注；每人一份投稿。

### 集合工作表

全部使用第 1 行精确表头。即使整张表没有条目，也保留表头。资源、住宿和回放可以没有行；intro、agenda、contacts、faqs 各至少一行。所有行按工作簿顺序输出。

| 表名 | 精确表头（按此顺序） | 每行必填与含义 |
|---|---|---|
| intro | text | 首页介绍段落，每行一个段落 |
| features | title,description | 亮点标题、说明，均必填 |
| organizers | role,name | 主办/承办等角色、机构名，均必填 |
| agenda | date,time,title,speaker,location | date 为 YYYY-MM-DD，time 为 HH:MM 或 HH:MM-HH:MM；title、location 必填；speaker 可空 |
| directions | title,body | 交通方式标题、说明，均必填 |
| hotels | name,address,description,url | 酒店名、地址、说明必填；URL 可空，不自动预订 |
| contacts | name,responsibility,email,phone,note | 名称、职责必填；email/phone 至少一个；备注可空 |
| faqs | question,answer | 静态问题与答案，均必填 |
| resources | title,description,url,asset,type | 标题、说明必填；url 或 asset 必须且只能填一个；type 是展示类型可空 |
| recordings | title,description,url | 标题、说明、http/https URL 都必填；仅 event.recordingsEnabled=true 才进入输出 |

重复或冲突记录拒绝：重复 key；重复介绍、亮点标题、酒店名称、FAQ 问题、资源标题或回放标题；重复主办角色+机构、联系人名称+职责；日程同一日期+时段+地点重复。日程日期必须在活动开始/结束日期范围内，时段结束必须晚于开始。不同地点可以同时间安排不同活动。

## 3. 公共素材约束

素材路径相对于工作簿所在目录，如 `assets/participant-notes.pdf`。禁止绝对路径、`..`、反斜杠、隐藏目录、符号链接、vendor/node_modules/data/uploads 和凭据文件；不能直接引用旧项目素材目录。只有被工作簿引用的公共素材会复制。

允许 png/jpg/jpeg/webp/pdf/docx/pptx，单文件最多 20MB；图片验证实际格式，最多 4000 万像素；Office 下载素材拒绝宏。输入 SVG 不接收，以避免脚本/外链风险；系统自行生成安全、可编辑的 hero.svg 与 poster.svg。URL 仅允许完整 http/https，不允许 javascript、data、file、ftp 或带用户名密码。

素材复制为 `frontend/public/assets/<原相对路径>`，JSON 使用相应 `/assets/<原相对路径>`。例如输入 `assets/participant-notes.pdf` 输出 URL 为 `/assets/assets/participant-notes.pdf`。这是保留输入目录层级的确定性映射，不是第二份可编辑配置。独立会议指南在有 event.siteUrl 时，将它与公共素材路径组合成完整 URL；没有网站地址时明确标注为需先启动网站的本地演示路径，不冒充公开下载链接。

不要把身份证、参会人员表、投稿者附件或其他非公开信息放入公共素材；业务上传由 backend 独立存储和鉴权提供。

## 4. 生成 JSON 的形状

config.json 位于输出根目录，也原样复制到 frontend/public/config.json 与 frontend/src/config.generated.json。生成后的 JSON 是派生文件，不是下一次配置源。

```json
{
  "event": {"slug":"...","title":"...","shortTitle":"...","subtitle":"...","startAt":"...+08:00","endAt":"...+08:00","timezone":"Asia/Shanghai","location":"...","capacity":120,"language":"zh-CN","siteUrl":"...","recordingsEnabled":false},
  "attendance":{"openAt":"...","closeAt":"..."},
  "submission":{"openAt":"...","closeAt":"...","supplementCloseAt":"..."},
  "files":{"maxFileBytes":20971520,"maxAttachments":3,"allowedExtensions":["pdf","docx","pptx"]},
  "sync":{"pollSeconds":60},
  "branding":{"primaryColor":"#5b9bd5","heroImage":"/assets/hero.svg"},
  "home":{"intro":["..."],"target":"...","features":[{"title":"...","description":"..."}],"organizers":[{"role":"...","name":"..."}]},
  "agenda":[{"date":"2031-06-14","time":"09:00-09:30","title":"...","location":"..."}],
  "travel":{"address":"...","directions":[{"title":"...","body":"..."}]},
  "hotels":[],"contacts":[],"faqs":[],"resources":[],"recordings":[],
  "forms":{"profileOptionalFields":["department","job","personalIntroduction"]},
  "source":{"schemaVersion":"1.0.0","workbookSha256":"..."}
}
```

## 5. 材料与可验证清单

每次生成同一工作簿+同一素材+同一运行时模板，在同一字体/库版本环境下产生相同文件字节。无 LLM 重写前端代码，无付费模型调用。

- frontend/public/assets/hero.svg：2048×512 电蓝科技风横幅，标题自动适配，使用同一规范化日期和场地，无旧品牌。
- materials/poster.svg：可编辑 SVG 海报，可在矢量设计软件中调整；文本保留为文本。
- materials/poster.png：有中文系统字体时生成社交传播用 PNG；无字体时仍生成可编辑 SVG，并在 manifest 提示。
- materials/conference-guide.docx：可编辑 Word 会议指南，固定、可复现元数据。
- materials/conference-guide.html：可编辑/打印 HTML 备份。
- materials/social-posts.txt：长版与简版中文邀请文本，不自动发送。
- manifest.json：工作簿、配置、运行时模板和每项生成文件的 SHA-256，活动 slug、版本、文件清单与必要提示。

图片和宣传文案会含配置的网站地址；示例地址属于保留示例域名，不代表已部署。不要在材料里另行维护会议时间或场地。

## 6. 安全再生成与运营状态

验证失败返回退出码 2，输出目录不被触碰。素材与运行时模板也先验证；生成材料在临时目录内完成，成功后才覆盖生成器拥有的文件。

新输出目录可不存在或为空。非空未知目录拒绝。再生成必须有本生成器的有效 manifest，且 event.slug 不得改变。只覆盖 manifest 已记录的生成文件或新增文件，不删除任何已有文件；不覆盖未知用户文件，不追随符号链接。业务 backend/data、uploads、.env、node_modules 不从 template 复制，不被覆盖或删除；业务 PostgreSQL 从未由生成器连接。移除资源后，旧的已生成素材文件可能保留在磁盘但不会出现在新配置中，需要管理员按自己的保留策略处理。

修改同一会议的页面事实后，用相同输入和输出再生成，并执行 npm run build、重启服务。独立新会议需要新目录、独立数据库/账号；绝不能通过改 slug 重用旧业务存储。升级模板或业务流程前应按发布说明备份、迁移并测试，生成器只承担配置/静态材料生成。

## 7. 给另一位 LLM 的任务提示

“只使用本包 docs/config-schema.md 的输入契约，为新虚构会议编写唯一 XLSX 和公共素材。不要复制任何旧活动的人名、地点、机构、logo 或日期。每个主要事实只填一处；不要放凭据，不创建 UI/飞书反向同步。保留固定个人资料、参会报名与学术投稿流程。运行只读验证后，生成到该 slug 的独立目录，运行测试与构建，检查横幅、海报与会议指南时间/场地一致。不要部署、发送通知、开账号或写 GitHub，除非另有明确授权。”
