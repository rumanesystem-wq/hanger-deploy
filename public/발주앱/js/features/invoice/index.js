// ============================================================
// features/invoice/index.js — 거래명세서 외부 노출 API
// 의존: types.js, utils.js, query.js, render.js, pdf.js, print.js
// ============================================================

async function _openFromOrder(order) {
  // inflight 가드 — 같은 발주서로 더블 클릭 시 중복 invoice 저장 방지
  if (window._invoiceOpenInFlight) return;
  window._invoiceOpenInFlight = true;
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
  } finally {
    window._invoiceOpenInFlight = false;
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

// 모달 footer에 저장 버튼 동적 추가 (1회만)
function _ensureSaveButton() {
  if (document.getElementById('invoiceBtnSave')) return document.getElementById('invoiceBtnSave');
  const btnClose = document.getElementById('invoiceBtnClose');
  if (!btnClose || !btnClose.parentNode) return null;
  const btn = document.createElement('button');
  btn.id = 'invoiceBtnSave';
  btn.type = 'button';
  btn.className = 'btn btn-primary';
  btn.style.cssText = 'background:#15803d;color:#fff;border:none;padding:8px 18px;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer;margin-right:6px';
  btn.innerHTML = '<i class="fas fa-save"></i> 저장';
  btnClose.parentNode.insertBefore(btn, btnClose);
  return btn;
}

function _setupInvoiceModalButtons(invoice) {
  const btnPdf   = document.getElementById('invoiceBtnPdf');
  const btnPrint = document.getElementById('invoiceBtnPrint');
  const btnClose = document.getElementById('invoiceBtnClose');
  const btnSave  = _ensureSaveButton();
  const content  = document.getElementById('invoiceContent');

  if (btnSave) {
    btnSave.onclick = async () => {
      if (btnSave.disabled) return;
      const originalHtml = btnSave.innerHTML;
      btnSave.disabled = true;
      btnSave.innerHTML = '저장 중...';
      try {
        const collected = (typeof window._collectInvoiceFromDOM === 'function')
          ? window._collectInvoiceFromDOM(invoice)
          : invoice;
        await updateInvoice(collected);
        if (typeof toast === 'function') toast('거래명세서가 저장되었습니다.', 'success');
        else alert('거래명세서가 저장되었습니다.');
        // 저장된 객체를 기준으로 핸들러 재바인딩 (다음 저장도 최신본 사용)
        invoice = collected;
      } catch (e) {
        console.error('[Invoice] 저장 실패:', e && e.message);
        if (typeof toast === 'function') toast('저장 중 오류가 발생했습니다.', 'error');
        else alert('저장 중 오류가 발생했습니다.');
      } finally {
        btnSave.disabled = false;
        btnSave.innerHTML = originalHtml;
      }
    };
  }

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
