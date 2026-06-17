// ============================================================
// features/invoice/utils.js — 거래명세서 유틸리티
// ============================================================

/**
 * 숫자를 한글 금액으로 변환
 * 범위: 0 ~ 99,999,999,999
 * 예: 454080 → "사십오만사천팔십원 정"
 * @param {number} n
 * @returns {string}
 */
function numberToKorean(n) {
  // 비정상 입력 가드: 숫자 아니거나 NaN/Infinity면 0원으로 표시
  if (typeof n !== 'number' || !isFinite(n)) return '영원 정';
  // 음수는 절대값 처리 후 접두어, 소수는 정수 반올림 (PDF 금액은 정수 단위)
  const negative = n < 0;
  n = Math.round(Math.abs(n));
  if (n === 0) return '영원 정';
  const ONES = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
  const UNITS = ['', '십', '백', '천'];
  const BIGS  = ['', '만', '억'];

  function chunk(num) {
    const parts = [];
    let str = String(num);
    while (str.length > 0) {
      parts.unshift(str.slice(-4));
      str = str.slice(0, -4);
    }
    return parts;
  }

  function convertChunk(s) {
    const digits = s.padStart(4, '0').split('').map(Number);
    let result = '';
    digits.forEach((d, i) => {
      if (d === 0) return;
      result += (d === 1 && i > 0 ? '' : ONES[d]) + UNITS[3 - i];
    });
    return result;
  }

  const chunks = chunk(n);
  let result = '';
  chunks.forEach((c, i) => {
    const v = convertChunk(c);
    if (!v) return;
    result += v + BIGS[chunks.length - 1 - i];
  });

  return (negative ? '마이너스 ' : '') + result + '원 정';
}

/**
 * 일련번호 생성 — YYYY/MM/DD -N 형식
 * 당일 기준 N을 카운트
 * @param {string} date - YYYY-MM-DD
 * @param {string[]} existingSerials - 기존 시리얼 목록
 * @returns {string}
 */
/**
 * draft invoice에서 단가 미등록(가격표에 없음) 항목 이름 목록 반환
 * - 0원으로 명시 등록된 항목은 정상으로 간주 (제외)
 * - 가격표 자체에 없거나 가격이 null인 항목만 잡음
 * @param {Object} draft - orderToInvoice() 결과
 * @returns {string[]}
 */
function findZeroPriceItems(draft) {
  if (!draft || !Array.isArray(draft.items)) return [];
  return draft.items
    .filter(i => i && i.priceUnknown)
    .map(i => i.name || '(이름없음)');
}

function generateSerial(date, existingSerials) {
  const prefix = (date || '').replace(/-/g, '/');
  const sameDay = (existingSerials || []).filter(s => s && s.startsWith(prefix));
  const n = sameDay.length + 1;
  return prefix + ' -' + n;
}

/**
 * 발주서 객체 → Invoice 매핑
 * items는 order.upperMaterials / shelfItems / drawerItems 에서 추출
 * 없으면 단일 행 fallback
 * @param {Object} order
 * @returns {Invoice}
 */
