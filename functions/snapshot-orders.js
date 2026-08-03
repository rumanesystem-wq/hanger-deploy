// ─────────────────────────────────────────────────────────────
// snapshot-orders.js — 발주서 일회성 백업 스냅샷
// 사용: cd functions && node snapshot-orders.js [YYYYMMDD]
//   YYYYMMDD 생략 시 오늘 날짜 사용
// 읽기: hanger_orders (신 컬렉션) + hanger_data/orders (옛 배열) 병합
// 쓰기: hanger_orders_backup_YYYYMMDD/{orderNum} (별도 컬렉션 — 기존 데이터 미영향)
// 안전: 대상 컬렉션이 이미 존재하면 abort (덮어쓰기 방지)
// ─────────────────────────────────────────────────────────────

const admin = require("firebase-admin");
admin.initializeApp({ projectId: "tooktakproject" });
const db = admin.firestore();

async function main() {
  const arg = (process.argv[2] || "").trim();
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const dateKey = /^\d{8}$/.test(arg) ? arg : `${y}${m}${d}`;
  const backupCol = `hanger_orders_backup_${dateKey}`;

  console.log(`\n━━━ 발주서 스냅샷 백업 (${dateKey}) ━━━\n`);
  console.log(`대상 컬렉션: ${backupCol}\n`);

  // 안전: 이미 존재하면 중단
  const existing = await db.collection(backupCol).limit(1).get();
  if (!existing.empty) {
    console.error(`❌ 컬렉션 ${backupCol} 이미 존재 (문서 있음). 중단.`);
    console.error(`   다른 날짜 인자로 재실행하거나, 기존 백업 확인 후 진행.`);
    process.exit(1);
  }

  // 1) 새 경로에서 전량 로드
  console.log("[1/3] hanger_orders 컬렉션 로드 중...");
  const newSnap = await db.collection("hanger_orders").get();
  const byId = new Map();
  const byOrderNum = new Map();
  newSnap.docs.forEach(docSnap => {
    const data = docSnap.data();
    if (!data || data.id == null || !data.orderNum) return;
    byId.set(data.id, data);
    byOrderNum.set(String(data.orderNum), data);
  });
  console.log(`   → ${byOrderNum.size}건 로드`);

  // 2) 옛 경로도 병합 (혹시 옛에만 있는 게 있으면 함께 백업)
  console.log("[2/3] hanger_data/orders 옛 배열도 확인 중...");
  const oldDoc = await db.collection("hanger_data").doc("orders").get();
  const oldArr = oldDoc.exists ? (oldDoc.data().value || []) : [];
  let mergedFromOld = 0;
  oldArr.forEach(o => {
    if (!o || o.id == null || !o.orderNum) return;
    const key = String(o.orderNum);
    if (!byOrderNum.has(key)) {
      byOrderNum.set(key, o);
      mergedFromOld++;
    }
  });
  console.log(`   → 옛 배열 ${oldArr.length}건, 새에 없어 병합된 것 ${mergedFromOld}건`);

  const totalToBackup = byOrderNum.size;
  console.log(`\n[3/3] ${totalToBackup}건을 ${backupCol}로 백업 중...`);

  // 3) 배치 write (500 doc 제한)
  const entries = [...byOrderNum.entries()];
  const BATCH_SIZE = 400;
  let done = 0;
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = entries.slice(i, i + BATCH_SIZE);
    chunk.forEach(([orderNum, data]) => {
      const ref = db.collection(backupCol).doc(String(orderNum));
      batch.set(ref, {
        ...data,
        _backupAt: new Date().toISOString(),
        _backupSource: "snapshot-orders.js"
      });
    });
    await batch.commit();
    done += chunk.length;
    console.log(`   → ${done}/${totalToBackup} 커밋`);
  }

  // 4) 메타 문서
  await db.collection("hanger_data").doc(`backup_meta_${dateKey}`).set({
    collectionName: backupCol,
    orderCount: totalToBackup,
    sourceNewCount: byOrderNum.size - mergedFromOld,
    sourceOldMergedCount: mergedFromOld,
    createdAt: new Date().toISOString(),
    script: "snapshot-orders.js"
  });

  console.log(`\n━━━ 백업 완료 ━━━`);
  console.log(`컬렉션: ${backupCol}`);
  console.log(`문서 수: ${totalToBackup}건`);
  console.log(`메타: hanger_data/backup_meta_${dateKey}`);
  console.log(`\n복원 필요 시: 해당 컬렉션을 hanger_orders로 복사하면 됨.\n`);
}

main().catch(e => {
  console.error("[snapshot-orders] 실패:", e);
  process.exit(1);
});
