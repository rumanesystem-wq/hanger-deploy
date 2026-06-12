// ============================================================
// features/ledger/utils.js — 원장 전용 순수 함수
// ============================================================

/**
 * 출고/입금을 시간순으로 통합하고 잔액 누적 계산
 * @param {Order[]} orders
 * @param {Payment[]} payments
 * @returns {LedgerEvent[]} 시간 오름차순 정렬됨, balance 필드 포함
 */
function buildLedgerEvents(orders, payments) {
  /** @type {LedgerEvent[]} */
  const events = [];

  orders.forEach(o => {
    events.push({
      date: o.shipDate || o.orderDate,
      type: 'out',
      description: `${o.orderNum} / ${o.address} (${o.warehouse})`,
      amount: o.totalAmount || 0,
      id: o.id,
      orderNum: o.orderNum,
      address: o.address,
      warehouse: o.warehouse
    });
  });

  payments.forEach(p => {
    events.push({
      date: p.date,
      type: 'in',
      description: p.memo || '입금',
      amount: p.amount || 0,
      id: p.id
    });
  });

  // 시간 오름차순 정렬
  events.sort((a, b) => a.date.localeCompare(b.date));

  // 잔액 누적 (앞에서부터 차곡차곡 쌓음)
  let balance = 0;
  events.forEach(e => {
    balance += (e.type === 'out' ? e.amount : -e.amount);
    e.balance = balance;
  });

  return events;
}

/**
 * 거래처별 통계 계산
 * @param {string} name - 납품처 이름
 * @param {Order[]} allOrders
 * @param {Payment[]} allPayments
 * @returns {CustomerStats}
 */
function calcCustomerStats(name, allOrders, allPayments) {
  const orders = allOrders.filter(o => o.deliveryTo === name && o.status === '출고완료');
  const payments = allPayments.filter(p => p.customer === name);
  const totalOut = orders.reduce((s, o) => s + (o.totalAmount || 0), 0);
  const totalIn = payments.reduce((s, p) => s + (p.amount || 0), 0);
  return {
    orderCount: orders.length,
    totalOut,
    totalIn,
    balance: totalOut - totalIn,
    orders,
    payments
  };
}

/**
 * 전체 거래처 목록 요약 (목록 화면용)
 * @param {Order[]} allOrders
 * @param {Payment[]} allPayments
 * @returns {CustomerSummary[]}
 */
function listCustomersSummary(allOrders, allPayments) {
  const completedOrders = allOrders.filter(o => o.status === '출고완료');
  const names = [...new Set(completedOrders.map(o => o.deliveryTo).filter(Boolean))];

  return names.map(name => {
    const stats = calcCustomerStats(name, allOrders, allPayments);
    return {
      name,
      orderCount: stats.orderCount,
      totalOut: stats.totalOut,
      totalIn: stats.totalIn,
      balance: stats.balance
    };
  }).sort((a, b) => b.balance - a.balance); // 미수금 큰 순
}
