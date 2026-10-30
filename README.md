# 他山活动网站模板 v5

Word 通知＋XLSX＋素材 → 展示、报名审核、单或多类别投稿网站。默认接他山验证码认证、通用资料总库、私有 OSS 和飞书审核。

业务默认：报名需审核；待审核可以投稿；每人每类一篇；修改后重新待审并保留历史；首次生成只开“学术报告”一个类别。视觉来自正式论坛 `a01dff8`，不携带其会议信息、凭据或生产数据。

## 生成与验证

Node 24、Python 3.11+。先读 [SKILL.md](SKILL.md)。Windows 建议设置 `PYTHONUTF8=1`。

```sh
python -m venv .venv
# Windows 用 .venv/Scripts/python.exe；Unix 用 .venv/bin/python
.venv/Scripts/python.exe -m pip install -r requirements.txt
.venv/Scripts/python.exe scripts/create_sample.py input/new-event
# 参照 Word 编辑 input/new-event/event.xlsx，并替换素材
.venv/Scripts/python.exe scripts/generate.py input/new-event/event.xlsx
```

进入命令输出的 generated/<slug>：

```sh
npm ci
npm run build
npm test
npm run test:frontend
npm run dev:fixture
```

`dev:fixture` 仅在 127.0.0.1:3420 运行，使用隔离测试身份和内存模拟飞书/OSS，不发送短信、不调用他山总库；退出丢弃测试记录。页面为真实构建产物，可查看登录后页面并提交测试报名。它不是生产接入验收，也不打入发布包。

生成器回归：`python -X utf8 -m unittest discover -s tests -p "test_*.py"`。源码打包与实例打包继续使用 scripts/package_delivery.py、scripts/package_instance.py；不覆盖业务数据库、私有 env 或用户文件。

## 入口

- [配置契约](docs/config-schema.md)：Word/XLSX、类别、截止、容量、素材。
- [接入契约](docs/integrations.md)：认证、总库、OSS、飞书及审核操作。
- [部署](docs/deployment-handoff.md)：staging/main、HTTPS、资源隔离、更新与回退。
- [外部独立使用](docs/independent-mode.md)：明确触发才替换服务，不复制中央认证源码。
- [验收范围](docs/VALIDATION.md)：本版本实测结果与未验范围。

v4 的标准后端代码仍保留供迁移参考，但 v5 生成物的 npm start 固定启动 forum-server；不要切换到旧 start.js、旧独立密码数据库或旧三表初始化脚本。新活动使用 forum-init.js 的报名/投稿两表契约。
