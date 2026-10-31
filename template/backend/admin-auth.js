import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
export async function passwordDigest(
  password,
  salt = randomBytes(16).toString("hex"),
) {
  return {
    salt,
    digest: Buffer.from(await scrypt(password, salt, 64)).toString("hex"),
  };
}
export async function createAdminAuth({ db, env }) {
  db.exec(`CREATE TABLE IF NOT EXISTS admin_account(username TEXT PRIMARY KEY, salt TEXT NOT NULL, digest TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS admin_sessions(token TEXT PRIMARY KEY, username TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS admin_attempts(key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS admin_audit(id INTEGER PRIMARY KEY, username TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, createdAt TEXT NOT NULL);`);
  if (
    !db.prepare("SELECT username FROM admin_account LIMIT 1").get() &&
    env.CAMP_ADMIN_BOOTSTRAP
  ) {
    const seed = JSON.parse(env.CAMP_ADMIN_BOOTSTRAP);
    if (
      !/^[a-zA-Z0-9_-]{3,40}$/.test(seed.username) ||
      !/^[a-f0-9]{32}$/.test(seed.salt) ||
      !/^[a-f0-9]{128}$/.test(seed.digest)
    )
      throw Error("Invalid administrator bootstrap");
    db.prepare("INSERT INTO admin_account VALUES(?,?,?)").run(
      seed.username,
      seed.salt,
      seed.digest,
    );
  }
  const cookieName = "__Host-kiz_admin";
  const cookie = (res, token, age = 28800) =>
    res.setHeader(
      "set-cookie",
      `${cookieName}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${age}`,
    );
  const tokenFrom = (req) =>
    req.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(cookieName + "="))
      ?.slice(cookieName.length + 1) || "";
  const audit = (username, action, target = "") =>
    db
      .prepare(
        "INSERT INTO admin_audit(username,action,target,createdAt) VALUES(?,?,?,?)",
      )
      .run(username, action, target, new Date().toISOString());
  async function matches(password, account) {
    const result = await passwordDigest(
      password,
      account?.salt || "0".repeat(32),
    );
    return (
      Boolean(account) &&
      timingSafeEqual(
        Buffer.from(result.digest, "hex"),
        Buffer.from(account.digest, "hex"),
      )
    );
  }
  function requireAdmin(req) {
    const token = tokenFrom(req);
    if (!/^[a-f0-9]{64}$/.test(token)) fail(401, "请登录管理后台");
    const session = db
      .prepare("SELECT * FROM admin_sessions WHERE token=? AND expires>?")
      .get(hash(token), Date.now());
    if (!session) fail(401, "登录已过期，请重新登录");
    return session.username;
  }
  function limit(req, username) {
    const now = Date.now();
    db.prepare("DELETE FROM admin_attempts WHERE expires<?").run(now);
    const keys = [
      "account:" + username,
      "ip:" + hash(req.headers["x-real-ip"] || req.socket.remoteAddress || ""),
    ];
    for (const key of keys) {
      const row = db
        .prepare("SELECT count FROM admin_attempts WHERE key=?")
        .get(key);
      if (row?.count >= 10) fail(429, "尝试次数过多，请15分钟后重试");
    }
    for (const key of keys)
      db.prepare(
        "INSERT INTO admin_attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1",
      ).run(key, now + 15 * 60000);
    return () => {
      for (const key of keys)
        db.prepare("DELETE FROM admin_attempts WHERE key=?").run(key);
    };
  }
  return {
    requireAdmin,
    audit,
    async handle(req, res, url, body, send) {
      const path = url.pathname;
      if (path === "/api/admin/login" && req.method === "POST") {
        const input = await body(req, 4096);
        if (
          typeof input.username !== "string" ||
          input.username.length > 40 ||
          typeof input.password !== "string" ||
          input.password.length > 256
        )
          fail(400, "账号或密码格式错误");
        const reset = limit(req, input.username);
        const account = db
          .prepare("SELECT * FROM admin_account WHERE username=?")
          .get(input.username);
        if (!(await matches(input.password, account)))
          fail(401, "用户名或密码错误");
        reset();
        db.prepare("DELETE FROM admin_sessions WHERE expires<?").run(
          Date.now(),
        );
        const token = randomBytes(32).toString("hex");
        db.prepare("INSERT INTO admin_sessions VALUES(?,?,?)").run(
          hash(token),
          account.username,
          Date.now() + 28800000,
        );
        cookie(res, token);
        audit(account.username, "登录");
        send(res, 200, { username: account.username });
        return true;
      }
      if (
        ![
          "/api/admin/session",
          "/api/admin/logout",
          "/api/admin/password",
        ].includes(path)
      )
        return false;
      const username = requireAdmin(req);
      if (path === "/api/admin/session" && req.method === "GET")
        send(res, 200, { username });
      else if (path === "/api/admin/logout" && req.method === "POST") {
        db.prepare("DELETE FROM admin_sessions WHERE token=?").run(
          hash(tokenFrom(req)),
        );
        cookie(res, "", 0);
        send(res, 200, { ok: true });
      } else if (path === "/api/admin/password" && req.method === "POST") {
        const input = await body(req, 4096);
        if (
          typeof input.password !== "string" ||
          input.password.length < 12 ||
          input.password.length > 128 ||
          typeof input.currentPassword !== "string" ||
          input.currentPassword.length > 256
        )
          fail(400, "新密码请使用12—128个字符");
        const reset = limit(req, username);
        if (
          !(await matches(
            input.currentPassword,
            db
              .prepare("SELECT * FROM admin_account WHERE username=?")
              .get(username),
          ))
        )
          fail(400, "当前密码错误");
        const digest = await passwordDigest(input.password);
        db.exec("BEGIN IMMEDIATE");
        try {
          db.prepare(
            "UPDATE admin_account SET salt=?,digest=? WHERE username=?",
          ).run(digest.salt, digest.digest, username);
          db.prepare("DELETE FROM admin_sessions WHERE username=?").run(
            username,
          );
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
        reset();
        audit(username, "修改密码");
        cookie(res, "", 0);
        send(res, 200, { ok: true });
      } else fail(405, "请求方法不支持");
      return true;
    },
  };
}
