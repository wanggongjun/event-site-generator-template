# v5 验收结果与边界

2026-10-30，Windows、Node 24.13.0、Python，独立分支 review/template-recovery-20261030。模板基线 e8b79be，视觉及成熟业务实现参考正式论坛 a01dff8。本轮没有修改或部署正式论坛。

## 已验证

- 生成器回归：46 项执行，44 项通过、2 项跳过。跳过原因为本机无符号链接创建权限、没有 LibreOffice 分页渲染工具。
- 两个全新实例：默认单类别和自定义多类别，分别安装依赖、构建和执行前端状态回归，均通过。多类别使用 paper/demo，证明类别不是硬编码 academic/flash。
- 后端：两实例各 27 项通过，包括报名审核、待审报名可以投稿、修改后重新审核、历史版本、过期审核、重试去重、归属隔离、重启持久化、总库读写、SSO、OSS 环境隔离和附件不存入 SQLite 正文。
- 前端：待审/通过状态、已提交快照保留、提交中与长时间等待提示、防重复提交、提交结果恢复、弹窗、单/多类别展示。
- Edge 浏览器：真实生成页面连接本机隔离测试后端；1440×1000、900×900、390×844 检查首页、报名、投稿、个人中心、账号设置，无横向溢出；桌面及方形保留右侧日期，手机使用底部玻璃抽屉。
- 浏览器实际提交报名、关闭结果弹窗并刷新，待审核提示仍在；实际提交和修改自定义实践类别；公开下载走本机白名单接口；桌面/手机登录页、手机展开玻璃抽屉已截图检查。
- Skill 格式校验、git diff --check、Bash 语法和部署工作流 YAML/分支目标静态检查通过。

浏览器证据位于回收工作区 audit/screenshots，主矩阵为 audit/browser-results.json。测试身份、飞书和 OSS 均为受控 fixture；登录页使用未登录响应检查布局，没有发送真实短信。

## 未验证，不算正式接入通过

- 本轮没有新建真实活动的认证/总库客户端、飞书表、OSS 桶或部署资源；真实短信、SSO 跳转、总库写入、飞书审核及 OSS 上传下载仍需在新活动隔离环境验收。
- Linux/systemd/Nginx/GitHub Actions 仅准备了脚本和配置说明，未执行远程部署、故障回滚或灾备恢复。
- 浏览器为 Edge 桌面与手机尺寸模拟，不是手机触控真机或 Safari 兼容性专项测试。
- Word 生成和内容检查通过；Word 分页视觉未验，PNG 物料缺少栅格化工具未生成，SVG 已生成。
- 构建存在主 JS 包约 625 KB（gzip 142 KB）的体积提示；未开展性能压测。
- v4 后端保留作迁移参考，其旧测试不作为 v5 实际运行链路的验收结果。v5 使用 forum-start.js 与报名/投稿两表。

## 复跑

在源码根目录设置 PYTHONUTF8=1，执行：

```sh
python -m unittest discover -s tests -p "test_*.py"
python scripts/generate.py input/fictional-conference.xlsx --output generated/recovery-single
python scripts/generate.py input/recovery-multi/event.xlsx --output generated/recovery-multi
```

进入任一生成实例执行 npm ci、npm run build、npm test、npm run test:frontend、npm run dev:fixture。端口默认 3420；第二实例可设置 PORT=3421。fixture 仅监听本机、不访问真实短信/资料总库，停止后不保留测试业务数据。
