// ============================================================
// features/invoice/render.js — 거래명세서 HTML 렌더링 (편집 가능)
// ============================================================

const SUPPLIER = {
  name:    '루마네시스템',
  bizno:   '793-81-02453',
  ceo:     '조영석',
  address: '경기도 시흥시 수인로3077번길 24-8',
  tel:     ''
};

// XSS 방어: innerHTML 에 박히는 모든 사용자 데이터(납품처/주소/품목명)는 escHtml 거치기
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 편집 가능한 td (contenteditable) — 클릭하면 입력
// data-field 로 어떤 필드인지 표시 (저장 시 DOM에서 값 수집)
function _editTd(value, field, opts) {
  opts = opts || {};
  const cls = 'invoice-td invoice-editable' + (opts.right ? ' invoice-td-right' : '') + (opts.center ? ' invoice-td-center' : '');
  const safe = escHtml(value == null ? '' : value);
  return `<td class="${cls}" contenteditable="true" data-field="${field}" spellcheck="false">${safe}</td>`;
}

// 행 단위 HTML 생성 (편집 가능)
function _itemRowHTML(item, shipDate) {
  item = item || {};
  const name = item.spec ? `${item.name || ''} [${item.spec}]` : (item.name || '');
  return `<tr class="invoice-item-row">
    ${_editTd(item.date || shipDate || '', 'date', { center: true })}
    ${_editTd(name, 'name')}
    ${_editTd(item.qty != null ? item.qty : '', 'qty', { right: true })}
    ${_editTd(item.unitPrice != null ? item.unitPrice : '', 'unitPrice', { right: true })}
    <td class="invoice-td invoice-td-right invoice-td-supply">${item.supply != null && item.supply !== '' ? Number(item.supply).toLocaleString() : ''}</td>
    <td class="invoice-td invoice-td-right invoice-td-vat">${item.vat != null && item.vat !== '' ? Number(item.vat).toLocaleString() : ''}</td>
    <td class="invoice-td invoice-td-center invoice-row-del-cell"><button type="button" class="invoice-row-del" title="행 삭제">×</button></td>
  </tr>`;
}

/**
 * 거래명세서 HTML 문자열 생성 (가로 landscape 양식, 편집 가능)
 * @param {Invoice} invoice
 * @returns {string}
 */
