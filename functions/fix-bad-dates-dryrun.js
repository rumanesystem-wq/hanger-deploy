// ─────────────────────────────────────────────────────────────
// fix-bad-dates-dryrun.js — 오염된 날짜 필드 정리 미리보기 (읽기 전용)
// 사용:  cd functions && node fix-bad-dates-dryrun.js
// 대상:  shipDate, orderDate (0026-XX-XX → 2026-XX-XX 등)
// 규칙:  "0000-00-00"은 미정 표시로 유지 (건드리지 않음)
// 안전:  DB 변경 0
// ─────────────────────────────────────────────────────────────

const admin = require("firebase-admin");
admin.initializeApp({ projectId: "tooktakproject" });
const db = admin.firestore();

// public/발주앱/js/utils/dateUtils.js 의 normalizeYear/normalizeDateStr와 동일 규칙
function normalizeYear(yStr) {
  if (!yStr) return '';
  const n = parseInt(yStr, 10);
  if (isNaN(n)) return String(yStr);
  if (n === 0) return '0000';
  if (n < 100) return String(2000 + n);
  return String(n).padStart(4, '0');
}

function normalizeDateStr(s) {
  if (!s || typeof s !== 'string') return s;
  if (s === '0000-00-00') return s;
  const m = s.match(/^(\d{1,4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return s;
  const y = normalizeYear(m[1]);
  const mm = m[2].padStart(2, '0');
  const dd = m[3].padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}

function needsFix(orig) {
  if (!orig || typeof orig !== 'string') return false;
  if (orig === '0000-00-00') return false; // 미정 유지
  const fixed = normalizeDateStr(orig);
  return fixed !== orig;
}

(async () => {
  console.log("\n━━━ 오염 발주서 정리 계획 (Dry-run) ━━━");
  console.log("※ DB 변경 없음. 계획만 출력.\n");

  const snap = await db.collection("hanger_orders").get();
  const orders = [];
  snap.forEach(d => orders.push({ _docId: d.id, ...d.data() }));
  console.log(`전체 발주서: ${orders.length}건 (hanger_orders)\n`);

  const shipFixes = [];   // shipDate 정규화 가능
  const orderFixes = [];  // orderDate 정규화 가능
  const shipMiseong = []; // shipDate = 0000-00-00 (유지)
  const orderMiseong = []; // orderDate = 0000-00-00 (유지)

  orders.forEach(o => {
    const info = {
      docId: o._docId,
      orderNum: o.orderNum,
      deliveryTo: o.deliveryTo,
      status: o.status,
      shipDate: o.shipDate,
      orderDate: o.orderDate,
    };
    if (needsFix(o.shipDate)) {
      shipFixes.push({ ...info, from: o.shipDate, to: normalizeDateStr(o.shipDate) });
    } else if (o.shipDate === '0000-00-00') {
      shipMiseong.push(info);
    }
    if (needsFix(o.orderDate)) {
      orderFixes.push({ ...info, from: o.orderDate, to: normalizeDateStr(o.orderDate) });
    } else if (o.orderDate === '0000-00-00') {
      orderMiseong.push(info);
    }
  });

  // ── shipDate 정규화 대상 ──
  console.log(`━━━ [1] shipDate 정규화 대상: ${shipFixes.length}건 ━━━`);
  if (shipFixes.length === 0) {
    console.log("  (없음)\n");
  } else {
    shipFixes.forEach(f => {
      console.log(`  ${f.orderNum || '#'+f.docId} | ${f.status} | ${f.deliveryTo} | "${f.from}" → "${f.to}"`);
    });
    console.log("");
  }

  // ── orderDate 정규화 대상 ──
  console.log(`━━━ [2] orderDate 정규화 대상: ${orderFixes.length}건 ━━━`);
  if (orderFixes.length === 0) {
    console.log("  (없음)\n");
  } else {
    orderFixes.forEach(f => {
      console.log(`  ${f.orderNum || '#'+f.docId} | ${f.status} | ${f.deliveryTo} | "${f.from}" → "${f.to}"`);
    });
    console.log("");
  }

  // ── 0000-00-00 미정 (유지) ──
  console.log(`━━━ [3] shipDate '0000-00-00' 미정 유지: ${shipMiseong.length}건 ━━━`);
  if (shipMiseong.length > 0) {
    shipMiseong.slice(0, 5).forEach(f => {
      console.log(`  ${f.orderNum || '#'+f.docId} | ${f.status} | ${f.deliveryTo} | shipDate="0000-00-00" (유지)`);
    });
    if (shipMiseong.length > 5) console.log(`  ... 외 ${shipMiseong.length - 5}건 (전부 유지)`);
    console.log("");
  }

  console.log(`━━━ [4] orderDate '0000-00-00' 미정 유지: ${orderMiseong.length}건 ━━━`);
  if (orderMiseong.length > 0) {
    orderMiseong.slice(0, 5).forEach(f => {
      console.log(`  ${f.orderNum || '#'+f.docId} | ${f.status} | ${f.deliveryTo} | orderDate="0000-00-00" (유지)`);
    });
    if (orderMiseong.length > 5) console.log(`  ... 외 ${orderMiseong.length - 5}건 (전부 유지)`);
    console.log("");
  }

  // ── 영향받는 발주서 (중복 제거) ──
  const impactedDocIds = new Set([
    ...shipFixes.map(f => f.docId),
    ...orderFixes.map(f => f.docId),
  ]);

  console.log("━━━ 요약 ━━━");
  console.log(`정규화 예정 필드:  ${shipFixes.length + orderFixes.length}개`);
  console.log(`  └ shipDate:   ${shipFixes.length}건`);
  console.log(`  └ orderDate:  ${orderFixes.length}건`);
  console.log(`영향받는 발주서:   ${impactedDocIds.size}건 (중복 제거)`);
  console.log(`미정 유지:         ${shipMiseong.length + orderMiseong.length}개 필드`);
  console.log(`DB 변경 예정:      0건 (dry-run)\n`);

  console.log("※ 실제 적용하려면 별도 승인 후 apply 스크립트 실행 필요.");
  console.log("※ 백업: .ai-backups/20260703/orders-backup-*.json\n");
})().catch(e => {
  console.error("실패:", e && e.message);
  process.exit(1);
});
