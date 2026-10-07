---
name: event-template
description: 从唯一XLSX和配套公共素材生成或更新一场独立中文会议、论坛或实训活动的可运行网站、固定报名投稿系统及可编辑物料；支持事实未齐的诚实会务预览。不迁移旧生产数据，不自动发布或部署。
---

# 生成独立活动项目

使用包内实际应用与确定性脚本，不为每场活动重写网站。每场活动独立输出、数据库和账号；不建立中央平台或共享账号。先读 [配置契约](docs/config-schema.md)，按场景查 [运行说明](README.md)、[来源说明](docs/PROVENANCE.md) 或 [验证边界](docs/VALIDATION.md)。

## 输入与事实政策

- 已提供 XLSX 就使用它，不先建立另一份事实源。新活动复制 `input/fictional-conference.xlsx` 的精确表名/表头，或运行 `scripts/create_sample.py` 创建输入副本。
- 唯一可编辑源是 XLSX 和它引用的同目录公共素材；生成 JSON、网站代码、物料与飞书不反向同步活动事实。工作簿不保存密码或服务秘密。
- 日期精度按原资料保留。仅知日期时用 startDate/endDate；未知具体 startAt/endAt、容量、报名和投稿窗口留空，不填容量 1、1970 年、00:00—23:59 或猜测窗口。
- 不从活动主题、组织机构或讲者身份推断参训资格。home.target 未提供就留空。重复展示名称、日期、地点和机构时使用固定引用；event.location 保存场馆，travel.address 保存完整街道地址，不重复场馆/活动名。
- 日程按天保留时间、题目、主讲人、主持人，地点为跨列行；分组字段只表达原资料相邻共享单元格，不能隐藏不同内容。未知时刻/地点使用“时间待通知”“地点待通知”。
- 现成 heroImage 只在同活动且使用获授权时保留原字节。手册实例的原横幅不能作为新活动的旧品牌/旧日期。新活动可用 brandmarks（最多五个）、seriesText、bannerTitle 构造可编辑框架，无 brandmarks 时可用 branding.logo；两者均空则不自动造品牌名，现成 heroImage 不再叠加品牌图。清除全部旧活动信息。

## 固定引用与静态横幅

规范事实只录一次，允许的公共文字字段使用八个固定引用：`{{event.title}}`、`{{event.shortTitle}}`、`{{event.dateRange}}`、`{{event.location}}`、`{{travel.address}}`、`{{organizers.主办单位}}`、`{{organizers.协办单位}}`、`{{organizers.支持单位}}`。例如 intro 写“{{event.title}}将于{{event.dateRange}}在{{event.location}}举办，由{{organizers.主办单位}}主办。”；交通正文分别引用场馆和地址。日期由规范字段派生，机构按角色顺序连接。不要在 URL、素材路径、规范事实、日期或分组 ID 中引用；不支持表达式、eval、任意变量/嵌套路径。未知、未闭合或空事实引用会失败。生成器校验后一次性展开原文字，再由既有 HTML/SVG/XML 层转义。

使用现成 heroImage 时，先实际查看图片，核对名称、日期、场地和品牌与当前规范字段相符，然后执行：

```sh
.venv/bin/python scripts/bind_hero.py /path/to/event.xlsx --confirm-current-facts
```

命令写入图片旁 `<图片文件名>.facts.json`，只保存图片/规范事实派生哈希，不编辑图片、不建立第二份事实源。缺少/失配绑定自动改用当前信息的可编辑 SVG，配置、manifest、控制台/UI 提示原因，不阻断无关生成或业务。更新规范事实后，若实际查看确认同图仍准确，可再次绑定；否则更换正确图片后确认或直接使用生成版。无现成图片不需要绑定。规范公共素材与 source-input 快照都保留相邻元数据，不手改哈希。

## 只有原始手册时

先逐页提取全文并实际查看源页，按配置契约建立唯一 XLSX，不依赖手册复现 helper 或预录答案。完整录入简介、组织机构/角色、全部须知、食宿、交通、联系人、资料和地图；日程每行分开 date/time/title/speaker/chair/location，保留主持人完整单位职务、原更新时段及跨页记录，可选 Group 字段仅表达真实相邻合并范围。sourceNotes 记录原文件、实际/印刷页码及未给事实。

