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

  // 상부 자재
  (order.upperMaterials || []).forEach(m => {
    if (!m.qty || m.qty <= 0) return;
    const spec = m.color || '';
    const qty  = m.qty;
    const unitPrice = m.unitPrice || 0;
    const supply = Math.floor(qty * unitPrice);
    const vat    = Math.round(supply * 0.1);
    items.push({ name: m.name || '', spec, qty, unitPrice, supply, vat });
  });

  // 선반/코너선반
  (order.shelfItems || []).forEach(si => {
    (si.entries || []).forEach(e => {
      if (!e.qty || e.qty <= 0) return;
      const spec = [e.color || '', e.size || '', e.width ? (e.width + '×' + e.height) : ''].filter(Boolean).join(' ');
      const qty  = e.qty;
      const unitPrice = e.unitPrice || 0;
      const supply = Math.floor(qty * unitPrice);
      const vat    = Math.round(supply * 0.1);
      items.push({ name: si.name || '', spec, qty, unitPrice, supply, vat });
    });
  });

  // 서랍/옵션
  (order.drawerItems || order.items || []).forEach(oi => {
    if (!oi.requiredQty || oi.requiredQty <= 0) return;
    const spec = oi.color || '';
    const qty  = oi.requiredQty;
    const unitPrice = oi.unitPrice || 0;
    const supply = Math.floor(qty * unitPrice);
    const vat    = Math.round(supply * 0.1);
    items.push({ name: oi.itemName || oi.displayName || '', spec, qty, unitPrice, supply, vat });
  });

  // 옷봉
  if (order.rod2400Required > 0) {
    items.push({ name: '옷봉 2400', spec: '', qty: order.rod2400Required, unitPrice: 0, supply: 0, vat: 0 });
  }

  // items가 없으면 단일 행 fallback
  if (items.length === 0) {
    items.push({ name: order.deliveryTo || '-', spec: '', qty: 1, unitPrice: order.totalSupply || 0, supply: order.totalSupply || 0, vat: order.totalVat || 0 });
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
    serial:     ''
  };
}
