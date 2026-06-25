// ─────────────────────────────────────────────────────────────
// add-test-order.js — 에뮬레이터에 테스트 발주서 1건 추가
// 사용: MSYS_NO_PATHCONV=1 docker exec hanger-emu node /home/node/functions/add-test-order.js
// ─────────────────────────────────────────────────────────────

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';

const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'tooktakproject' });
const db = admin.firestore();

async function main() {
  console.log('━━━ 테스트 발주서 추가 ━━━\n');

  // 오늘 날짜로 발주번호 생성
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const dateStr = `${y}-${m}-${d}`;
  const shipDate = new Date(Date.now() + 86400000);
  const sy = shipDate.getFullYear();
  const sm = String(shipDate.getMonth() + 1).padStart(2, '0');
  const sd = String(shipDate.getDate()).padStart(2, '0');

  // 기존 orders 가져와서 그날 시퀀스 결정
  const ordersDoc = await db.collection('hanger_data').doc('orders').get();
  const existing = ordersDoc.exists ? (ordersDoc.data().value || []) : [];
  const prefix = `${y}${m}${d}`;
  const sameDay = existing.filter(o => o.orderNum && o.orderNum.startsWith(prefix));
  const seq = sameDay.length + 1;
  const orderNum = `${prefix}-${String(seq).padStart(3, '0')}`;

  // 발주 ID (전체 시퀀스)
  const maxId = existing.reduce((m, o) => Math.max(m, o.id || 0), 0);
  const newId = maxId + 1;

  // 테스트 발주서 객체
  const order = {
    id: newId,
    orderNum,
    deliveryTo: '테스트업체',
    address: '테스트 시공주소',
    orderDate: dateStr,
    shipDate: `${sy}-${sm}-${sd}`,
    warehouse: '시흥',
    note: 'AI 자동 생성 테스트 발주서',
    status: '발주대기',
    statusHistory: [
      { status: '발주대기', changedAt: new Date().toISOString(), note: '신규 등록' }
    ],
    // 상부자재 — 포스트바 2400 × 2
    upperMaterials: [
      { name: '포스트바 2400', color: '화이트', qty: 2, unitPrice: 12000 }
    ],
    upperCommonColor: '화이트',
    // 선반 — 770 × 1
    shelfItems: [
      {
        name: '선반 770',
        entries: [
          { color: '메이플', size: '770', qty: 1, unitPrice: 5300 }
        ]
      }
    ],
    // 서랍 — 겉서랍 2단 × 1
    drawerItems: [
      {
        id: Date.now(),
        itemId: 1,
        displayName: '겉서랍 2단',
        itemName: '겉서랍 2단',
        color: '솔리드',
        requiredQty: 1,
        shortageQty: 0,
        unitPrice: 69000,
        warehouse: '시흥',
        orderId: newId,
        createdAt: new Date().toISOString()
      }
    ],
    sharedColor: '솔리드',
    // 옷봉 — rod2400 1개
    rod2400Required: 1,
    rodItems: [{ qty: 1, size: '700' }],
    rodTotalLen: 700,
    rodAmount: 5000,
    rodVat: 500,
    // 합계
    totalSupply: 24000 + 5300 + 69000 + 5000,  // 103,300
    totalVat: 2400 + 530 + 6900 + 500,           // 10,330
    totalAmount: 0,                              // 아래에서 계산
    createdBy: 'admin',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  order.totalAmount = order.totalSupply + order.totalVat;

  // orders 배열에 추가
  const newOrders = [...existing, order];
  await db.collection('hanger_data').doc('orders').set({
    value: newOrders,
    updatedAt: new Date().toISOString()
  });

  // 신경로 (hanger_orders) 단건 저장 — Phase 1 듀얼 라이트
  await db.collection('hanger_orders').doc(orderNum).set(order);

  console.log(`✓ 발주서 추가됨`);
  console.log(`  발주번호: ${orderNum}`);
  console.log(`  발주ID:   ${newId}`);
  console.log(`  거래처:   ${order.deliveryTo}`);
  console.log(`  품목:     상부자재 1 + 선반 1 + 서랍 1 + 옷봉 1`);
  console.log(`  합계:     ${order.totalAmount.toLocaleString()}원`);
  console.log(`\n앱에서 확인: http://localhost:5050`);
}

main().then(() => process.exit(0)).catch(e => {
  console.error('실패:', e.message);
  process.exit(1);
});
