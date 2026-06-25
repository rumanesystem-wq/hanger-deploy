// ─────────────────────────────────────────────────────────────
// add-bulk-orders.js — 에뮬레이터에 더미 발주서 N건 대량 추가
// 사용: MSYS_NO_PATHCONV=1 docker exec hanger-emu node /home/node/functions/add-bulk-orders.js [건수]
//   기본 30건
// ─────────────────────────────────────────────────────────────

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';

const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'tooktakproject' });
const db = admin.firestore();

const COUNT = parseInt(process.argv[2] || '30', 10);
const CUSTOMERS = ['테스트업체', '테스트A업체', '테스트B업체', '테스트C업체'];
const ADDRESSES = [
  '서울시 강남구 테스트로 1', '경기도 성남시 분당구 정자동 2',
  '인천시 남동구 구월동 3', '대전시 유성구 봉명동 4',
  '부산시 해운대구 우동 5'
];
const COLORS_UPPER = ['화이트', '블랙', '실버', '샴페인골드'];
const COLORS_DRAWER = ['솔리드', '메이플', '다크월넛'];

function rnd(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rndInt(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }

async function main() {
  console.log(`━━━ 더미 발주서 ${COUNT}건 추가 ━━━\n`);

  const ordersDoc = await db.collection('hanger_data').doc('orders').get();
  const existing = ordersDoc.exists ? (ordersDoc.data().value || []) : [];
  let maxId = existing.reduce((m, o) => Math.max(m, o.id || 0), 0);

  // 날짜별 시퀀스 카운트
  const seqByDate = {};
  existing.forEach(o => {
    if (o.orderNum) {
      const date = o.orderNum.split('-')[0];
      seqByDate[date] = (seqByDate[date] || 0) + 1;
    }
  });

  const newOrders = [];

  for (let i = 0; i < COUNT; i++) {
    // 날짜는 최근 30일 중 랜덤
    const daysAgo = rndInt(0, 30);
    const orderDate = new Date(Date.now() - daysAgo * 86400000);
    const y = orderDate.getFullYear();
    const m = String(orderDate.getMonth() + 1).padStart(2, '0');
    const d = String(orderDate.getDate()).padStart(2, '0');
    const prefix = `${y}${m}${d}`;
    seqByDate[prefix] = (seqByDate[prefix] || 0) + 1;
    const orderNum = `${prefix}-${String(seqByDate[prefix]).padStart(3, '0')}`;

    const shipDate = new Date(orderDate.getTime() + rndInt(1, 7) * 86400000);
    const sy = shipDate.getFullYear();
    const sm = String(shipDate.getMonth() + 1).padStart(2, '0');
    const sd = String(shipDate.getDate()).padStart(2, '0');

    maxId++;
    const upperColor = rnd(COLORS_UPPER);
    const drawerColor = rnd(COLORS_DRAWER);
    const postQty = rndInt(1, 5);
    const shelfQty = rndInt(1, 3);
    const drawerQty = rndInt(0, 2);
    const rodQty = rndInt(0, 2);

    const supply = postQty * 12000 + shelfQty * 5300 + drawerQty * 69000 + rodQty * 5000;
    const vat = Math.round(supply * 0.1);

    const status = rnd(['발주대기', '발주확정', '발주확정', '출고완료', '출고완료']);

    const order = {
      id: maxId,
      orderNum,
      deliveryTo: rnd(CUSTOMERS),
      address: rnd(ADDRESSES),
      orderDate: `${y}-${m}-${d}`,
      shipDate: `${sy}-${sm}-${sd}`,
      warehouse: rnd(['시흥', '평택']),
      note: `더미 ${i + 1}번`,
      status,
      statusHistory: [
        { status: '발주대기', changedAt: orderDate.toISOString(), note: '신규 등록' },
        ...(status !== '발주대기' ? [{ status, changedAt: shipDate.toISOString(), note: '' }] : [])
      ],
      upperMaterials: [
        { name: '포스트바 2400', color: upperColor, qty: postQty, unitPrice: 12000 }
      ],
      upperCommonColor: upperColor,
      shelfItems: shelfQty > 0 ? [{
        name: '선반 770',
        entries: [{ color: drawerColor, size: '770', qty: shelfQty, unitPrice: 5300 }]
      }] : [],
      drawerItems: drawerQty > 0 ? [{
        id: Date.now() + i,
        itemId: 1,
        displayName: '겉서랍 2단',
        itemName: '겉서랍 2단',
        color: drawerColor,
        requiredQty: drawerQty,
        shortageQty: 0,
        unitPrice: 69000,
        warehouse: '시흥',
        orderId: maxId,
        createdAt: orderDate.toISOString()
      }] : [],
      sharedColor: drawerColor,
      rod2400Required: rodQty,
      rodItems: rodQty > 0 ? [{ qty: rodQty, size: '700' }] : [],
      rodTotalLen: rodQty * 700,
      rodAmount: rodQty * 5000,
      rodVat: rodQty * 500,
      totalSupply: supply,
      totalVat: vat,
      totalAmount: supply + vat,
      createdBy: 'admin',
      createdAt: orderDate.toISOString(),
      updatedAt: orderDate.toISOString()
    };
    newOrders.push(order);
  }

  // B4 보강: read-modify-write race 방지 — transaction으로 atomic 보장
  // B5 보강: Firestore 단일 doc 1MB 한도 가드 — 초과 시 명시 throw (silent 손실 금지)
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(db.collection('hanger_data').doc('orders'));
    const cur = snap.exists ? (snap.data().value || []) : [];
    const merged = [...cur, ...newOrders];
    const sizeBytes = Buffer.byteLength(JSON.stringify({ value: merged }), 'utf8');
    if (sizeBytes > 900_000) {
      throw new Error(`[B5] 시드 누적 doc 크기 ${(sizeBytes/1024).toFixed(0)}KB — Firestore 1MB 한도 임박. 분할 시드 또는 컬렉션 분리 필요.`);
    }
    tx.set(db.collection('hanger_data').doc('orders'), {
      value: merged,
      updatedAt: new Date().toISOString()
    });
  });

  // 신경로 단건 저장
  const batch = db.batch();
  newOrders.forEach(o => {
    const ref = db.collection('hanger_orders').doc(o.orderNum);
    batch.set(ref, o);
  });
  await batch.commit();

  console.log(`✓ ${COUNT}건 추가 완료`);
  console.log(`  총 발주서: ${existing.length} → ${existing.length + newOrders.length}건`);
  console.log(`\n앱에서 확인: http://localhost:5050`);
}

main().then(() => process.exit(0)).catch(e => {
  console.error('실패:', e.message);
  process.exit(1);
});
