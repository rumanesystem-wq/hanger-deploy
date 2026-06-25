// ─────────────────────────────────────────────────────────────
// seed-emulator.js — 로컬 에뮬레이터에 기본 데이터 시드
// 사용: docker exec hanger-emu node functions/seed-emulator.js
//      또는 호스트에서 node functions/seed-emulator.js (env 설정 시)
// ─────────────────────────────────────────────────────────────

// 에뮬레이터 호스트 자동 감지 (도커 안: localhost, 호스트: localhost)
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';

const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'tooktakproject' });

const auth = admin.auth();
const db = admin.firestore();

async function main() {
  console.log('━━━ 에뮬레이터 시드 시작 ━━━\n');

  // 1) Auth 계정 생성
  const accounts = [
    { uid: 'admin-uid', email: 'admin@local.test', password: '123456', id: 'admin', name: '관리자', role: 'admin', deliveryName: '' },
    { uid: 'orderer-uid', email: 'orderer@local.test', password: '123456', id: 'orderer', name: '발주자', role: 'orderer', deliveryName: '테스트업체' },
  ];

  for (const acc of accounts) {
    try {
      await auth.createUser({ uid: acc.uid, email: acc.email, password: acc.password, displayName: acc.name });
      console.log(`✓ Auth 계정: ${acc.id} / ${acc.password}`);
    } catch (e) {
      if (e.code === 'auth/uid-already-exists' || e.code === 'auth/email-already-exists') {
        console.log(`· Auth 이미 있음: ${acc.id}`);
      } else throw e;
    }
  }

  // 2) Firestore: hanger_data/accounts (앱이 사용하는 사용자 매핑)
  const accountsValue = accounts.map(a => ({
    id: a.id, name: a.name, email: a.email, role: a.role, deliveryName: a.deliveryName,
    empCd: '', bizCd: ''
  }));
  await db.collection('hanger_data').doc('accounts').set({
    value: accountsValue,
    updatedAt: new Date().toISOString()
  });
  console.log(`✓ Firestore: accounts ${accounts.length}건`);

  // 3) Firestore: hanger_data/items (최소 자재 마스터)
  const items = [
    { id: 1, name: '겉서랍 2단', category: '서랍장', drawerType: 'outer', isActive: true, currentStock: 10, stockSiheung: 5, stockPyeongtaek: 5 },
    { id: 2, name: '속서랍 2단', category: '서랍장', drawerType: 'inner', isActive: true, currentStock: 10, stockSiheung: 5, stockPyeongtaek: 5 },
  ];
  await db.collection('hanger_data').doc('items').set({
    value: items,
    updatedAt: new Date().toISOString()
  });
  console.log(`✓ Firestore: items ${items.length}건`);

  // 4) Firestore: hanger_data/price_settings (최소 가격표)
  const prices = [
    { name: '포스트바 2400', price: 12000 },
    { name: '옷봉 2400', price: 5000 },
    { name: '겉서랍 2단', price: 69000 },
    { name: '속서랍 2단', price: 69000 },
    { name: '선반 770', price: 5300 },
  ];
  await db.collection('hanger_data').doc('price_settings').set({
    value: prices,
    updatedAt: new Date().toISOString()
  });
  console.log(`✓ Firestore: price_settings ${prices.length}건`);

  // 5) Firestore: 빈 orders/invoices 컨테이너 (앱이 안 깨지게)
  await db.collection('hanger_data').doc('orders').set({
    value: [],
    updatedAt: new Date().toISOString()
  });
  await db.collection('hanger_data').doc('invoices').set({
    value: [],
    updatedAt: new Date().toISOString()
  });
  console.log(`✓ Firestore: orders/invoices 빈 컨테이너`);

  console.log('\n━━━ 시드 완료 ━━━');
  console.log('\n로그인 정보:');
  console.log('  관리자: admin / 123456');
  console.log('  발주자: orderer / 123456');
  console.log('\n앱 접속: http://localhost:5050');
  console.log('에뮬레이터 UI: http://localhost:4000');
}

main().then(() => process.exit(0)).catch(e => {
  console.error('시드 실패:', e.message);
  process.exit(1);
});
