# Windows运行与源模板修复 v4

v4基于main `9d6f00c54b77aeb1a6aa78c5d6080df316ab386c`。本轮没有Windows执行环境；Windows命令分支已mock验证，真正Windows实机与终端Ctrl+C仍未验。不要将Linux通过改写为Windows通过。

## 先生成，再验证，再接入

在模板根用Python3.11+项目环境生成，Windows不需要改PowerShell执行策略：

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --cache-dir .cache/pip -r requirements.txt
.\.venv\Scripts\python.exe scripts/generate.py input/fictional-conference.xlsx --output generated/windows-check
```

进入新生成实例，使用Node24：

```powershell
cd generated/windows-check
npm ci
npm run build
npm test
npm run test:frontend
npm run test:windows
```

自动Windows回归创建独立临时中文/空格路径及新PG目录，不接真实服务，不改变原活动数据。检查三次重启前后的账户、资料、投稿二审、附件及去重参会资格，并验证重复关闭、配置错误、HTTP端口占用清理。输出保留的证据路径；Linux运行明确SKIP。自动停机通过父子进程IPC进入应用自己的关闭函数；它不等于终端Ctrl+C验收，也不用Windows `child.kill('SIGINT')`假装优雅信号。

## 正常本地启停

这一步仅为明确开发测试。真实部署仍按 [接入与运行](deployment-handoff.md) 配好独立数据库、HTTPS、真实短信和飞书三表，不回退模拟。

```powershell
$env:PUBLIC_ORIGIN='http://localhost:3003'
$env:PORT='3003'
$env:PG_PORT='55435'
$env:PG_DATA_DIR=Join-Path (Get-Location) 'backend/data/postgres'
node backend/start.js --simulation
```

HTTP默认3000，本地PG默认55432且只监听127.0.0.1；上述值是独立实例示例。每活动独立slug、目录、HTTP/PG端口。数据保留在PG_DATA_DIR（默认实例的backend/data/postgres），重新生成不会清空。生产提供DATABASE_URL时，应用仅关闭自己的连接池，不停止外部PG。

在原启动终端按Ctrl+C，等待“Shutdown complete”及终端返回后再启动同一命令；核对账号和记录保留。不要直接关闭终端、taskkill或结束进程树。受控停机按HTTP请求、同步任务、连接池、内嵌PG的顺序完成；重复请求共享同一次关闭。

## 修复依据与失败处理

锁定依赖embedded-postgres16.14.0-beta.17的Windows stop使用taskkill /f /t，可能让PG来不及正常关闭和移除锁。v4在模板内覆盖该实例stop（包括依赖退出钩子的调用），改为官方pg_ctl `stop -D <目录> -m fast -w -t 15`，参数数组无shell，等待PG正常停机及持有子进程退出。官方 [PG16 pg_ctl文档](https://www.postgresql.org/docs/16/app-pg-ctl.html) 说明fast会回滚活动事务并正常停机，-w以PG自行移除PID作为完成条件；超时不代表可以强杀或删锁。

若启动/关闭失败，错误报告目录、持有PID和pg_ctl错误，原数据不删除。已有postmaster.pid一律视为所有权仍活跃或未知，拒绝第二份启动，不自动删锁、不重新initdb、不按猜测PID杀进程。先在原电脑/原终端核对所有者和日志；不能确认时停止并向负责人报告。旧版强杀留下的锁不由v4自动“修复”。

另一个Windows失败是把POSIX0600当NTFS ACL断言。`.env.feishu.ids`只写白名单中的四个非秘密资源IDs，全部平台仍检查无密钥、可重读、重复写安全、拒绝覆盖秘密env。POSIX继续要求0600；Windows继承目录ACL，程序没有自动配置或声称凭据ACL已加固。真正密钥放部署Secret或由负责人保护的本机配置；运行时env排除于Git和成品包。

遇到新的部署失败，保留OS、Node版本、模板版本、脱敏命令/日志和最小复现反馈源模板，不让各场活动各自另改一份。生成成功、本地测试通过、真实生产验收通过要分别汇报；缺配置在对话中反馈，公开六页不展示内部诊断。
