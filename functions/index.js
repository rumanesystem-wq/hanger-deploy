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
const { onDocumentDeleted } = require("firebase-functions/v2/firestore");
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
// hanger_data 컬렉션: _backups/{YYYY-MM-DD} 에 스냅샷 저장 (기존)
// hanger_orders/snapshots/cancel_log/edit_logs: _backups_{name}/{YYYY-MM-DD} 로 별도 저장 (2026-08-04 추가)
// 8일 이상 된 백업은 자동 삭제 (7일치 보관)
async function _backupCollectionToDoc(db, collectionName, backupCollectionName, dateStr, shape = 'docs') {
  const snap = await db.collection(collectionName).get();
  // 보조 컬렉션의 `_` prefix 상태 doc은 백업에서 제외
  const docs = snap.docs
    // hanger_data는 기존 복구 호환을 위해 _seq_*, _migrations 등도 모두 백업한다.
    // _runlock 같은 상태 문서가 있는 보조 컬렉션만 `_` prefix doc을 제외한다.
    .filter(d => collectionName === 'hanger_data' || !d.id.startsWith('_'))
    .map(d => ({ docId: d.id, data: d.data() }));
  // hanger_data는 기존 복구 스크립트 호환을 위해 {data:{docId:doc}} 형식을 유지한다.
  const payload = shape === 'map'
    ? { data: Object.fromEntries(docs.map(d => [d.docId, d.data])) }
    : { count: docs.length, docs };
  const json = JSON.stringify(payload);
  const bytes = Buffer.byteLength(json, 'utf8');
  // Firestore 문서 1MiB(~1,048,576 bytes) 한계. 900KB 이상이면 잘라내지 말고 로그·알림 후 skip.
  if (bytes > 900 * 1024) {
    logger.warn(`[백업] ${collectionName} 크기 초과 ${Math.round(bytes/1024)}KB — 백업 skip. GCS Firestore Export 필요.`);
    await _sendSlackWithCooldown(
      db,
      `backupSizeExceeded_${collectionName}`,
      `:warning: *일일 백업 크기 초과* (${dateStr})\n• 컬렉션: ${collectionName}\n• 크기: ${Math.round(bytes/1024)}KB (1MiB 한계 근접)\n• 이 컬렉션은 이번 회차 백업 스킵됨. GCS 기반 Firestore Export 로 이전 필요.\n• 이 알림은 24h 내 최초 1회만 발송 (cooldown)`
    );
    return { name: collectionName, backed: false, reason: 'size_exceeded', bytes };
  }
  await db.collection(backupCollectionName).doc(dateStr).set({
    backedUpAt: admin.firestore.FieldValue.serverTimestamp(),
    bytes,
    ...payload
  });
  // 크기 정상 → 이전 크기초과 알림 cooldown 자동 해제
  await _clearAlertKey(db, `backupSizeExceeded_${collectionName}`);
  return { name: collectionName, backed: true, count: docs.length, bytes };
}

async function _deleteOldBackups(db, collectionName, cutoffStr) {
  const oldSnap = await db.collection(collectionName)
    .where(admin.firestore.FieldPath.documentId(), "<", cutoffStr)
    .get();
  if (oldSnap.empty) return 0;
  const batch = db.batch();
  oldSnap.forEach(doc => batch.delete(doc.ref));
  await batch.commit();
  return oldSnap.size;
}

