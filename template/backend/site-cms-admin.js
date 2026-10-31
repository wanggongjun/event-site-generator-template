import { randomUUID, randomBytes } from "node:crypto";
import { cmsTables, compileCms, hash } from "./site-cms-model.js";
import { feishuText } from "./site-cms-feishu.js";

const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
export function createCmsAdmin({
  db,
  client,
  tables,
  config,
  get,
  set,
  readRows,
  rowDigest,
  prepare,
  activate,
  history,
  version,
  current,
  historyFields,
  exclusive,
  origin,
}) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS cms_admin_uploads(token TEXT PRIMARY KEY, url TEXT NOT NULL, name TEXT NOT NULL)",
  );
  const currentVersion = () => current().id;
  const revisions = () =>
    db
      .prepare(
        "SELECT id,createdAt,action,source FROM cms_versions WHERE published=1 ORDER BY rowid DESC LIMIT 50",
      )
      .all();
  async function state() {
    const rows = await readRows();
    const editable = Object.fromEntries(
      Object.entries(rows).map(([key, items]) => [
        key,
        items.map((row) => ({
          record_id: row.record_id,
          fields: Object.fromEntries(
            cmsTables[key].fields.map((field) => [
              field.field_name,
              field.type === 17
                ? row.fields[field.field_name] || []
                : field.type === 2
                  ? Number(row.fields[field.field_name] || 0)
                  : feishuText(row.fields[field.field_name]),
            ]),
          ),
        })),
      ]),
    );
    const uploads = db.prepare("SELECT * FROM cms_admin_uploads").all();
    for (const row of [...rows.settings, ...rows.pages])
      for (const image of row.fields["图片"] || []) {
        const id = get("image:" + image.file_token);
        if (id && !uploads.some((upload) => upload.token === image.file_token))
          uploads.push({
            token: image.file_token,
            url: "/api/site/media/" + id,
          });
      }
    return {
      rows: editable,
      digest: rowDigest(rows),
      current: currentVersion(),
      history: revisions(),
      pending: Boolean(get("adminPending")),
      uploads,
    };
  }
  async function ensureIdle() {
    const controls = await client.rows(tables.control);
    if (
      controls.length !== 1 ||
      !["", "待命"].includes(feishuText(controls[0].fields["操作"])) ||
      get("pendingResult")
    )
      fail(409, "正在处理另一次发布，请稍后重试");
    return controls[0];
  }
  function sanitize(input, existing) {
    const result = {};
    for (const key of ["settings", "pages", "questions"]) {
      const rows = input?.[key];
      if (!Array.isArray(rows) || rows.length > (key === "questions" ? 60 : 40))
        fail(400, "编辑内容格式错误");
      const allowed = new Set(cmsTables[key].fields.map((f) => f.field_name));
      const before = new Map(existing[key].map((row) => [row.record_id, row]));
      const seen = new Set();
      result[key] = rows.map((row) => {
        if (
          !row ||
          typeof row.record_id !== "string" ||
          seen.has(row.record_id)
        )
          fail(400, "记录标识重复或缺失");
        seen.add(row.record_id);
        const old = before.get(row.record_id);
        if (!old && !/^new_[a-f0-9-]{36}$/.test(row.record_id))
          fail(400, "记录不属于本活动");
        if (!old && key === "settings" && row.fields?.["设置标识"] !== "openAt")
          fail(400, "不支持新增此项设置");
        const fields = {};
        for (const [name, value] of Object.entries(row.fields || {})) {
          if (!allowed.has(name)) fail(400, "不支持的编辑字段");
          if (name === "图片") {
            if (
              !Array.isArray(value) ||
              value.length > (key === "settings" ? 1 : 6)
            )
              fail(400, "标志和横幅每项1张图片，页面最多6张");
            fields[name] = value.map((item) => {
              const token = item?.file_token;
              const known =
                old?.fields["图片"]?.some(
                  (image) => image.file_token === token,
                ) ||
                db
                  .prepare("SELECT token FROM cms_admin_uploads WHERE token=?")
                  .get(String(token));
              if (!known) fail(400, "请通过管理后台上传图片");
              return { file_token: token };
            });
          } else if (
            (typeof value === "string" && value.length <= 50000) ||
            (typeof value === "number" && Number.isFinite(value))
          )
            fields[name] = value;
          else fail(400, "字段内容格式错误");
        }
        const immutable =
          key === "settings"
            ? "设置标识"
            : key === "pages"
              ? "页面路径"
              : "字段标识";
        if (
          old &&
          feishuText(fields[immutable]) !== feishuText(old.fields[immutable])
        )
          fail(400, "已有记录的标识不能修改");
        if (key === "questions" && !old)
          fields["字段标识"] = "q_" + row.record_id.slice(4);
        return { record_id: row.record_id, fields };
      });
      for (const id of before.keys())
        if (!seen.has(id)) fail(400, "请停用记录，保留已有内容和历史数据");
    }
    // Compile before the first remote write, including attachment validation via prepare on publication.
    const validationRows = structuredClone(result);
    for (const row of validationRows.settings)
      if (row.fields["图片"]?.length)
        row.fields["内容"] = "/api/site/media/" + "0".repeat(64);
    compileCms(validationRows, config, historyFields());
    return result;
  }
  async function save(input) {
    await ensureIdle();
    const rows = await readRows();
    let pending = get("adminPending");
    if (pending && pending.requestId !== input.requestId)
      fail(409, "上次保存尚未完成，请点击“恢复未完成的保存”");
    if (!pending) {
      if (!/^[a-f0-9-]{36}$/.test(input.requestId || ""))
        fail(400, "保存标识无效");
      if (input.digest !== rowDigest(rows))
        fail(409, "内容已被其他人修改，请重新载入后编辑");
      pending = {
        requestId: input.requestId,
        rows: sanitize(input.rows, rows),
        before: rows,
      };
      set("adminPending", pending);
    }
    for (const key of ["settings", "pages", "questions"]) {
      let remote = await client.rows(tables[key]);
      for (const row of pending.rows[key]) {
        const primary =
          key === "settings"
            ? "设置标识"
            : key === "pages"
              ? "页面路径"
              : "字段标识";
        const existing = row.record_id.startsWith("new_")
          ? remote.find(
              (item) =>
                feishuText(item.fields[primary]) === row.fields[primary],
            )
          : remote.find((item) => item.record_id === row.record_id);
        const normalized = (fields) =>
          Object.fromEntries(
            Object.keys(row.fields).map((name) => [
              name,
              name === "图片"
                ? (fields[name] || []).map((i) => i.file_token)
                : name === "排序"
                  ? Number(fields[name])
                  : feishuText(fields[name]),
            ]),
          );
        if (
          existing &&
          hash(normalized(existing.fields)) === hash(normalized(row.fields))
        )
          continue;
        const before = pending.before[key].find(
          (item) => item.record_id === row.record_id,
        );
        if (
          existing &&
          (!before ||
            hash(normalized(existing.fields)) !==
              hash(normalized(before.fields)))
        )
          fail(409, "保存期间飞书内容被修改，请联系管理员核对未完成的保存");
        await client.write(tables[key], row.fields, existing?.record_id);
        remote = await client.rows(tables[key]);
        const verified = remote.find((item) =>
          existing
            ? item.record_id === existing.record_id
            : feishuText(item.fields[primary]) === row.fields[primary],
        );
        if (
          !verified ||
          hash(normalized(verified.fields)) !== hash(normalized(row.fields))
        )
          fail(503, "保存结果尚未确认，请恢复此次保存");
      }
    }
    set("adminPending", null);
    set("preview", null);
    return state();
  }
  async function publish(input, previewOnly = false) {
    const control = await ensureIdle();
    if (get("adminPending")) fail(409, "请先恢复未完成的保存");
    const rows = await readRows(),
      digest = rowDigest(rows);
    if (digest !== input.digest || currentVersion() !== input.current)
      fail(409, "网站内容或版本已更新，请重新载入");
    const prepared = await prepare(rows);
    if (rowDigest(await readRows()) !== digest)
      fail(409, "内容正在被修改，请稍后重试");
    if (previewOnly) {
      const token = randomBytes(32).toString("hex");
      set("preview", {
        id: prepared.id,
        token,
        digest,
        expires: Date.now() + 7 * 86400000,
      });
      return { url: origin + "/cms-preview/" + token + "/" };
    }
    // Feishu acknowledgement is durable before the local live pointer switches.
    await history({
      ...version(prepared.id),
      action: "管理后台发布",
      source: currentVersion(),
    });
    await client.write(
      tables.control,
      {
        当前版本: prepared.id,
        操作: "待命",
        处理结果: "管理后台发布成功",
        更新时间: new Date().toISOString(),
      },
      control.record_id,
    );
    activate(prepared.id, "管理后台发布", currentVersion());
    return { current: currentVersion(), history: revisions() };
  }
  async function rollback(input) {
    const control = await ensureIdle();
    if (get("adminPending")) fail(409, "请先恢复未完成的保存");
    if (input.current !== currentVersion())
      fail(409, "当前版本已更新，请重新载入");
    const old = version(input.version);
    if (!old?.published) fail(400, "请选择已经发布的版本");
    const id = "restore-" + randomUUID();
    db.prepare(
      "INSERT INTO cms_versions(id,payload,createdAt) VALUES(?,?,?)",
    ).run(id, JSON.stringify(old.payload), new Date().toISOString());
    await history({ ...version(id), action: "管理后台恢复", source: old.id });
    await client.write(
      tables.control,
      {
        当前版本: id,
        处理结果: "已恢复历史版本，编辑区仍保留草稿",
        更新时间: new Date().toISOString(),
      },
      control.record_id,
    );
    activate(id, "管理后台恢复", old.id);
    return { current: id, history: revisions() };
  }
  return {
    state: () => exclusive(state),
    save: (input) => exclusive(() => save(input)),
    resume: () =>
      exclusive(() => {
        const pending = get("adminPending");
        if (!pending) return state();
        return save({ requestId: pending.requestId });
      }),
    publish: (input) => exclusive(() => publish(input)),
    preview: (input) => exclusive(() => publish(input, true)),
    rollback: (input) => exclusive(() => rollback(input)),
    rememberUpload(token, url, name) {
      db.prepare("INSERT OR REPLACE INTO cms_admin_uploads VALUES(?,?,?)").run(
        token,
        url,
        name,
      );
    },
  };
}
