# 单一 XLSX 配置契约 v2.0.0

每场活动只有一个可编辑事实源：event.xlsx，以及同目录中由它引用的公共素材。工作簿不存凭据、管理员账号、数据库连接、短信或飞书密钥。报名、投稿、附件和审核记录留在独立 PostgreSQL 与鉴权文件存储中，生成器不会连接或改写业务数据库。生成后的 JSON 是派生文件，不能替代 XLSX 作为下次输入。

## 生成和验证

在模板根目录建立项目专用环境：

```sh
python3 -m venv .venv
.venv/bin/python -m pip install --cache-dir .cache/pip -r requirements.txt
.venv/bin/python scripts/validate_config.py /path/to/event.xlsx
.venv/bin/python scripts/generate.py /path/to/event.xlsx
```

Windows 用 py -3 -m venv .venv，之后把 .venv/bin/python 换成 .\.venv\Scripts\python.exe。不需激活脚本或改执行策略。

虚构的完整运营配置示例仍在 input/fictional-conference.xlsx；原文档输入由消费者按契约自行建立；缺失运营事实仍可生成代码/内容，内部manifest报告缺项。活动过去或窗口关闭与“事实是否齐全”是两回事，运行时仍检查当前时间。

```sh
.venv/bin/python scripts/create_sample.py input/my-event
# 修改 input/my-event/event.xlsx 中的 slug、所有活动事实和素材
.venv/bin/python scripts/generate.py input/my-event/event.xlsx --output generated/my-event
cd generated/my-event
npm install
npm run build
npm start
```

不同活动或不同届次必须使用独立 slug、输出目录和业务数据库。脚本不会部署、发送通知、创建外部账号或写入 GitHub。

## 工作簿通用规则

工作表和字段键区分大小写，第 1 行使用下面的精确表头，不能加封面行、合并表头、未定义列、额外表、公式、错误值或宏。完全空行忽略。集合条目保持输入顺序。每个 key 只出现一次。日期时间写最终值。

event 和 defaults 使用 key,value,description；description 是填表说明，不进入网站。未知事实留空，不填 1、1970 年、00:00 或猜测值。容量 1 如果确实是主办方提供的真实容量仍合法，生成器无法从一个合法数字判断它是否是占位符。

## event 字段

| key | 必填 | 类型和含义 |
|---|---|---|
| event.slug | 是 | 1–64 位小写字母、数字和单连字符 |
| event.title | 是 | 活动全称 |
| event.shortTitle | 是 | 导航短名称，也可作为横幅短标题 |
| event.subtitle | 否 | 副标题，默认空 |
| event.startDate | 条件 | YYYY-MM-DD 或 Excel 日期；没有 startAt 时必填 |
| event.endDate | 条件 | YYYY-MM-DD 或 Excel 日期；没有 endAt 时必填 |
| event.startAt | 否 | 仅在原资料提供具体开始时刻时填写 ISO 日期时间 |
| event.endAt | 否 | 仅在原资料提供具体结束时刻时填写 ISO 日期时间 |
| event.timezone | 是 | IANA 时区，如 Asia/Shanghai |
| event.location | 是 | 活动主会场名称 |
| event.capacity | 否 | 真实正整数；未知留空，规范化为 null |
| event.language | 否 | 当前界面仅 zh-CN，默认中文；内容不自动翻译 |
| event.siteUrl | 否 | 无凭据的完整 http/https URL；未知留空 |
| event.recordingsEnabled | 否 | true/false、布尔值、1/0 或 是/否；默认 false |
| attendance.openAt | 否 | 真实参会报名开放时间；未知留空 |
| attendance.closeAt | 否 | 真实参会报名截止时间；未知留空 |
| submission.openAt | 否 | 真实首次投稿开放时间；未知留空 |
| submission.closeAt | 否 | 真实首次投稿截止时间；未知留空 |
| submission.supplementCloseAt | 否 | 已提交投稿的补附件截止；空白沿用已知 closeAt，closeAt 也未知则 null |
| branding.primaryColor | 否 | #RRGGBB；默认 #5b9bd5，用于网页强调 |
| branding.heroImage | 否 | 工作簿目录内公共图片相对路径；提供时网站和海报保留原图片字节 |
| branding.logo | 否 | 工作簿目录内公共图片相对路径；默认生成横幅无brandmarks时作为首标识，空白不显示 |
| branding.seriesText | 否 | 品牌横幅右上角系列活动文字；不推断 |
| branding.bannerTitle | 否 | 横幅的短标题；空白使用 shortTitle |
| home.target | 否 | 原资料明确提供的面向人群；未提供留空，不推断参训资格 |
| travel.address | 是 | 完整会场地址 |
| travel.mapUrl | 否 | 完整 http/https 地图链接 |

