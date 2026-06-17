/**
 * 이카운트 ERP 연동 Firebase Cloud Functions
 * 프로젝트: tooktakproject
 * v2 — SESSION_ID URL 파라미터 방식으로 통일 (2026-03-27)
 *
 * 확인된 설정:
 *   COM_CODE = 670811  /  ZONE = AA
 *   테스트 서버: https://sboapiAA.ecount.com  → https://sboapiaa.ecount.com
 *   실서버:      https://oapiAA.ecount.com    → https://oapiaa.ecount.com
 *
 *   ※ 현재는 테스트 서버 사용 (테스트 인증키 갱신: 2026-04-14)
 *      실서버 인증키 발급 후 BASE_URL 을 PROD_URL 로 교체하면 됨
 */

const { onCall, HttpsError, onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { logger } = require("firebase-functions");
const admin  = require("firebase-admin");
const axios  = require("axios");

admin.initializeApp();


// 이카운트 관련 Cloud Functions 제거됨 (2026-06-11):
// - ECOUNT 설정, ecountLogin
// - testEcountConnection, getEcountProducts, createEcountSaleOrder, updateEcountPrice

// ─── 아이디 → 이메일 조회 (로그인 전 미인증 호출용) ──────────
// 발주앱 로그인 시 아이디로 이메일 매핑. admin SDK가 보안 룰 우회.
// 보안 경계: 이메일만 반환. role/name/비번/납품처 등 일체 미포함.
exports.getEmailById = onCall(
  { region: "asia-northeast3", invoker: "public" },
  async (request) => {
    const { id } = request.data || {};
    if (!id || typeof id !== "string") {
      throw new HttpsError("invalid-argument", "아이디(id)가 필요합니다.");
    }
    try {
      const doc = await admin.firestore()
        .collection("hanger_data").doc("accounts").get();
      if (!doc.exists) {
        throw new HttpsError("not-found", "계정 데이터가 없습니다.");
      }
      const accounts = doc.data().value;
      if (!Array.isArray(accounts)) {
        throw new HttpsError("not-found", "계정 데이터 형식 오류.");
      }
      const found = accounts.find(a => a && a.id === id);
      if (!found || !found.email) {
        throw new HttpsError("not-found", "해당 아이디의 계정을 찾을 수 없습니다.");
      }
      logger.info(`[getEmailById] id=${id} → 이메일 조회 성공`);
      return { success: true, email: found.email };
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      logger.error("[getEmailById] 오류:", e.message);
      throw new HttpsError("internal", `이메일 조회 오류: ${e.message}`);
    }
  }
);

// ─── 4-bis. 서버 단일 ID 발급 (다중 PC 동시 저장 시 번호 충돌 방지) ──
// 호출: window._FN.getNextIds({ counts: { orders: 1, order_items: N, purchase_requests: N, logs: N } })
// 응답: { success: true, ids: { orders: [42], order_items: [200,201,...], ... } }
// 규칙: 로그인 필수 / 허용 컬렉션 화이트리스트 / 컬렉션당 1회 트랜잭션으로 원자적 증가
exports.getNextIds = onCall(
  { region: "asia-northeast3", invoker: "public" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }
    const counts = (request.data && request.data.counts) || {};
    const ALLOWED = new Set(["orders", "order_items", "purchase_requests", "logs"]);
    const MAX_PER = 100;
    const keys = Object.keys(counts);
    if (keys.length === 0) {
      throw new HttpsError("invalid-argument", "counts가 비어 있습니다.");
    }
    for (const k of keys) {
      if (!ALLOWED.has(k)) {
        throw new HttpsError("permission-denied", `허용되지 않은 컬렉션: ${k}`);
      }
      const n = counts[k];
      if (!Number.isInteger(n) || n < 1 || n > MAX_PER) {
        throw new HttpsError("invalid-argument", `잘못된 개수 (${k}=${n}, 1-${MAX_PER})`);
      }
    }
    try {
      const db = admin.firestore();
      const result = {};
      await Promise.all(keys.map(async (k) => {
        const ref = db.collection("hanger_data").doc("_seq_" + k);
        const ids = await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          let cur = 0;
          if (snap.exists) {
            const v = snap.data() && snap.data().value;
            if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
              cur = Math.floor(v);
            } else {
              throw new HttpsError(
                "failed-precondition",
                `_seq_${k} 값 형식 오류 (admin 확인 필요)`
              );
            }
          }
          const newVal = cur + counts[k];
          tx.set(
            ref,
            { value: newVal, updatedAt: new Date().toISOString() },
            { merge: true }
          );
          return Array.from({ length: counts[k] }, (_, i) => cur + 1 + i);
        });
        result[k] = ids;
      }));
      logger.info(
        `[getNextIds] uid=${request.auth.uid} counts=${JSON.stringify(counts)} ` +
        `firstIds=${JSON.stringify(Object.fromEntries(keys.map(k => [k, result[k][0]])))}`
      );
      return { success: true, ids: result };
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      logger.error("[getNextIds] 오류:", e.message);
      throw new HttpsError("internal", `ID 발급 오류: ${e.message}`);
    }
  }
);

