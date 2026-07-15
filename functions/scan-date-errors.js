// ─────────────────────────────────────────────────────────────
// scan-date-errors.js — 전체 발주서에서 잘못된 날짜 필드 스캔
// 사용:  cd functions && node scan-date-errors.js
// 검출: shipDate/orderDate/createdAt/updatedAt의 년도 이상값
// 읽기 전용 — 운영 데이터 변경 0
// ─────────────────────────────────────────────────────────────

const admin = require("firebase-admin");
admin.initializeApp({ projectId: "tooktakproject" });
const db = admin.firestore();

// 정상 년도 범위 (2020 ~ 2030 정도가 안전)
const YEAR_MIN = 2020;
const YEAR_MAX = 2030;

function parseYear(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const m = dateStr.match(/^(\d{4})-\d{2}-\d{2}/);
  if (!m) return null;
  return parseInt(m[1], 10);
}

function isBadYear(year) {
  return year !== null && (year < YEAR_MIN || year > YEAR_MAX);
}

(async () => {
  console.log("\n━━━ 전체 발주서 날짜 오류 스캔 ━━━\n");

  // hanger_data/orders (옛 경로)
  const oldDoc = await db.collection("hanger_data").doc("orders").get();
  const oldArr = oldDoc.exists ? (oldDoc.data().value || []) : [];
  console.log(`전체 발주서: ${oldArr.length}건 (hanger_data/orders)`);

  // 필드별 카운트
  const stats = {
    shipDate: { bad: [], missing: [] },
    orderDate: { bad: [], missing: [] },
    createdAt: { bad: [] },
    updatedAt: { bad: [] },
  };

  oldArr.forEach(o => {
    if (!o) return;
    const info = {
      id: o.id,
      orderNum: o.orderNum,
      deliveryTo: o.deliveryTo,
      status: o.status,
      shipDate: o.shipDate,
      orderDate: o.orderDate,
      createdAt: (o.createdAt || '').slice(0, 10),
      updatedAt: (o.updatedAt || '').slice(0, 10),
    };

    // shipDate
    const shipYear = parseYear(o.shipDate);
    if (isBadYear(shipYear)) stats.shipDate.bad.push(info);
    else if (!o.shipDate && (o.status === '출고완료' || o.status === '발주확정')) {
      stats.shipDate.missing.push(info);
    }

    // orderDate
    const orderYear = parseYear(o.orderDate);
    if (isBadYear(orderYear)) stats.orderDate.bad.push(info);
    else if (!o.orderDate) stats.orderDate.missing.push(info);

    // createdAt/updatedAt (ISO 형식이라 앞 4자리 확인)
    if (o.createdAt) {
      const y = parseInt((o.createdAt || '').slice(0, 4), 10);
      if (y && (y < YEAR_MIN || y > YEAR_MAX)) stats.createdAt.bad.push(info);
    }
    if (o.updatedAt) {
      const y = parseInt((o.updatedAt || '').slice(0, 4), 10);
      if (y && (y < YEAR_MIN || y > YEAR_MAX)) stats.updatedAt.bad.push(info);
    }
  });

  // 결과
  console.log(`\n[shipDate 년도 오류] ${stats.shipDate.bad.length}건`);
  if (stats.shipDate.bad.length > 0) {
    stats.shipDate.bad.forEach(o => {
      console.log(`  ${o.orderNum || '#'+o.id} | ${o.status} | 납품처: ${o.deliveryTo} | shipDate=${o.shipDate}`);
    });
  }

  console.log(`\n[shipDate 누락 - 발주확정/출고완료인데 없음] ${stats.shipDate.missing.length}건`);
  if (stats.shipDate.missing.length > 0) {
    stats.shipDate.missing.slice(0, 10).forEach(o => {
      console.log(`  ${o.orderNum || '#'+o.id} | ${o.status} | 납품처: ${o.deliveryTo}`);
    });
    if (stats.shipDate.missing.length > 10) console.log(`  ... 외 ${stats.shipDate.missing.length - 10}건`);
  }

  console.log(`\n[orderDate 년도 오류] ${stats.orderDate.bad.length}건`);
  if (stats.orderDate.bad.length > 0) {
    stats.orderDate.bad.forEach(o => {
      console.log(`  ${o.orderNum || '#'+o.id} | ${o.status} | 납품처: ${o.deliveryTo} | orderDate=${o.orderDate}`);
    });
  }

  console.log(`\n[orderDate 누락] ${stats.orderDate.missing.length}건`);
  if (stats.orderDate.missing.length > 0) {
    stats.orderDate.missing.slice(0, 5).forEach(o => {
      console.log(`  ${o.orderNum || '#'+o.id} | ${o.status} | 납품처: ${o.deliveryTo}`);
    });
    if (stats.orderDate.missing.length > 5) console.log(`  ... 외 ${stats.orderDate.missing.length - 5}건`);
  }

  console.log(`\n[createdAt/updatedAt 년도 오류]`);
  console.log(`  createdAt 오류: ${stats.createdAt.bad.length}건`);
  console.log(`  updatedAt 오류: ${stats.updatedAt.bad.length}건`);

  // 오류 발주서의 납품처 요약
  const badOrders = [...stats.shipDate.bad, ...stats.orderDate.bad];
  const uniqueOrders = [...new Set(badOrders.map(o => o.orderNum))];
  const customers = [...new Set(badOrders.map(o => o.deliveryTo))];
  console.log(`\n━━━ 요약 ━━━`);
  console.log(`문제 발주서: ${uniqueOrders.length}건 (${badOrders.length}개 필드 오류)`);
  console.log(`영향받은 납품처: ${customers.length}곳`);
  console.log(`\n[납품처 목록]`);
  customers.forEach(c => {
    const count = badOrders.filter(o => o.deliveryTo === c).length;
    console.log(`  ${c}: ${count}건`);
  });
  console.log("\n※ 데이터 변경 없음. 진단만.\n");
})().catch(e => {
  console.error("실패:", e.message);
  process.exit(1);
});
