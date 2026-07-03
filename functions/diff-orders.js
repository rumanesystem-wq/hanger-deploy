// ─────────────────────────────────────────────────────────────
// diff-orders.js — 옛/새 경로 차집합 발주서 진단
// 사용: cd functions && node diff-orders.js
// 읽기 전용 — 운영 데이터 변경 0
// ─────────────────────────────────────────────────────────────

const admin = require("firebase-admin");
admin.initializeApp({ projectId: "tooktakproject" });
const db = admin.firestore();

(async () => {
  console.log("\n━━━ 발주서 차집합 진단 ━━━\n");

  // 옛 경로
  const oldDoc = await db.collection("hanger_data").doc("orders").get();
  const oldArr = oldDoc.exists ? (oldDoc.data().value || []) : [];
  const oldIds = new Set(oldArr.filter(o => o && o.id != null).map(o => o.id));
  console.log(`[옛] hanger_data/orders: ${oldArr.length}건, 고유 id ${oldIds.size}개`);

  // 새 경로
  const newSnap = await db.collection("hanger_orders").get();
  const newDocs = [];
  newSnap.docs.forEach(d => {
    const data = d.data();
    if (data && data.id != null) newDocs.push({ docId: d.id, ...data });
  });
  const newIds = new Set(newDocs.map(d => d.id));
  console.log(`[새] hanger_orders: ${newDocs.length}건, 고유 id ${newIds.size}개`);

  // 차집합
  const onlyOld = [...oldIds].filter(id => !newIds.has(id));
  const onlyNew = [...newIds].filter(id => !oldIds.has(id));
  console.log(`\n  옛 전용: ${onlyOld.length}건${onlyOld.length ? " → " + onlyOld.join(", ") : ""}`);
  console.log(`  새 전용: ${onlyNew.length}건${onlyNew.length ? " → " + onlyNew.join(", ") : ""}`);

  // 새 전용 상세
  if (onlyNew.length > 0) {
    console.log("\n[새 전용 발주서 상세] (옛 경로에 빠진 것)\n");
    onlyNew.forEach(id => {
      const o = newDocs.find(d => d.id === id);
      if (!o) return;
      console.log(`  ─ id ${id} | ${o.orderNum || "?"}`);
      console.log(`     상태:   ${o.status || "?"}`);
      console.log(`     납품처: ${o.deliveryTo || "?"}`);
      console.log(`     주소:   ${(o.address || "?").slice(0, 40)}`);
      console.log(`     발주일: ${o.orderDate || "?"}`);
      console.log(`     생성자: ${o.createdBy || "?"}`);
      console.log(`     생성:   ${(o.createdAt || "?").slice(0, 19)}`);
      console.log(`     수정:   ${(o.updatedAt || "?").slice(0, 19)}`);
      console.log(`     docId:  ${o.docId}`);
      console.log("");
    });
  }

  // 옛 경로 doc 크기 추정 (1MB 한계 확인)
  const oldSize = Buffer.byteLength(JSON.stringify({ value: oldArr }), "utf8");
  console.log(`[참고] 옛 경로 doc 크기: ${(oldSize / 1024).toFixed(1)} KB (1MB 한계: ${(1048576/1024).toFixed(0)} KB)`);
  if (oldSize > 800000) {
    console.log(`  ⚠️  옛 경로가 800KB 초과 — 1MB 한계 임박. 신규 발주 시 set 실패 가능성 높음.`);
  }

  console.log("\n━━━ 진단 완료 (운영 데이터 변경 0) ━━━\n");
})().catch(e => {
  console.error("실패:", e.message);
  process.exit(1);
});