function orderToInvoice(order) {
  const items = [];

  // 가격표에서 단가 조회 (fallback용)
  const priceTable = (typeof DB !== 'undefined' && typeof DB.get === 'function')
    ? DB.get('price_settings', [])
    : [];
  // priceOf: 가격표에 등록 안 됨 = undefined, 0원으로 명시 등록 = 0 (정상)
  const priceOf = (name) => {
    if (!name) return undefined;
    const p = priceTable.find(x => x && x.name === name);
    if (!p) return undefined;
    return (p.price == null) ? undefined : p.price;
  };
  // resolveUnit: order 항목의 unitPrice가 있으면 우선, 없으면 가격표 조회
  // 둘 다 없으면 priceUnknown=true (차단 대상). 0원은 정상.
  const resolveUnit = (rawUnit, name) => {
    if (rawUnit != null) return { unitPrice: rawUnit, priceUnknown: false };
    const looked = priceOf(name);
    if (looked == null) return { unitPrice: 0, priceUnknown: true };
    return { unitPrice: looked, priceUnknown: false };
  };

  // 상부 자재
  (order.upperMaterials || []).forEach(m => {
    if (!m.qty || m.qty <= 0) return;
    const spec = m.color || '';
    const qty  = m.qty;
    const r = resolveUnit(m.unitPrice, m.name);
    const supply = Math.floor(qty * r.unitPrice);
    const vat    = Math.round(supply * 0.1);
    items.push({ name: m.name || '', spec, qty, unitPrice: r.unitPrice, supply, vat, priceUnknown: r.priceUnknown });
  });

  // 선반/코너선반
  (order.shelfItems || []).forEach(si => {
    (si.entries || []).forEach(e => {
      if (!e.qty || e.qty <= 0) return;
      const spec = [e.color || '', e.size || '', e.width ? (e.width + '×' + e.height) : ''].filter(Boolean).join(' ');
      const qty  = e.qty;
      const r = resolveUnit(e.unitPrice, si.name);
      const supply = Math.floor(qty * r.unitPrice);
      const vat    = Math.round(supply * 0.1);
      items.push({ name: si.name || '', spec, qty, unitPrice: r.unitPrice, supply, vat, priceUnknown: r.priceUnknown });
    });
  });

  // 서랍/옵션 — order.items는 재고 이동 기록이라 폴백에서 제외 (호환성 fix)
  // 옛 발주서는 itemId만 저장된 경우가 있어 items 마스터에서 이름 역조회
  const itemsMaster = (typeof DB !== 'undefined' && typeof DB.get === 'function')
    ? DB.get('items', [])
    : [];
  // M2 보강 (Codex): 옛 발주서 itemId가 문자열일 수도 있어 String 비교
  const nameOfItemId = (id) => {
    if (id == null) return '';
    const sId = String(id);
    const it = itemsMaster.find(x => x && String(x.id) === sId);
    return it ? (it.name || '') : '';
  };
  (order.drawerItems || []).forEach(oi => {
    if (!oi.requiredQty || oi.requiredQty <= 0) return;
    const name = oi.itemName || oi.displayName || nameOfItemId(oi.itemId) || '';
    const spec = oi.color || '';
    const qty  = oi.requiredQty;
    const r = resolveUnit(oi.unitPrice, name);
    const supply = Math.floor(qty * r.unitPrice);
    const vat    = Math.round(supply * 0.1);
    items.push({ name, spec, qty, unitPrice: r.unitPrice, supply, vat, priceUnknown: r.priceUnknown });
  });

  // 옷봉 2400 (가격표에서 조회)
  if (order.rod2400Required > 0) {
    const qty = order.rod2400Required;
    const r = resolveUnit(null, '옷봉 2400');
    const supply = Math.floor(qty * r.unitPrice);
    const vat    = Math.round(supply * 0.1);
    items.push({ name: '옷봉 2400', spec: '', qty, unitPrice: r.unitPrice, supply, vat, priceUnknown: r.priceUnknown });
  }

  // items가 없으면 단일 행 fallback (order.totalSupply 기반, priceUnknown=false로 정상 통과 의도)
  if (items.length === 0) {
    items.push({ name: order.deliveryTo || '-', spec: '', qty: 1, unitPrice: order.totalSupply || 0, supply: order.totalSupply || 0, vat: order.totalVat || 0, priceUnknown: false });
  }

  const totalSupply = items.reduce((s, i) => s + i.supply, 0);
  const totalVat    = items.reduce((s, i) => s + i.vat, 0);
  const totalAmount = totalSupply + totalVat;

  return {
    id: '',
    orderNum:   order.orderNum || ('#' + order.id),
    shipDate:   order.shipDate || '',
    deliveryTo: order.deliveryTo || order.siteName || '',
    address:    order.address || '',
    items,
    totalSupply,
    totalVat,
    totalAmount,
    createdAt:  new Date().toISOString(),
    createdBy:  (window.currentUser && window.currentUser.id) || '',
    issuerName: (typeof currentUser !== 'undefined' && currentUser && currentUser.name) || '',
    serial:     '',
    sentToCustomer: false
  };
}
