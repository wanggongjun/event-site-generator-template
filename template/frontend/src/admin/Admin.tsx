import { useEffect, useState, type FormEvent } from "react";
import { RichEditor } from "./RichEditor";
import "./admin.css";

type Row = { record_id: string; fields: Record<string, any> };
type Content = {
  rows: Record<string, Row[]>;
  digest: string;
  current: string;
  history: any[];
  pending: boolean;
  uploads: { token: string; url: string }[];
};
const sections = ["基本设置", "页面内容", "报名设置", "报名管理"];
const statuses: Record<string, string> = {
  under_review: "待审核",
  reviewing: "审核中",
  needs_materials: "需补充材料",
  accepted: "已通过",
  rejected: "未通过",
};
const payments = ["待确认", "已缴费", "未缴费", "已退款"];
const core = new Set([
  "core",
  "attachmentIds",
  "paymentMethod",
  "invoiceType",
  "invoiceTitle",
  "invoiceTaxId",
  "invoiceAddress",
  "invoicePhone",
  "invoiceBank",
  "invoiceAccount",
  "dietaryNeeds",
  "researchQuestions",
]);
const requiredPages = new Set([
  "/",
  "/register",
  "/account",
  "/privacy",
  "/fees",
]);
const detailLabels: Record<string, string> = {
  name: "姓名",
  phone: "手机号",
  email: "邮箱",
  identityType: "身份",
  organization: "单位",
  department: "院系／部门",
  major: "专业",
  researchDirection: "研究方向",
  grade: "年级",
  title: "职称",
  paymentMethod: "缴费方式",
  invoiceType: "发票类型",
  invoiceTitle: "发票抬头",
  invoiceTaxId: "税号",
  invoiceAddress: "注册地址",
  invoicePhone: "注册电话",
  invoiceBank: "开户银行",
  invoiceAccount: "银行账号",
  dietaryNeeds: "饮食禁忌",
  researchQuestions: "希望解决的问题",
};
async function request(path: string, value?: unknown) {
  const response = await fetch("/api/admin/" + path, {
    method: value === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: value === undefined ? {} : { "content-type": "application/json" },
    body: value === undefined ? undefined : JSON.stringify(value),
    signal: AbortSignal.timeout(90000),
  });
  const result = await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(result.error?.message || "操作失败，请重试"),
      { status: response.status },
    );
  return result;
}
const time = (value: string) =>
  value
    ? new Date(value).toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour12: false,
      })
    : "—";
const showImage = (url: string) =>
  url?.replace("/api/site/media/", "/api/admin/images/");

