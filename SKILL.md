---
name: event-template
description: 从唯一XLSX配置和配套公共素材生成独立的会议、论坛或实训活动网站、账号报名投稿系统及可编辑宣传物料。用于重复生成新活动或更新同一活动内容；不迁移旧生产数据，不自动部署或发布。
---

# 生成独立活动项目

使用包内实际代码与确定性脚本。不要为每一场活动重新编写应用，不要从旧活动复制人物、地点或宣传文字。

## 输入与开始

- 使用一个唯一的 `.xlsx` 配置表及其同目录公共素材。若已提供输入表，直接使用；不要先生成另一份事实源。
- 为新活动制作表格时，先读 [配置契约](docs/config-schema.md)，复制 `input/fictional-conference.xlsx` 的精确表名/表头。可执行 `.venv/bin/python scripts/create_sample.py input/new-event` 创建可编辑输入副本。
- 活动名称、日期、场地、容量、联系人等事实只填写一次。介绍段落和FAQ不要重复硬写这些事实，尤其不要留下样例名称或固定天数。
- 工作簿不保存密码、数据库URL、短信/飞书密钥。报名、投稿和审核是独立运行时业务数据，不回写活动表。

## 确定性执行

在本包根目录执行：

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
.venv/bin/python scripts/validate_config.py /path/to/event.xlsx
.venv/bin/python scripts/generate.py /path/to/event.xlsx
```

验证失败时根据明确错误修正原表；不要绕过校验或先改生成代码。缺失事实无法从资料确定时才向活动负责人询问。生成器打印唯一输出目录，默认 `generated/<event.slug>`；需要其他目录时使用 `--output /absolute/path`。

进入打印的生成目录：

```sh
npm install
npm run build
npm test
npm run demo
```

需要Node24。首次依赖安装需要正常网络访问官方包仓库；不要使用 `npm --ignore-scripts`。本地演示自动启动真实PostgreSQL16，短信/飞书为醒目标记的模拟适配器。按照终端显示的精确地址打开，一般是 `http://localhost:3000`。同机端口被占用时，先停止另一演示；或按 [运行说明](README.md) 指定不同HTTP/PG端口。

## 固定业务边界

- 六页：首页、交通住宿、联系我们、相关资料、常见问题、个人中心。首页含日程，FAQ为静态内容，录播链接仅在配置开启时出现。
- 账号沿用短信注册并设置密码、手机号密码登录、短信重置。手机号已验证后不可自行更改。
- 共用资料一次填写；参会报名与在线投稿独立。普通参会者不必投稿；投稿无需先报名。
- 每账号一条投稿：草稿、审核中、待补料、录用、未通过。提交后不能普通编辑或撤回；待补料仅开放说明和附件替换。
- 工作人员通过飞书审核，结果约一分钟反映到网站；本地 `/simulation` 可复现同一流程。
- 录用投稿自动获得参会资格；报名通过与投稿录用按同一人去重计数。达到/超过容量只提醒，永远不阻止工作人员批准。
- 工作人员可纠正审核结果；撤销投稿录用只去掉自动资格，不能消除独立批准的参会资格。
- 不加入支付/发票、课程助手、晚间活动、签到、旧项目申请、共享账号平台或配置反向同步。

## 更新与验收

更新活动内容时只修改原XLSX/配套素材，执行同一生成命令和 `npm run build`。新代码涉及后端时正常停止并重启应用。不要删除 `backend/data`，不要执行数据库重置。不同活动使用不同slug、输出目录和数据库；不能对已有实例更换slug。

运行包级回归：

```sh
.venv/bin/python -m unittest discover -s tests -p 'test_generator.py'
```

在生成目录执行 `npm test` 验证实际PostgreSQL业务闭环。检查 `manifest.json` 的工作簿和产物哈希；三份生成配置是相同派生数据，不是可编辑输入。检查网站、横幅、海报、指南、社媒文案中的名称/日期/地点一致，并检查录播开关、资料链接与附件私有性。

需要离线检查时在生成实例运行 `npm run preview:offline` 并打开 `offline-preview/home.html`。浏览器可用时检查桌面和手机六页，以及注册、密码重置、独立报名/投稿、补料、录用和状态刷新。静态HTML导出或源码测试不能冒充浏览器交互验收。若运行环境不支持浏览器，明确报告未完成的视觉/交互验证。

## 交付与上线边界

交付生成项目、原XLSX与配套公共素材、`materials/` 可编辑海报/指南和运行说明。使用 [打包脚本](scripts/package_delivery.py) 时排除数据库、用户附件、node_modules、运行时.env及原始vendor参考资料。

真实短信、飞书、数据库、域名、TLS、备份、托管费用与账号授权在上线前按 [服务交接清单](docs/deployment-handoff.md) 完成。未提供凭据时只验证模拟服务，不能宣称真实集成已通过。代码生成不授权购买服务、创建外部账号、推送GitHub或发布网站。

## 模板包与活动实例包分别交付

`package_delivery.py`只打包可复用模板源码（脚本、规则、默认样表、测试），不包含已经生成的活动。生成实例含RUN.md，可单独npm安装/构建/启动。需要交付某场活动时用另一个脚本：

```sh
.venv/bin/python scripts/package_delivery.py --destination ../template-source-delivery --zip ../template-source.zip
.venv/bin/python scripts/package_instance.py --instance generated/<event.slug> --input /path/to/event.xlsx --destination ../event-instance-delivery --zip ../event-instance.zip
```

实例脚本仅复制manifest定义的公开代码/物料和可选构建/静态预览，排除数据库、用户附件、node_modules、日志与运行时.env。可选source-input是追溯快照，不是第二个可编辑事实源；后续内容仍在负责人指定的唯一XLSX中修改并用模板重新生成。

同一数据目录只允许一个PostgreSQL运行所有者。停止原启动终端并等待Node/PG完全退出后再重启；其他隔离会话看不到PID/端口，不代表它已停止。不能通过删postmaster.pid或重建数据库来绕过保护。
