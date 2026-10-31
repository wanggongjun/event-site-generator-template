// Run with the camp service stopped. Original tables are retained as the migration source.
import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { CmsFeishu, feishuText } from "../backend/site-cms-feishu.js";
import { ForumFeishu } from "../backend/forum-feishu.js";

const shared = process.argv[2];
const checkpoint = resolve(shared, "independent-base.json");
const state = existsSync(checkpoint)
  ? JSON.parse(readFileSync(checkpoint, "utf8"))
  : { tokens: {} };
const save = () => {
  writeFileSync(checkpoint + ".tmp", JSON.stringify(state), { mode: 0o600 });
  renameSync(checkpoint + ".tmp", checkpoint);
};
const sha = (value) => createHash("sha256").update(value).digest("hex");
async function migrationTransport(url, options = {}) {
  const canRetry = !options.method || options.method === "GET" || url.endsWith("/auth/v3/tenant_access_token/internal");
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, {...options, headers: {...options.headers, connection: "close"}});
    } catch (error) {
      if (!canRetry || attempt >= 2 || error.name === "TimeoutError") throw error;
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
}
if (state.complete) {
  console.log("Independent camp Base already configured");
  process.exit(0);
}
const sourceIds = JSON.parse(
  readFileSync(resolve(shared, "feishu-ids.json"), "utf8"),
);
const sourceCms = JSON.parse(
  readFileSync(resolve(shared, "cms-ids.json"), "utf8"),
);
const sourceEnv = { ...process.env, ...sourceIds };
const source = new CmsFeishu(sourceEnv),
  sourceFiles = new ForumFeishu(sourceEnv);
source.transport = migrationTransport;
sourceFiles.transport = migrationTransport;
const control = await source.rows(sourceCms.tables.control);
if (control.length !== 1 || feishuText(control[0].fields["操作"]) !== "待命")
  throw Error("Complete the pending CMS publication before migrating");
if (!state.base) {
  const created = await source.api("/bitable/v1/apps", {
    method: "POST",
    body: JSON.stringify({
      name: "昆明动物研究所 AI for Science 实训营 · 管理数据",
      time_zone: "Asia/Shanghai",
    }),
  });
  state.base = created.app?.app_token;
  if (!state.base || state.base === source.base)
    throw Error("Independent Base creation failed");
  save();
}
const destinationEnv = { ...process.env, FORUM_FEISHU_BASE_TOKEN: state.base };
for (const [script, file] of [
  ["provision-feishu.mjs", "feishu-ids-independent.json"],
  ["provision-cms.mjs", "cms-ids-independent.json"],
]) {
  if (script === "provision-cms.mjs")
    Object.assign(
      destinationEnv,
      JSON.parse(
        readFileSync(resolve(shared, "feishu-ids-independent.json"), "utf8"),
      ),
    );
  const result = spawnSync(
    process.execPath,
    [resolve("ops", script), resolve(shared, file)],
    { env: destinationEnv, stdio: "inherit" },
  );
  if (result.status !== 0)
    throw Error("Independent Base schema provisioning failed");
}
const target = new CmsFeishu(destinationEnv),
  targetFiles = new ForumFeishu(destinationEnv);