function buildInvoiceHTML(invoice) {
  const items = invoice.items || [];
  const MIN_ROWS = 8;
  const rows = [...items];
  while (rows.length < MIN_ROWS) rows.push(null);

  const itemRowsHTML = rows.map(it => _itemRowHTML(it, invoice.shipDate)).join('');

  const totalQty   = items.reduce((s, i) => s + (Number(i.qty) || 0), 0);
  const totalSupply = invoice.totalSupply != null ? invoice.totalSupply : items.reduce((s,i)=>s+(Number(i.supply)||0),0);
  const totalVat    = invoice.totalVat    != null ? invoice.totalVat    : items.reduce((s,i)=>s+(Number(i.vat)||0),0);
  const totalAmount = invoice.totalAmount != null ? invoice.totalAmount : (totalSupply + totalVat);

  return `
<style>
  .invoice-editable { background: #fffef0; cursor: text; outline: none; }
  .invoice-editable:hover { background: #fef9c3; }
  .invoice-editable:focus { background: #fff; box-shadow: inset 0 0 0 2px #2563eb; }
  .invoice-row-del { background: none; border: none; color: #cbd5e1; font-size: 16px; font-weight: 700; cursor: pointer; padding: 0 4px; line-height: 1; }
  .invoice-row-del:hover { color: #dc2626; }
  .invoice-item-row:hover .invoice-row-del { color: #94a3b8; }
  .invoice-add-row-wrap { padding: 8px 0; text-align: center; }
  .invoice-add-row-btn { background: #eff6ff; color: #1e40af; border: 1px dashed #2563eb; padding: 6px 18px; border-radius: 6px; font-size: 12px; font-weight: 700; cursor: pointer; }
  .invoice-add-row-btn:hover { background: #dbeafe; }
  .invoice-receipt-input { background: #fffef0; outline: none; cursor: text; min-width: 80px; display: inline-block; padding: 2px 8px; border-radius: 4px; }
  .invoice-receipt-input:hover { background: #fef9c3; }
  .invoice-receipt-input:focus { background: #fff; box-shadow: inset 0 0 0 2px #2563eb; }
</style>
<div class="invoice-wrap" data-invoice-id="${escHtml(invoice.id || '')}" data-invoice-order-num="${escHtml(invoice.orderNum || '')}" data-invoice-serial="${escHtml(invoice.serial || '')}" data-invoice-ship-date="${escHtml(invoice.shipDate || '')}" data-invoice-delivery-to="${escHtml(invoice.deliveryTo || '')}" data-invoice-address="${escHtml(invoice.address || '')}">
  <div class="invoice-title">거 래 명 세 서</div>

  <div class="invoice-parties">
    <table class="invoice-party-tbl">
      <colgroup><col style="width:90px"/><col/></colgroup>
      <thead><tr><th colspan="2" class="invoice-party-head">공급받는자</th></tr></thead>
      <tbody>
        <tr><th class="invoice-th">상호</th><td class="invoice-td-party">${escHtml(invoice.deliveryTo || '')}</td></tr>
        <tr><th class="invoice-th">주소</th><td class="invoice-td-party">${escHtml(invoice.address || '')}</td></tr>
        <tr><th class="invoice-th">발주번호</th><td class="invoice-td-party">${escHtml(invoice.orderNum || '')}</td></tr>
      </tbody>
    </table>

    <div class="invoice-parties-spacer"></div>

    <table class="invoice-party-tbl">
      <colgroup><col style="width:90px"/><col/></colgroup>
      <thead><tr><th colspan="2" class="invoice-party-head">공급자</th></tr></thead>
      <tbody>
        <tr><th class="invoice-th">상호</th><td class="invoice-td-party">${SUPPLIER.name}</td></tr>
        <tr><th class="invoice-th">사업자등록번호</th><td class="invoice-td-party">${SUPPLIER.bizno}</td></tr>
        <tr><th class="invoice-th">대표자</th><td class="invoice-td-party">${SUPPLIER.ceo}</td></tr>
        <tr><th class="invoice-th">주소</th><td class="invoice-td-party">${SUPPLIER.address}</td></tr>
        <tr><th class="invoice-th">TEL</th><td class="invoice-td-party">${SUPPLIER.tel}</td></tr>
      </tbody>
    </table>
  </div>

  <div class="invoice-serial">No. ${escHtml(invoice.serial || '')}</div>

  <table class="invoice-items-tbl">
    <thead>
      <tr>
        <th class="invoice-th-item" style="width:90px">일자</th>
        <th class="invoice-th-item">품목명 [규격]</th>
        <th class="invoice-th-item" style="width:60px">수량</th>
        <th class="invoice-th-item" style="width:90px">단가</th>
        <th class="invoice-th-item" style="width:100px">공급가액</th>
        <th class="invoice-th-item" style="width:90px">부가세</th>
        <th class="invoice-th-item" style="width:36px"></th>
      </tr>
    </thead>
    <tbody class="invoice-items-tbody">${itemRowsHTML}</tbody>
    <tfoot>
      <tr class="invoice-total-row">
        <td class="invoice-td invoice-td-center">합계</td>
        <td class="invoice-td"></td>
        <td class="invoice-td invoice-td-right invoice-td-total-qty">${totalQty.toLocaleString()}</td>
        <td class="invoice-td"></td>
        <td class="invoice-td invoice-td-right invoice-td-total-supply">${(totalSupply || 0).toLocaleString()}</td>
        <td class="invoice-td invoice-td-right invoice-td-total-vat">${(totalVat || 0).toLocaleString()}</td>
        <td class="invoice-td"></td>
      </tr>
    </tfoot>
  </table>

  <div class="invoice-add-row-wrap">
    <button type="button" class="invoice-add-row-btn"><i class="fas fa-plus"></i> 행 추가</button>
  </div>

  <div class="invoice-summary">
    <div class="invoice-summary-row">
      <span class="invoice-summary-label">공급가액</span>
      <span class="invoice-summary-value invoice-summary-supply">${(totalSupply || 0).toLocaleString()} 원</span>
    </div>
    <div class="invoice-summary-row">
      <span class="invoice-summary-label">부가세</span>
      <span class="invoice-summary-value invoice-summary-vat">${(totalVat || 0).toLocaleString()} 원</span>
    </div>
    <div class="invoice-summary-row invoice-summary-total">
      <span class="invoice-summary-label">합계금액</span>
      <span class="invoice-summary-value invoice-summary-amount">${(totalAmount || 0).toLocaleString()} 원</span>
    </div>
    <div class="invoice-summary-row">
      <span class="invoice-summary-label">한글금액</span>
      <span class="invoice-summary-value invoice-korean-amount">${numberToKorean(totalAmount || 0)}</span>
    </div>
  </div>

  <div class="invoice-receipt">
    <div class="invoice-receipt-label">인수</div>
    <div><span class="invoice-receipt-input" contenteditable="true" data-field="receiver-name" spellcheck="false">${escHtml(invoice.receiverName || '')}</span></div>
    <div class="invoice-receipt-stamp"><span class="invoice-receipt-input" contenteditable="true" data-field="receiver-stamp" spellcheck="false">${escHtml(invoice.receiverStamp || '(인)')}</span></div>
  </div>
</div>
`;
}