exports.dailyFirestoreBackup = onSchedule(
  { schedule: "0 15 * * *", timeZone: "UTC", region: "asia-northeast3" },
  async () => {
    const db = admin.firestore();

    // 오늘 날짜 (KST = UTC+9)
    const now = new Date();
    now.setHours(now.getHours() + 9);
    const dateStr = now.toISOString().slice(0, 10); // "YYYY-MM-DD"

    try {
      // 각 컬렉션을 독립 실행한다. 한 컬렉션 실패가 다른 백업을 막지 않는다.
      // 보관 기간: hanger_data 는 7일(기존 유지), 신 컬렉션들은 30일 (사고 복구용 여유 확보).
      const specs = [
        ['hanger_data', '_backups', 'map', 7],
        ['hanger_orders', '_backups_hanger_orders', 'docs', 30],
        ['hanger_orders_snapshots', '_backups_hanger_orders_snapshots', 'docs', 30],
        ['hanger_orders_cancel_log', '_backups_hanger_orders_cancel_log', 'docs', 30],
        ['hanger_order_edit_logs', '_backups_hanger_order_edit_logs', 'docs', 30],
      ];
      const results = await Promise.allSettled(
        specs.map(([source, target, shape]) => _backupCollectionToDoc(db, source, target, dateStr, shape))
      );

      // 오늘 백업이 성공한 컬렉션만 오래된 백업을 정리한다. cutoff 는 컬렉션별 다름.
      const failures = [];
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const [source, target, , retentionDays] = specs[i];
        if (r.status !== 'fulfilled' || !r.value.backed) {
          const reason = r.status === 'rejected' ? (r.reason && r.reason.message) : r.value.reason;
          logger.error(`[dailyFirestoreBackup] ${source} 백업 실패/스킵:`, reason);
          failures.push(`${source}:${reason || 'unknown'}`);
          continue;
        }
        logger.info(`[dailyFirestoreBackup] ${source} → ${r.value.count}건 (${Math.round(r.value.bytes/1024)}KB, ${retentionDays}일 보관)`);
        const cutoff = new Date(now);
        cutoff.setDate(cutoff.getDate() - retentionDays);
        const cutoffStr = cutoff.toISOString().slice(0, 10);
        try {
          const n = await _deleteOldBackups(db, target, cutoffStr);
          if (n > 0) logger.info(`[dailyFirestoreBackup] ${target} ${retentionDays}일 이전 백업 ${n}건 삭제`);
        } catch (e) {
          logger.warn(`[dailyFirestoreBackup] ${target} 삭제 실패:`, e.message);
        }
      }
      if (failures.length) throw new Error(`일부 백업 실패: ${failures.join(', ')}`);
    } catch (e) {
      logger.error("[dailyFirestoreBackup] 오류:", e.message);
      throw e;
    }
  }
);


// monitorOutboundIp + notifySlackIpChanged 제거됨 (2026-06-11) — 이카운트 연동 종료
// hourlyOrdersDiffCheck (옛/새 DB 차집합) 제거됨 (2026-08-04) — Phase 5로 옛 DB write 중단, 스냅샷 diff로 대체

// ─── 발주서 스냅샷 diff (사라진 orderNum 감지) ───
// 3시간마다 hanger_orders 스냅샷 → 직전 스냅샷과 대조 → 사라진 orderNum 슬랙 알림.
// 정상 취소는 doc이 삭제되지 않고 status='취소' 로만 마킹되므로 diff에 안 잡힌다.
// 스냅샷에서 빠졌다 = 실제로 doc이 사라짐 = 사고. hanger_orders_cancel_log 와 교차 조회로 사유 확인.
// Slack 알림 함수. return { sent: true/false } 로 성공 여부 알림.
async function notifySlackOrdersMissing(result) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) { logger.warn("[notifySlackOrdersMissing] SLACK_WEBHOOK_URL 미설정 — 스킵"); return { sent: false, reason: 'no_webhook' }; }
  const restoreToken = process.env.RESTORE_API_TOKEN;
  const restoreBase = process.env.RESTORE_BASE_URL || 'https://asia-northeast3-tooktakproject.cloudfunctions.net/restoreOrder';
  const missingLines = result.missing.slice(0, 30).map(m => {
    const restoreLink = restoreToken
      ? `${restoreBase}?docId=${encodeURIComponent(m.docId)}&token=${encodeURIComponent(restoreToken)}`
      : '(RESTORE_API_TOKEN 미설정)';
    return `  → ${m.orderNum || '(orderNum없음)'} (docId: ${m.docId})\n     복원: ${restoreLink}`;
  }).join('\n');
  const lines = [
    `:rotating_light: *사라진 발주서 감지* (${result.checkedAt})`,
    `• 직전 스냅샷: ${result.prevAt} (${result.prevCount}건)`,
    `• 현재:        ${result.checkedAt} (${result.currentCount}건)`,
    `• 사라진 doc: ${result.missing.length}건`,
    missingLines,
    result.missing.length > 30 ? `  (표시 30건 초과, 나머지는 GCP 로그)` : '',
    `• 즉시 확인 필요 — 링크는 미리보기 후 복원 실행`
  ].filter(Boolean);
  try {
    await axios.post(url, { text: lines.join("\n") }, { timeout: 10000 });
    logger.info("[notifySlackOrdersMissing] 슬랙 알림 발송 완료");
    return { sent: true };
  } catch (e) {
    logger.error("[notifySlackOrdersMissing] 슬랙 발송 실패:", e.message);
    return { sent: false, reason: 'post_failed', error: e.message };
  }
}

