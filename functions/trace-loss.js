// trace-loss.js — 6월 8일 발주서 손실 시점 추적
// _backups 의 각 일자 백업에서 발주서 수 + 최근 변경 흔적 확인
const admin = require("firebase-admin");
admin.initializeApp({projectId: "tooktakproject"});
const db = admin.firestore();

(async () => {
  const refs = await db.collection("_backups").listDocuments();
  refs.sort((a, b) => a.id.localeCompare(b.id));
  console.log("\n=== 일자별 백업 안 발주서 개수 + 6월 8일 3건 포함 여부 ===\n");
  const ids = [265, 266, 267];
  for (const r of refs) {
    const d = (await r.get()).data();
    const arr = (d && d.data && d.data.orders && d.data.orders.value) || [];
    const has = ids.filter((id) => arr.find((o) => o.id === id));
    console.log(`${r.id}: 총 ${arr.length}건, 6월 8일 3건 포함 = ${has.length}/3 ${has.length === 3 ? "✅" : "❌"}`);
  }

  // 현재 orders.updatedAt
  const cur = await db.collection("hanger_data").doc("orders").get();
  console.log(`\n현재 orders.updatedAt: ${cur.data().updatedAt}`);

  // logs 에서 6월 9~10일 사이 모든 write 시각 추적
  const logsDoc = await db.collection("hanger_data").doc("logs").get();
  const logs = (logsDoc.data() && logsDoc.data().value) || [];
  const between = logs.filter((l) => {
    const t = l.createdAt || "";
    return t >= "2026-06-09" && t < "2026-06-10";
  }).sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
  console.log(`\n=== 6월 9일 logs ${between.length}건 (시간순) ===`);
  between.forEach((l) => {
    console.log(`  ${(l.createdAt || "").slice(11, 16)} | ${l.type} | qty=${l.qty} | ${l.memo || "-"} | by ${l.createdBy || "-"}`);
  });

  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