// 한 행의 입력값에서 supply/vat 계산하여 같은 행에 반영
function _recalcRow(tr) {
  if (!tr) return;
  const qty = Number((tr.querySelector('[data-field="qty"]')?.textContent || '').replace(/[,\s]/g,'')) || 0;
  const unitPrice = Number((tr.querySelector('[data-field="unitPrice"]')?.textContent || '').replace(/[,\s]/g,'')) || 0;
  const supply = Math.round(qty * unitPrice);
  const vat = Math.round(supply * 0.1);
  const supplyCell = tr.querySelector('.invoice-td-supply');
  const vatCell = tr.querySelector('.invoice-td-vat');
  if (supplyCell) supplyCell.textContent = supply ? supply.toLocaleString() : '';
  if (vatCell) vatCell.textContent = vat ? vat.toLocaleString() : '';
}

// 모든 행 합계 → 표 푸터·하단 요약·한글금액 갱신
function _recalcTotals(wrap) {
  if (!wrap) return;
  let totalQty = 0, totalSupply = 0, totalVat = 0;
  wrap.querySelectorAll('.invoice-item-row').forEach(tr => {
    const qty = Number((tr.querySelector('[data-field="qty"]')?.textContent || '').replace(/[,\s]/g,'')) || 0;
    const supply = Number((tr.querySelector('.invoice-td-supply')?.textContent || '').replace(/[,\s]/g,'')) || 0;
    const vat = Number((tr.querySelector('.invoice-td-vat')?.textContent || '').replace(/[,\s]/g,'')) || 0;
    totalQty += qty;
    totalSupply += supply;
    totalVat += vat;
  });
  const totalAmount = totalSupply + totalVat;
  const setText = (sel, val) => { const el = wrap.querySelector(sel); if (el) el.textContent = val; };
  setText('.invoice-td-total-qty', totalQty.toLocaleString());
  setText('.invoice-td-total-supply', totalSupply.toLocaleString());
  setText('.invoice-td-total-vat', totalVat.toLocaleString());
  setText('.invoice-summary-supply', totalSupply.toLocaleString() + ' 원');
  setText('.invoice-summary-vat', totalVat.toLocaleString() + ' 원');
  setText('.invoice-summary-amount', totalAmount.toLocaleString() + ' 원');
  setText('.invoice-korean-amount', numberToKorean(totalAmount));
}

