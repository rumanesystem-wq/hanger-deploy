// ─────────────────────────────────────────────────────────────
// find-customer-orders.js — 특정 납품처의 발주서 + invoice 진단
// 사용:  cd functions && node find-customer-orders.js <납품처명>
// 예시:  node find-customer-orders.js "유케이 퍼니처"
// 읽기 전용 — 운영 데이터 변경 0
// ─────────────────────────────────────────────────────────────

const admin = require("firebase-admin");
admin.initializeApp({ projectId: "tooktakproject" });
const db = admin.firestore();

const query = (process.argv[2] || "").trim();
if (!query) {
  console.log('사용법: node find-customer-orders.js "납품처명"');
  process.exit(1);
}

(async () => {
  console.log(`\n━━━ "${query}" 발주서 진단 ━━━\n`);

  // 발주서
  const oldDoc = await db.collection("hanger_data").doc("orders").get();
  const oldArr = oldDoc.exists ? (oldDoc.data().value || []) : [];
  const matched = oldArr.filter(o => o && String(o.deliveryTo || '').includes(query));

  console.log(`전체 발주서: ${oldArr.length}건`);
  console.log(`"${query}" 매칭: ${matched.length}건\n`);

  if (matched.length === 0) {
    console.log("❌ 매칭 없음");
    console.log("\n[힌트] 비슷한 납품처 예시:");
    const uniq = [...new Set(oldArr.map(o => o.deliveryTo).filter(Boolean))]
      .filter(n => n.length > 0);
    uniq.slice(0, 30).forEach(n => console.log(`  - "${n}"`));
    return;
  }

  // invoices
  const invDoc = await db.collection("hanger_data").doc("invoices").get();
  const invArr = invDoc.exists ? (invDoc.data().value || []) : [];
  const invMap = {};
  invArr.forEach(inv => {
    if (!inv || inv.cancelled || !inv.orderNum) return;
    const prev = invMap[inv.orderNum];
    if (!prev || (inv.createdAt || '') > (prev.createdAt || '')) {
      invMap[inv.orderNum] = inv;
    }
  });

  // 상태별 카운트
  const byStatus = {};
  matched.forEach(o => { byStatus[o.status] = (byStatus[o.status] || 0) + 1; });
  console.log(`상태별:`);
  Object.entries(byStatus).forEach(([s, c]) => console.log(`  ${s}: ${c}건`));
  console.log("");

  // 상세
  matched
    .sort((a, b) => (b.shipDate || b.orderDate || '').localeCompare(a.shipDate || a.orderDate || ''))
    .forEach(o => {
      const inv = invMap[o.orderNum];
      const invStatus = inv ? `📄 발급됨 (${inv.sentToCustomer ? '전송✓' : '미전송'})` : '❌ invoice 없음';
      const dateInfo = `발주 ${o.orderDate || '-'} | 출고 ${o.shipDate || '❌없음'}`;
      const statusFlag = (o.status === '출고완료' || o.status === '발주확정') ? '✅' : '⚠️';
      console.log(`─ ${o.orderNum || '#'+o.id}  [${o.status}] ${statusFlag}`);
      console.log(`  ${dateInfo}`);
      console.log(`  ${invStatus}`);
      console.log(`  주소: ${(o.address || '-').slice(0, 40)}`);
      console.log(`  금액: ₩${(o.totalAmount || 0).toLocaleString()}`);
      console.log("");
    });

  // 정산 페이지 표시 예상
  const willShowInSettlement = matched.filter(o =>
    (o.status === '출고완료' || o.status === '발주확정') && o.shipDate
  );
  const notShown = matched.filter(o =>
    !((o.status === '출고완료' || o.status === '발주확정') && o.shipDate)
  );

  console.log("━━━ 정산 페이지 표시 예상 ━━━");
  console.log(`✅ 표시됨: ${willShowInSettlement.length}건`);
  console.log(`⚠️ 안 뜸: ${notShown.length}건`);
  if (notShown.length > 0) {
    console.log("\n[안 뜨는 이유]");
    notShown.forEach(o => {
      const reasons = [];
      if (o.status !== '출고완료' && o.status !== '발주확정') reasons.push(`상태=${o.status}`);
      if (!o.shipDate) reasons.push("shipDate 없음");
      console.log(`  ${o.orderNum} → ${reasons.join(", ")}`);
    });
  }
  console.log("\n※ 추가로 정산 페이지의 '시작일~종료일' 필터 범위 안이어야 표시됩니다.\n");
})().catch(e => {
  console.error("실패:", e.message);
  process.exit(1);
});