// Slack cooldown: transaction으로 짧은 발송 예약을 잡고, 실제 전송 성공 뒤에만 lastSentAt 확정.
// 실패 시 예약을 해제해 다음 실행에서 즉시 재시도할 수 있다.
async function _sendSlackWithCooldown(db, alertKey, text) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) {
    logger.warn(`[cooldown] ${alertKey} webhook 미설정 — cooldown 기록 안 함`);
    return { sent: false, reason: 'no_webhook' };
  }
  const stateRef = db.collection("hanger_orders_snapshot_alerts").doc(alertKey);
  const token = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const nowMs = Date.now();
  let reserved = false;
  try {
    await db.runTransaction(async tx => {
      reserved = false;
      const snap = await tx.get(stateRef);
      const data = snap.exists ? (snap.data() || {}) : {};
      const lastSentMs = data.lastSentAt ? new Date(data.lastSentAt).getTime() : 0;
      const pendingMs = data.pendingAt ? new Date(data.pendingAt).getTime() : 0;
      if (lastSentMs > 0 && nowMs - lastSentMs >= 0 && nowMs - lastSentMs < 24 * 60 * 60 * 1000) return;
      if (pendingMs > 0 && nowMs - pendingMs >= 0 && nowMs - pendingMs < 2 * 60 * 1000) return;
      tx.set(stateRef, { pendingAt: new Date(nowMs).toISOString(), pendingToken: token }, { merge: true });
      reserved = true;
    });
  } catch (e) {
    logger.warn(`[cooldown] ${alertKey} 예약 실패 — 알림 진행 안 함:`, e.message);
    return { sent: false, reason: 'reservation_failed' };
  }
  if (!reserved) return { sent: false, reason: 'suppressed', suppressed: true };

  try {
    await axios.post(url, { text }, { timeout: 10000 });
    await db.runTransaction(async tx => {
      const snap = await tx.get(stateRef);
      const data = snap.exists ? (snap.data() || {}) : {};
      if (data.pendingToken !== token) return;
      tx.set(stateRef, {
        lastSentAt: new Date().toISOString(),
        pendingAt: admin.firestore.FieldValue.delete(),
        pendingToken: admin.firestore.FieldValue.delete()
      }, { merge: true });
    });
    return { sent: true };
  } catch (e) {
    logger.error(`[cooldown] ${alertKey} Slack 실패:`, e.message);
    try {
      await db.runTransaction(async tx => {
        const snap = await tx.get(stateRef);
        const data = snap.exists ? (snap.data() || {}) : {};
        if (data.pendingToken === token) tx.delete(stateRef);
      });
    } catch (_e) {}
    return { sent: false, reason: 'post_failed' };
  }
}

// 정상 복구 시 상태를 지워 같은 장애가 재발하면 즉시 다시 알린다.
async function _clearAlertKey(db, alertKey) {
  try {
    await db.collection("hanger_orders_snapshot_alerts").doc(alertKey).delete();
  } catch (e) {
    logger.warn(`[cooldown] ${alertKey} clear 실패:`, e.message);
  }
}