// ─── 5. Firestore 정기 백업 (매일 KST 00:00) ─────────────────
// hanger_data 컬렉션 전체를 _backups/{YYYY-MM-DD} 문서에 스냅샷으로 저장
// 8일 이상 된 백업은 자동 삭제 (7일치 보관)
exports.dailyFirestoreBackup = onSchedule(
  { schedule: "0 15 * * *", timeZone: "UTC", region: "asia-northeast3" },
  async () => {
    const db = admin.firestore();

    // 오늘 날짜 (KST = UTC+9)
    const now = new Date();
    now.setHours(now.getHours() + 9);
    const dateStr = now.toISOString().slice(0, 10); // "YYYY-MM-DD"

    try {
      // 1) hanger_data 컬렉션 전체 읽기
      const snapshot = await db.collection("hanger_data").get();
      const data = {};
      snapshot.forEach(doc => { data[doc.id] = doc.data(); });

      // 2) _backups/{YYYY-MM-DD} 에 저장
      await db.collection("_backups").doc(dateStr).set({
        backedUpAt: admin.firestore.FieldValue.serverTimestamp(),
        data
      });
      logger.info(`[dailyFirestoreBackup] ${dateStr} 백업 완료 — ${Object.keys(data).length}개 키`);

      // 3) 8일 이상 된 백업 삭제
      const cutoff = new Date(now);
      cutoff.setDate(cutoff.getDate() - 7);
      const cutoffStr = cutoff.toISOString().slice(0, 10);

      const oldSnap = await db.collection("_backups")
        .where(admin.firestore.FieldPath.documentId(), "<", cutoffStr)
        .get();

      const batch = db.batch();
      oldSnap.forEach(doc => batch.delete(doc.ref));
      if (!oldSnap.empty) {
        await batch.commit();
        logger.info(`[dailyFirestoreBackup] 오래된 백업 ${oldSnap.size}건 삭제`);
      }
    } catch (e) {
      logger.error("[dailyFirestoreBackup] 오류:", e.message);
      throw e;
    }
  }
);


// monitorOutboundIp + notifySlackIpChanged 제거됨 (2026-06-11) — 이카운트 연동 종료

// ─── 차집합 슬랙 알림 ───
// SLACK_WEBHOOK_URL 미설정이면 조용히 스킵
async function notifySlackOrdersDiff(result) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) { logger.warn("[notifySlackOrdersDiff] SLACK_WEBHOOK_URL 미설정 — 스킵"); return; }
  const lines = [
    `⚠️ *발주서 차집합 감지* (${result.checkedAt})`,
    `• 옛 DB(hanger_data/orders): ${result.oldCount}건 (고유 id ${result.oldIds})`,
    `• 새 DB(hanger_orders):     ${result.newCount}건 (고유 id ${result.newIds})`,
    `• 옛 전용 id: ${result.onlyOldCount}건${result.onlyOld.length ? ` → ${result.onlyOld.join(", ")}` : ""}`,
    `• 새 전용 id: ${result.onlyNewCount}건${result.onlyNew.length ? ` → ${result.onlyNew.join(", ")}` : ""}`
  ];
  try {
    await axios.post(url, { text: lines.join("\n") }, { timeout: 10000 });
    logger.info("[notifySlackOrdersDiff] 슬랙 알림 발송 완료");
  } catch (e) {
    logger.error("[notifySlackOrdersDiff] 슬랙 발송 실패:", e.message);
  }
}

// 검사 로직 — daily + hourly 양쪽에서 호출
async function _runOrdersDiffCheck(triggerLabel) {
  try {
    const db = admin.firestore();
    const oldDoc = await db.collection("hanger_data").doc("orders").get();
    const oldArr = oldDoc.exists ? (oldDoc.data().value || []) : [];
    const oldIds = new Set(oldArr.filter(o => o && o.id != null).map(o => o.id));

    const newSnap = await db.collection("hanger_orders").get();
    const newIds = new Set();
    newSnap.docs.forEach(d => {
      const data = d.data();
      if (data && data.id != null) newIds.add(data.id);
    });

    const onlyOld = [...oldIds].filter(id => !newIds.has(id));
    const onlyNew = [...newIds].filter(id => !oldIds.has(id));
    const now = new Date().toISOString();
    const result = {
      oldCount: oldArr.length,
      newCount: newSnap.size,
      oldIds: oldIds.size,
      newIds: newIds.size,
      onlyOldCount: onlyOld.length,
      onlyNewCount: onlyNew.length,
      onlyOld: onlyOld.slice(0, 20),
      onlyNew: onlyNew.slice(0, 20),
      checkedAt: now,
      trigger: triggerLabel
    };

    await db.collection("hanger_data").doc("orders_diff_monitor").set({
      value: result,
      updatedAt: now
    });

    if (onlyOld.length > 0 || onlyNew.length > 0) {
      logger.warn(`[차집합 검증 ${triggerLabel}] ⚠️ 불일치 감지: 옛전용 ${onlyOld.length}건, 새전용 ${onlyNew.length}건`);
      await notifySlackOrdersDiff(result);
    } else {
      logger.info(`[차집합 검증 ${triggerLabel}] 정상: 옛 ${result.oldCount}건 == 새 ${result.newCount}건 (id 일치)`);
    }
  } catch (e) {
    logger.error(`[ordersDiffCheck ${triggerLabel}] 오류:`, e.message);
  }
}

