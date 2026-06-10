// ─────────────────────────────────────────────────────────────
// do-restore.js — 발주서 복구 실행 (2단계)
// 사용: node functions/do-restore.js
// 순서:
//   ① 현재 orders 를 _backups/2026-06-10-pre-restore 로 안전망 백업
//   ② recover-output.json 에서 복구 대상 3건 로드
//   ③ 현재 orders.value 에 ID 순서대로 끼워넣기 (중복 안전 가드)
//   ④ orders 문서에 write (updatedAt 갱신)
//   ⑤ 결과 검증 — 현재 N건 → N+3건 확인
// ─────────────────────────────────────────────────────────────

const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

admin.initializeApp({projectId: "tooktakproject"});
const db = admin.firestore();

(async () => {
  console.log("\n━━━ 발주서 복구 실행 ━━━\n");

  // 복구 대상 로드
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
  const targets = Object.values(uniq).map((f) => f.order).sort((a, b) => a.id - b.id);
  console.log(`복구 대상 ${targets.length}건:`);
  targets.forEach((o) => console.log(`  · id=${o.id} | ${o.orderNum} | ${o.deliveryTo}`));

  // ① 안전망 백업
  console.log("\n[1] 현재 orders 안전망 백업");
  const ordersRef = db.collection("hanger_data").doc("orders");
  const curSnap = await ordersRef.get();
  if (!curSnap.exists) {
    console.error("   ❌ orders 문서 없음. 중단.");
    process.exit(1);
  }
  const curData = curSnap.data();
  const curArr = curData.value || [];
  console.log(`   현재 orders.value: ${curArr.length}건`);

  const safetyBackupId = "2026-06-10-pre-restore";
  await db.collection("_backups").doc(safetyBackupId).set({
    data: {orders: {value: curArr, updatedAt: curData.updatedAt}},
    backedUpAt: admin.firestore.FieldValue.serverTimestamp(),
    note: "발주 #265,266,267 복구 직전 안전망 백업",
  });
  console.log(`   ✅ 백업됨: _backups/${safetyBackupId}`);

  // ② 중복 안전 가드 — 만에 하나 충돌 있으면 중단
  const curIds = new Set(curArr.map((o) => o.id));
  const curNums = new Set(curArr.map((o) => o.orderNum));
  const collision = targets.find((o) => curIds.has(o.id) || curNums.has(o.orderNum));
  if (collision) {
    console.error(`   ❌ 막판 충돌 감지 (id=${collision.id}, num=${collision.orderNum}). 안전 중단.`);
    console.error("   → 검증 단계와 실제 쓰기 사이 누가 또 발주서 만든 듯. 다시 재확인 필요.");
    process.exit(1);
  }

  // ③ 끼워넣기 — id 순서대로 정렬되도록 위치 계산
  console.log("\n[2] 발주서 삽입 위치 계산");
  const newArr = [...curArr];
  for (const o of targets) {
    // id 순서 유지: 자기 id 보다 큰 첫 항목 앞에 삽입
    let insertAt = newArr.findIndex((x) => (x.id || 0) > o.id);
    if (insertAt === -1) insertAt = newArr.length;
    newArr.splice(insertAt, 0, o);
    console.log(`   · ${o.orderNum} (id=${o.id}) → 위치 ${insertAt} 에 삽입`);
  }
  console.log(`   삽입 후 ${newArr.length}건 (이전 ${curArr.length}건)`);

  // ④ 실제 write
  console.log("\n[3] orders 문서에 write");
  await ordersRef.set({
    value: newArr,
    updatedAt: new Date().toISOString(),
  }, {merge: true});
  console.log("   ✅ write 완료");

  // ⑤ 결과 검증
  console.log("\n[4] write 결과 검증");
  const verifySnap = await ordersRef.get();
  const verifyArr = (verifySnap.data() && verifySnap.data().value) || [];
  console.log(`   현재 orders.value: ${verifyArr.length}건`);
  const restored = verifyArr.filter((o) => targets.find((t) => t.orderNum === o.orderNum));
  console.log(`   복구된 발주서 확인: ${restored.length}/${targets.length}건`);
  restored.forEach((o) => console.log(`     ✅ ${o.orderNum} | ${o.status} | ${o.deliveryTo}`));

  if (restored.length === targets.length) {
    console.log("\n🎉 복구 완료!");
    console.log("\n다음 액션:");
    console.log("  1. 앱에서 강제 새로고침(Ctrl+Shift+R)");
    console.log("  2. 발주 목록 → 6월 8일 발주서 3건 보이는지 확인");
    console.log("  3. 김근수님께 확인 요청");
  } else {
    console.log("\n⚠️ 일부 복구 누락. 위 결과 확인 후 재실행 필요.");
  }

  process.exit(0);
})().catch((e) => {
  console.error("\n오류:", e.message);
  process.exit(1);
});