startDate <= endDate。填了 startAt/endAt 时，在 event.timezone 中的日期必须与相应日期字段一致，缺省日期由它派生；若二者都含时刻，则 startAt < endAt。兼容 v1 完整日期时间输入，不要求额外录入日期。仅有日期不转换为午夜、日末或任意集合时间，JSON 的 startAt/endAt 保持 null。

日期时间允许本地 ISO 文本或 Excel 真日期时间，统一补充 event.timezone 的真实 UTC 偏移。显式偏移必须与时区一致。不存在的夏令时时刻拒绝，重复时段须提供明确偏移。运营截止时间不能仅填日期。

每个已知完整窗口必须 openAt < closeAt。补附件截止需要已知首次投稿截止，且 closeAt <= supplementCloseAt。报名、投稿和补材料可以覆盖活动期间或结束后，不强制截止早于会议开始。

## 内部运营准备度

config.readiness 由实际缺失的 event.capacity、attendance.openAt、attendance.closeAt、submission.openAt、submission.closeAt 派生：

```json
{
  "mode": "preview",
  "unresolved": [{"key": "event.capacity", "reason": "未提供会务事实，需主办方确认"}],
  "attendanceEnabled": false,
  "submissionEnabled": false
}
```

报名可用需真实容量和完整报名窗口；投稿可用需真实容量和完整投稿窗口。二者独立判定。mode=ready 表示这五项配置齐全，不表示当前窗口仍开放或活动未结束。mode=preview 只在私有配置/manifest中记录待确认事项。登录、资料和草稿功能仍可用，后端在最终报名、投稿和补附件边界拒绝条件不齐的操作；公开按钮正常显示，点击失败才显示简短错误。

未知的容量、截止时间和政策不出现在海报或社媒文案中。公开物料不包含构建/预览诊断或缺项清单。具体某天日程的未知时刻、地点使用语义标签，不能伪装成00:00—23:59。

## 集合工作表

| 表名 | 精确表头 | 必填和用途 |
|---|---|---|
| intro | text | 介绍段落，每行一个；至少一条 |
| features | title,description | 标题和说明均必填；可空 |
| organizers | role,name | 角色和机构均必填；按角色分组展示 |
| brandmarks | label,asset | 固定的品牌标识集合，最多五个；名称和安全本地图片必填；用于可编辑横幅 |
| agenda | date,time,title,speaker,chair,location,timeGroup,topicGroup,speakerGroup,chairGroup,locationGroup | date/title 必填；其他可空；至少一条 |
| notices | title,body | 手册参会须知标题、正文均必填；可空 |
| mealGuide | title,body | 食宿自理说明、就餐地址等标题、正文均必填；可空 |
| sourceNotes | title,body | 资料出处、原手册页码、未提供事实的说明；均必填，可空 |
| directions | title,body | 交通说明标题、正文均必填；可空 |
| hotels | name,address,description,url | 名称、地址、说明必填；URL 可空，不自动预订 |
| contacts | name,responsibility,email,phone,note | 名称、职责必填，email/phone 至少一项；至少一条 |
| faqs | question,answer | 问题和答案均必填；至少一条 |
| resources | title,description,url,asset,type | 标题、说明必填，url/asset 必须且仅填一项；type 可空，map 表示在指南嵌入的地图图片 |
| recordings | title,description,url | 全部必填；只有 recordingsEnabled=true 时进入输出 |