async function _runOrdersSnapshotDiff(triggerLabel) {
  const db = admin.firestore();
  const now = new Date().toISOString();
  const latestRef = db.collection("hanger_orders_snapshots").doc("latest");
  const runlockRef = db.collection("hanger_orders_snapshots").doc("_runlock");

  // 스케줄 중복 실행 방어. 확인+획득을 transaction으로 묶어 동시 진입을 막는다.
  let shouldSkip = false;
  let futureLockAt = '';
  try {
    await db.runTransaction(async tx => {
      shouldSkip = false;
      futureLockAt = '';
      const lockDoc = await tx.get(runlockRef);
      const lockData = lockDoc.exists ? (lockDoc.data() || {}) : {};
      const lastStart = Number.isFinite(Number(lockData.startedAtMs))
        ? Number(lockData.startedAtMs)
        : (lockData.startedAt ? new Date(lockData.startedAt).getTime() : 0);
      const delta = Date.now() - lastStart;
      if (!isNaN(lastStart) && lastStart > 0 && delta >= 0 && delta < 5 * 60 * 1000) {
        shouldSkip = true;
        return;
      }
      if (delta < 0) futureLockAt = lockData.startedAt || String(lockData.startedAtMs);
      tx.set(runlockRef, { startedAt: now, startedAtMs: Date.now(), trigger: triggerLabel });
    });
  } catch (e) {
    logger.error(`[snapshotDiff ${triggerLabel}] runlock transaction 실패 — fail-closed:`, e.message);
    throw e;
  }
  if (shouldSkip) {
    logger.warn(`[snapshotDiff ${triggerLabel}] 최근 5분 이내 실행 감지 — skip (중복 방어)`);
    return;
  }
  if (futureLockAt) {
    logger.warn(`[snapshotDiff ${triggerLabel}] runlock 미래 시각 (${futureLockAt}) — 무시하고 진행`);
    await _sendSlackWithCooldown(
      db,
      'clockSkewAt',
      `:warning: *snapshotDiff runlock 미래 시각 감지 (인프라 이상)* (${now})\n• 저장 시각: ${futureLockAt}\n• 현재 시각: ${now}\n• 진행은 계속됨 (wedge 방지). 서버 시계·runlock doc 확인 필요.\n• 이 알림은 24h 내 최초 1회만 발송 (cooldown)`
    );
  } else {
    await _clearAlertKey(db, 'clockSkewAt');
  }

  // 현재 hanger_orders 스캔
  let currentDocs = [];
  try {
    const snap = await db.collection("hanger_orders").get();
    snap.docs.forEach(d => {
      const data = d.data() || {};
      const raw = data.orderNum;
      const on = (typeof raw === 'string' || typeof raw === 'number') ? String(raw) : '';
      currentDocs.push({ docId: d.id, orderNum: on });
    });
  } catch (e) {
    logger.error(`[snapshotOrdersDiff ${triggerLabel}] hanger_orders 스캔 실패:`, e.message);
    await _sendSlackWithCooldown(
      db,
      'ordersScanFailAt',
      `:warning: *snapshotDiff hanger_orders 스캔 실패* (${now})\n• latest는 갱신하지 않음\n• 오류: ${e.message}`
    );
    throw e; // latest 오염 방지 + 실행 실패를 모니터링에 노출
  }
  await _clearAlertKey(db, 'ordersScanFailAt');
  const currentDocIds = new Set(currentDocs.map(d => d.docId));

  // 직전 스냅샷 읽기 — 실패/오염 시 fail-closed (latest 절대 덮어쓰지 않음)
  let prevDocs = null;
  let prevAt = '(첫 실행)';
  let latestExists = false;
  try {
    const prevDoc = await latestRef.get();
    latestExists = prevDoc.exists;
    if (prevDoc.exists) {
      const data = prevDoc.data() || {};
      prevAt = data.at || '(unknown)';
      // 스키마 심층 검증: 항목 하나라도 불량/중복이거나 count가 다르면 fail-closed.
      const docsArray = Array.isArray(data.docs) ? data.docs : null;
      const entriesValid = !!docsArray && docsArray.every(x =>
        x && typeof x.docId === 'string' && x.docId.length > 0 && typeof x.orderNum === 'string'
      );
      const ids = docsArray ? docsArray.map(x => x && x.docId) : [];
      const uniqueIds = new Set(ids);
      const countValid = !!docsArray && Number(data.count) === docsArray.length;
      const schemaValid = data.schemaVersion === 2 && entriesValid && countValid && uniqueIds.size === ids.length;
      if (schemaValid) {
        prevDocs = docsArray;
        // 스키마·읽기 정상 → 이전 알림 cooldown 자동 해제 (수동 조치 후 재발 즉시 알림)
        await _clearAlertKey(db, 'schemaCorruptionAt');
        await _clearAlertKey(db, 'readFailAt');
      } else {
        // 스키마 위반 → fail-closed. latest 덮어쓰지 말고 admin 수동 확인 요청.
        logger.error(`[snapshotDiff ${triggerLabel}] latest 스키마 오염 — fail-closed (자동 재작성 X)`);
        await _sendSlackWithCooldown(
          db,
          'schemaCorruptionAt',
          `:warning: *snapshotDiff latest 스키마 오염 (fail-closed)* (${now})\n• 자동 재작성 중단 — 사고 은폐 방지\n• 배열/항목/count/중복/schemaVersion 중 하나가 잘못됨\n• Firestore 콘솔에서 hanger_orders_snapshots/latest 확인 후 수동 조치 필요\n• 이 알림은 24h 내 최초 1회만 발송 (cooldown)`
        );
        return;
      }
    }
  } catch (e) {
    // 읽기 자체 실패 → fail-closed (latest 안 덮어씀, 다음 실행에서 재시도)
    logger.error(`[snapshotDiff ${triggerLabel}] latest 읽기 실패 — fail-closed 종료:`, e.message);
    await _sendSlackWithCooldown(
      db,
      'readFailAt',
      `:warning: *snapshotDiff latest 읽기 실패 (fail-closed)* (${now})\n• 이번 window skip. 다음 실행 시 재시도.\n• 오류: ${e.message}\n• 이 알림은 24h 내 최초 1회만 발송 (cooldown)`
    );
    throw e;
  }

  // diff 계산 + Slack 알림
  if (prevDocs && prevDocs.length > 0) {
    const missingDocs = prevDocs.filter(x => !currentDocIds.has(x.docId));
    if (missingDocs.length > 0) {
      const missingDisplay = missingDocs.map(x => ({ docId: x.docId, orderNum: x.orderNum || '' }));
      logger.warn(`[snapshotDiff ${triggerLabel}] ⚠️ 사라진 doc ${missingDocs.length}건`, missingDisplay.slice(0, 20));

      const slackResult = await notifySlackOrdersMissing({
        missing: missingDisplay,
        prevAt,
        checkedAt: now,
        prevCount: prevDocs.length,
        currentCount: currentDocs.length,
        trigger: triggerLabel
      });

      // Slack 실패 시 latest 갱신 금지 → 다음 실행에서 다시 알림 기회
      if (!slackResult.sent) {
        logger.error(`[snapshotDiff ${triggerLabel}] Slack 실패 (${slackResult.reason}) — latest 갱신 skip, 다음 실행에서 재알림`);
        return;
      }
    } else {
      logger.info(`[snapshotDiff ${triggerLabel}] 정상: 직전 ${prevDocs.length}건 → 현재 ${currentDocs.length}건 (사라진 것 없음)`);
    }
  } else if (!latestExists) {
    logger.info(`[snapshotDiff ${triggerLabel}] 첫 실행 — 스냅샷만 저장`);
  }

  // 스냅샷 저장 — read 성공 + (missing 없음 OR Slack 성공) 일 때만 도달
  try {
    await latestRef.set({
      docs: currentDocs,
      count: currentDocs.length,
      at: now,
      trigger: triggerLabel,
      schemaVersion: 2
    });
  } catch (e) {
    logger.error(`[snapshotOrdersDiff ${triggerLabel}] latest 저장 실패:`, e.message);
    throw e;
  }
}

