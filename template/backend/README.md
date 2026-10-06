# Event backend

Node 24, PostgreSQL (`pg`), legacy-compatible bcrypt cost 12 (`bcryptjs`). No SQLite fallback. Authentication remains SMS registration + password setting, phone/password login, and SMS password reset; there is no OTP-only login. A generated `config.json` is read on every request. Business data and private file bytes live in the separate PostgreSQL database. Regenerating event content never executes a database reset.

## Start

For a local demo, run `npm start` without DATABASE_URL: the bundled embedded PostgreSQL starts on loopback port55432 with persistent data at `$APP_ROOT/backend/data/postgres`. Set `PG_PORT` or `PG_DATA_DIR` to override. This is a real PostgreSQL16 database, not an in-memory mock. Run exactly one owner for each data directory. Stop it with Ctrl+C or SIGTERM in its original terminal, wait for the process to exit and the PostgreSQL shutdown log, then regenerate/restart. A different terminal/tool namespace may not see the original PID or TCP listener while sharing its files. Startup refuses any existing postmaster.pid as active or unknown ownership; it never deletes the marker, resets data or tries recovery. An unexpected crash/stale marker or startup corruption requires operator diagnosis with the data preserved. The local-only demo credentials are not production credentials. For an existing PostgreSQL service or real deployment, set DATABASE_URL and the variables in `.env.example` in your shell (Node does not load this file automatically). Real mode never silently starts a demo database. `APP_ROOT` is the generated event's filesystem root; the defaults are `$APP_ROOT/config.json` and `$APP_ROOT/dist`. Optional `EVENT_CONFIG_PATH` and `STATIC_DIR` override those locations. The schema is initialized without deleting existing records. Use one database per event. A persisted event_slug guard claims each brand-new database for config.event.slug and rejects startup if another event tries to reuse it. Same-slug content updates remain valid. A nonempty older database without event metadata is refused, never silently claimed or reset; it requires an explicit operator migration or a separate database.

Simulation is the default and `start.js` refuses to expose it on non-loopback interfaces. It sends no SMS and writes no Feishu data. SMS request responses visibly include `simulationCode`. Open `/simulation` for the local, labeled review simulator. Queue a result, wait approximately `sync.pollSeconds` (default 60), or explicitly sync with the UI button. `npm run sync -- --force` processes queued simulation commands immediately through the same review-application function. Without `--force`, normal due-time rules apply. `/api/simulation/*` is unavailable in real mode.

## API

Every mutation uses JSON and requires `Origin` to exactly match `PUBLIC_ORIGIN`. Browser same-origin fetch supplies this. Errors are `{error:{code,message}}`. Authentication uses the `event_session` HttpOnly/SameSite=Strict cookie; real mode adds Secure. Never copy cookie or provider secrets into configuration.

- `GET /api/public/config` → `{config,runtime:{mode,smsMode,feishuMode,pollSeconds}}`
- `POST /api/auth/sms/request` `{phone,purpose:"register"|"reset"}` → `{ok,mode,expiresIn,retryAfter}` and simulation-only `simulationCode` and warning
- `POST /api/auth/register` `{phone,password,code}` → `{user:{id,phone},needsProfile:true}`, signs in
- `POST /api/auth/login` `{phone,password}` → `{user,needsProfile}`
- `POST /api/auth/reset` `{phone,password,code}` → `{ok:true}`, invalidates every session for this account; login again
- `POST /api/auth/logout` `{}` → `{ok:true}`
- `GET/PATCH /api/me/profile` → `{profile,complete,editable}`. Shared fields: name, verified phone (read-only), email, organization, identity (default 研究人员), researchDirection, optional department/job/personalIntroduction. Profile is editable until either application is submitted.
- `GET /api/me/attendance` → `{attendance,attendanceStats}`
- `POST /api/me/attendance` `{motivation?:string}` → `{attendance,attendanceStats}`; no submission prerequisite
- `GET/PUT /api/me/submission` → `{submission}`; `null` before first draft. PUT draft fields: title, abstract, keywords:string[], authors:[{name,affiliation}], presenter:string, note, attachmentIds:string[]. Submit requires all main fields and at least one attachment.
- `POST /api/me/submission/submit` `{}` → `{submission}`; no attendee prerequisite
- `POST /api/me/submission/supplement` `{note?,attachmentIds?}` → `{submission}`; only allowed in needs_materials, and only these fields may change. It returns the record to under_review.
- `POST /api/me/files` `{name,contentBase64}` → `{file:{id,name,mime,size}}`; default 20MiB/file and PDF/DOCX/PPTX; at most 3 attached per submission (30 stored files/account to permit replacements)
- `GET /api/me/files/:id` → authenticated owner-only attachment download. IDs are never public download links.
- `GET /api/simulation/state` → labeled local-only account/review state (never password hashes, sessions or file bytes)
- `POST /api/simulation/reviews` `{phone,kind:"attendance"|"submission",decision:"accepted"|"rejected"|"needs_materials",feedback}` → delayed queue result; attendance does not allow needs_materials
- `POST /api/simulation/sync` `{force?:true}` → applied count

