// ─────────────────────────────────────────────────────────────
// verify-recover.js — 복구 전 안전성 검증 (1단계)
// 사용: node functions/verify-recover.js
// 검사:
//   ① 복구 대상 ID(265,266,267) 현재 orders 에 이미 있나? (충돌 검사)
//   ② 현재 orders 의 최대 ID — 안전한 신규 ID 산정용
//   ③ 백업 발주서의 stockDeducted 상태
//   ④ 현재 재고와 복구 시 영향 추정 (이미 차감됐는지 확인)
//   ⑤ 6월 8일자 logs 와 백업 발주서 품목 비교
// 읽기 전용
// ─────────────────────────────────────────────────────────────

const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

admin.initializeApp({projectId: "tooktakproject"});
const db = admin.firestore();

(async () => {
  console.log("\n━━━ 복구 전 검증 ━━━\n");

  // 백업 파일 로드
  const outPath = path.join(__dirname, "recover-output.json");
  if (!fs.existsSync(outPath)) {
    console.error("recover-output.json 없음. recover-order.js 먼저 실행하세요.");
    process.exit(1);
  }
  const recover = JSON.parse(fs.readFileSync(outPath, "utf8"));
  const uniq = {};
  recover.forEach((f) => {
    const k = f.order.orderNum;
    if (!uniq[k] || f.backupId > uniq[k].backupId) uniq[k] = f;
  });
  const targets = Object.values(uniq).map((f) => f.order);
  console.log(`복구 대상 ${targets.length}건:`);
  targets.forEach((o) => console.log(`  · id=${o.id} | ${o.orderNum} | stockDeducted=${o.stockDeducted}`));

  // 현재 orders
  const cur = await db.collection("hanger_data").doc("orders").get();
  const curArr = (cur.data() && cur.data().value) || [];
  console.log(`\n현재 orders.value: ${curArr.length}건`);

  // ① ID 충돌 검사
  console.log("\n[1] ID 충돌 검사");
  const targetIds = targets.map((o) => o.id);
  const collisions = curArr.filter((o) => targetIds.includes(o.id));
  if (collisions.length > 0) {
    console.log(`   ⚠️ 충돌 ${collisions.length}건 — 다른 발주서가 같은 ID 차지함:`);
    collisions.forEach((o) => {
      console.log(`     · ID ${o.id} 현재 = ${o.orderNum} | ${o.status} | ${o.deliveryTo}`);
    });
    console.log("   → 복구 시 ID 재할당 필요");
  } else {
    console.log(`   ✅ 충돌 없음 — ID ${targetIds.join(",")} 모두 비어있음. 그대로 복구 가능`);
  }

  // ② 현재 최대 ID
  const maxId = curArr.reduce((m, o) => Math.max(m, o.id || 0), 0);
  console.log(`\n[2] 현재 최대 ID: ${maxId} (충돌 시 ${maxId + 1}~ 부터 신규 할당 가능)`);

  // ③ orderNum 충돌 검사
  console.log("\n[3] orderNum 중복 검사");
  const targetNums = targets.map((o) => o.orderNum);
  const numColl = curArr.filter((o) => targetNums.includes(o.orderNum));
  if (numColl.length > 0) {
    console.log(`   ⚠️ orderNum 충돌 ${numColl.length}건:`);
    numColl.forEach((o) => console.log(`     · ${o.orderNum} 이미 존재`));
  } else {
    console.log(`   ✅ orderNum 충돌 없음`);
  }

  // ④ stockDeducted 상태 + 재고 영향
  console.log("\n[4] stockDeducted 상태 & 재고 영향 추정");
  const logsDoc = await db.collection("hanger_data").doc("logs").get();
  const logs = (logsDoc.data() && logsDoc.data().value) || [];

  for (const o of targets) {
    console.log(`\n   📋 ${o.orderNum} (id=${o.id})  stockDeducted=${o.stockDeducted}`);
    // 이 발주서가 만든 발주차감 로그
    const dedLogs = logs.filter((l) =>
      l.type === "발주차감" && (l.memo || "").includes(`발주 #${o.id}`)
    );
    console.log(`     · 발주차감 로그: ${dedLogs.length}건`);
    // 같은 발주가 만든 취소롤백 로그 (있다면 = 누군가 취소했었음)
    const rbLogs = logs.filter((l) =>
      l.type === "취소롤백" && (l.memo || "").includes(`발주 #${o.id}`)
    );
    if (rbLogs.length > 0) {
      console.log(`     · ⚠️ 취소롤백 로그 ${rbLogs.length}건 발견 — 누군가 취소했었음`);
      rbLogs.slice(0, 3).forEach((l) => console.log(`        · ${(l.createdAt || "").slice(0, 16)} | qty=${l.qty} | ${l.memo}`));
    } else {
      console.log(`     · 취소롤백 없음 → 재고는 차감 상태 유지 중 (정상)`);
    }
    // 품목 수 합계
    const drawerCount = (o.drawerItems || []).reduce((s, i) => s + (i.requiredQty || 0), 0);
    const upperCount = (o.upperMaterials || []).reduce((s, i) => s + (i.qty || 0), 0);
    console.log(`     · 서랍 ${drawerCount}개, 상부자재 ${upperCount}개, 총공급 ${(o.totalSupply || 0).toLocaleString()}원`);
  }

  // ⑤ 종합 권고
  console.log("\n[5] 종합 결론");
  const safe = collisions.length === 0 && numColl.length === 0;
  if (safe) {
    console.log("   ✅ 안전하게 복구 가능 — 충돌·중복 없음");
    console.log("   → 2단계 복구 진행 가능 (현재 orders 백업 + 3건 삽입)");
  } else {
    console.log("   ⚠️ 충돌 있음 — 복구 전 ID/orderNum 조정 필요");
  }

  process.exit(0);
})().catch((e) => {
  console.error("\n오류:", e.message);
  process.exit(1);
});