// 3시간마다 (0시·3시·6시·…·21시) KST
exports.snapshotOrdersDiff = onSchedule(
  { schedule: "0 */3 * * *", timeZone: "Asia/Seoul", region: "asia-northeast3" },
  async () => _runOrdersSnapshotDiff("3h")
);

// M3 보강 (Codex): invoices 무결성 검사
// - id 중복 / orderNum 없음 / 같은 orderNum 활성 invoice 다중 / 고아 invoice 검출
async function _runInvoicesIntegrityCheck(triggerLabel) {
  try {
    const db = admin.firestore();
    const invDoc = await db.collection("hanger_data").doc("invoices").get();
    const rawInvoices = invDoc.exists ? invDoc.data().value : [];
    if (!Array.isArray(rawInvoices)) {
      await _sendSlackWithCooldown(
        db,
        'invoiceSchemaAt',
        `:warning: *거래명세서 스키마 오류* (${new Date().toISOString()})\n• hanger_data/invoices.value가 배열이 아님\n• 무결성 검사를 fail-closed로 종료`
      );
      throw new Error('hanger_data/invoices.value 스키마 오류 — 배열이 아님');
    }
    await _clearAlertKey(db, 'invoiceSchemaAt');
    const arr = rawInvoices;
    // [2026-08-04] Phase 5 이후 hanger_data/orders 배열 얼어붙음 → 새 컬렉션 hanger_orders 사용
    // docId 를 fallback 으로 사용 (규약: hanger_orders docId == orderNum, 필드 누락 방어)
    const ordSnap = await db.collection("hanger_orders").get();
    const orderNums = new Set();
    const orderNumMismatch = [];
    ordSnap.docs.forEach(d => {
      const data = d.data() || {};
      const canonical = String(d.id); // Phase 5 규약의 기준값
      orderNums.add(canonical);
      if (data.orderNum !== undefined && data.orderNum !== null && String(data.orderNum) !== canonical) {
        orderNumMismatch.push(`${canonical}≠${String(data.orderNum)}`);
      }
    });

    const idCount = {};
    const activeByOrderNum = {};
    const noOrderNum = [];
    const orphan = []; // invoice.orderNum이 orders에 없음

    arr.forEach(inv => {
      if (!inv) return;
      if (inv.id) idCount[inv.id] = (idCount[inv.id] || 0) + 1;
      if (!inv.orderNum) { noOrderNum.push(inv.id || '(no id)'); return; }
      const invOrderNum = String(inv.orderNum);
      if (!inv.cancelled) {
        activeByOrderNum[invOrderNum] = (activeByOrderNum[invOrderNum] || 0) + 1;
      }
      if (!orderNums.has(invOrderNum)) orphan.push(invOrderNum);
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
      orderNumMismatchCount: orderNumMismatch.length,
      orderNumMismatch: orderNumMismatch.slice(0, 20),
      checkedAt: now,
      trigger: triggerLabel
    };

    await db.collection("hanger_data").doc("invoices_diff_monitor").set({
      value: result,
      updatedAt: now
    });

    const anyIssue = dupIds.length || noOrderNum.length || multiActive.length || orphan.length || orderNumMismatch.length;
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
          `• 고아 invoice (orders에 없음): ${orphan.length}건`,
          `• order docId/필드 불일치: ${orderNumMismatch.length}건${orderNumMismatch.length ? ` → ${orderNumMismatch.slice(0, 5).join(', ')}` : ''}`
        ];
        try { await axios.post(url, { text: lines.join("\n") }, { timeout: 10000 }); }
        catch (e) { logger.error("[invoices 슬랙] 발송 실패:", e.message); throw e; }
      }
    } else {
      logger.info(`[invoices 검증 ${triggerLabel}] 정상: ${arr.length}건`);
    }
  } catch (e) {
    logger.error(`[invoicesIntegrityCheck ${triggerLabel}] 오류:`, e.message);
    throw e;
  }
}

