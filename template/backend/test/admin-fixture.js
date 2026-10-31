import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { createForumServer } from "../forum-server.js";
import { passwordDigest } from "../admin-auth.js";
import { seedCms } from "../site-cms-model.js";
import { memoryStorage } from "./memory-storage.js";

export async function fixture({
  port = 0,
  publicOrigin = "https://admin.example",
} = {}) {
  const root = resolve(import.meta.dirname, "../..");
  const config = JSON.parse(await readFile(join(root, "config.json"), "utf8"));
  const seeded = seedCms(config);
  seeded.control[0]["操作"] = "待命";
  const tables = Object.fromEntries(
    Object.entries(seeded).map(([key, rows]) => [
      key,
      rows.map((fields, index) => ({ record_id: key + index, fields })),
    ]),
  );
  let writes = 0,
    failAfter = Infinity;
  const cmsClient = {
    rows: async (key) => structuredClone(tables[key]),
    write: async (key, fields, id) => {
      if (++writes === failAfter)
        throw Error("Simulated upstream interruption");
      const row = tables[key].find((row) => row.record_id === id);
      if (row) Object.assign(row.fields, fields);
      else
        tables[key].push({
          record_id: "rec" + randomUUID().replaceAll("-", ""),
          fields: structuredClone(fields),
        });
    },
    image: async () => ({
      mime: "image/png",
      bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]),
    }),
  };
  const id = randomUUID(),
    owner = "sample-owner";
  const saved = {
    id,
    owner,
    kind: "registration",
    version: 1,
    data: {
      name: "演示老师",
      phone: "13800000000",
      organization: "示例单位",
      customAnswers: { q_legacy: "原始答案" },
      customLabels: { q_legacy: "原问题" },
    },
    files: [],
    updatedAt: new Date().toISOString(),
  };
  const row = {
    record_id: "record001",
    fields: {
      注册ID: id,
      会议标识: config.event.slug,
      统一账号ID: owner,
      手机号: "13800000000",
      当前资料快照: JSON.stringify(saved),
      当前状态: "待审核",
      审核对应版本: "1",
    },
  };
  const feishu = {
    check: async () => {},
    records: async (kind) =>
      kind === "registration" ? [structuredClone(row)] : [],
    readRecords: async () => [structuredClone(row)],
    find: async (kind, key, value) =>
      row.fields[key] === value ? structuredClone(row) : null,
    write: async (kind, key, value, meeting, fields) => {
      Object.assign(row.fields, fields);
      return structuredClone(row);
    },
    attachment: async () => ({ file_token: "uploadedtoken" }),
    download: async () => Buffer.from("example"),
  };
  const dir = await mkdtemp(join(tmpdir(), "camp-admin-"));
  const password = "local-example-password-2026";
  const bootstrap = { username: "admin", ...(await passwordDigest(password)) };
  const server = await createForumServer({
    appRoot: root,
    dataDir: dir,
    origin: publicOrigin,
    identityResolver: async () => ({ id: owner, phone: "13800000000" }),
    fileStorage: memoryStorage(),
    feishu,
    cmsClient,
    env: {
      PUBLIC_ORIGIN: publicOrigin,
      INTEGRATION_MODE: "independent",
      CMS_TABLES: JSON.stringify(
        Object.fromEntries(Object.keys(tables).map((key) => [key, key])),
      ),
      CAMP_ADMIN_BOOTSTRAP: JSON.stringify(bootstrap),
    },
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  let cookie = "";
  async function request(path, value, headers = {}) {
    const result = await fetch(origin + "/api/admin/" + path, {
      method: value === undefined ? "GET" : "POST",
      headers: {
        origin: publicOrigin,
        "content-type": "application/json",
        cookie,
        ...headers,
      },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    });
    if (result.headers.has("set-cookie"))
      cookie = result.headers.get("set-cookie").split(";")[0];
    return result;
  }
  return {
    server,
    origin,
    password,
    tables,
    row,
    request,
    failNext: () => {
      failAfter = writes + 2;
    },
    close: async () => {
      await server.shutdown();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
