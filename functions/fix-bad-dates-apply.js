// ─────────────────────────────────────────────────────────────
// fix-bad-dates-apply.js — 오염된 shipDate 정규화 실제 적용
// 사용:  cd functions && node fix-bad-dates-apply.js
// 대상:  hanger_orders + hanger_data/orders 동시 업데이트 (동기화 유지)
// 규칙:  "0026-XX-XX" → "2026-XX-XX" (shipDate만)
//        "0000-00-00" 유지, orderDate 미변경 (dry-run 결과 0건)
// 안전:  하나씩 write, 각 결과 로그, 실패 시 즉시 중단
// 백업:  이미 .ai-backups/20260703/orders-backup-*.json 에 확보
// ─────────────────────────────────────────────────────────────

const admin = require("firebase-admin");
admin.initializeApp({ projectId: "tooktakproject" });
const db = admin.firestore();

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
  if (orig === '0000-00-00') return false;
  return normalizeDateStr(orig) !== orig;
}

(async () => {
  console.log("\n━━━ 오염 shipDate 정규화 실제 적용 시작 ━━━");
  console.log(`시각: ${new Date().toISOString()}`);
  console.log("대상: hanger_orders + hanger_data/orders (동기 유지)\n");

  // [1] hanger_orders 컬렉션 로드
  const snap = await db.collection("hanger_orders").get();
  const orders = [];
  snap.forEach(d => orders.push({ _docId: d.id, ...d.data() }));
  console.log(`hanger_orders 로드: ${orders.length}건`);

  // [2] 정규화 대상만 필터
  const targets = orders
    .filter(o => needsFix(o.shipDate))
    .map(o => ({
      docId: o._docId,
      orderNum: o.orderNum,
      deliveryTo: o.deliveryTo,
      status: o.status,
      before: o.shipDate,
      after: normalizeDateStr(o.shipDate),
    }));

  console.log(`정규화 대상: ${targets.length}건\n`);

  if (targets.length === 0) {
    console.log("✓ 정리할 데이터 없음. 종료.\n");
    return;
  }

  // [3] hanger_data/orders (옛 배열) 로드 — 함께 동기 유지 필요
  const oldDoc = await db.collection("hanger_data").doc("orders").get();
  const oldArr = oldDoc.exists ? (oldDoc.data().value || []) : [];
  console.log(`hanger_data/orders 로드: ${oldArr.length}건\n`);

  // [4] hanger_orders: 하나씩 업데이트 (실패 시 즉시 중단)
  console.log("━━━ [1/2] hanger_orders 컬렉션 업데이트 ━━━");
  let done = 0;
  for (const t of targets) {
    try {
      await db.collection("hanger_orders").doc(t.docId).update({
        shipDate: t.after,
        // 감사용 메타
        _lastNormalizedAt: new Date().toISOString(),
        _lastNormalizedField: 'shipDate',
        _lastNormalizedFrom: t.before,
      });
      done++;
      console.log(`  ✓ ${done}/${targets.length} ${t.orderNum} | ${t.before} → ${t.after}`);
    } catch (e) {
      console.error(`  ✗ ${t.orderNum} 실패:`, e.message);
      console.error(`\n중단. 지금까지 ${done}건 완료. 나머지 미처리.\n`);
      process.exit(1);
    }
  }
  console.log(`\n✓ hanger_orders 전체 완료: ${done}건\n`);

  // [5] hanger_data/orders (옛 배열): 대응 항목 정규화 후 통째 저장
  console.log("━━━ [2/2] hanger_data/orders (옛 배열) 동기화 ━━━");
  const targetOrderNums = new Set(targets.map(t => t.orderNum));
  let arrChanged = 0;
  const newArr = oldArr.map(o => {
    if (!o) return o;
    if (targetOrderNums.has(o.orderNum) && needsFix(o.shipDate)) {
      arrChanged++;
      return { ...o, shipDate: normalizeDateStr(o.shipDate) };
    }
    return o;
  });
  console.log(`  옛 배열에서 정규화될 항목: ${arrChanged}건`);

  if (arrChanged === 0) {
    console.log("  (옛 배열에는 이미 정상값 또는 대응 항목 없음 — 저장 생략)\n");
  } else {
    try {
      await db.collection("hanger_data").doc("orders").set({ value: newArr });
      console.log(`  ✓ hanger_data/orders 저장 완료 (${newArr.length}건)\n`);
    } catch (e) {
      console.error(`  ✗ hanger_data/orders 저장 실패:`, e.message);
      console.error(`  ⚠️ 신 컬렉션은 이미 정규화됨. 옛 배열만 동기 실패.`);
      console.error(`  → 앱은 신 컬렉션 기준으로 정상 동작. 옛 배열은 다음에 재시도 가능.\n`);
      process.exit(1);
    }
  }

  console.log("━━━ 완료 ━━━");
  console.log(`hanger_orders 업데이트:      ${done}건`);
  console.log(`hanger_data/orders 업데이트: ${arrChanged}건`);
  console.log(`\n검증: node fix-bad-dates-dryrun.js 재실행 → 정규화 예정 0건 확인 필요\n`);
})().catch(e => {
  console.error("실패:", e && e.message);
  process.exit(1);
});