export function Admin() {
  const [username, setUsername] = useState<string | null>(null),
    [checking, setChecking] = useState(true);
  const [section, setSection] = useState(0),
    [content, setContent] = useState<Content | null>(null),
    [dirty, setDirty] = useState(false),
    [editorVersion, setEditorVersion] = useState(0);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [preview, setPreview] = useState("");
  const [selectedPage, setSelectedPage] = useState("/"),
    [items, setItems] = useState<any[]>([]),
    [detail, setDetail] = useState<any>(null);
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [payment, setPayment] = useState(""),
    [passwordOpen, setPasswordOpen] = useState(false);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (e: any) {
      setError(
        e.name === "TimeoutError"
          ? "处理时间较长，请重新载入核对结果后再操作。"
          : e.message,
      );
      if (e.status === 401) setUsername(null);
    } finally {
      setBusy(false);
    }
  }
  function applyContent(next: Content) {
    setContent(next);
    setDirty(false);
    setEditorVersion((v) => v + 1);
    setPreview("");
  }
  async function loadContent() {
    applyContent(await request("content"));
  }
  useEffect(() => {
    request("session")
      .then(async (session) => {
        setUsername(session.username);
        await loadContent();
      })
      .catch((e) => {
        if (e.status !== 401) setError(e.message);
      })
      .finally(() => setChecking(false));
  }, []);
  useEffect(() => {
    const listener = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", listener);
    return () => window.removeEventListener("beforeunload", listener);
  }, [dirty]);
  function update(group: string, id: string, key: string, value: any) {
    setContent((previous) =>
      previous
        ? {
            ...previous,
            rows: {
              ...previous.rows,
              [group]: previous.rows[group].map((row) =>
                row.record_id === id
                  ? { ...row, fields: { ...row.fields, [key]: value } }
                  : row,
              ),
            },
          }
        : null,
    );
    setDirty(true);
    setPreview("");
  }
  function add(group: string, fields: Record<string, any>) {
    setContent((previous) =>
      previous
        ? {
            ...previous,
            rows: {
              ...previous.rows,
              [group]: [
                ...previous.rows[group],
                { record_id: "new_" + crypto.randomUUID(), fields },
              ],
            },
          }
        : null,
    );
    setDirty(true);
  }
  async function save() {
    if (!content) throw Error("内容尚未加载");
    if (!dirty) return content;
    const next = await request("content", {
      rows: content.rows,
      digest: content.digest,
      requestId: crypto.randomUUID(),
    });
    applyContent(next);
    return next as Content;
  }
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      const result = await request("login", {
        username: form.get("username"),
        password: form.get("password"),
      });
      setUsername(result.username);
      await loadContent();
    });
  }
  function params() {
    return new URLSearchParams({ search, status, payment }).toString();
  }
  async function registrations() {
    const result = await request("registrations?" + params());
    setItems(result.items);
  }
  async function upload(file: File, group: string, row: Row) {
    if (file.size > 10 * 1048576) throw Error("图片须小于10MB");
    const contentBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = () => reject(Error("图片读取失败"));
      reader.readAsDataURL(file);
    });
    const result = await request("images", { contentBase64 });
    const images =
      group === "settings" ? [result] : [...(row.fields["图片"] || []), result];
    update(
      group,
      row.record_id,
      "图片",
      images.map(({ file_token, name }: any) => ({ file_token, name })),
    );
    setContent((previous) =>
      previous
        ? {
            ...previous,
            uploads: [
              ...previous.uploads,
              { token: result.file_token, url: result.url },
            ],
          }
        : null,
    );
    setMessage("图片已上传，保存并发布后会显示在网站上。");
  }
  function images(group: string, row: Row) {
    const attached = row.fields["图片"] || [];
    return (
      <div className="admin-images">
        {!attached.length && group === "settings" && row.fields["内容"] && (
          <img src={showImage(row.fields["内容"])} alt={row.fields["名称"]} />
        )}
        {attached.map((item: any, index: number) => {
          const url = content?.uploads.find(
            (upload) => upload.token === item.file_token,
          )?.url;
          return (
            <div key={item.file_token}>
              {url ? (
                <img src={showImage(url)} alt={"图片" + (index + 1)} />
              ) : (
                <span>已上传图片 {index + 1}</span>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  update(
                    group,
                    row.record_id,
                    "图片",
                    attached.filter((_: any, i: number) => i !== index),
                  )
                }
              >
                移除
              </button>
            </div>
          );
        })}
        <label className="admin-file">
          {group === "settings" ? "上传替换图片" : "添加页面图片"}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy || (group === "pages" && attached.length >= 6)}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void run(() => upload(file, group, row));
              event.target.value = "";
            }}
          />
        </label>
        <small>
          PNG、JPG、WebP，每张不超过10MB
          {group === "pages" ? "，最多6张，显示在正文上方" : ""}。
        </small>
      </div>
    );
  }
  if (checking) return <main className="admin-loading">正在打开管理后台…</main>;
  if (!username)
    return (
      <main className="admin-login">
        <section>
          <div className="admin-mark">KIZ · AI FOR SCIENCE</div>
          <h1>昆明实训营管理后台</h1>
          <p>登录后管理网站内容与培训报名</p>
          <form onSubmit={login}>
            <label>
              用户名
              <input
                name="username"
                autoComplete="username"
                required
                maxLength={40}
              />
            </label>
            <label>
              密码
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                maxLength={256}
              />
            </label>
            {error && (
              <p className="admin-error" role="alert">
                {error}
              </p>
            )}
            <button disabled={busy}>
              {busy ? "正在登录…" : "登录管理后台"}
            </button>
          </form>
          <a href="/">返回活动网站</a>
        </section>
      </main>
    );
  const page = content?.rows.pages.find(
    (row) => row.fields["页面路径"] === selectedPage,
  );
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-mark">KIZ · AI FOR SCIENCE</div>
        <h1>
          昆明实训营
          <br />
          <span>网站管理</span>
        </h1>
        <nav>
          {sections.map((label, index) => (
            <button
              key={label}
              aria-current={section === index ? "page" : undefined}
              onClick={() => {
                setSection(index);
                if (index === 3) void run(registrations);
              }}
            >
              <span>0{index + 1}</span>
              {label}
            </button>
          ))}
        </nav>
        <div className="admin-sidebar-bottom">
          <a href="/" target="_blank" rel="noreferrer">
            打开活动网站 ↗
          </a>
          <small>当前账号 · {username}</small>
          <button onClick={() => setPasswordOpen(!passwordOpen)}>
            修改密码
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (dirty && !confirm("有尚未保存的修改，确认退出？")) return;
                await request("logout", {});
                setUsername(null);
                setContent(null);
                setDirty(false);
              })
            }
          >
            退出登录
          </button>
        </div>
      </aside>
      <main className="admin-main">
        <header className="admin-header">
          <div>
            <p>昆明实训营 / 管理控制台</p>
            <h2>{sections[section]}</h2>
          </div>
          <span className={"admin-state" + (dirty ? " is-dirty" : "")}>
            {busy ? "正在处理…" : dirty ? "有未保存修改" : "内容已载入"}
          </span>
        </header>
        {error && (
          <div role="alert" className="admin-error">
            {error}
          </div>
        )}
        {message && (
          <div role="status" className="admin-success">
            {message}
          </div>
        )}
        {passwordOpen && (
          <section className="admin-card">
            <h3>修改后台密码</h3>
            <form
              className="admin-grid"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                if (form.get("password") !== form.get("confirm")) {
                  setError("两次新密码不一致");
                  return;
                }
                void run(async () => {
                  await request("password", {
                    currentPassword: form.get("currentPassword"),
                    password: form.get("password"),
                  });
                  setUsername(null);
                  setPasswordOpen(false);
                  setMessage("密码已修改，请重新登录。");
                });
              }}
            >
              <label>
                当前密码
                <input
                  name="currentPassword"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </label>
              <label>
                新密码
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  required
                />
              </label>
              <label>
                再次输入新密码
                <input
                  name="confirm"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </label>
              <button disabled={busy}>修改并重新登录</button>
            </form>
          </section>
        )}
        {section < 3 && (
          <>
            <div className="admin-actions">
              <button
                disabled={busy || !content || content.pending}
                onClick={() =>
                  void run(async () => {
                    await save();
                    setMessage("草稿已保存。");
                  })
                }
              >
                保存草稿
              </button>
              <button
                disabled={busy || !content || content.pending}
                onClick={() =>
                  void run(async () => {
                    const next = await save();
                    const result = await request("preview", {
                      digest: next.digest,
                      current: next.current,
                    });
                    setPreview(result.url);
                    setMessage("预览已生成，可打开查看后发布。");
                  })
                }
              >
                生成预览
              </button>
              <button
                className="admin-publish"
                disabled={busy || !content || content.pending}
                onClick={() =>
                  void run(async () => {
                    const next = await save();
                    const result = await request("publish", {
                      digest: next.digest,
                      current: next.current,
                    });
                    setContent((previous) =>
                      previous ? { ...previous, ...result } : null,
                    );
                    setMessage("已发布，活动网站刷新后即可看到更新。");
                  })
                }
              >
                发布到网站
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (
                      dirty &&
                      !confirm("重新载入会放弃当前未保存的修改，是否继续？")
                    )
                      return;
                    await loadContent();
                  })
                }
              >
                重新载入
              </button>
              {preview && (
                <a href={preview} target="_blank" rel="noreferrer">
                  打开预览 ↗
                </a>
              )}
            </div>
            {content?.pending && (
              <div className="admin-error">
                上次保存尚未完成，请恢复后再继续编辑。
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      applyContent(await request("resume", {}));
                      setMessage("保存已恢复完成。");
                    })
                  }
                >
                  恢复未完成的保存
                </button>
              </div>
            )}
          </>
        )}
        {section === 0 && content && (
          <section className="admin-card">
            <h3>活动与网站信息</h3>
            <p className="admin-hint">
              修改后点击“发布到网站”即可生效。图片会保留当前网站的自适应展示方式。
            </p>
            <fieldset disabled={busy || content.pending}>
              <div className="admin-grid">
                {content.rows.settings
                  .filter(
                    (row) =>
                      !["openAt", "closeAt"].includes(row.fields["设置标识"]),
                  )
                  .map((row) => (
                    <label
                      key={row.record_id}
                      className={
                        [
                          "banner",
                          "logo",
                          "contacts",
                          "feeNotice",
                          "organizers",
                        ].includes(row.fields["设置标识"])
                          ? "wide"
                          : ""
                      }
                    >
                      {row.fields["名称"]}
                      {["banner", "logo"].includes(row.fields["设置标识"]) ? (
                        images("settings", row)
                      ) : ["contacts", "feeNotice", "organizers"].includes(
                          row.fields["设置标识"],
                        ) ? (
                        <textarea
                          value={row.fields["内容"]}
                          rows={3}
                          onChange={(event) =>
                            update(
                              "settings",
                              row.record_id,
                              "内容",
                              event.target.value,
                            )
                          }
                        />
                      ) : (
                        <input
                          type={
                            row.fields["设置标识"] === "primaryColor"
                              ? "color"
                              : ["startDate", "endDate"].includes(
                                    row.fields["设置标识"],
                                  )
                                ? "date"
                                : "text"
                          }
                          value={row.fields["内容"]}
                          onChange={(event) =>
                            update(
                              "settings",
                              row.record_id,
                              "内容",
                              event.target.value,
                            )
                          }
                        />
                      )}
                    </label>
                  ))}
              </div>
            </fieldset>
          </section>
        )}
        {section === 1 && content && (
          <section className="admin-card">
            <div className="admin-page-head">
              <label>
                选择页面
                <select
                  value={selectedPage}
                  onChange={(event) => setSelectedPage(event.target.value)}
                >
                  {content.rows.pages.map((row) => (
                    <option key={row.record_id} value={row.fields["页面路径"]}>
                      {row.fields["栏目名称"]}
                    </option>
                  ))}
                </select>
              </label>
              <button
                disabled={busy}
                onClick={() => {
                  const path =
                    "/p/" +
                    crypto
                      .randomUUID()
                      .slice(0, 8)
                      .replace(/^([0-9])/, "p$1");
                  add("pages", {
                    页面路径: path,
                    栏目名称: "新页面",
                    正文: "",
                    图片: [],
                    排序: (content.rows.pages.length + 1) * 10,
                    显示导航: "否",
                    启用: "是",
                    填写说明: "",
                  });
                  setSelectedPage(path);
                }}
              >
                新增页面
              </button>
            </div>
            {page && (
              <fieldset disabled={busy || content.pending}>
                <div className="admin-grid">
                  <label>
                    栏目名称
                    <input
                      value={page.fields["栏目名称"]}
                      maxLength={40}
                      onChange={(event) =>
                        update(
                          "pages",
                          page.record_id,
                          "栏目名称",
                          event.target.value,
                        )
                      }
                    />
                  </label>
                  <label>
                    排序（小的在前）
                    <input
                      type="number"
                      min="0"
                      max="100000"
                      value={page.fields["排序"]}
                      onChange={(event) =>
                        update(
                          "pages",
                          page.record_id,
                          "排序",
                          Number(event.target.value),
                        )
                      }
                    />
                  </label>
                  <label className="admin-checkbox">
                    <input
                      type="checkbox"
                      checked={page.fields["显示导航"] === "是"}
                      onChange={(event) =>
                        update(
                          "pages",
                          page.record_id,
                          "显示导航",
                          event.target.checked ? "是" : "否",
                        )
                      }
                    />
                    在导航显示
                  </label>
                  <label className="admin-checkbox">
                    <input
                      type="checkbox"
                      disabled={requiredPages.has(selectedPage)}
                      checked={page.fields["启用"] === "是"}
                      onChange={(event) =>
                        update(
                          "pages",
                          page.record_id,
                          "启用",
                          event.target.checked ? "是" : "否",
                        )
                      }
                    />
                    启用页面
                  </label>
                </div>
                {["/register", "/account"].includes(selectedPage) ? (
                  <p className="admin-hint">
                    这是系统页面，可调整栏目名称和导航。报名问题请在“报名设置”修改。
                  </p>
                ) : (
                  <>
                    <p className="admin-hint">
                      选中文字后使用工具栏调整格式。双花括号内的培训日期、活动地点、园区地址会自动使用基本设置中的内容。
                    </p>
                    <RichEditor
                      key={page.record_id + "-" + editorVersion}
                      value={page.fields["正文"]}
                      disabled={busy || content.pending}
                      onChange={(value) =>
                        update("pages", page.record_id, "正文", value)
                      }
                    />
                    <h3>页面图片</h3>
                    {images("pages", page)}
                  </>
                )}
              </fieldset>
            )}
          </section>
        )}
        {section === 2 && content && (
          <>
            <section className="admin-card">
              <h3>报名时间</h3>
              <div className="admin-grid">
                {["openAt", "closeAt"].map((key) => {
                  const row = content.rows.settings.find(
                    (row) => row.fields["设置标识"] === key,
                  );
                  const val = row?.fields["内容"] || "";
                  const local = val
                    ? new Date(
                        val.includes("+") || val.endsWith("Z")
                          ? val
                          : val.replace(" ", "T") + "+08:00",
                      )
                    : null;
                  const value =
                    local && !isNaN(local.getTime())
                      ? new Date(local.getTime() + 8 * 3600000)
                          .toISOString()
                          .slice(0, 16)
                      : "";
                  return (
                    <label key={key}>
                      {key === "openAt" ? "开放时间（留空即开放）" : "截止时间"}
                      <input
                        type="datetime-local"
                        value={value}
                        disabled={busy}
                        onChange={(event) => {
                          const v = event.target.value
                            ? event.target.value + ":00+08:00"
                            : "";
                          if (row) update("settings", row.record_id, "内容", v);
                          else
                            add("settings", {
                              设置标识: key,
                              名称: "报名开放",
                              内容: v,
                              填写说明: "",
                              图片: [],
                            });
                        }}
                      />
                    </label>
                  );
                })}
              </div>
              <small>时间均为北京时间。</small>
            </section>
            <section className="admin-card">
              <div className="admin-page-head">
                <div>
                  <h3>报名表字段</h3>
                  <p className="admin-hint">
                    停用字段会从新报名表隐藏，已提交的答案继续保留。
                  </p>
                </div>
                <button
                  disabled={busy || content.pending}
                  onClick={() =>
                    add("questions", {
                      字段标识: "",
                      问题名称: "新问题",
                      类型: "短文本",
                      "选项（每行一个）": "",
                      必填: "否",
                      启用: "是",
                      排序: (content.rows.questions.length + 1) * 10,
                      填写说明: "",
                    })
                  }
                >
                  添加问题
                </button>
              </div>
              {content.rows.questions.map((row) => {
                const builtin = core.has(row.fields["字段标识"]);
                return (
                  <fieldset
                    className="admin-question"
                    key={row.record_id}
                    disabled={busy || content.pending}
                  >
                    <div className="admin-grid">
                      <label>
                        问题名称
                        <input
                          value={row.fields["问题名称"]}
                          maxLength={120}
                          onChange={(event) =>
                            update(
                              "questions",
                              row.record_id,
                              "问题名称",
                              event.target.value,
                            )
                          }
                        />
                      </label>
                      <label>
                        类型
                        <select
                          value={row.fields["类型"]}
                          disabled={
                            builtin || !row.record_id.startsWith("new_")
                          }
                          onChange={(event) =>
                            update(
                              "questions",
                              row.record_id,
                              "类型",
                              event.target.value,
                            )
                          }
                        >
                          {[
                            ...new Set([
                              row.fields["类型"],
                              "短文本",
                              "长文本",
                              "单选",
                              "多选",
                              "数字",
                              "日期",
                            ]),
                          ].map((type) => (
                            <option key={type}>{type}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        排序
                        <input
                          type="number"
                          min="0"
                          max="100000"
                          value={row.fields["排序"]}
                          onChange={(event) =>
                            update(
                              "questions",
                              row.record_id,
                              "排序",
                              Number(event.target.value),
                            )
                          }
                        />
                      </label>
                      <div className="admin-checks">
                        <label className="admin-checkbox">
                          <input
                            type="checkbox"
                            disabled={row.fields["字段标识"] === "core"}
                            checked={row.fields["必填"] === "是"}
                            onChange={(event) =>
                              update(
                                "questions",
                                row.record_id,
                                "必填",
                                event.target.checked ? "是" : "否",
                              )
                            }
                          />
                          必填
                        </label>
                        <label className="admin-checkbox">
                          <input
                            type="checkbox"
                            disabled={row.fields["字段标识"] === "core"}
                            checked={row.fields["启用"] === "是"}
                            onChange={(event) =>
                              update(
                                "questions",
                                row.record_id,
                                "启用",
                                event.target.checked ? "是" : "否",
                              )
                            }
                          />
                          启用
                        </label>
                      </div>
                      {["单选", "多选"].includes(row.fields["类型"]) && (
                        <label className="wide">
                          选项（每行一个）
                          <textarea
                            rows={3}
                            value={row.fields["选项（每行一个）"]}
                            onChange={(event) =>
                              update(
                                "questions",
                                row.record_id,
                                "选项（每行一个）",
                                event.target.value,
                              )
                            }
                          />
                        </label>
                      )}
                      <label className="wide">
                        填写提示
                        <input
                          value={row.fields["填写说明"]}
                          maxLength={1000}
                          onChange={(event) =>
                            update(
                              "questions",
                              row.record_id,
                              "填写说明",
                              event.target.value,
                            )
                          }
                        />
                      </label>
                    </div>
                  </fieldset>
                );
              })}
            </section>
          </>
        )}
        {section < 3 && content && (
          <details className="admin-card admin-history">
            <summary>发布记录与恢复</summary>
            <p>恢复会将正式网站切换到所选版本，编辑区保留现有草稿。</p>
            {content.history.map((version) => (
              <div key={version.id}>
                <span>
                  {time(version.createdAt)} · {version.action || "发布"}
                  {version.id === content.current ? " · 当前版本" : ""}
                </span>
                <button
                  disabled={busy || version.id === content.current}
                  onClick={() =>
                    void run(async () => {
                      if (!confirm("确认将正式网站恢复到这个版本？")) return;
                      const result = await request("rollback", {
                        version: version.id,
                        current: content.current,
                      });
                      setContent((previous) =>
                        previous ? { ...previous, ...result } : null,
                      );
                      setMessage("正式网站已恢复到所选版本。");
                    })
                  }
                >
                  恢复此版
                </button>
              </div>
            ))}
          </details>
        )}
        {section === 3 && (
          <>
            <section className="admin-card">
              <form
                className="admin-filters"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(registrations);
                }}
              >
                <label>
                  搜索
                  <input
                    placeholder="姓名、手机号、单位"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
                <label>
                  审核状态
                  <select
                    value={status}
                    onChange={(event) => setStatus(event.target.value)}
                  >
                    <option value="">全部</option>
                    {Object.entries(statuses).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  缴费状态
                  <select
                    value={payment}
                    onChange={(event) => setPayment(event.target.value)}
                  >
                    <option value="">全部</option>
                    {payments.map((label) => (
                      <option key={label}>{label}</option>
                    ))}
                  </select>
                </label>
                <button disabled={busy}>查询</button>
                <a
                  className="admin-link-button"
                  href={"/api/admin/registrations/export?" + params()}
                >
                  导出筛选结果
                </a>
              </form>
              <p>共 {items.length} 条报名记录</p>
              <div className="admin-table-wrap">
                <table>
                  <thead>
                    <tr>
                      {[
                        "姓名",
                        "手机号",
                        "单位",
                        "审核",
                        "缴费",
                        "提交时间",
                        "操作",
                      ].map((label) => (
                        <th key={label}>{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id}>
                        <td>{item.name}</td>
                        <td>{item.phone}</td>
                        <td>{item.organization}</td>
                        <td>{statuses[item.status] || item.status}</td>
                        <td>{item.paymentStatus}</td>
                        <td>{time(item.submittedAt)}</td>
                        <td>
                          <button
                            disabled={busy}
                            onClick={() =>
                              void run(async () =>
                                setDetail(
                                  await request("registrations/" + item.id),
                                ),
                              )
                            }
                          >
                            查看 / 审核
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!items.length && (
                  <div className="admin-empty">当前筛选下暂无报名记录</div>
                )}
              </div>
            </section>
            {detail && (
              <section className="admin-card" aria-label="报名详情">
                <div className="admin-page-head">
                  <h3>{detail.name}的报名资料</h3>
                  <button onClick={() => setDetail(null)}>关闭详情</button>
                </div>
                <dl className="admin-detail">
                  {Object.entries(detail.data)
                    .filter(([key, value]) => detailLabels[key] && value)
                    .map(([key, value]) => (
                      <div key={key}>
                        <dt>{detailLabels[key]}</dt>
                        <dd>{String(value)}</dd>
                      </div>
                    ))}
                  {Object.entries(detail.data.customAnswers || {}).map(
                    ([key, value]) => (
                      <div key={key}>
                        <dt>{detail.data.customLabels?.[key] || key}</dt>
                        <dd>
                          {Array.isArray(value)
                            ? value.join("、")
                            : String(value || "—")}
                        </dd>
                      </div>
                    ),
                  )}
                </dl>
                <h4>证明材料</h4>
                {detail.files.length ? (
                  <ul>
                    {detail.files.map((file: any) => (
                      <li key={file.id}>
                        <a
                          href={
                            "/api/admin/registrations/" +
                            detail.id +
                            "/files/" +
                            file.id
                          }
                        >
                          {file.name}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>未提交材料</p>
                )}
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(async () => {
                      await request(
                        "registrations/" + detail.id + "/review",
                        detail,
                      );
                      setDetail(await request("registrations/" + detail.id));
                      await registrations();
                      setMessage(
                        "审核与缴费状态已保存，报名者可在个人中心查看公开结果。",
                      );
                    });
                  }}
                >
                  <div className="admin-grid">
                    <label>
                      审核状态
                      <select
                        value={detail.status}
                        onChange={(event) =>
                          setDetail({ ...detail, status: event.target.value })
                        }
                      >
                        {Object.entries(statuses).map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      缴费状态
                      <select
                        value={detail.paymentStatus}
                        onChange={(event) =>
                          setDetail({
                            ...detail,
                            paymentStatus: event.target.value,
                          })
                        }
                      >
                        {payments.map((value) => (
                          <option key={value}>{value}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      审核意见（报名者可见）
                      <textarea
                        value={detail.feedback}
                        maxLength={3000}
                        onChange={(event) =>
                          setDetail({ ...detail, feedback: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      缴费说明（报名者可见）
                      <textarea
                        value={detail.paymentNote}
                        maxLength={3000}
                        onChange={(event) =>
                          setDetail({
                            ...detail,
                            paymentNote: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label className="wide">
                      内部会务备注
                      <textarea
                        value={detail.note}
                        maxLength={3000}
                        onChange={(event) =>
                          setDetail({ ...detail, note: event.target.value })
                        }
                      />
                    </label>
                  </div>
                  <button disabled={busy}>保存审核与缴费状态</button>
                </form>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
