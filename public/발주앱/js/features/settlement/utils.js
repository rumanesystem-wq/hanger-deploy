// ============================================================
// features/settlement/utils.js — 정산 전용 유틸 (순수 함수, side effect 없음)
// ============================================================

/**
 * 기간 단위에 따른 날짜 범위 계산
 * @param {PeriodMode} mode
 * @param {string | {year:number, quarter:number} | {startDate:string, endDate:string}} value
 * @returns {DateRange}
 */
function getDateRange(mode, value) {
  if (mode === 'daily') {
    return { startDate: value, endDate: value };
  }

  if (mode === 'weekly') {
    const mon = new Date(value);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    return {
      startDate: value,
      endDate: `${sun.getFullYear()}-${pad2(sun.getMonth() + 1)}-${pad2(sun.getDate())}`
    };
  }

  if (mode === 'monthly') {
    const [y, m] = value.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    return {
      startDate: `${y}-${pad2(m)}-01`,
      endDate: `${y}-${pad2(m)}-${lastDay}`
    };
  }

  if (mode === 'quarterly') {
    const { year, quarter } = value;
    const startMonth = (quarter - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    const lastDay = new Date(year, endMonth, 0).getDate();
    return {
      startDate: `${year}-${pad2(startMonth)}-01`,
      endDate: `${year}-${pad2(endMonth)}-${lastDay}`
    };
  }

  if (mode === 'yearly') {
    return { startDate: `${value}-01-01`, endDate: `${value}-12-31` };
  }

  if (mode === 'custom') {
    return value;
  }

  throw new Error('Unknown period mode: ' + mode);
}

/**
 * 발주서 목록을 납품처별로 그룹화
 * @param {Order[]} orders
 * @returns {Object<string, CustomerStats>}
 */
function groupByCustomer(orders) {
  /** @type {Object<string, CustomerStats>} */
  const grouped = {};
  orders.forEach(o => {
    const key = o.deliveryTo || '(미지정)';
    if (!grouped[key]) {
      grouped[key] = { orders: [], totalSupply: 0, totalVat: 0, totalAmount: 0 };
    }
    grouped[key].orders.push(o);
    grouped[key].totalSupply += o.totalSupply || 0;
    grouped[key].totalVat += o.totalVat || 0;
    grouped[key].totalAmount += o.totalAmount || 0;
  });
  return grouped;
}

/**
 * 발주서 목록의 합계 통계 계산
 * @param {Order[]} orders
 * @returns {SettlementSummary}
 */
function calcSummary(orders) {
  // M4 보강 (Codex): 활성 invoice가 있으면 invoice 금액 우선 (수기 수정 반영)
  const invMap = _buildInvoiceMapForSettlement();
  const eff = (o) => {
    const inv = invMap[o.orderNum];
    if (inv) {
      return {
        supply: inv.totalSupply || 0,
        vat: inv.totalVat || 0,
        amount: inv.totalAmount || 0
      };
    }
    return {
      supply: o.totalSupply || 0,
      vat: o.totalVat || 0,
      amount: o.totalAmount || 0
    };
  };
  return {
    count: orders.length,
    totalSupply: orders.reduce((s, o) => s + eff(o).supply, 0),
    totalVat:    orders.reduce((s, o) => s + eff(o).vat, 0),
    totalAmount: orders.reduce((s, o) => s + eff(o).amount, 0)
  };
}

// M4 보강: 활성 invoice 맵 (orderNum → 최신 활성 invoice)
function _buildInvoiceMapForSettlement() {
  try {
    const invoices = (typeof DB !== 'undefined' && typeof DB.get === 'function')
      ? DB.get('invoices', [])
      : [];
    const map = {};
    invoices.forEach(inv => {
      if (!inv || inv.cancelled || !inv.orderNum) return;
      const prev = map[inv.orderNum];
      if (!prev || (inv.createdAt || '') > (prev.createdAt || '')) {
        map[inv.orderNum] = inv;
      }
    });
    return map;
  } catch (_e) {
    return {};
  }
}

/**
 * 일별 추이 집계 (출고완료일 기준)
 * @param {Order[]} orders
 * @returns {Array<{date:string, count:number, total:number}>}
 */
function aggregateByDay(orders) {
  /** @type {Object<string, {count:number, total:number}>} */
  const daily = {};
  orders.forEach(o => {
    const k = o.shipDate || '';
    if (!k) return;
    if (!daily[k]) daily[k] = { count: 0, total: 0 };
    daily[k].count++;
    daily[k].total += o.totalAmount || 0;
  });
  return Object.keys(daily).sort().map(date => ({
    date,
    count: daily[date].count,
    total: daily[date].total
  }));
}

/**
 * 월별 추이 집계 (출고완료일 기준)
 * @param {Order[]} orders
 * @returns {Array<{month:string, count:number, total:number}>}
 */
function aggregateByMonth(orders) {
  /** @type {Object<string, {count:number, total:number}>} */
  const monthly = {};
  orders.forEach(o => {
    const k = (o.shipDate || '').slice(0, 7);
    if (!k) return;
    if (!monthly[k]) monthly[k] = { count: 0, total: 0 };
    monthly[k].count++;
    monthly[k].total += o.totalAmount || 0;
  });
  return Object.keys(monthly).sort().map(month => ({
    month,
    count: monthly[month].count,
    total: monthly[month].total
  }));
}
