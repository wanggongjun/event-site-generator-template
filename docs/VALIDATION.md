# v4 验证与未验项目

2026-10-07。基于GitHub main `9d6f00c54b77aeb1a6aa78c5d6080df316ab386c`，改动前94个文件内容与Git模式逐blob一致，工作树为 `7cf62a9ce7ce23ae474bb2b3823cbe17fb403aaa`。保留用户README的panshi命名、v3真实服务默认及既有业务；版本4.0.0。此版本只发布模板源码，不部署生产、不修改真实飞书；当前旧包移除，历史提交保留，不以ZIP上传为交付前提。

## 最终代码已验证

执行环境为Linux、非root用户、Node24.19.0、锁定embedded-postgres16.14.0-beta.17（实际PG16）。以下通过均不表示Windows实机或真实外部服务通过。

- Python生成/引用/横幅绑定/打包一致性：42/42
- 新生成消费实例独立npm ci，production build成功
- 新生成消费实例后端全量：73/73，无跳过；其中新增PG测试10项，含Windows中文/空格exe与目录的无shell参数mock、退出等待/超时、PID保护、已退出进程、失败保留、禁止非持久化与非法端口、真实PG三次重启及启动失败恢复、重复stop与连接池关闭一次
- POSIX非秘密IDs文件0600通过；所有平台同一内容/无密钥/白名单/秘密env拒覆盖测试继续执行。Windows分支不再将mode当ACL；NTFS ACL实机未验
- React/jsdom状态与SSR回归：16/16；六页渲染及DOM/本地链接检查通过，公开页面没有模拟验证码、内部诊断或准备度提示
- 新生成实例完整业务SIGTERM/SIGINT → 重新生成 → 重启3周期通过，账号、投稿补料轮次、私有附件、录用与去重参会资格保持
- Windows自动回归脚本的完整受控IPC流程在临时Linux副本验证通过：三次重启、重复关闭、账户/资料/附件/二审/资格保持，以及配置错误、loopback限制、HTTP端口占用的非零失败清理。原脚本在Linux运行明确SKIP，不计Windows实机通过
- 独立审核另19项定向验证通过，包含Linux SIGTERM/SIGINT、HTTP占用失败code1、未完成HTTP请求的SIGINT收尾、默认win32→windows-x64模块解析与参数mock、已退出子进程残留PID保护
- git diff --check、本地文档链接及生成实例包含同一修复文件通过

## 未验与边界

- Windows本机PG进程、真实PowerShell/CMD Ctrl+C、NTFS ACL未验；一键脚本是留给Windows执行者的验证入口，不是实测证明
- 没有真实飞书App Secret/目标base及权限，真实建表、记录写入、附件上传、工作人员审核与问答回读未验
- 真实短信投递、签名模板、HTTPS Cookie与生产部署未验；mock/check通过不能写完整生产已部署
- 桌面/手机真实浏览器视觉、触控、表单操作未验，SSR/build/jsdom不替代浏览器验收
- 生产备份恢复与Word跨平台渲染未验；本地重启保留不等于灾备恢复通过

## 复跑

按README建立项目venv，在模板根：

```sh
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
.venv/bin/python scripts/generate.py input/fictional-conference.xlsx --output /absolute/path/to/new-instance
```

Windows替换Python路径为 `.\.venv\Scripts\python.exe`。进入新实例：

```sh
npm ci
npm run build
npm test
npm run test:frontend
npm run test:pages
npm run test:windows
```

最后一条仅Windows实机执行回归；其他平台明确SKIP。在模板根跑 `tests/validate_public_pages.py <实例>` 检查测试页面，本地QA输出不进成品包。Linux完整生命周期需新fixture、已安装实例及源模板Python：

```sh
node template/backend/test/shutdown-lifecycle.mjs /absolute/path/to/new-fixture /absolute/path/to/installed-instance .venv/bin/python
```

Windows启停、端口、数据目录和脚本边界见 [Windows运行说明](windows.md)。真实接入及预发布验收按 [接入与运行](deployment-handoff.md)。
