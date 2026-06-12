// ============================================================
// features/invoice/render.js — 거래명세서 HTML 렌더링
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

/**
 * 거래명세서 HTML 문자열 생성 (가로 landscape 양식)
 * @param {Invoice} invoice
 * @returns {string}
 */
function buildInvoiceHTML(invoice) {
  const items = invoice.items || [];
  const MIN_ROWS = 8;
  const rows = [...items];
  while (rows.length < MIN_ROWS) rows.push(null);

  const itemRowsHTML = rows.map(it => {
    if (!it) {
      return `<tr>
        <td class="invoice-td invoice-td-center"></td>
        <td class="invoice-td"></td>
        <td class="invoice-td invoice-td-right"></td>
        <td class="invoice-td invoice-td-right"></td>
        <td class="invoice-td invoice-td-right"></td>
        <td class="invoice-td invoice-td-right"></td>
      </tr>`;
    }
    const namePart = it.spec ? `${escHtml(it.name)} [${escHtml(it.spec)}]` : escHtml(it.name);
    return `<tr>
      <td class="invoice-td invoice-td-center">${escHtml(invoice.shipDate || '')}</td>
      <td class="invoice-td">${namePart}</td>
      <td class="invoice-td invoice-td-right">${it.qty ? it.qty.toLocaleString() : ''}</td>
      <td class="invoice-td invoice-td-right">${it.unitPrice ? it.unitPrice.toLocaleString() : ''}</td>
      <td class="invoice-td invoice-td-right">${it.supply ? it.supply.toLocaleString() : ''}</td>
      <td class="invoice-td invoice-td-right">${it.vat ? it.vat.toLocaleString() : ''}</td>
    </tr>`;
  }).join('');

  const totalQty = items.reduce((s, i) => s + (i.qty || 0), 0);

  return `
<div class="invoice-wrap">
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
      </tr>
    </thead>
    <tbody>${itemRowsHTML}</tbody>
    <tfoot>
      <tr class="invoice-total-row">
        <td class="invoice-td invoice-td-center">합계</td>
        <td class="invoice-td"></td>
        <td class="invoice-td invoice-td-right">${totalQty.toLocaleString()}</td>
        <td class="invoice-td"></td>
        <td class="invoice-td invoice-td-right">${invoice.totalSupply ? invoice.totalSupply.toLocaleString() : 0}</td>
        <td class="invoice-td invoice-td-right">${invoice.totalVat ? invoice.totalVat.toLocaleString() : 0}</td>
      </tr>
    </tfoot>
  </table>

  <div class="invoice-summary">
    <div class="invoice-summary-row">
      <span class="invoice-summary-label">공급가액</span>
      <span class="invoice-summary-value">${(invoice.totalSupply || 0).toLocaleString()} 원</span>
    </div>
    <div class="invoice-summary-row">
      <span class="invoice-summary-label">부가세</span>
      <span class="invoice-summary-value">${(invoice.totalVat || 0).toLocaleString()} 원</span>
    </div>
    <div class="invoice-summary-row invoice-summary-total">
      <span class="invoice-summary-label">합계금액</span>
      <span class="invoice-summary-value">${(invoice.totalAmount || 0).toLocaleString()} 원</span>
    </div>
    <div class="invoice-summary-row">
      <span class="invoice-summary-label">한글금액</span>
      <span class="invoice-summary-value invoice-korean-amount">${numberToKorean(invoice.totalAmount || 0)}</span>
    </div>
  </div>

  <div class="invoice-receipt">
    <div class="invoice-receipt-label">인수</div>
    <div class="invoice-receipt-stamp">(인)</div>
  </div>
</div>
`;
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
}