agenda 兼容 v1 的 date,time,title,speaker,location 表头，也接受无分组元数据的 date,time,title,speaker,chair,location。新工作簿推荐完整 11 列表头。

agenda.date 是日期，须在活动日期范围内；time 是 HH:MM、HH:MM-HH:MM、全天或时间待通知。空时刻规范化为时间待通知，空地点规范化为地点待通知。时段结束须晚于开始。speaker/chair 保留原主讲人与主持人及其单位职务，不能拼成一个字段。分组 ID 只标明同日相邻记录在原表中共享同一时间、题目、主讲人、主持人或地点；同组内容须一致，不能生成或隐藏不同事实。地点行横跨四列，按日展示“时间、题目、主讲人、主持人”。相同日期、时段、地点、题目的完全重复记录拒绝。

重复 key、介绍段落、亮点标题、酒店名、FAQ 问题、资源标题、回放标题、主办角色+机构或联系人名称+职责均拒绝。

## 固定 defaults

| key | 默认值 | 可用范围 |
|---|---|---|
| profileOptionalFields | department,job,personalIntroduction | 三个字段的逗号分隔子集 |
| files.maxFileBytes | 20971520 | 正整数，不超过 20MB |
| files.maxAttachments | 3 | 1–3 |
| files.allowedExtensions | pdf,docx,pptx | 三种扩展名的非空子集，不带点 |
| sync.pollSeconds | 60 | 5–3600 秒 |

固定资料字段是姓名、手机号（只读）、邮箱、单位、身份、研究方向；部门、职务、个人简介可选。固定投稿字段是标题、摘要、关键词、作者与单位、报告人、附件、备注，每人一份投稿。这不是通用表单或任意流程引擎，不增加新平台。

## 公共素材与横幅

素材路径相对于工作簿目录，如 assets/handbook.pdf。禁止绝对路径、..、反斜杠、隐藏目录、符号链接、vendor/node_modules/data/uploads 和凭据文件。只复制被引用的素材。输入图片允许 png/jpg/jpeg/webp，下载资料另可 pdf/docx/pptx，每个不超过20MB；图片验证实际格式且最多4000万像素，Office 拒绝宏。输入 SVG 不接收。URL 仅允许完整无凭据 http/https。

素材复制到 frontend/public/assets/<原相对路径>，配置中路径是 /assets/<原相对路径>。例如 assets/handbook.pdf 对应 /assets/assets/handbook.pdf。在 siteUrl 未提供时，独立指南将资源路径明确标为本地演示路径。不要把身份证、报名名单或私人投稿附件放进公共素材。

有合法、同活动的现成 heroImage 时优先保留它；真实手册示例使用用户授权的原站 WebP，不能拿其旧日期和品牌用于新活动。给定heroImage时保留静态成图，不额外叠加logo或brandmarks。空白时 scripts/hero.py 生成可编辑 SVG 品牌骨架；brandmarks、seriesText、bannerTitle 都来自新活动 XLSX。日期和场地分区，位置延续原骨架。生成的图片不是对所有新品牌的通用设计系统。

## 生成文件与再生成安全

私有config.json包含完整规范内容、readiness、source/sourceNotes及横幅核验；公开frontend/public/config.json和frontend/src/config.generated.json使用同一公开投影，剔除source、sourceNotes、readiness、sync以及branding.heroWarning/heroBinding/heroSourceImage。manifest分别记录configSha256和publicConfigSha256，公开内容不泄漏内部来源与诊断。

生成物料：
- materials/poster.svg 和 poster.png：海报复用实际选用的横幅，未知运营事实省略。SVG 横幅转 PNG 优先使用已安装的 CairoSVG，否则调用 Inkscape；均不可用时保留可编辑 SVG 并在 manifest 明确提示 PNG 未生成。现成 JPG/PNG/WebP 横幅只需 Pillow 与中文字体
- materials/conference-guide.docx：可编辑完整指南，分日四列表格、地点跨列行、重复表头，允许大表自然分页
- materials/conference-guide.html：同一章节与日程结构的打印备份
- materials/social-posts.txt：长短版草稿，不自动发送
- manifest.json：输入、配置、模板与产物 SHA-256、版本、readiness 和警告

