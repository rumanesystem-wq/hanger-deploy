// ============================================================
// features/invoice/query.js — 거래명세서 Firestore 쿼리
// Q1=B: hanger_data/invoices 문서 배열 push (핫픽스 A 패턴)
// 로컬 폴백 금지 — 서버 미수신 시 빈 배열 반환 + console.warn
// ============================================================

const INVOICE_DOC_KEY = 'invoices';

/**
 * 거래명세서 저장 — hanger_data/invoices 문서의 배열에 push
 * 핫픽스 A 패턴: _FS.get → 배열 push → _FS.set
 * @param {Invoice} invoice
 * @returns {Promise<Invoice>}
 */
async function saveInvoice(invoice) {
  if (!window._FS) throw new Error('[Invoice] _FS 미초기화');
  let list = await window._FS.get(INVOICE_DOC_KEY);
  if (!Array.isArray(list)) list = [];
  const saved = { ...invoice, id: 'inv_' + Date.now() };
  list.push(saved);
  await window._FS.set(INVOICE_DOC_KEY, list);
  return saved;
}

/**
 * 특정 발주번호의 거래명세서 목록 반환
 * @param {string} orderNum
 * @returns {Promise<Invoice[]>}
 */
async function getInvoicesByOrderNum(orderNum) {
  if (!window._FS) { console.warn('[Invoice] _FS 미초기화 — 빈 배열 반환'); return []; }
  const list = await window._FS.get(INVOICE_DOC_KEY);
  if (!Array.isArray(list)) { console.warn('[Invoice] invoices 문서 없음 — 빈 배열 반환'); return []; }
  return list.filter(inv => inv && inv.orderNum === orderNum);
}

/**
 * 거래명세서 업데이트 (수기 편집 저장)
 * 같은 id로 찾아서 통째 교체 (patch가 아니라 full replace — 사용자 직접 수정한 최종본 반영)
 * @param {Invoice} invoice - id 필수, 이외 필드는 갱신될 최종값
 * @returns {Promise<Invoice>}
 */
async function updateInvoice(invoice) {
  if (!window._FS) throw new Error('[Invoice] _FS 미초기화');
  if (!invoice || !invoice.id) throw new Error('[Invoice] update: id 없음');
  let list = await window._FS.get(INVOICE_DOC_KEY);
  if (!Array.isArray(list)) list = [];
  const idx = list.findIndex(inv => inv && inv.id === invoice.id);
  if (idx < 0) {
    // 기존에 없으면 push (신규로 취급)
    list.push(invoice);
  } else {
    list[idx] = invoice;
  }
  await window._FS.set(INVOICE_DOC_KEY, list);
  return invoice;
}

/**
 * 특정 날짜의 거래명세서 시리얼 목록 반환 (일련번호 생성용)
 * @param {string} yyyymmdd - 예: "20260612"
 * @returns {Promise<string[]>}
 */
async function getInvoicesByDate(yyyymmdd) {
  if (!window._FS) { console.warn('[Invoice] _FS 미초기화 — 빈 배열 반환'); return []; }
  const list = await window._FS.get(INVOICE_DOC_KEY);
  if (!Array.isArray(list)) { console.warn('[Invoice] invoices 문서 없음 — 빈 배열 반환'); return []; }
  const dateStr = yyyymmdd.slice(0, 4) + '-' + yyyymmdd.slice(4, 6) + '-' + yyyymmdd.slice(6, 8);
  return list
    .filter(inv => inv && inv.shipDate === dateStr)
    .map(inv => inv.serial || '');
}
