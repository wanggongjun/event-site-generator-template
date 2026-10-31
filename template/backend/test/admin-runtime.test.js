import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "./admin-fixture.js";

test("administrator auth, publish conflict, recoverable save and review version protection", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request("content")).status, 401);
    assert.equal(
      (
        await f.request(
          "login",
          { username: "admin", password: f.password },
          { origin: "https://other.example" },
        )
      ).status,
      403,
    );
    assert.equal(
      (await f.request("login", { username: "admin", password: "wrong" }))
        .status,
      401,
    );
    assert.equal(
      (await f.request("login", { username: "admin", password: f.password }))
        .status,
      200,
    );
    const original = await (await f.request("content")).json();
    const title = original.rows.settings.find(
      (row) => row.fields["设置标识"] === "title",
    );
    title.fields["内容"] = "修改后的培训名称";
    const location = original.rows.settings.find(
      (row) => row.fields["设置标识"] === "location",
    );
    location.fields["内容"] = "新会场";
    f.failNext();
    assert.equal(
      (await f.request("content", { ...original, requestId: randomUUID() }))
        .status,
      503,
    );
    assert.equal((await (await f.request("content")).json()).pending, true);
    assert.equal(
      (
        await f.request("publish", {
          digest: original.digest,
          current: original.current,
        })
      ).status,
      409,
    );
    f.delayNextRead();
    const resumed = await (await f.request("resume", {})).json();
    assert.equal(resumed.pending, false);
    assert.equal(
      (
        await f.request("publish", {
          digest: original.digest,
          current: original.current,
        })
      ).status,
      409,
    );
    const published = await f.request("publish", {
      digest: resumed.digest,
      current: resumed.current,
    });
    assert.equal(published.status, 200);
    const live = await (await fetch(f.origin + "/api/site/content")).json();
    assert.equal(live.config.event.title, "修改后的培训名称");
    const detail = await (
      await f.request("registrations/" + f.row.fields["注册ID"])
    ).json();
    const change = {
      ...detail,
      status: "accepted",
      paymentStatus: "已缴费",
      feedback: "审核通过",
      paymentNote: "已核对",
      note: "内部记录",
    };
    assert.equal(
      (await f.request("registrations/" + detail.id + "/review", change))
        .status,
      200,
    );
    assert.equal(
      (await f.request("registrations/" + detail.id + "/review", change))
        .status,
      409,
    );
    assert.equal(f.row.fields["当前状态"], "已通过");
    assert.equal(
      (
        await f.request("password", {
          currentPassword: f.password,
          password: "new-example-password-2026",
        })
      ).status,
      200,
    );
    assert.equal((await f.request("content")).status, 401);
    assert.equal(
      (await f.request("login", { username: "admin", password: f.password }))
        .status,
      401,
    );
    assert.equal(
      (
        await f.request("login", {
          username: "admin",
          password: "new-example-password-2026",
        })
      ).status,
      200,
    );
  } finally {
    await f.close();
  }
});
