# 接入契约

每场活动与每个环境使用独立身份配置。参考 `template/backend/forum.env.example`，不要用另一个活动的生产 env。

## 他山认证（默认）

`AUTH_SERVICE_URL` 必填，为认证服务源地址，不包含 /api/v1。后端代理 /api/v1/confirmations/prepare、auth/verification/send、auth/otp/login、auth/logout、auth/logout-all、me/profile 及账号设密接口。客户端沿用 confirmations 与幂等头契约；当前兼容会话 cookie 名为 panshi_learner_session，这是协议名，不是界面品牌。代理仅转发该 cookie，去除 Domain 并在本站保存。具体请求实现见 frontend/src/api/auth-client.ts、backend/forum-server.js。

`check:integration` 检查 healthz 和未登录 profile 状态，不代表验证码登录已完成。上线前用测试手机号实际收码并验证登录/退出。可选他山 SSO 按钮需要 TASHAN_SSO_CLIENT_ID/SECRET、64 位十六进制加密 key、API_BASE、LOGIN_URL、本站 ORIGIN；保持为空则不显示第二入口。

## 通用资料总库

配置 PROFILE_HUB_URL（服务基础路径）、PROFILE_HUB_CLIENT（本活动本环境客户端）、PROFILE_HUB_SECRET（至少24字符）。`/sync` POST 使用 HMAC-SHA256，签名为 timestamp.nonce.rawBody；协议在 backend/profile-hub.js。

请求身份 phone/subject 均来自服务端会话。读取返回 profile：real_name、organization、major、research_direction、email、department 及 version。保存报名后，向 /sync 发送 changes、event_id、source_updated_at；持久记录未成功回写任务，重试使用相同 event_id。非空通用字段回写，活动专属字段不回写。最新来源裁决在中央服务完成，本模板不再按导入时间猜测。

不再调用旧实训营的 application/prefill 接口，资料来源统一为配置的总库。

后台同步失败不影响登录、手动填写和已提交记录。已提交报名显示当时快照，其他网站资料更新不悄悄改写快照；本次用户修改并提交才形成新版本。

## OSS

DEPLOY_ENV 必须为 staging/production。前缀必须为 `<event.slug>/<DEPLOY_ENV>/`，部署脚本检查与活动相符。各环境使用独立桶或最小权限前缀和密钥。

上传正文保存在私有 OSS；SQLite 仅保存对象 key、大小、哈希及业务元数据，不保存新附件字节。用户下载需要本人会话。为沿用飞书工作人员直接查看材料的能力，提交时会向飞书保留审核附件镜像；不会在服务器落地附件文件。

XLSX resources 中的下载附件生成到 materials/oss-upload，部署前 `node ops/upload-public.mjs` 上传并读回核对。前端 URL 指向 `/api/forum/public/<sha256>`，后端只公开当前配置白名单文件；这些下载原件不打进运行包。照片、Logo、横幅等站点视觉素材仍是静态资源，不是用户上传附件。

## 飞书两表

先配置 Base 与应用，运行 `npm run feishu:plan` 查看准确目标；有该 Base 建表授权后 `npm run feishu:apply -- --authorize-base=<token>`。使用 Bitable v1 API；不携带原论坛 R2 专属 schema 或字段 ID。

报名表：当前状态可填 待审核／审核中／需补充材料／已通过／未通过。投稿表：待审核／审核中／需补充材料／已录用／未录用／已撤回。工作人员同时将“审核对应版本”设为报名的“资料版本”或投稿的“当前版本”；“公开意见”给用户看，备注只供工作人员。

用户修改重新提交：当前版本递增、状态重置待审核，保留旧版本与当时审核。只改旧版本审核不会改变新版本状态。报名是否通过不影响待审期间投稿，稿件录用不会自动通过报名。

网站重新读取时同步审核结果，当前飞书记录缓存约10秒；本版本不承诺页面无操作时自动轮询更新。审核最终结果请刷新页面查看。