未知 capacity/windows/target 及具体时刻留空。原 PDF/地图作为引用公共素材；明确获授权的同活动 hero 可用已有原素材，或从已核实的 [同活动原横幅链接](https://panshi-ai4s.tashan.chat/images/panshi-ai4s-camp-banner-20260825.png) 取原图（2048×512），不猜链接，不把旧活动品牌用于新活动。正文重复事实改用固定引用，场馆和街道地址分开。核对源页与工作簿，使用现成图时再实际查看并执行显式 bind 命令，然后进入生成/检查流程。

## 运行准备

需要 Node 24、Python 3.11+。在模板根目录建立一次项目虚拟环境，不向系统或用户目录安装：

```sh
python3 -m venv .venv
.venv/bin/python -m pip install --cache-dir .cache/pip -r requirements.txt
```

Windows PowerShell 使用 `py -3 -m venv .venv`，之后把 `.venv/bin/python` 换成 `.\.venv\Scripts\python.exe`；无需激活或修改执行策略。

```sh
.venv/bin/python scripts/validate_config.py /path/to/event.xlsx
.venv/bin/python scripts/generate.py /path/to/event.xlsx
```

生成器打印唯一输出目录，默认 `generated/<event.slug>`；明确指定目录时加 `--output /absolute/path`。失败按报错修改原表，不绕过校验。无法从资料确定的事实保留未知；只有需要开放相关流程时才向负责人取得确认。

进入打印的实例目录，安装一次依赖，然后：

```sh
npm install
npm run build
npm test
npm run demo
```

不要使用 `npm --ignore-scripts`，也不要另在 template 目录重复安装依赖。打开终端显示的精确地址。默认是真实本地 PostgreSQL 16，短信/飞书是标明的模拟器，模拟模式只监听本机；`/simulation` 复现审核同步。端口与 Windows 命令见 README。

## 准备度与固定业务边界

`config.readiness` 列出缺失事实，并分别标记 attendanceEnabled/submissionEnabled。真实容量和相应完整窗口是最终报名/投稿的条件；容量缺失影响两项最终提交。后端逐请求重新计算，并拒绝条件不齐的最终报名、投稿和补料。不能把预览当作无限开放模式。

预览仍可进行认证、个人资料、私有文件和投稿草稿准备；已知窗口、所有权、配额及提交后锁定照常生效。ready 只表示运营配置齐全，与当前时间、simulation/real 适配器模式和生产验收分别判断。公共物料省略未知事实，预览稿必须有可见草稿标识。

保留以下固定规则，不拓展为通用流程：

- 六页中文站：首页、交通住宿、联系我们、相关资料、静态 FAQ、个人中心；录播仅配置开启时出现
- 原短信注册+设置密码、手机号密码登录、短信重置；已验证手机号不可自行更改
- 共用资料一次填写；参会报名与投稿互不要求对方先完成
- 每账号一条投稿：草稿、审核中、待补料、录用、未通过；提交后无普通编辑或撤回，待补料仅开放说明和附件
- 工作人员通过飞书审核，默认约一分钟同步；本地模拟器使用相同状态应用路径
- 录用自动参会，与独立批准报名按同人去重；已知容量只作软提醒，不阻止工作人员批准；未知容量保持 null
- 工作人员可纠正审核；撤销录用仅去掉自动资格，不删除独立批准的报名资格
- 不加入支付/发票、课程助手、晚间活动、签到、旧项目申请、共享账号、多租户或配置反向同步

## 更新与验收

只修改原 XLSX 规范字段/配套素材，正文引用自动更新；静态图按绑定结果使用当前生成版或实际核对后重新确认，再生成、`npm run build` 并正常重启。不要删除 backend/data 或重置数据库。已有实例不更换 slug；新活动另用目录和数据库。

同一 PG 数据目录只允许一个运行所有者。在原启动终端 Ctrl+C，等待 Node/PG 完整退出和停机日志后再启动。其他隔离会话看不到 PID/端口不代表已停机，不能删 postmaster.pid 或重建数据绕过保护。

模板根目录：

```sh
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
```

实例目录执行 `npm run build`、`npm test`、`npm run preview:offline`、`npm run test:frontend`。后者仅模拟内存DOM的同路由状态回归，不是browserQA。后端测试用独立临时真实 PostgreSQL；TEST_DATABASE_URL 只能指向专用可丢弃测试库，不调用真实短信/飞书。可选生命周期回归复用已安装实例，不重复安装：

```sh
node template/backend/test/shutdown-lifecycle.mjs /absolute/path/to/new-fixture generated/<event.slug> .venv/bin/python
```

检查 manifest 中输入、模板和产物哈希，以及三份派生配置镜像。核对网站、横幅、海报、Word/HTML 和社媒稿的源事实、分日四列表格、主持人、未知事实标签、录播开关与附件私有性。Word 需实际渲染检查全部页，不硬限三页；无空白页、缺字、裁切或溢出才记录通过。

离线入口是 `offline-preview/home.html`。它是实际 React 组件的非交互 SSR 六页，不是浏览器截图或表单验收。可用浏览器中还须检查桌面/手机、原圆角悬浮玻璃服务栏/抽屉、登录/重置、两项独立提交、补料、纠错及状态刷新；遭拒绝时不绕过，明确记录未验。构建和 API 通过不能改写为整站视觉通过。

## 分别交付与发布边界

模板包与实际活动实例包分别打包：

```sh
.venv/bin/python scripts/package_delivery.py --destination ../template-source-delivery --zip ../template-source.zip
.venv/bin/python scripts/package_instance.py --instance generated/<event.slug> --input /path/to/event.xlsx --destination ../event-instance-delivery --zip ../event-instance.zip
```

模板包不含 generated 实例；实例包含独立 RUN.md、公开应用/素材/物料及存在时的构建输出和静态六页。排除数据库、私有附件、node_modules、缓存、日志、运行时 .env 与旧 vendor。静态图的相邻 .facts.json 是派生绑定 metadata，package_instance --input 会带入 source-input；source-input 只是追溯快照，不让两份 XLSX 同时成为编辑源。

未提供凭据只验证模拟服务，不能宣称真实集成通过。上线前按 [交接清单](docs/deployment-handoff.md) 确认运营事实、短信、飞书、数据库、HTTPS、备份与权限。生成/打包不授权购买服务、创建外部账号、推送仓库或发布。公开分发前核对原代码与素材许可。