// 모달 내 이벤트 위임 — 편집·삭제·추가
function _attachInvoiceEditEvents(wrap) {
  if (!wrap || wrap._invEditAttached) return;
  wrap._invEditAttached = true;

  // 셀 편집 시 같은 행 재계산 + 전체 합계 갱신
  wrap.addEventListener('input', e => {
    const td = e.target.closest('[data-field="qty"], [data-field="unitPrice"]');
    if (td) {
      const tr = td.closest('tr');
      _recalcRow(tr);
      _recalcTotals(wrap);
    }
  });

  // 행 삭제
  wrap.addEventListener('click', e => {
    const delBtn = e.target.closest('.invoice-row-del');
    if (delBtn) {
      const tr = delBtn.closest('tr');
      if (tr) tr.remove();
      _recalcTotals(wrap);
      return;
    }
    const addBtn = e.target.closest('.invoice-add-row-btn');
    if (addBtn) {
      const tbody = wrap.querySelector('.invoice-items-tbody');
      if (tbody) {
        const shipDate = wrap.dataset.invoiceShipDate || '';
        tbody.insertAdjacentHTML('beforeend', _itemRowHTML(null, shipDate));
        _recalcTotals(wrap);
      }
    }
  });
}

/**
 * 현재 모달 DOM에서 사용자가 편집한 최종 invoice 객체를 수집
 * @param {Invoice} baseInvoice - 원본 invoice (id, orderNum 등 메타 유지용)
 * @returns {Invoice}
 */
function collectInvoiceFromDOM(baseInvoice) {
  const wrap = document.querySelector('#invoiceContent .invoice-wrap');
  if (!wrap) return baseInvoice;
  const items = [];
  wrap.querySelectorAll('.invoice-item-row').forEach(tr => {
    const date = tr.querySelector('[data-field="date"]')?.textContent.trim() || '';
    const nameRaw = tr.querySelector('[data-field="name"]')?.textContent.trim() || '';
    const qty = Number((tr.querySelector('[data-field="qty"]')?.textContent || '').replace(/[,\s]/g,'')) || 0;
    const unitPrice = Number((tr.querySelector('[data-field="unitPrice"]')?.textContent || '').replace(/[,\s]/g,'')) || 0;
    // 모두 빈 행은 제외
    if (!date && !nameRaw && !qty && !unitPrice) return;
    // 품목명 [규격] 형식 파싱
    let name = nameRaw, spec = '';
    const m = nameRaw.match(/^(.*?)\s*\[(.+?)\]\s*$/);
    if (m) { name = m[1].trim(); spec = m[2].trim(); }
    const supply = Math.round(qty * unitPrice);
    const vat = Math.round(supply * 0.1);
    items.push({ date, name, spec, qty, unitPrice, supply, vat });
  });
  const totalSupply = items.reduce((s,i)=>s+(i.supply||0),0);
  const totalVat = items.reduce((s,i)=>s+(i.vat||0),0);
  const receiverName = wrap.querySelector('[data-field="receiver-name"]')?.textContent.trim() || '';
  const receiverStamp = wrap.querySelector('[data-field="receiver-stamp"]')?.textContent.trim() || '';
  return {
    ...baseInvoice,
    items,
    totalSupply,
    totalVat,
    totalAmount: totalSupply + totalVat,
    receiverName,
    receiverStamp
  };
}

/**
 * 거래명세서 모달 표시
 * @param {Object} orderOrInvoice
 * @param {'preview'|'view'} mode
 */
function openInvoiceModal(orderOrInvoice, mode) {
  const modal   = document.getElementById('invoiceModal');
  const content = document.getElementById('invoiceContent');
  if (!modal || !content) { console.warn('[Invoice] 모달 DOM 없음'); return; }
  content.innerHTML = buildInvoiceHTML(orderOrInvoice);
  modal.style.display = 'flex';
  // 편집 이벤트 위임 등록 + 초기 합계 재계산 (DOM 값으로)
  const wrap = content.querySelector('.invoice-wrap');
  _attachInvoiceEditEvents(wrap);
  // 초기 표시는 invoice.items가 supply/vat 가지고 있어서 totalSupply 이미 채워져 있음 — recalc 안 함
}

// 글로벌 노출 (invoice/index.js의 저장 핸들러에서 사용)
window._collectInvoiceFromDOM = collectInvoiceFromDOM;
