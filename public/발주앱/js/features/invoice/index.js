// ============================================================
// features/invoice/index.js — 거래명세서 외부 노출 API
// 의존: types.js, utils.js, query.js, render.js, pdf.js, print.js
// ============================================================

async function _openFromOrder(order) {
  try {
    // 발주번호 없으면 중복 방지 보장 불가 — 진행 중단
    if (!order || !order.orderNum) {
      if (typeof toast === 'function') toast('발주번호가 없어 거래명세서를 생성할 수 없습니다.', 'error');
      console.warn('[Invoice] openFromOrder: missing orderNum', order);
      return;
    }
    // 중복 저장 방지: 같은 발주번호의 거래명세서가 이미 있으면 그걸 재사용
    const existing = await getInvoicesByOrderNum(order.orderNum);
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
    btnPdf.onclick = async () => {
      if (btnPdf.disabled) return;
      const filename = _safeFileName(`거래명세서_${invoice.deliveryTo || ''}_${invoice.serial || invoice.orderNum || ''}`) + '.pdf';
      const originalHtml = btnPdf.innerHTML;
      btnPdf.disabled = true;
      btnPdf.innerHTML = '생성 중...';
      try {
        await downloadInvoicePDF(content, filename);
      } catch (e) {
        console.error('[Invoice] PDF 생성 실패:', e && e.message);
        if (typeof toast === 'function') toast('PDF 생성 중 오류가 발생했습니다.', 'error');
      } finally {
        btnPdf.disabled = false;
        btnPdf.innerHTML = originalHtml;
      }
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
