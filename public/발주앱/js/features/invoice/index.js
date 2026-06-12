// ============================================================
// features/invoice/index.js — 거래명세서 외부 노출 API
// 의존: types.js, utils.js, query.js, render.js, pdf.js, print.js
// ============================================================

async function _openFromOrder(order) {
  try {
    // 중복 저장 방지: 같은 발주번호의 거래명세서가 이미 있으면 그걸 재사용
    const existing = await getInvoicesByOrderNum(order.orderNum || '');
    if (existing && existing.length > 0) {
      const latest = existing[existing.length - 1];
      openInvoiceModal(latest, 'view');
      _setupInvoiceModalButtons(latest);
      return;
    }
    const draft = orderToInvoice(order);
    const dateKey = (draft.shipDate || '').replace(/-/g, '');
    const existingSerials = await getInvoicesByDate(dateKey);
    draft.serial = generateSerial(draft.shipDate || '', existingSerials);
    const saved = await saveInvoice(draft);
    openInvoiceModal(saved, 'preview');
    _setupInvoiceModalButtons(saved);
  } catch (e) {
    console.error('[Invoice] openFromOrder 실패:', e && e.message);
    if (typeof toast === 'function') toast('거래명세서 생성 중 오류가 발생했습니다.', 'error');
  }
}

// 파일명 sanitize: 경로 트래버설/Windows 예약 문자 제거
function _safeFileName(name) {
  return String(name || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 100);
}

function _openFromSaved(invoice) {
  openInvoiceModal(invoice, 'view');
  _setupInvoiceModalButtons(invoice);
}

function _setupInvoiceModalButtons(invoice) {
  const btnPdf   = document.getElementById('invoiceBtnPdf');
  const btnPrint = document.getElementById('invoiceBtnPrint');
  const btnClose = document.getElementById('invoiceBtnClose');
  const content  = document.getElementById('invoiceContent');

  if (btnPdf) {
    btnPdf.onclick = () => {
      const filename = _safeFileName(`거래명세서_${invoice.deliveryTo || ''}_${invoice.serial || invoice.orderNum || ''}`) + '.pdf';
      downloadInvoicePDF(content, filename);
    };
  }
  if (btnPrint) {
    btnPrint.onclick = () => printInvoice();
  }
  if (btnClose) {
    btnClose.onclick = () => _closeInvoiceModal();
  }
}

function _closeInvoiceModal() {
  const modal = document.getElementById('invoiceModal');
  if (modal) modal.style.display = 'none';
}

async function _listInvoices(orderNum) {
  return getInvoicesByOrderNum(orderNum);
}

window.LumaneInvoice = {
  openFromOrder: _openFromOrder,
  openFromSaved: _openFromSaved,
  list:          _listInvoices
};

(function () {
  const overlay = document.getElementById('invoiceModal');
  if (overlay) {
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) _closeInvoiceModal();
    });
  }
})();
