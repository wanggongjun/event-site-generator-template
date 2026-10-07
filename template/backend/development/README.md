# 开发与测试工具

仅供执行者在自己的开发测试环境使用，不作为活动网站入口或客户展示。

## 显式本地开发

实例根`PUBLIC_ORIGIN=http://localhost:3000 npm run dev:simulation`，只loopback、本机PG默认55432、数据backend/data/postgres。NODE_ENV=production拒绝模拟；缺真实配置默认不会启动模拟。

没有/simulation、/api/simulation或公开模拟code。开发者通过显式CLI读取本地验证码/排模拟审核：

```sh
APP_MODE=simulation DATABASE_URL=postgresql://event_demo:local_demo_only@127.0.0.1:55432/postgres PUBLIC_ORIGIN=http://localhost:3000 node backend/development/dev-simulation.js sms 13800001234 register
APP_MODE=simulation DATABASE_URL=postgresql://event_demo:local_demo_only@127.0.0.1:55432/postgres PUBLIC_ORIGIN=http://localhost:3000 node backend/development/dev-simulation.js review 13800001234 submission needs_materials "请补附件"
APP_MODE=simulation DATABASE_URL=postgresql://event_demo:local_demo_only@127.0.0.1:55432/postgres PUBLIC_ORIGIN=http://localhost:3000 node backend/development/dev-simulation.js sync
```

WindowsPowerShell先分别设环境变量再运行相同node命令。停止原终端Ctrl+C等待完整退出。生命周期测试使用新目录和已安装实例：

```sh
node /absolute/path/to/template-source/template/backend/test/shutdown-lifecycle.mjs /absolute/path/to/new-fixture /absolute/path/to/installed-instance /absolute/path/to/template-source/.venv/bin/python
```
