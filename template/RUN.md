# 运行这个生成后的活动实例

这是一个独立生成的活动项目；无需原仓库即可启动。活动内容源仍是生成它的唯一XLSX与公共素材，生成JSON是派生数据。

需要Node24。进入本实例目录：

```sh
npm install
npm run build
npm test
npm run demo
```

如果原资料没有容量或报名、投稿窗口，实例醒目标记“资料预览”，对应最终提交暂不开放；登录、共用资料与投稿草稿仍可准备。不要用数字1或任意日期凑齐。确认真实运营事实后，回到唯一XLSX补齐并重新生成、构建和正常重启；不重置数据库。

打开终端显示的精确地址，默认http://localhost:3000。默认使用实际本地PostgreSQL16，短信与飞书为醒目标记的模拟服务；不是生产部署。模拟审核台位于/simulation。账号沿用短信注册+设置密码、手机号密码登录、短信重置流程。

需要静态六页检查时运行：

```sh
npm run preview:offline
npm run test:frontend
```

打开offline-preview/home.html。静态文件不执行登录和表单；它不是浏览器交互测试。test:frontend仅用模拟内存DOM验证同路由登录/退出状态，不是真实浏览器验收。

停止时在启动该实例的同一终端按Ctrl+C，等待Node和PostgreSQL退出、日志出现完成停机，再重新启动。一个PG_DATA_DIR只能有一个运行所有者；进程或端口在另一隔离会话不可见，不代表原所有者已经停止。遇到postmaster.pid拒绝启动时不能自动删PID文件或重建数据库，应回到原终端确认停机。不同实例使用独立数据目录/数据库；同机还需不同HTTP与PG端口。

Linux/macOS指定另一组端口：

```sh
PORT=3001 PG_PORT=55433 PUBLIC_ORIGIN=http://localhost:3001 npm run demo
```

Windows PowerShell：

```powershell
$env:PORT='3001'; $env:PG_PORT='55433'; $env:PUBLIC_ORIGIN='http://localhost:3001'
npm run demo
```

PG_DATA_DIR可覆盖本地数据库目录；日志打印它的实际绝对路径。backend/data中的业务记录不能放进交付ZIP。实际运行必须保留数据库；不删除、不复制运行中的PG目录给另一个实例。

若要修改活动内容，返回来源模板包和原XLSX执行validate/generate，再在此处build。不要直接修改config.json、网页或飞书反向同步活动事实。真实短信/飞书接入、TLS与生产数据库详见backend/README.md；模拟已测试不代表真实集成通过。