exports.hourlyInvoicesIntegrityCheck = onSchedule(
  { schedule: "30 8-17 * * *", timeZone: "Asia/Seoul", region: "asia-northeast3" },
  async () => _runInvoicesIntegrityCheck("hourly")
);

// ─── iter2: 실시간 삭제 감지 (onDocumentDeleted) ────────────────
// hanger_orders/{docId} 삭제 즉시 슬랙 알림 + 서버측 audit log 기록.
// 스냅샷 diff(3시간 주기)의 사각지대를 보완.
// 참고: 문서를 update 로 status='취소' 처리하는 경우엔 발동 X (delete 만).
function _buildRestoreUrl(docId) {
  const baseUrl = process.env.RESTORE_BASE_URL || 'https://asia-northeast3-tooktakproject.cloudfunctions.net/restoreOrder';
  const token = process.env.RESTORE_API_TOKEN;
  if (!token) return null;
  return `${baseUrl}?docId=${encodeURIComponent(docId)}&token=${encodeURIComponent(token)}`;
}

exports.onOrderDeleted = onDocumentDeleted(
  { document: "hanger_orders/{docId}", region: "asia-northeast3" },
  async (event) => {
    const docId = event.params.docId;
    const before = (event.data && event.data.data()) || {};
    const now = new Date().toISOString();
    const orderNum = before.orderNum ? String(before.orderNum) : '';
    logger.warn(`[onOrderDeleted] 삭제 감지: hanger_orders/${docId} (orderNum=${orderNum})`);

    // 서버측 audit log 기록 (클라이언트 위조 방지 관점의 부수효과)
    try {
      const db = admin.firestore();
      const logId = `delete_trigger_${docId}_${Date.now()}`;
      await db.collection("hanger_orders_cancel_log").doc(logId).set({
        id: logId,
        type: '삭제감지(서버트리거)',
        orderId: docId,
        orderNum: orderNum,
        source: 'onDocumentDeleted',
        deletedSnapshot: before,
        at: admin.firestore.FieldValue.serverTimestamp(),
        detectedAt: now
      });
    } catch (e) {
      logger.warn("[onOrderDeleted] audit log 실패:", e.message);
    }

    // 슬랙 알림 + 복원 링크
    const url = process.env.SLACK_WEBHOOK_URL;
    if (!url) {
      logger.warn("[onOrderDeleted] SLACK_WEBHOOK_URL 미설정 — 알림 스킵");
      return;
    }
    const restoreUrl = _buildRestoreUrl(docId);
    const lines = [
      `:rotating_light: *발주서 실시간 삭제 감지* (${now})`,
      `• docId: ${docId}`,
      `• orderNum: ${orderNum || '(없음)'}`,
      `• 삭제 시각: ${now}`,
      restoreUrl
        ? `• 복원 링크: ${restoreUrl}\n  (미리보기 후 확인, 최근 30일 백업에서 자동 검색)`
        : `• 복원 링크: RESTORE_API_TOKEN 미설정 — Firestore 콘솔에서 수동 복원 필요`,
      `• 서버측 audit log: hanger_orders_cancel_log 에 기록됨`
    ].filter(Boolean);
    try {
      await axios.post(url, { text: lines.join("\n") }, { timeout: 10000 });
      logger.info("[onOrderDeleted] 슬랙 알림 완료");
    } catch (e) {
      logger.error("[onOrderDeleted] 슬랙 발송 실패:", e.message);
    }
  }
);

// ─── iter2: 발주서 복원 함수 (HTTP endpoint, 슬랙 링크용) ─────────
// GET /restoreOrder?docId=xxx[&date=YYYY-MM-DD]&token=xxx[&confirm=true]
// - token 인증 필수
// - date 없으면 최근 백업에서 자동 검색 (30일)
// - confirm=true 없으면 미리보기 페이지만 표시
// - 실제 복원 시 hanger_orders_cancel_log 에 이벤트 기록
async function _findBackupWithDoc(db, docId, explicitDate) {
  if (explicitDate) {
    const doc = await db.collection("_backups_hanger_orders").doc(explicitDate).get();
    if (!doc.exists) return { found: false, reason: `${explicitDate} 백업 doc 없음` };
    const docs = doc.data().docs || [];
    const target = docs.find(d => d && d.docId === docId);
    return target ? { found: true, date: explicitDate, target } : { found: false, reason: `${explicitDate} 백업에 docId=${docId} 없음` };
  }
  const snap = await db.collection("_backups_hanger_orders")
    .orderBy(admin.firestore.FieldPath.documentId(), "desc")
    .limit(30)
    .get();
  for (const doc of snap.docs) {
    const docs = doc.data().docs || [];
    const target = docs.find(d => d && d.docId === docId);
    if (target) return { found: true, date: doc.id, target };
  }
  return { found: false, reason: `최근 30일 백업에 docId=${docId} 없음` };
}