target.transport = migrationTransport;
targetFiles.transport = migrationTransport;
const targetCms = JSON.parse(
  readFileSync(resolve(shared, "cms-ids-independent.json"), "utf8"),
);
const sourceTables = {
  ...sourceCms.tables,
  registration: sourceIds.FORUM_REGISTRATION_TABLE_ID,
  submission: sourceIds.FORUM_SUBMISSION_TABLE_ID,
};
const targetTables = {
  ...targetCms.tables,
  registration: destinationEnv.FORUM_REGISTRATION_TABLE_ID,
  submission: destinationEnv.FORUM_SUBMISSION_TABLE_ID,
};
const primaries = {
  settings: "设置标识",
  pages: "页面路径",
  questions: "字段标识",
  control: "名称",
  history: "版本",
  registration: "注册ID",
  submission: "投稿ID",
};
async function copyFile(token, name = "material") {
  if (state.tokens[token]) return state.tokens[token];
  const bytes = await sourceFiles.download(token);
  const uploaded = await targetFiles.attachment({ name, content: bytes });
  state.tokens[token] = uploaded.file_token;
  save();
  return uploaded.file_token;
}
async function rewrite(value) {
  if (Array.isArray(value)) return Promise.all(value.map(rewrite));
  if (!value || typeof value !== "object") return value;
  if (value.archiveFileToken || value.forumStorageFileToken) {
    const token = value.archiveFileToken || value.forumStorageFileToken;
    const raw = JSON.parse(
      (await sourceFiles.download(token)).toString("utf8"),
    );
    const result = await rewrite(
      value.archiveFileToken ? raw : JSON.parse(raw.serialized),
    );
    const serialized = JSON.stringify(result),
      hash = sha(serialized);
    if (!state.tokens[token]) {
      const content = value.archiveFileToken
        ? serialized
        : JSON.stringify({ forumStorageVersion: 1, serialized, sha256: hash });
      state.tokens[token] = (
        await targetFiles.attachment({
          name: "registration-snapshot.json",
          content: Buffer.from(content),
        })
      ).file_token;
      save();
    }
    return value.archiveFileToken
      ? { ...value, archiveFileToken: state.tokens[token], digest: hash }
      : { ...value, forumStorageFileToken: state.tokens[token] };
  }
  const result = {};
  for (const [key, item] of Object.entries(value))
    result[key] =
      key === "file_token"
        ? await copyFile(item, value.name || "material")
        : await rewrite(item);
  return result;
}
const snapshotFields = [
  "当前资料快照",
  "历史资料快照",
  "当前版文字快照",
  "版本历史",
];
for (const [key, sourceId] of Object.entries(sourceTables)) {
  const schema = await source.list(
    `/bitable/v1/apps/${source.base}/tables/${sourceId}/fields`,
  );
  const sourceRows = await source.rows(sourceId);
  let destinationRows = await target.rows(targetTables[key]);
  for (const row of sourceRows) {
    if (
      ["registration", "submission"].includes(key) &&
      feishuText(row.fields["会议标识"]) !== "kiz-ai-camp-2026"
    )
      throw Error("Unexpected activity in migration source");
    const fields = {};
    for (const spec of schema.filter((field) =>
      snapshotFields.includes(field.field_name),
    )) {
      const value = feishuText(row.fields[spec.field_name]);
      fields[spec.field_name] = value
        ? JSON.stringify(await rewrite(JSON.parse(value)))
        : "";
    }
    for (const spec of schema.filter(
      (field) => !snapshotFields.includes(field.field_name),
    )) {
      const value = row.fields[spec.field_name];
      if (value === undefined || value === null) continue;
      if (spec.type === 17)
        fields[spec.field_name] = await Promise.all(
          value.map(async (image) => ({
            file_token: await copyFile(
              image.file_token,
              image.name || "image.png",
            ),
          })),
        );
      else if (spec.type === 2) fields[spec.field_name] = Number(value);
      else fields[spec.field_name] = feishuText(value);
    }
    if (key === "questions" && !fields["字段标识"])
      fields["字段标识"] = "q_" + row.record_id;
    if (key === "control")
      Object.assign(fields, { 操作: "待命", 预览链接: "", 待发布版本: "" });
    const primary = primaries[key],
      identity = fields[primary];
    const matches = destinationRows.filter(
      (record) => feishuText(record.fields[primary]) === identity,
    );
    if (!identity || matches.length > 1)
      throw Error("Migration business key is missing or duplicated");
    await target.write(targetTables[key], fields, matches[0]?.record_id);
    destinationRows = await target.rows(targetTables[key]);
    const verified = destinationRows.filter(
      (record) => feishuText(record.fields[primary]) === identity,
    );
    const normalize = (record) =>
      Object.fromEntries(
        Object.keys(fields)
          .sort()
          .map((name) => [
            name,
            Array.isArray(fields[name])
              ? (record[name] || []).map((image) => image.file_token).sort()
              : typeof fields[name] === "number"
                ? Number(record[name])
                : feishuText(record[name]),
          ]),
      );
    if (
      verified.length !== 1 ||
      JSON.stringify(normalize(fields)) !==
        JSON.stringify(normalize(verified[0].fields))
    )
      throw Error("Migrated row verification failed: " + key);
  }
  console.log("Migrated and verified " + key + ": " + sourceRows.length);
}
// Preserve local recovery operations and cached files against the new attachment tokens.
const db = new DatabaseSync(resolve(shared, "data/recovery.sqlite"));
const localRewrite = (value) => {
  if (Array.isArray(value)) return value.map(localRewrite);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key === "file_token" && state.tokens[item]
        ? state.tokens[item]
        : localRewrite(item),
    ]),
  );
};
db.exec("BEGIN IMMEDIATE");
try {
  for (const [oldToken, newToken] of Object.entries(state.tokens))
    db.prepare("UPDATE files SET token=? WHERE token=?").run(
      newToken,
      oldToken,
    );
  for (const row of db.prepare("SELECT id,data FROM objects").all())
    db.prepare("UPDATE objects SET data=? WHERE id=?").run(
      JSON.stringify(localRewrite(JSON.parse(row.data))),
      row.id,
    );
  for (const row of db
    .prepare("SELECT id,payload,result FROM operations")
    .all())
    db.prepare("UPDATE operations SET payload=?,result=? WHERE id=?").run(
      JSON.stringify(localRewrite(JSON.parse(row.payload))),
      row.result ? JSON.stringify(localRewrite(JSON.parse(row.result))) : null,
      row.id,
    );
  db.exec("DELETE FROM snapshot_uploads");
  db.prepare("DELETE FROM cms_state WHERE key=?").run("preview");
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
} finally {
  db.close();
}
state.complete = true;
state.tables = targetTables;
save();
console.log("Independent camp Base migration verified");
