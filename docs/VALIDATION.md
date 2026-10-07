# v3 验证与未验项目

2026-10-07。本轮基于GitHub main `bc2a3c7f152e2e0fb27446a40c0d71223fed437b`，开始时对98个文件逐Git blob校验一致；用户README的panshi命名保留，旧版本从当前树移除，可由Git历史恢复。本轮源码版本3.0.0，不推送、不部署、不改真实飞书。

## 已完成的本地验证

- Python生成/引用/横幅绑定/打包输入一致性：42项通过
- 后端全量：63项通过，使用全新隔离真实PostgreSQL16，飞书HTTP与短信provider明确mock
- 其中飞书初始化/adapter/SMS定向37项：plan零资源写、精确base授权、三表重复apply复用、异名兼容表、字段类型/状态选项冲突、权限类别、并发/中断恢复、分页、创建幂等、附件缓存、工作人员字段不被回写、新旧轮次及表/记录失败隔离
- 两用户私有问题创建/查询隔离、请求重试去重、DB拒绝写入不报成功、单回复更新/清空、越权记录404、缺飞书默认生产拒绝、内部备注不出API
- 完整server事务+实际FeishuBitable的HTTP mock闭环，包含旧轮次忽略、新轮审核、录用去重；mock不等于真实租户联通
- 从虚构完整XLSX新生成实例：production build、16项React/jsdom状态与SSR回归、测试目录中的六页渲染及DOM/本地链接检查通过
- 六页与public配置/bundle无readiness、sourceNotes、heroWarning、模拟入口/验证码或构建预览诊断；正常按钮实际API失败没有假成功
- 原停机回归迁移至独立开发CLI后，通过SIGTERM/SIGINT→重新生成→重启3周期，保留完整账号/投稿/补料轮次/私有附件/参会资格
- 样例会议指南render_docx.py渲染4页，逐页检查无空白页、缺字、裁切或表格溢出；不限制其他活动页数
- SKILL frontmatter验证通过，主入口短化并将具体操作放入文档；本地Markdown链接及git diff --check通过

## 尚未验证

- 没有真实飞书App Secret/目标base与权限配置，因此真实建表、记录写入、附件上传、工作人员审核/问答回读端到端未验
- 真实短信投递/签名模板、预发布HTTPS Cookie和正式部署未验
- 真正桌面/手机浏览器视觉、触控、表单操作未验；SSR/build/jsdom/HTTP mock不能替代
- 生产备份恢复、跨OS运行和Microsoft Word渲染未验；本地重启保持不能称灾备已验证
- 真实活动的容量和窗口未由本虚构样例替代；交付实际活动前仍需负责人确认

## 复跑

模板根建立README中的项目venv后：

```sh
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
.venv/bin/python scripts/generate.py input/fictional-conference.xlsx --output /absolute/path/to/new-instance
```

进入新实例：

```sh
npm ci
npm run build
npm test
npm run test:frontend
npm run test:pages
```

模板根运行 `tests/validate_public_pages.py` 检查上述实例的test-evidence/public-pages；该输出仅QA，不进成品包或交付入口。完整持久化生命周期需要新的fixture、已安装实例与源模板Python：

```sh
node template/backend/test/shutdown-lifecycle.mjs /absolute/path/to/new-fixture /absolute/path/to/installed-instance .venv/bin/python
```

对照manifest的输入/配置/public配置/模板/产物SHA；公开镜像不再和私有配置同字节。飞书plan/apply/check及预发布验收按deployment-handoff.md。无凭据时只交付代码与本地证据，不能写生产已就绪或系统已接通。

## 当前交付

当前树与交付附件仅保留v3，旧文件入口已移除，Git历史没有重写。本轮成品包不带测试页面/测试输出，不把测试页作为客户展示入口。