function _htmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 복원 성공 시 슬랙 알림 (파괴적 작업 감지·감사 목적)
async function _notifyRestoreSuccess(docId, orderNum, date, actorIp) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;
  try {
    await axios.post(url, {
      text: `:white_check_mark: *발주서 복원 완료* (${new Date().toISOString()})\n• docId: ${docId}\n• orderNum: ${orderNum || '(없음)'}\n• 백업 날짜: ${date}\n• 요청 IP: ${actorIp}\n• hanger_orders_cancel_log 에 이벤트 기록됨`
    }, { timeout: 10000 });
  } catch (e) { logger.warn("[restoreOrder] 성공 알림 발송 실패:", e.message); }
}

// 인증 실패·비정상 요청 로깅 (brute force 감지 흔적)
function _logAuthAttempt(kind, req, extra) {
  const ip = req.ip || req.headers['x-forwarded-for'] || '(unknown)';
  const ua = req.headers['user-agent'] || '(no-ua)';
  logger.warn(`[restoreOrder] ${kind} ip=${ip} ua=${ua} ${extra || ''}`);
}

exports.restoreOrder = onRequest(
  { region: "asia-northeast3", invoker: "public" },
  async (req, res) => {
    res.set('Content-Type', 'text/html; charset=utf-8');
    // Slack unfurl 방지: X-Robots-Tag + Cache-Control
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.set('Cache-Control', 'no-store');

    const expectedToken = process.env.RESTORE_API_TOKEN;
    if (!expectedToken) {
      logger.error('[restoreOrder] RESTORE_API_TOKEN 미설정');
      res.status(500).send('<h1>500</h1><p>RESTORE_API_TOKEN 환경변수 미설정. functions/.env 확인.</p>');
      return;
    }

    // 실행(POST) vs 미리보기(GET)
    const isExecute = req.method === 'POST';
    const params = isExecute ? (req.body || {}) : (req.query || {});
    const token = String(params.token || '');
    if (token !== expectedToken) {
      _logAuthAttempt('AUTH_FAIL', req, `method=${req.method}`);
      res.status(401).send('<h1>401 인증 실패</h1><p>token 불일치. 시도가 로깅되었습니다.</p>');
      return;
    }

    const docId = String(params.docId || '');
    const explicitDate = params.date ? String(params.date) : '';
    if (!docId) {
      res.status(400).send('<h1>400</h1><p>docId 파라미터 필요.</p>');
      return;
    }

    try {
      const db = admin.firestore();
      const result = await _findBackupWithDoc(db, docId, explicitDate);
      if (!result.found) {
        _logAuthAttempt('BACKUP_MISS', req, `docId=${docId} date=${explicitDate}`);
        res.status(404).send(`<h1>404 백업 없음</h1><p>${_htmlEscape(result.reason)}</p>`);
        return;
      }

      const currentRef = db.collection("hanger_orders").doc(docId);
      const currentDoc = await currentRef.get();
      const alreadyExists = currentDoc.exists;

      // 덮어쓰기 절대 금지 — 옛 데이터로 오늘 수정본 파괴 방지
      if (alreadyExists) {
        _logAuthAttempt('OVERWRITE_REFUSED', req, `docId=${docId}`);
        res.status(409).send(`<!doctype html><html><head><meta charset="utf-8"><title>409 이미 존재</title></head><body style="font-family:sans-serif;max-width:600px;margin:20px auto;padding:0 20px">
<h1 style="color:#c00">409 이미 존재</h1>
<p><b>docId</b>: ${_htmlEscape(docId)} — hanger_orders 에 doc이 이미 있음.</p>
<p>복원 API는 <b>덮어쓰기 금지</b> — 옛 백업으로 오늘 수정본을 파괴할 위험.</p>
<p>정말 덮으려면: Firestore 콘솔에서 해당 doc 을 먼저 삭제 후 다시 이 링크 요청.</p>
</body></html>`);
        return;
      }

      // GET = 미리보기, POST = 실행
      if (!isExecute) {
        const dataJson = _htmlEscape(JSON.stringify(result.target.data, null, 2));
        res.send(`<!doctype html><html><head><meta charset="utf-8"><title>발주서 복원 미리보기</title></head><body style="font-family:sans-serif;max-width:800px;margin:20px auto;padding:0 20px">
<h1>발주서 복원 미리보기</h1>
<table style="border-collapse:collapse">
<tr><td style="padding:4px 8px"><b>docId</b></td><td>${_htmlEscape(docId)}</td></tr>
<tr><td style="padding:4px 8px"><b>orderNum</b></td><td>${_htmlEscape(result.target.data.orderNum || '(없음)')}</td></tr>
<tr><td style="padding:4px 8px"><b>백업 날짜</b></td><td>${_htmlEscape(result.date)}</td></tr>
<tr><td style="padding:4px 8px"><b>현재 상태</b></td><td><span style="color:#080">✓ 없음 (복원 안전)</span></td></tr>
</table>
<h2>백업 내용</h2>
<pre style="max-height:500px;overflow:auto;background:#f5f5f5;padding:10px;border:1px solid #ddd">${dataJson}</pre>
<form method="POST" action="" style="margin:20px 0">
  <input type="hidden" name="docId" value="${_htmlEscape(docId)}">
  <input type="hidden" name="date" value="${_htmlEscape(result.date)}">
  <input type="hidden" name="token" value="${_htmlEscape(token)}">
  <button type="submit" style="background:#c00;color:#fff;padding:12px 24px;border:0;border-radius:4px;font-weight:bold;font-size:1em;cursor:pointer">복원 실행</button>
</form>
<p style="color:#666;font-size:0.9em">GET 은 미리보기만, 실제 복원은 POST (버튼 클릭). Slack unfurl 자동 실행 방지.</p>
</body></html>`);
        return;
      }

      // 실제 복원 (POST) — .create() 로 원자적 처리 (TOCTOU 방지)
      // 사전 check(라인 위) 통과 후에도 set 직전에 doc 이 생겼으면 create 가 ALREADY_EXISTS throw
      try {
        await currentRef.create(result.target.data);
      } catch (createErr) {
        // ALREADY_EXISTS 여러 형식 방어: gRPC 숫자 코드(6) / 문자열 / status / 메시지
        const c = createErr && createErr.code;
        const s = createErr && createErr.status;
        const m = (createErr && createErr.message) || '';
        const isAlreadyExists = c === 6 || c === 'already-exists' || c === 'ALREADY_EXISTS'
          || s === 'ALREADY_EXISTS' || /already.?exists/i.test(m);
        if (isAlreadyExists) {
          _logAuthAttempt('OVERWRITE_REFUSED_TOCTOU', req, `docId=${docId}`);
          res.status(409).send(`<h1>409 이미 존재 (race)</h1><p>미리보기와 실행 사이에 doc 이 생성됨. 새 요청 필요.</p>`);
          return;
        }
        throw createErr;
      }
      const orderNum = result.target.data.orderNum ? String(result.target.data.orderNum) : '';
      const logId = `restore_${docId}_${Date.now()}`;
      const actorIp = req.ip || req.headers['x-forwarded-for'] || '(unknown)';
      await db.collection("hanger_orders_cancel_log").doc(logId).set({
        id: logId,
        type: '복원',
        orderId: docId,
        orderNum,
        source: `_backups_hanger_orders/${result.date}`,
        actor: 'restore_api',
        actorIp,
        at: admin.firestore.FieldValue.serverTimestamp(),
        restoredAt: new Date().toISOString()
      });
      logger.info(`[restoreOrder] 복원 성공: ${docId} (백업=${result.date}, ip=${actorIp})`);
      // 성공 시 Slack 알림 (감사 흔적)
      await _notifyRestoreSuccess(docId, orderNum, result.date, actorIp);

      res.send(`<!doctype html><html><head><meta charset="utf-8"><title>복원 완료</title></head><body style="font-family:sans-serif;max-width:600px;margin:20px auto;padding:0 20px">
<h1 style="color:#080">✓ 복원 완료</h1>
<p><b>docId</b>: ${_htmlEscape(docId)}</p>
<p><b>orderNum</b>: ${_htmlEscape(orderNum || '(없음)')}</p>
<p><b>백업 날짜</b>: ${_htmlEscape(result.date)}</p>
<p><code>hanger_orders_cancel_log</code> 에 복원 이벤트 기록됨.</p>
<p>Slack 에 복원 완료 알림도 발송됨.</p>
</body></html>`);
    } catch (e) {
      logger.error("[restoreOrder] 오류:", e.message, e.stack);
      res.status(500).send(`<h1>500 복원 실패</h1><p>${_htmlEscape(e.message)}</p>`);
    }
  }
);

