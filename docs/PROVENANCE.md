# 复用来源与边界

参考仓库：TashanGKD/panshi-ai4s-camp。
提取基线：b743737b4144052579fcdb740719ad6b3b3d07a3。

直接复用：packages/ui/src/tokens.css、EventBanner.tsx、EventNavigation.tsx（导航aria标签泛化）、InfoCard.tsx、ContentSection.tsx；apps/web/src/styles/public.css；features/auth/AuthForm.tsx；features/learner/AccountAccessPanel.tsx（保留交互和密码校验，适配新API并标记模拟短信）。

结构参考并重构：PublicShell、首页、交通住宿、联系、资料、FAQ及个人中心。旧业务内容、人物图片、Logo、固定活动横幅、旧录取数据、旧数据库迁移和服务器秘密均不进入交付。

后端提炼并简化：保留原身份/本人数据/私有文件/状态正确性原则，使用新的最小固定业务模型。没有迁移旧生产数据，也不承诺新代码与旧API逐项兼容。

原仓库及线上系统未写入或部署。后续公开分发前应核对原代码授权；本文件不另行宣称原代码具有开源许可。
