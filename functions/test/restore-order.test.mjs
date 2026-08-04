import { beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import { createRequire } from "module";

process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "tooktak-test";
process.env.GOOGLE_CLOUD_PROJECT = "tooktak-test";
process.env.RESTORE_API_TOKEN = "restore-test-secret-with-sufficient-length";
delete process.env.SLACK_WEBHOOK_URL;

const fns = await import("../index.js");
const admin = (await import("firebase-admin")).default;
const require = createRequire(import.meta.url);
const axios = require("axios");
const fft = (await import("firebase-functions-test")).default({ projectId: "tooktak-test" });
const db = admin.firestore();
const onOrderDeleted = fft.wrap(fns.onOrderDeleted);

function sign(action, docId, date, exp, contentHash = "") {
  return crypto.createHmac("sha256", process.env.RESTORE_API_TOKEN)
    .update([action, docId, date || "", contentHash || "", String(exp)].join("\n"))
    .digest("hex");
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  return "{" + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ":" + canonicalJson(value[key]))
    .join(",") + "}";
}

function recoveryIntegrity(docId, eventId, deletedAtMs, snapshot) {
  const snapshotHash = contentHash(snapshot);
  return crypto.createHmac("sha256", process.env.RESTORE_API_TOKEN)
    .update([docId, eventId, String(deletedAtMs), snapshotHash].join("\n"))
    .digest("hex");
}

function contentHash(snapshot) {
  return crypto.createHash("sha256").update(canonicalJson(snapshot)).digest("hex");
}

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    send(body) { this.body = String(body); return this; }
  };
}

async function invoke(method, params) {
  const req = {
    method,
    query: method === "GET" ? params : {},
    body: method === "POST" ? params : {},
    headers: { "user-agent": "vitest" },
    ip: "127.0.0.1",
    path: "/"
  };
  const res = responseRecorder();
  await fns.restoreOrder(req, res);
  return res;
}

