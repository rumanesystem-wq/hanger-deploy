// ─────────────────────────────────────────────────────────────
// recover-order.js — _backups 컬렉션에서 사라진 발주서 추적
// 사용:  node functions/recover-order.js 20260608
//        node functions/recover-order.js 265           (발주 ID)
// 동작:  _backups 컬렉션 모든 문서를 재귀 탐색해서 매칭 발주서 찾기
//        찾으면 전체 내용 출력 + recover-output.json 으로 저장
// 읽기 전용 (수정 안 함)
// ─────────────────────────────────────────────────────────────

const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

admin.initializeApp({projectId: "tooktakproject"});
const db = admin.firestore();

const query = (process.argv[2] || "").trim();
if (!query) {
  console.log("사용법: node functions/recover-order.js <발주번호 또는 발주ID>");
  process.exit(1);
}

// 재귀적으로 객체를 돌면서 orderNum/id 가 매칭되는 발주서 객체 찾기
function findOrdersInTree(node, pathLabel, hits) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((item, i) => {
      // 배열 원소가 발주서처럼 보이면 매칭 검사
      if (item && typeof item === "object") {
        const num = String(item.orderNum || "");
        const id = String(item.id || "");
        if ((num && num.includes(query)) || (id && id === query)) {
          hits.push({path: `${pathLabel}[${i}]`, order: item});
        }
        findOrdersInTree(item, `${pathLabel}[${i}]`, hits);
      }
    });
  } else {
    for (const [k, v] of Object.entries(node)) {
      findOrdersInTree(v, pathLabel ? `${pathLabel}.${k}` : k, hits);
    }
  }
}

(async () => {
  console.log(`\n━━━ _backups 안에서 "${query}" 재귀 추적 ━━━\n`);

  const backupCol = await db.collection("_backups").listDocuments();
  console.log(`백업 문서 ${backupCol.length}개\n`);

  const allFound = [];
  const ordersCountByBackup = {};

  for (const ref of backupCol) {
    const doc = await ref.get();
    if (!doc.exists) continue;
    const data = doc.data();

    // 백업 안 발주서 총 개수 추정 (배열 길이 합)
    let orderCount = 0;
    const countArr = (n) => {
      if (Array.isArray(n)) {
        n.forEach((x) => {
          if (x && typeof x === "object" && x.orderNum) orderCount++;
          countArr(x);
        });
      } else if (n && typeof n === "object") {
        Object.values(n).forEach(countArr);
      }
    };
    countArr(data);
    ordersCountByBackup[ref.id] = orderCount;

    const hits = [];
    findOrdersInTree(data, "", hits);

    if (hits.length > 0) {
      console.log(`📦 ${ref.id} — 매칭 ${hits.length}건 (총 ${orderCount}건 안에서)`);
      hits.forEach((h) => {
        const o = h.order;
        console.log(`   ✅ ${h.path}`);
        console.log(`      id=${o.id} | ${o.orderNum} | ${o.status} | ${o.deliveryTo} | 발주일 ${o.orderDate}`);
        allFound.push({backupId: ref.id, path: h.path, order: o});
      });
    } else {
      console.log(`📦 ${ref.id} — 매칭 없음 (총 ${orderCount}건 탐색)`);
    }
  }

  console.log(`\n━━━ 총 매칭 ${allFound.length}건 ━━━`);

  if (allFound.length > 0) {
    const outPath = path.join(__dirname, "recover-output.json");
    fs.writeFileSync(outPath, JSON.stringify(allFound, null, 2), "utf8");
    console.log(`\n💾 전체 데이터 저장됨: ${outPath}`);

    // 가장 최신 백업 기준 unique 발주서
    const uniqueLatest = {};
    allFound.forEach((f) => {
      const k = f.order.orderNum || f.order.id;
      if (!uniqueLatest[k] || f.backupId > uniqueLatest[k].backupId) {
        uniqueLatest[k] = f;
      }
    });
    console.log(`\n📋 유니크 발주서 ${Object.keys(uniqueLatest).length}건:`);
    Object.values(uniqueLatest).forEach((f) => {
      console.log(`   · ${f.order.orderNum} | ${f.order.status} | ${f.order.deliveryTo} | 발주일 ${f.order.orderDate} | 백업출처: ${f.backupId}`);
    });
  } else {
    console.log("\n백업에서도 찾을 수 없음.");
    console.log("\n[참고] 백업별 발주서 개수:");
    Object.entries(ordersCountByBackup).forEach(([k, v]) => {
      console.log(`   ${k}: ${v}건`);
    });
  }

  process.exit(0);
})().catch((e) => {
  console.error("\n오류:", e.message);
  process.exit(1);
});
