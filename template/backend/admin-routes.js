import { createHash } from "node:crypto";
import { createAdminAuth } from "./admin-auth.js";
import { feishuText } from "./feishu-client.js";
import { currentReview } from "./forum-domain.js";

const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const digest = (value) => createHash("sha256").update(value).digest("hex");
const reviewNames = {
  under_review: "待审核",
  reviewing: "审核中",
  needs_materials: "需补充材料",
  accepted: "已通过",
  rejected: "未通过",
};
const paymentNames = ["待确认", "已缴费", "未缴费", "已退款"];
export async function createAdminRoutes({
  db,
  env,
  cms,
  feishu,
  meeting,
  unpack,
  serial,
  body,
  send,
}) {
  const auth = await createAdminAuth({ db, env });
  const reviewKeys = [
    "当前状态",
    "审核对应版本",
    "公开意见",
    "审核历史",
    "缴费状态",
    "缴费公开说明",
    "会务备注",
  ];
  const revision = (row) =>
    digest(
      JSON.stringify(reviewKeys.map((key) => feishuText(row.fields[key]))),
    );
  async function rows() {
    const all = await feishu.readRecords("registration");
    return all.filter((row) => feishuText(row.fields["会议标识"]) === meeting);
  }
  async function record(id) {
    const row = await feishu.find("registration", "注册ID", id, meeting, {
      fresh: true,
    });
    if (!row) fail(404, "报名记录不存在");
    const saved = await unpack(feishuText(row.fields["当前资料快照"]));
    if (
      saved.id !== id ||
      saved.kind !== "registration" ||
      saved.owner !== feishuText(row.fields["统一账号ID"])
    )
      fail(503, "报名记录校验失败");
    return { row, saved };
  }
  const summary = (row, saved) => ({
    id: saved.id,
    name: saved.data?.name || "",
    phone: feishuText(row.fields["手机号"]),
    organization: saved.data?.organization || "",
    identity: saved.data?.identityType || "",
    submittedAt: saved.updatedAt,
    version: saved.version,
    ...currentReview({ ...saved, remote: row }),
    paymentStatus: feishuText(row.fields["缴费状态"]) || "待确认",
    paymentNote: feishuText(row.fields["缴费公开说明"]),
    note: feishuText(row.fields["会务备注"]),
    reviewRevision: revision(row),
  });
  async function list(url) {
    const result = [];
    for (const row of await rows()) {
      const saved = await unpack(feishuText(row.fields["当前资料快照"]));
      if (
        saved.id !== feishuText(row.fields["注册ID"]) ||
        saved.kind !== "registration"
      )
        fail(503, "报名记录校验失败");
      result.push({ ...summary(row, saved), data: saved.data });
    }
    const search = (url.searchParams.get("search") || "").trim().toLowerCase();
    const status = url.searchParams.get("status") || "",
      payment = url.searchParams.get("payment") || "";
    return result
      .filter(
        (r) =>
          (!search ||
            [r.name, r.phone, r.organization]
              .join(" ")
              .toLowerCase()
              .includes(search)) &&
          (!status || r.status === status) &&
          (!payment || r.paymentStatus === payment),
      )
      .sort((a, b) =>
        String(b.submittedAt).localeCompare(String(a.submittedAt)),
      );
  }
  return async function handle(req, res, url) {
    if (!url.pathname.startsWith("/api/admin/")) return false;
    res.setHeader("x-robots-tag", "noindex, nofollow");
    if (await auth.handle(req, res, url, body, send)) return true;
    const username = auth.requireAdmin(req);
    if (!cms) fail(503, "网站管理尚未配置");
    const path = url.pathname,
      method = req.method;
    if (path === "/api/admin/content" && method === "GET")
      send(res, 200, await cms.admin.state());
    else if (path === "/api/admin/content" && method === "POST") {
      const result = await cms.admin.save(await body(req, 3 * 1048576));
      auth.audit(username, "保存网站草稿");
      send(res, 200, result);
    } else if (
      ["resume", "preview", "publish", "rollback"].some(
        (action) => path === "/api/admin/" + action,
      ) &&
      method === "POST"
    ) {
      const action = path.split("/").pop(),
        input = await body(req);
      const result = await cms.admin[action](input);
      auth.audit(username, action, input.version || result.current || "");
      send(res, 200, result);
    } else if (path === "/api/admin/images" && method === "POST") {
      const input = await body(req, 15 * 1048576);
      if (
        typeof input.contentBase64 !== "string" ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(input.contentBase64) ||
        input.contentBase64.length % 4
      )
        fail(400, "图片内容无效");
      const bytes = Buffer.from(input.contentBase64, "base64");
      if (!bytes.length || bytes.length > 10 * 1048576)
        fail(400, "图片须小于10MB");
      let mime, ext;
      if (
        bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ) {
        mime = "image/png";
        ext = "png";
      } else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
        mime = "image/jpeg";
        ext = "jpg";
      } else if (
        bytes.subarray(0, 4).toString() === "RIFF" &&
        bytes.subarray(8, 12).toString() === "WEBP"
      ) {
        mime = "image/webp";
        ext = "webp";
      } else fail(400, "请上传 PNG、JPG 或 WebP 图片");
      const id = digest(bytes),
        name = "website-" + id.slice(0, 16) + "." + ext;
      const cached = db
        .prepare("SELECT token FROM cms_admin_uploads WHERE url=?")
        .get("/api/site/media/" + id);
      const token =
        cached?.token ||
        (await feishu.attachment({ name, content: bytes })).file_token;
      db.prepare("INSERT OR IGNORE INTO cms_images VALUES(?,?,?)").run(
        id,
        mime,
        bytes,
      );
      cms.admin.rememberUpload(token, "/api/site/media/" + id, name);
      auth.audit(username, "上传网站图片", name);
      send(res, 201, { file_token: token, name, url: "/api/site/media/" + id });
    } else if (
      /^\/api\/admin\/images\/[a-f0-9]{64}$/.test(path) &&
      method === "GET"
    ) {
      const image = db
        .prepare("SELECT mime,bytes FROM cms_images WHERE id=?")
        .get(path.split("/").pop());
      if (!image) fail(404, "图片不存在");
      res.writeHead(200, {
        "content-type": image.mime,
        "cache-control": "private,no-store",
      });
      res.end(Buffer.from(image.bytes));
    } else if (path === "/api/admin/registrations" && method === "GET") {
      const items = await list(url);
      send(res, 200, { items: items.map(({ data, ...item }) => item) });
    } else if (path === "/api/admin/registrations/export" && method === "GET") {
      const items = await list(url);
      const labels = {
        name: "姓名",
        phone: "手机号",
        organization: "单位",
        identity: "身份",
        status: "审核状态",
        feedback: "审核意见",
        paymentStatus: "缴费状态",
        paymentNote: "缴费说明",
        note: "内部备注",
        submittedAt: "提交时间",
        email: "邮箱",
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
      for (const item of items)
        for (const [key, label] of Object.entries(item.data.customLabels || {}))
          labels[key] = label;
      const keys = Object.keys(labels);
      const cell = (value) => {
        let str = Array.isArray(value) ? value.join("、") : String(value ?? "");
        if (/^[\s]*[=+@-]/.test(str)) str = "'" + str;
        return '"' + str.replaceAll('"', '""') + '"';
      };
      const csv = [
        Object.values(labels),
        ...items.map((item) =>
          keys.map((key) =>
            key === "status"
              ? reviewNames[item.status] || item.status
              : (item[key] ??
                item.data[key] ??
                item.data.customAnswers?.[key] ??
                ""),
          ),
        ),
      ]
        .map((row) => row.map(cell).join(","))
        .join("\r\n");
      auth.audit(username, "导出报名", String(items.length));
      res.writeHead(200, {
        "content-type": "text/csv; charset=utf-8",
        "cache-control": "private,no-store",
        "content-disposition":
          "attachment; filename*=UTF-8''" +
          encodeURIComponent("昆明实训营报名.csv"),
      });
      res.end("\uFEFF" + csv);
    } else {
      const match = path.match(
        /^\/api\/admin\/registrations\/([a-f0-9-]{36})(?:\/(review|files)(?:\/([a-f0-9-]{36}))?)?$/,
      );
      if (!match) fail(404, "管理接口不存在");
      if (!match[2] && method === "GET") {
        const { row, saved } = await record(match[1]);
        send(res, 200, {
          ...summary(row, saved),
          data: saved.data,
          files: (saved.files || []).map(({ id, name, size }) => ({
            id,
            name,
            size,
          })),
          reviewHistory: feishuText(row.fields["审核历史"]),
        });
      } else if (match[2] === "files" && match[3] && method === "GET") {
        const { saved } = await record(match[1]);
        const file = saved.files?.find((item) => item.id === match[3]);
        if (!file) fail(404, "材料不存在");
        const bytes = await feishu.download(file.file_token);
        res.writeHead(200, {
          "content-type": "application/octet-stream",
          "cache-control": "private,no-store",
          "content-disposition":
            "attachment; filename*=UTF-8''" + encodeURIComponent(file.name),
        });
        res.end(bytes);
      } else if (match[2] === "review" && method === "POST") {
        const input = await body(req);
        await serial(async () => {
          const { row, saved } = await record(match[1]);
          if (
            input.version !== saved.version ||
            input.reviewRevision !== revision(row)
          )
            fail(409, "报名或审核已更新，请重新打开详情后处理");
          if (
            !Object.hasOwn(reviewNames, input.status) ||
            !paymentNames.includes(input.paymentStatus)
          )
            fail(400, "审核或缴费状态无效");
          for (const key of ["feedback", "paymentNote", "note"])
            if (typeof input[key] !== "string" || input[key].length > 3000)
              fail(400, "说明文字请控制在3000字以内");
          let history;
          try {
            history = JSON.parse(feishuText(row.fields["审核历史"]) || "[]");
            if (!Array.isArray(history)) throw Error();
          } catch {
            fail(503, "审核历史格式异常，请联系管理员");
          }
          const at = new Date().toISOString();
          history.push({
            version: saved.version,
            status: input.status,
            feedback: input.feedback,
            processedAt: at,
            reviewer: username,
            paymentStatus: input.paymentStatus,
          });
          const serialized = JSON.stringify(history);
          if (serialized.length > 60000)
            fail(400, "审核历史已达到存储上限，请联系管理员");
          await feishu.write("registration", "注册ID", saved.id, meeting, {
            当前状态: reviewNames[input.status],
            审核对应版本: String(saved.version),
            公开意见: input.feedback,
            审核历史: serialized,
            处理时间: at,
            缴费状态: input.paymentStatus,
            缴费公开说明: input.paymentNote,
            会务备注: input.note,
          });
          auth.audit(username, "审核报名", saved.id);
        });
        send(res, 200, { ok: true });
      } else fail(405, "请求方法不支持");
    }
    return true;
  };
}
