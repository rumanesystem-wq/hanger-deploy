// ─────────────────────────────────────────────────────────────
// add-bulk-invoices.js — 발주서들에 거래명세서 자동 생성
// 사용: MSYS_NO_PATHCONV=1 docker exec hanger-emu node /home/node/functions/add-bulk-invoices.js
// ─────────────────────────────────────────────────────────────

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';

const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'tooktakproject' });
const db = admin.firestore();

async function main() {
  console.log('━━━ 거래명세서 자동 생성 ━━━\n');

  const ordersDoc = await db.collection('hanger_data').doc('orders').get();
  const orders = ordersDoc.exists ? (ordersDoc.data().value || []) : [];
  // 발주확정/출고완료 상태만
  const targets = orders.filter(o => o.status === '발주확정' || o.status === '출고완료');
  console.log(`대상 발주서: ${targets.length}건 (발주확정/출고완료만)`);

  const invDoc = await db.collection('hanger_data').doc('invoices').get();
  const existing = invDoc.exists ? (invDoc.data().value || []) : [];
  const existingOrderNums = new Set(existing.filter(i => !i.cancelled).map(i => i.orderNum));

  const newInvoices = [];
  let serialN = {};

  for (const o of targets) {
    if (existingOrderNums.has(o.orderNum)) continue;  // 이미 있으면 skip

    // 가격표에서 단가 가져오기 (없으면 발주서 unitPrice)
    const items = [];
    (o.upperMaterials || []).forEach(m => {
      if (!m.qty) return;
      const supply = m.qty * (m.unitPrice || 0);
      items.push({
        name: m.name, spec: m.color, qty: m.qty, unitPrice: m.unitPrice,
        supply, vat: Math.round(supply * 0.1), priceUnknown: false
      });
    });
    (o.shelfItems || []).forEach(si => {
      (si.entries || []).forEach(e => {
        if (!e.qty) return;
        const supply = e.qty * (e.unitPrice || 0);
        items.push({
          name: si.name, spec: e.color + ' ' + e.size, qty: e.qty, unitPrice: e.unitPrice,
          supply, vat: Math.round(supply * 0.1), priceUnknown: false
        });
      });
    });
    (o.drawerItems || []).forEach(d => {
      if (!d.requiredQty) return;
      const supply = d.requiredQty * (d.unitPrice || 0);
      items.push({
        name: d.displayName || d.itemName, spec: d.color, qty: d.requiredQty, unitPrice: d.unitPrice,
        supply, vat: Math.round(supply * 0.1), priceUnknown: false
      });
    });
    if (o.rod2400Required > 0) {
      const supply = o.rod2400Required * 5000;
      items.push({
        name: '옷봉 2400', spec: '', qty: o.rod2400Required, unitPrice: 5000,
        supply, vat: Math.round(supply * 0.1), priceUnknown: false
      });
    }
    if (items.length === 0) continue;

    // 시리얼
    const dateKey = (o.shipDate || o.orderDate || '').replace(/-/g, '/');
    serialN[dateKey] = (serialN[dateKey] || 0) + 1;
    const serial = dateKey + ' -' + serialN[dateKey];

    const totalSupply = items.reduce((s, i) => s + i.supply, 0);
    const totalVat = items.reduce((s, i) => s + i.vat, 0);

    const invoice = {
      id: 'inv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      orderNum: o.orderNum,
      shipDate: o.shipDate || o.orderDate,
      deliveryTo: o.deliveryTo,
      address: o.address,
      items,
      totalSupply,
      totalVat,
      totalAmount: totalSupply + totalVat,
      createdAt: o.createdAt || new Date().toISOString(),
      createdBy: 'admin',
      issuerName: '관리자',
      serial,
      sentToCustomer: true,  // 자동 전송 처리 (테스트)
      sentAt: new Date().toISOString()
    };
    newInvoices.push(invoice);
  }

  if (newInvoices.length === 0) {
    console.log('생성할 invoice 없음 (이미 다 있거나 대상 0건)');
    return;
  }

  // B4 동일 보강: read-modify-write race 방지 — transaction
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(db.collection('hanger_data').doc('invoices'));
    const cur = snap.exists ? (snap.data().value || []) : [];
    tx.set(db.collection('hanger_data').doc('invoices'), {
      value: [...cur, ...newInvoices],
      updatedAt: new Date().toISOString()
    });
  });

  console.log(`✓ ${newInvoices.length}건 거래명세서 생성 완료`);
  console.log(`  총 invoice: ${existing.length} → ${existing.length + newInvoices.length}건`);
  console.log(`\n원장에서 확인: 거래처 펼침 → 판매/수금내역에 데이터 나옴`);
}

main().then(() => process.exit(0)).catch(e => {
  console.error('실패:', e.message);
  process.exit(1);
});