Submission output contains all draft fields plus status, reviewRound, feedback, attachment metadata, updatedAt and submittedAt. Draft reviewRound is0; first submission sets1; each needs_materials supplement increments by1; staff corrections keep the current round. Allowed statuses: draft, under_review, needs_materials, accepted, rejected. No withdrawal and no normal post-submit edits. One business record and submission per verified phone account. Review corrections may change terminal states.

Attendance output: status (manual application only), motivation, feedback, updatedAt, attendanceGranted, grantSources. Sources independently track manual_attendance and accepted_submission. Accepted submissions immediately grant attendance; rejecting/correcting that submission removes only its automatic grant. Shared total counts distinct account/person IDs across both sources; capacityWarning is raised at or above capacity and is informational and never blocks approval. Counts can overlap and must not be summed.

## Optional real adapters (not live-tested)

Real mode fails closed unless real SMS and Feishu settings are present and PUBLIC_ORIGIN is HTTPS. It has no simulator endpoints and no exposed SMS codes. Configure real integrations and run staging acceptance tests before public launch. Credentials must be obtained and managed by the operator outside event content.

Real SMS defaults to direct Aliyun SendSms, preserving the original provider's SignName, TemplateCode, configurable template variable key and Code=OK acceptance. The SDK transport was refactored into native Node crypto/fetch using current official ACS3-HMAC-SHA256 signing, so an extra SMS gateway or SDK package is not required. Set SMS_ALIYUN_ACCESS_KEY_ID, SMS_ALIYUN_ACCESS_KEY_SECRET, SMS_ALIYUN_SIGN_NAME and SMS_ALIYUN_TEMPLATE_CODE. SMS_ALIYUN_TEMPLATE_PARAM_KEY defaults to code; SMS_ALIYUN_ENDPOINT defaults to dysmsapi.aliyuncs.com; SMS_ALIYUN_REGION_ID defaults to cn-hangzhou. Optional SMS_ALIYUN_SECURITY_TOKEN supports operator-supplied STS credentials. The endpoint is restricted to official HTTPS dysmsapi.aliyuncs.com hosts. The operator must have an authorized Aliyun RAM identity with dysms:SendSms access and an approved signature/template that matches the chosen verification-code variable. No credentials, provider account, approved template or paid SMS service are bundled. Live delivery, tenant permissions and template approval remain untested. SendSms is not idempotent, so an uncertain timeout is not automatically retried.