describe("restoreOrder HMAC + atomic restore", () => {
  let docId;
  let deletedAt;
  let snapshot;

  beforeEach(async () => {
    docId = `restore-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    deletedAt = new Date().toISOString();
    snapshot = { id: docId, orderNum: docId, deliveryTo: "복원 테스트", totalAmount: 12345 };
    const eventId = `seed-${docId}`;
    const deletedAtMs = Date.now();
    await db.collection("hanger_orders_deleted_recovery").doc(docId).set({
      docId,
      orderNum: docId,
      eventId,
      deletedSnapshot: snapshot,
      deletedAt,
      deletedAtMs,
      integrityVersion: 1,
      integrity: recoveryIntegrity(docId, eventId, deletedAtMs, snapshot)
    });
  });

  it("GET preview는 장기 secret을 노출하지 않고 POST 실행 서명을 발급한다", async () => {
    const exp = Date.now() + 60_000;
    const res = await invoke("GET", {
      docId,
      exp: String(exp),
      sig: sign("preview", docId, "", exp)
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("발주서 복원 미리보기");
    expect(res.body).not.toContain(process.env.RESTORE_API_TOKEN);
    expect(res.body).toContain('name="sig"');
    expect(res.headers["Referrer-Policy"]).toBe("no-referrer");
  });

  it("POST는 발주서와 audit log를 함께 생성한다", async () => {
    const exp = Date.now() + 60_000;
    const hash = contentHash(snapshot);
    const res = await invoke("POST", {
      docId,
      date: deletedAt,
      hash,
      exp: String(exp),
      sig: sign("execute", docId, deletedAt, exp, hash)
    });
    expect(res.statusCode).toBe(200);
    expect((await db.collection("hanger_orders").doc(docId).get()).data()).toEqual(snapshot);
    const logs = await db.collection("hanger_orders_cancel_log").where("orderId", "==", docId).get();
    expect(logs.docs.some(d => d.data().type === "복원")).toBe(true);
  });

  it("서명된 백업 날짜를 바꾸면 거부한다", async () => {
    const exp = Date.now() + 60_000;
    const hash = contentHash(snapshot);
    const res = await invoke("POST", {
      docId,
      date: "2000-01-01",
      hash,
      exp: String(exp),
      sig: sign("execute", docId, deletedAt, exp, hash)
    });
    expect(res.statusCode).toBe(401);
    expect((await db.collection("hanger_orders").doc(docId).get()).exists).toBe(false);
  });

  it("클라이언트가 변조한 삭제 복구 스냅샷은 사용하지 않는다", async () => {
    await db.collection("hanger_orders_deleted_recovery").doc(docId).update({
      "deletedSnapshot.totalAmount": 999999999
    });
    const exp = Date.now() + 60_000;
    const res = await invoke("GET", {
      docId,
      exp: String(exp),
      sig: sign("preview", docId, "", exp)
    });
    expect(res.statusCode).toBe(404);
    expect((await db.collection("hanger_orders").doc(docId).get()).exists).toBe(false);
  });

  it("만료 서명과 기존 문서 덮어쓰기를 거부한다", async () => {
    const expired = Date.now() - 1;
    const expiredRes = await invoke("GET", {
      docId,
      exp: String(expired),
      sig: sign("preview", docId, "", expired)
    });
    expect(expiredRes.statusCode).toBe(401);

    await db.collection("hanger_orders").doc(docId).set({ orderNum: docId, marker: "newer" });
    const exp = Date.now() + 60_000;
    const hash = contentHash(snapshot);
    const conflictRes = await invoke("POST", {
      docId,
      date: deletedAt,
      hash,
      exp: String(exp),
      sig: sign("execute", docId, deletedAt, exp, hash)
    });
    expect(conflictRes.statusCode).toBe(409);
    expect((await db.collection("hanger_orders").doc(docId).get()).data().marker).toBe("newer");
  });
});

describe("onOrderDeleted idempotency + exact recovery snapshot", () => {
  it("같은 event.id가 재전달돼도 audit와 Slack을 한 번만 만들고 정확한 삭제본을 보관한다", async () => {
    process.env.SLACK_WEBHOOK_URL = "https://slack.invalid/test";
    const post = vi.spyOn(axios, "post").mockResolvedValue({ status: 200 });
    const docId = `deleted-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const eventId = `event-${docId}`;
    const deletedAt = new Date().toISOString();
    const deletedSnapshot = { id: docId, orderNum: docId, deliveryTo: "삭제 테스트", totalAmount: 777 };
    const sourceRef = db.collection("hanger_orders").doc(docId);
    await sourceRef.set(deletedSnapshot);
    const sourceSnap = await sourceRef.get();
    const event = { id: eventId, time: deletedAt, params: { docId }, data: sourceSnap };

    await onOrderDeleted(event);
    await onOrderDeleted(event);

    const recovery = await db.collection("hanger_orders_deleted_recovery").doc(docId).get();
    expect(recovery.data().deletedSnapshot).toEqual(deletedSnapshot);
    const logs = await db.collection("hanger_orders_cancel_log").where("eventId", "==", eventId).get();
    expect(logs.size).toBe(1);
    expect(logs.docs[0].data().slackSent).toBe(true);
    expect(post).toHaveBeenCalledTimes(1);

    post.mockRestore();
    delete process.env.SLACK_WEBHOOK_URL;
  });

  it("Slack 발송 실패 시 재시도 예외 없이 관리자 배지용 실패 문서를 남긴다", async () => {
    process.env.SLACK_WEBHOOK_URL = "https://slack.invalid/test";
    const post = vi.spyOn(axios, "post").mockRejectedValue(new Error("slack unavailable"));
    const docId = `slack-fail-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const eventId = `event-${docId}`;
    const deletedAt = new Date().toISOString();
    const sourceRef = db.collection("hanger_orders").doc(docId);
    await sourceRef.set({ id: docId, orderNum: docId, totalAmount: 123 });
    const sourceSnap = await sourceRef.get();

    await expect(onOrderDeleted({
      id: eventId,
      time: deletedAt,
      params: { docId },
      data: sourceSnap
    })).resolves.toBeUndefined();

    const failures = await db.collection("hanger_orders_alert_failures")
      .where("eventId", "==", eventId).get();
    expect(failures.size).toBe(1);
    expect(failures.docs[0].data()).toMatchObject({
      docId,
      orderNum: docId,
      failureType: "SLACK_SEND_FAILED",
      resolved: false
    });

    post.mockRestore();
    delete process.env.SLACK_WEBHOOK_URL;
  });

  it("Webhook 미설정도 예외 없이 관리자 배지용 실패 문서를 남긴다", async () => {
    delete process.env.SLACK_WEBHOOK_URL;
    const docId = `webhook-missing-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const eventId = `event-${docId}`;
    const deletedAt = new Date().toISOString();
    const sourceRef = db.collection("hanger_orders").doc(docId);
    await sourceRef.set({ id: docId, orderNum: docId, totalAmount: 456 });
    const sourceSnap = await sourceRef.get();

    await expect(onOrderDeleted({
      id: eventId,
      time: deletedAt,
      params: { docId },
      data: sourceSnap
    })).resolves.toBeUndefined();

    const failures = await db.collection("hanger_orders_alert_failures")
      .where("eventId", "==", eventId).get();
    expect(failures.size).toBe(1);
    expect(failures.docs[0].data()).toMatchObject({
      docId,
      orderNum: docId,
      failureType: "SLACK_WEBHOOK_MISSING",
      resolved: false
    });
  });
});
