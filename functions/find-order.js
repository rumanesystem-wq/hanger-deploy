// ─────────────────────────────────────────────────────────────
// find-order.js — 발주서 추적 도구
// 사용:  node functions/find-order.js 20260608
//        node functions/find-order.js 20260608-001
// 동작:  Firestore의 hanger_data 컬렉션 전체에서
//        해당 발주번호/날짜 관련 흔적을 모두 추적
//   ① orders.value 배열 안 검색
//   ② orderseq_<날짜> 발급 카운터
//   ③ logs 배열에서 흔적 (memo/orderNum/createdAt)
//   ④ _backups 컬렉션에 백업 있나
//   ⑤ statusHistory 안 변경 이력
// 읽기 전용 — 어떤 데이터도 수정하지 않음
// ─────────────────────────────────────────────────────────────

const admin = require("firebase-admin");

// 인증: Firebase CLI 로그인된 사용자의 ADC 사용 (firebase login 필요)
admin.initializeApp({projectId: "tooktakproject"});
const db = admin.firestore();

const query = (process.argv[2] || "").trim();
if (!query) {
  console.log("사용법: node functions/find-order.js <발주번호 또는 날짜>");
  console.log("예시:   node functions/find-order.js 20260608");
  console.log("        node functions/find-order.js 20260608-001");
  process.exit(1);
}

(async () => {
  console.log(`\n━━━ "${query}" 추적 시작 ━━━\n`);

  // ① orders 본체 검색
  console.log("[1] orders 본체 검색");
  try {
    const ordersDoc = await db.collection("hanger_data").doc("orders").get();
    if (!ordersDoc.exists) {
      console.log("   ❌ orders 문서 자체가 없음");
    } else {
      const arr = ordersDoc.data().value || [];
      const found = arr.filter((o) => (o.orderNum || "").includes(query));
      console.log(`   전체 발주서 ${arr.length}건 중 매칭 ${found.length}건`);
      if (found.length > 0) {
        found.forEach((o) => {
          console.log(`   ✅ ${o.orderNum} | ${o.status} | ${o.deliveryTo} | 발주일 ${o.orderDate} | 생성 ${(o.createdAt || "").slice(0, 16)}`);
        });
      } else {
        console.log("   ❌ orders.value 배열 안에 없음");
      }
    }
  } catch (e) {
    console.log("   ⚠️ 읽기 실패:", e.message);
  }

  // ② orderseq 카운터
  console.log("\n[2] orderseq 발급 카운터");
  const datePart = query.split("-")[0];
  try {
    const seqDoc = await db.collection("hanger_data").doc("orderseq_" + datePart).get();
    if (seqDoc.exists) {
      const d = seqDoc.data();
      console.log(`   ✅ orderseq_${datePart} 존재 — value: ${d.value} (= 그날 발급된 번호 개수)`);
      console.log(`     updatedAt: ${d.updatedAt}`);
    } else {
      console.log(`   ❌ orderseq_${datePart} 없음 (그날 발급된 번호 0개)`);
    }
  } catch (e) {
    console.log("   ⚠️ 읽기 실패:", e.message);
  }

  // ③ logs 흔적
  console.log("\n[3] logs 흔적 검색");
  try {
    const logsDoc = await db.collection("hanger_data").doc("logs").get();
    if (logsDoc.exists) {
      const arr = logsDoc.data().value || [];
      const found = arr.filter((l) =>
        (l.memo || "").includes(query) ||
        (l.orderNum || "").includes(query) ||
        (l.createdAt || "").startsWith("2026-" + datePart.slice(4, 6) + "-" + datePart.slice(6, 8))
      );
      console.log(`   전체 로그 ${arr.length}건 중 매칭 ${found.length}건`);
      found.slice(0, 20).forEach((l) => {
        console.log(`   · ${(l.createdAt || "").slice(0, 16)} | ${l.type} | qty=${l.qty} | ${l.memo || "-"}`);
      });
      if (found.length > 20) console.log(`   ... 외 ${found.length - 20}건`);
    } else {
      console.log("   ❌ logs 문서 없음");
    }
  } catch (e) {
    console.log("   ⚠️ 읽기 실패:", e.message);
  }

  // ④ _backups 컬렉션
  console.log("\n[4] _backups 컬렉션 검사");
  try {
    const snap = await db.collection("_backups").listDocuments();
    if (snap.length === 0) {
      console.log("   ❌ _backups 비어있음");
    } else {
      console.log(`   _backups 문서 ${snap.length}개 발견`);
      for (const ref of snap.slice(0, 30)) {
        console.log(`   · ${ref.id}`);
      }
      // orders 관련 백업 안 내용 검색
      const relatedIds = snap.map((r) => r.id).filter((id) =>
        id.includes("orders") || id.includes(datePart) || id.includes(datePart.slice(0, 6))
      );
      if (relatedIds.length > 0) {
        console.log(`\n   📦 orders/날짜 관련 백업 ${relatedIds.length}개 — 내용 검색:`);
        for (const id of relatedIds.slice(0, 5)) {
          const bDoc = await db.collection("_backups").doc(id).get();
          if (!bDoc.exists) continue;
          const data = bDoc.data();
          // value 배열을 가졌으면 검색
          const arr = data.value || data.orders || [];
          if (Array.isArray(arr)) {
            const hit = arr.filter((o) => (o.orderNum || "").includes(query));
            if (hit.length > 0) {
              console.log(`     ✅ ${id} 안에서 매칭 ${hit.length}건`);
              hit.forEach((o) => {
                console.log(`        · ${o.orderNum} | ${o.status} | ${o.deliveryTo} | 발주일 ${o.orderDate}`);
              });
            } else {
              console.log(`     · ${id} (${arr.length}건) — 매칭 없음`);
            }
          }
        }
      }
    }
  } catch (e) {
    console.log("   ⚠️ _backups 읽기 실패 (없을 수도 있음):", e.message);
  }

  // ⑤ statusHistory 안 다른 발주서들에 있는 발주번호 흔적
  console.log("\n[5] 다른 발주서의 statusHistory 안 흔적");
  try {
    const ordersDoc = await db.collection("hanger_data").doc("orders").get();
    if (ordersDoc.exists) {
      const arr = ordersDoc.data().value || [];
      const hits = [];
      arr.forEach((o) => {
        const hist = o.statusHistory || [];
        hist.forEach((h) => {
          const blob = JSON.stringify(h);
          if (blob.includes(query)) hits.push({orderNum: o.orderNum, hist: h});
        });
      });
      console.log(`   매칭 ${hits.length}건`);
      hits.slice(0, 10).forEach((h) => {
        console.log(`   · ${h.orderNum}의 이력 → ${h.hist.changedAt} ${h.hist.status} (${h.hist.note || "-"})`);
      });
    }
  } catch (e) {
    console.log("   ⚠️ 읽기 실패:", e.message);
  }

  console.log("\n━━━ 추적 끝 ━━━");
  process.exit(0);
})().catch((e) => {
  console.error("\n오류:", e.message);
  process.exit(1);
});