Provenance: [original provider at the pinned source commit](https://github.com/TashanGKD/panshi-ai4s-camp/blob/b743737b4144052579fcdb740719ad6b3b3d07a3/apps/api/src/modules/identity/aliyun-verification-provider.ts), [original SDK wrapper](https://github.com/TashanGKD/panshi-ai4s-camp/blob/b743737b4144052579fcdb740719ad6b3b3d07a3/apps/api/src/modules/sms/aliyun-client.ts). Native transport follows [official ACS3 signing](https://help.aliyun.com/zh/sdk/product-overview/v3-request-structure-and-signature) and [official SendSms metadata](https://api.aliyun.com/meta/v1/products/Dysmsapi/versions/2017-05-25/apis/SendSms/api). Tests match the official fixed signature vector and exercise a mocked transport only.

Only when explicitly selected with SMS_PROVIDER=http, the optional generic adapter calls the operator's HTTPS SMS_SEND_URL with Bearer SMS_API_KEY, JSON {phone,purpose,code,templateId}. That gateway must return a 2xx response only after accepting delivery. This is an alternative integration, not an additional required dependency.

The optional Feishu adapter uses official tenant-token, Bitable-record and Drive-media endpoints. Create two tables, Attendance and Submission, with these exact fields: 用户ID (text), 手机号 (text), 姓名 (text), 单位 (text), 邮箱 (text), 职业阶段 (text), 审核状态 (single select), 反馈 (text), 资料JSON (multiline text). Attendance also has 报名原因 (multiline text). Submission also has 标题 (text), 审核轮次 (number) and 附件 (attachment). 审核状态 values must be under_review, needs_materials, accepted, rejected. Staff change 审核状态 and 反馈. Credentials need only the corresponding Bitable read/write and media-upload permissions, and access to these tables. Registration/profile records remain private in PostgreSQL until an application is submitted; exporting includes the shared profile and that application, and submission files are uploaded privately to Feishu media.

Each periodic cycle pulls changed review decisions, applies them transactionally with an audit history, then exports changed application rows. The application data remains authoritative in PostgreSQL; canonical event content is never imported from Feishu. The fixed schema is deliberately not a general form/workflow engine. Live token scopes, table permissions, pagination and attachment uploads must be verified against the specific Feishu tenant. Feedback fields should be plain text. `FEISHU_MODE` defaults to real in real mode.

## Security and operation

Passwords are bcrypt cost12 and limited to 8–72 UTF-8 bytes to avoid truncation. SMS codes expire after10 minutes, are salted/hashed, single-use and lock after five wrong attempts. Minimal per-IP/per-phone throttling is in-process; production multi-instance deployments should add shared edge throttling. Session tokens are stored hashed in PostgreSQL and expire after7 days. Reset deletes all current sessions. Only owners can attach/read files. PDF signatures/EOF and bounded OOXML ZIP/XML signatures are inspected; this is basic true-content checking, not an antivirus service. Consider isolated malware scanning before a production event accepts untrusted documents. Backend never extracts archives, serves upload paths or publishes attachment URLs.

The static frontend is served with SPA fallback from `dist`; `/api` never falls back to HTML. TLS should terminate at a trusted reverse proxy and preserve same-origin behavior. In real mode configure HTTPS, backup the PostgreSQL database, restrict its network access, and grant the application DB account only the event database. No old admin, payments, invoices, tutoring, evening sessions or check-in are included.

Backend integration tests automatically start a temporary local PostgreSQL unless `TEST_DATABASE_URL` points to a disposable PostgreSQL database. Tests create and drop a uniquely named schema only inside that explicitly supplied test database. There are no real provider tests.

Optional repository-level lifecycle regression, after the documented project venv setup and npm install in one generated instance:

```sh
node template/backend/test/shutdown-lifecycle.mjs /absolute/path/to/a-new-fixture generated/<event.slug> .venv/bin/python
```

Run this from the reusable package root. Windows uses `.\.venv\Scripts\python.exe` for the final argument. The second path is an existing generated instance with its already-installed Node dependencies; no duplicate template npm install is needed. The script creates a new fixture via the project venv Python and uses the installed generated backend to run it in one owner/process namespace. It saves complete-record evidence and checks SIGTERM/SIGINT stop → regeneration → restart. Existing fixture data is never reset. This explicit regression is separate from ordinary generated-instance `npm test`.
