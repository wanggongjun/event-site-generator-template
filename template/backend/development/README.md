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

Windows PowerShell在实例根可直接运行：

```powershell
$env:PUBLIC_ORIGIN='http://localhost:3003'
$env:PORT='3003'
$env:PG_PORT='55435'
$env:PG_DATA_DIR=Join-Path (Get-Location) 'backend/data/postgres'
node backend/start.js --simulation
```

PG只监听127.0.0.1，默认端口55432，HTTP默认3000；每活动独立目录/端口。路径可含空格/中文。真实模式使用DATABASE_URL，不启内嵌PG，不能把本地命令当生产接入。停止原终端Ctrl+C，等“Shutdown complete”及终端返回后重启。应用先收尾HTTP、同步与连接池，再用官方pg_ctl fast等待PG正常退出和PID文件由PG移除；外部生产数据库不停止。不要关终端、taskkill、删postmaster.pid或重初始化。异常报告包含目录/拥有PID/停机错误，保留原数据，先在原环境确认所有者；未确认前不能启动第二份。

Windows自动回归：实例根 `npm run test:windows`，创建新的临时中文/空格路径，运行完整账号/附件/二审资格保持、重复优雅关闭、三次重启及启动失败清理，输出证据路径。用受控IPC进入同一关闭函数，不伪造Windows SIGINT；终端Ctrl+C需另做人工启停。Linux执行明确SKIP。Linux实际SIGTERM/SIGINT生命周期测试使用新目录和已安装实例：

```sh
node /absolute/path/to/template-source/template/backend/test/shutdown-lifecycle.mjs /absolute/path/to/new-fixture /absolute/path/to/installed-instance /absolute/path/to/template-source/.venv/bin/python
```
