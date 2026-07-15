// ─────────────────────────────────────────────────────────────
// backup-orders.js — 운영 발주서 전체 스냅샷 백업 (읽기 전용)
// 사용:  cd functions && node backup-orders.js
// 저장:  ../.ai-backups/YYYYMMDD/orders-backup-<ts>.json
// 대상:  hanger_data/orders (옛 배열) + hanger_orders (신 컬렉션) 둘 다
// 안전:  DB 변경 0, 순수 export
// ─────────────────────────────────────────────────────────────

const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

admin.initializeApp({ projectId: "tooktakproject" });
const db = admin.firestore();

function pad(n) { return String(n).padStart(2, '0'); }
function nowStamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
function dayStamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}`;
}

(async () => {
  console.log("\n━━━ 운영 발주서 백업 시작 ━━━\n");

  // 1) 옛 배열 저장소
  console.log("[1/2] hanger_data/orders 읽는 중...");
  const oldDoc = await db.collection("hanger_data").doc("orders").get();
  const oldArr = oldDoc.exists ? (oldDoc.data().value || []) : [];
  console.log(`  → ${oldArr.length}건`);

  // 2) 신 컬렉션 저장소
  console.log("[2/2] hanger_orders 컬렉션 읽는 중...");
  const snap = await db.collection("hanger_orders").get();
  const newArr = [];
  snap.forEach(d => newArr.push({ _docId: d.id, ...d.data() }));
  console.log(`  → ${newArr.length}건`);

  // 백업 대상 폴더 (프로젝트 루트/.ai-backups/YYYYMMDD/)
  const backupDir = path.resolve(__dirname, "..", ".ai-backups", dayStamp());
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  const ts = nowStamp();
  const payload = {
    backupAt: new Date().toISOString(),
    project: "tooktakproject",
    counts: {
      "hanger_data.orders": oldArr.length,
      "hanger_orders": newArr.length,
    },
    "hanger_data.orders": oldArr,
    "hanger_orders": newArr,
  };

  const filePath = path.join(backupDir, `orders-backup-${ts}.json`);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");

  const stat = fs.statSync(filePath);
  console.log("\n━━━ 백업 완료 ━━━");
  console.log(`파일:   ${filePath}`);
  console.log(`크기:   ${(stat.size / 1024).toFixed(1)} KB`);
  console.log(`옛 배열: ${oldArr.length}건`);
  console.log(`신 컬렉션: ${newArr.length}건`);
  console.log("\n※ DB 변경 없음. 스냅샷만 저장.\n");
})().catch(e => {
  console.error("실패:", e && e.message);
  process.exit(1);
});
