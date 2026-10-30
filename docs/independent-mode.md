# 非他山独立使用

仅在用户明确要求时触发；默认仍为他山模式。不要因为服务地址暂缺就切换到本地假认证。

先设置 `INTEGRATION_MODE=independent`，否则启动按他山模式要求资料总库配置。

1. 认证：替换 AUTH_SERVICE_URL，对接兼容验证码/确认/会话接口的服务；不兼容时在 backend/forum-server.js 的 identity/proxy 和前端 auth-client 适配。允许替换 cookie 名，但必须相应调整会话白名单及测试，不关闭来源校验。
2. 资料：不需要跨网站复用可留空 PROFILE_HUB_URL/CLIENT/SECRET，表单仍可手填。需要外部资料时实现 /sync 契约或替换 profile-hub.js 客户端；不保留他山客户端密钥。
3. 存储：默认仍可用独立阿里云 OSS。换服务商时只替换 forum-oss.js 的 put/get/remove/probe 实现，保留私有对象、鉴权下载、校验与禁止本地持久附件回退的规则。
4. 部署：独立域名、HTTPS、目录、端口、服务、飞书表、对象前缀与 Secrets。清空可选 TASHAN_SSO_*；接入方名称不得冒称他山。

业务组件、生成器与审核规则保持共用。完成新服务验证码登录、附件、飞书写入与审核回读验收后再声称可独立上线。模板提供替换边界和步骤，不承诺自动支持任意第三方认证协议。
