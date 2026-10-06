# 活动网站与系统生成模板

实际可运行的代码模板，不是让LLM从零重写网站的提示词。由磐石实训营原项目提取公开端视觉和认证交互，再将后台收敛为独立活动所需的固定报名/投稿模型。原仓库、旧生产系统与旧学员数据均不改动。

## 快速开始

需要Node24、Python3.11+；首次安装需要官方包仓库网络。使用一个XLSX和与它同目录的公共素材：

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
npm test
npm run demo
```

打开 `http://localhost:3000`。这个实例使用真实PostgreSQL16.14，自动保存于实例 `backend/data/postgres`；短信和飞书为醒目标记的本地模拟服务。注册界面显示本地模拟验证码，绝不会发送真实短信。飞书审核模拟台位于 `/simulation`，保存审核后默认约一分钟同步，或使用“立即同步”进行本地验收。模拟模式只能监听本机。

停止时按Ctrl+C，应用和本地PostgreSQL正常关闭；下次启动保留账号和业务记录。不要使用 `npm --ignore-scripts`，内嵌PostgreSQL需要安装脚本准备原生文件链接。

如果同机已有演示占用端口，停止它，或者：

```sh
PORT=3001 PG_PORT=55433 PUBLIC_ORIGIN=http://localhost:3001 npm run demo
```

浏览器地址必须与PUBLIC_ORIGIN一致；不同活动仍须独立输出和数据库。若提供自己的PostgreSQL，仅在环境变量设置DATABASE_URL。真实模式要求HTTPS及真实服务配置，见backend README和交接清单。

## 离线六页预览

在已生成的实例目录执行：

```sh
npm run preview:offline
```

打开 `offline-preview/home.html`。导航和公共素材链接可离线检查，账号页显示与应用相同的登录组件。它是实际React组件的非交互HTML导出，不是浏览器截图或交互测试；表单提交需要运行中的服务。

## 给下一位Agent的任务入口

读 `SKILL.md` 和 `docs/config-schema.md`，给它新的XLSX和必要公共素材。无需接触原仓库、了解本次开发聊天或手工改网站代码。表头与固定规则明确，生成失败会在写输出前指出原因。

制作一场新活动：

```sh
.venv/bin/python scripts/create_sample.py input/new-event
# 编辑唯一的 input/new-event/event.xlsx，替换所有示例内容并修改event.slug
.venv/bin/python scripts/validate_config.py input/new-event/event.xlsx
.venv/bin/python scripts/generate.py input/new-event/event.xlsx
```

生成命令打印输出目录。之后进入该目录执行npm安装、构建、测试和启动。每个活动是单独的网站、数据库、账号和素材，不存在中央运营平台。

## 生成内容

- 六页中文公开站及个人中心：保持原横幅/白色粘性导航/蓝绿强调色/正文侧栏布局
- 首页日程、交通住宿、联系方式、公开资料、静态FAQ；可选录播链接
- 原认证交互：短信注册+设置密码、手机号密码登录、短信重置
- 独立工作人员审核的参会报名，以及每人一份可保存草稿的在线投稿
- 有限补料、工作人员纠错、录用自动参会、同人去重和软容量提醒
- PostgreSQL、私有附件及必要鉴权，模拟与真实服务适配接口
- 可编辑横幅/海报SVG、PNG、Word/HTML参会指南、社媒文案和产物哈希清单

不包含支付/发票/费用、课程助手、晚间活动、签到、用户撤稿、旧项目申请模块、多租户、共享账号或配置反向同步。

## 内容更新

唯一源始终是XLSX与配套公共素材。更改原输入并重新执行生成、构建命令。生成器保留已有数据库、上传数据和运行时.env，不初始化或删除业务状态；会拒绝未知非空目录和在已有实例改变slug。不要直接编辑生成JSON、网站代码、海报或飞书来改变下一次生成的活动事实。

投稿提交后主要字段锁定。要求补料时只能补充说明/替换附件并再次审核。共用资料在首次申请提交后锁定，需修正时联系工作人员。审核结果可由工作人员纠正，内部备注不会作为作者反馈公开。

## 验证与限制

```sh
# 在模板包根目录
.venv/bin/python -m unittest discover -s tests -p 'test_generator.py'
# 在生成目录
npm test
```

后端测试使用独立临时PostgreSQL；不连接真实业务数据库，不调用付费短信/飞书。若指定TEST_DATABASE_URL，必须是专门的可丢弃测试数据库。

在本次开发环境，云浏览器拒绝localhost，本机Chromium受Unix socket限制。因此静态六页HTML可以检查内容/结构，但不代替实际浏览器交互验收。正式上线前仍要在可用浏览器和真实服务的预发布环境复核。

如果缺少中文字体，PNG可跳过并在manifest记录；可编辑SVG/Word/HTML仍生成。要生成中文PNG，安装系统Noto Sans CJK、微软雅黑或相应中文字体；不要仅用拉丁字体替代中文。

## 文件索引

- SKILL.md：给通用LLM/Agent的执行入口
- docs/config-schema.md：精确XLSX结构、固定默认值和小范围可替换选项
- docs/PROVENANCE.md：保留、重构和删除的原项目模块来源
- docs/deployment-handoff.md：真实服务、部署、备份及权限交接
- template/backend/README.md：API、模拟器和真实适配器契约
- scripts/generate.py：确定性生成；validate_config.py：只读检查
- scripts/render_preview.mjs：从同一React组件导出非交互离线六页
- scripts/package_delivery.py：排除秘密/业务数据后的交付打包
- input/fictional-conference.xlsx：可编辑虚构样例

本包不自动购买或部署服务，不推送外部仓库，也不宣称真实服务已经测试。原代码授权来源见PROVENANCE；公开分发前应核对使用许可。

## 模板包与活动实例包分别交付

`package_delivery.py`只打包可复用模板源码（脚本、规则、默认样表、测试），不包含已经生成的活动。生成实例含RUN.md，可单独npm安装/构建/启动。需要交付某场活动时用另一个脚本：

```sh
.venv/bin/python scripts/package_delivery.py --destination ../template-source-delivery --zip ../template-source.zip
.venv/bin/python scripts/package_instance.py --instance generated/<event.slug> --input /path/to/event.xlsx --destination ../event-instance-delivery --zip ../event-instance.zip
```

实例脚本仅复制manifest定义的公开代码/物料和可选构建/静态预览，排除数据库、用户附件、node_modules、日志与运行时.env。可选source-input是追溯快照，不是第二个可编辑事实源；后续内容仍在负责人指定的唯一XLSX中修改并用模板重新生成。

同一数据目录只允许一个PostgreSQL运行所有者。停止原启动终端并等待Node/PG完全退出后再重启；其他隔离会话看不到PID/端口，不代表它已停止。不能通过删postmaster.pid或重建数据库来绕过保护。