同一输入、素材、模板和字体/库版本产生同字节。验证失败退出码2，不触碰输出。生成先在临时目录成功，再覆盖生成器拥有的文件。未知非空输出目录拒绝；再生成需有效 manifest 且相同 slug。未知文件不覆盖，不删除已有文件，不追随链接。data、uploads、.env、node_modules 不复制或删改。删除输入资源后旧已生成文件可能留在磁盘，但不再出现在新配置中。

修改会议事实后，重新生成、npm run build 并重启服务。独立新会议必须新目录、新数据库和账号。模板升级、数据库迁移或上线另需明确授权。

## 从任意原始资料开始

按照README和SKILL逐页查看原文档，建立唯一XLSX，记录sourceNotes来源页码，并引用原PDF和已授权的公共图片。运行校验、确定性生成、构建和测试；实际渲染Word全页检查分页，核对全部日程、独立主持人和公共物料。文档未给的会务事实留空，不依赖任何专属转录脚本或预填答案。

## 固定正文引用

重复出现的活动事实可以在下列正文单元格中写固定引用；规范事实仍只在 event、travel 与 organizers 中填写一次。生成器在规范数据验证后、生成 JSON 与物料前展开引用，输出层随后按 HTML、XML 或 SVG 的上下文转义。引用本身不执行表达式，不查询任意字段，也不接受条件、循环或函数。

| 唯一允许的引用 | 事实来源与显示 |
|---|---|
| {{event.title}} | event.title 活动全称 |
| {{event.shortTitle}} | event.shortTitle 短名称，可组成会务组署名 |
| {{event.dateRange}} | event.startDate/endDate；手册示例显示 2026年9月4日至9月8日，不补午夜或结束时刻 |
| {{event.location}} | event.location 主会场名 |
| {{travel.address}} | travel.address 街道地址；与会场名分开存储，正文可写 {{event.location}}（{{travel.address}}） |
| {{organizers.主办单位}} | organizers 中角色恰为 主办单位 的名称，按输入顺序用 、 连接 |
| {{organizers.协办单位}} | organizers 中角色恰为 协办单位 的名称，按输入顺序用 、 连接 |
| {{organizers.支持单位}} | organizers 中角色恰为 支持单位 的名称，按输入顺序用 、 连接 |

可用正文是 intro；home.target；features 的 title/description；agenda 的 title/speaker/chair/location；notices、mealGuide、sourceNotes、directions 的 title/body；hotels 的 name/address/description；contacts 的 name/responsibility/note；faqs 的 question/answer；resources、recordings 的 title/description；brandmarks 的 label。日期、时段、ID、URL、素材路径、规范事实本身及其他字段不接受正文引用。

引用名必须逐字匹配白名单，不能加空格。未知引用、括号不完整、表达式、递归规范事实或引用缺少对应组织角色会验证失败，不能把 {{unknown}} 原样留到页面。展开是一次构建步骤，不是运行时反向同步；每次重新读取 XLSX 后展开。调整活动名称、日期、会场、街道地址或组织名称后，重新生成即可更新引用它们的各段正文。

真实手册 intro 使用上述引用，但当前展开仍保留原标题、日期、会场地址、五家主办和三家协办的原文以及会务组署名。须知中举办日期的“—”统一为 dateRange 的“至”，仅是派生显示标点，不改变日期。原资料落款2026年9月是来源署名月份，不能假定它随举办日期变化。具体签到时刻、分会场房间、讲者单位和交通地点是另有出处的事实，不能由活动日期或主会场推断替换。sourceNotes 保留原 PDF 的历史来源记录，并说明正文显示由规范事实派生。

打包带输入快照时，package_instance还会比对派生配置SHA及公共素材SHA；绑定文件缺失/变化或同名素材换字节也要求先再生成，不只检查XLSX本身。