// 영업 시간 매시 30분 (08:30, 09:30, ..., 17:30) — 즉시 감지용
// 차이 발견 시에만 슬랙 알림 (정상이면 조용)
// 새벽 검사는 제거 — 자다 깰 일 없음
exports.hourlyOrdersDiffCheck = onSchedule(
  { schedule: "30 8-17 * * *", timeZone: "Asia/Seoul", region: "asia-northeast3" },
  async () => _runOrdersDiffCheck("hourly")
);

// M3 보강 (Codex): invoices 무결성 검사
// - id 중복 / orderNum 없음 / 같은 orderNum 활성 invoice 다중 / 고아 invoice 검출
async function _runInvoicesIntegrityCheck(triggerLabel) {
  try {
    const db = admin.firestore();
    const invDoc = await db.collection("hanger_data").doc("invoices").get();
    const arr = invDoc.exists ? (invDoc.data().value || []) : [];
    const ordDoc = await db.collection("hanger_data").doc("orders").get();
    const orders = ordDoc.exists ? (ordDoc.data().value || []) : [];
    const orderNums = new Set(orders.map(o => o && o.orderNum).filter(Boolean));

    const idCount = {};
    const activeByOrderNum = {};
    const noOrderNum = [];
    const orphan = []; // invoice.orderNum이 orders에 없음

    arr.forEach(inv => {
      if (!inv) return;
      if (inv.id) idCount[inv.id] = (idCount[inv.id] || 0) + 1;
      if (!inv.orderNum) { noOrderNum.push(inv.id || '(no id)'); return; }
      if (!inv.cancelled) {
        activeByOrderNum[inv.orderNum] = (activeByOrderNum[inv.orderNum] || 0) + 1;
      }
      if (!orderNums.has(inv.orderNum)) orphan.push(inv.orderNum);
    });

    const dupIds = Object.entries(idCount).filter(([, c]) => c > 1).map(([id, c]) => id + '×' + c);
    const multiActive = Object.entries(activeByOrderNum).filter(([, c]) => c > 1).map(([n, c]) => n + '×' + c);

    const now = new Date().toISOString();
    const result = {
      total: arr.length,
      dupIdsCount: dupIds.length,
      dupIds: dupIds.slice(0, 20),
      noOrderNumCount: noOrderNum.length,
      noOrderNum: noOrderNum.slice(0, 20),
      multiActiveCount: multiActive.length,
      multiActive: multiActive.slice(0, 20),
      orphanCount: orphan.length,
      orphan: [...new Set(orphan)].slice(0, 20),
      checkedAt: now,
      trigger: triggerLabel
    };

    await db.collection("hanger_data").doc("invoices_diff_monitor").set({
      value: result,
      updatedAt: now
    });

    const anyIssue = dupIds.length || noOrderNum.length || multiActive.length || orphan.length;
    if (anyIssue) {
      logger.warn(`[invoices 검증 ${triggerLabel}] ⚠️ 이슈 감지`, result);
      const url = process.env.SLACK_WEBHOOK_URL;
      if (url) {
        const lines = [
          `⚠️ *거래명세서 무결성 이슈* (${now})`,
          `• 총 invoice: ${arr.length}건`,
          `• id 중복: ${dupIds.length}건${dupIds.length ? ` → ${dupIds.slice(0, 5).join(', ')}` : ''}`,
          `• orderNum 누락: ${noOrderNum.length}건`,
          `• 동일 orderNum 활성 invoice 다중: ${multiActive.length}건${multiActive.length ? ` → ${multiActive.slice(0, 5).join(', ')}` : ''}`,
          `• 고아 invoice (orders에 없음): ${orphan.length}건`
        ];
        try { await axios.post(url, { text: lines.join("\n") }, { timeout: 10000 }); } catch (e) { logger.error("[invoices 슬랙] 발송 실패:", e.message); }
      }
    } else {
      logger.info(`[invoices 검증 ${triggerLabel}] 정상: ${arr.length}건`);
    }
  } catch (e) {
    logger.error(`[invoicesIntegrityCheck ${triggerLabel}] 오류:`, e.message);
  }
}

exports.hourlyInvoicesIntegrityCheck = onSchedule(
  { schedule: "30 8-17 * * *", timeZone: "Asia/Seoul", region: "asia-northeast3" },
  async () => _runInvoicesIntegrityCheck("hourly")
);

