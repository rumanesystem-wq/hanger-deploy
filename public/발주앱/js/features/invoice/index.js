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
    // 관리자 여부 — 발주자는 새 invoice 생성 불가 (읽기 전용)
    const _isAdminUser = (typeof isAdmin === 'function') && isAdmin();
    // C1 보강 (Codex): 발주자는 본인 발주서만 접근 — 다른 발주자 명세서 콘솔 우회 차단
    if (!_isAdminUser) {
      const _curId = (typeof currentUser !== 'undefined' && currentUser && currentUser.id) || '';
      if (!_curId || order.createdBy !== _curId) {
        if (typeof toast === 'function') toast('본인이 등록한 발주서만 거래명세서를 조회할 수 있습니다.', 'warning');
        return;
      }
    }
    // 활성 invoice 찾기 (cancelled 제외)
    const existing = await getInvoicesByOrderNum(order.orderNum);
    const active = (existing || []).filter(i => i && !i.cancelled);
    if (active.length > 0) {
      // M2 fix: 발주자는 active 중 sentToCustomer=true 인 최신 건 노출 (관리자는 가장 최신)
      let target = active[active.length - 1];
      if (!_isAdminUser) {
        const sentList = active.filter(i => i.sentToCustomer);
        if (sentList.length === 0) {
          if (typeof toast === 'function') toast('아직 거래명세서가 전송되지 않았습니다. 관리자에게 문의하세요.', 'warning');
          return;
        }
        target = sentList[sentList.length - 1];
      }
      openInvoiceModal(target, 'view');
      _setupInvoiceModalButtons(target);
      if (!_isAdminUser) _applyReadonlyMode();
      return;
    }
    // 발주자가 호출했고 invoice가 없으면 신규 생성 금지 (관리자 흐름 보호)
    if (!_isAdminUser) {
      if (typeof toast === 'function') toast('아직 거래명세서가 발급되지 않았습니다. 관리자에게 문의하세요.', 'warning');
      return;
    }
    const draft = orderToInvoice(order);
    const zeroItems = findZeroPriceItems(draft);
    if (zeroItems.length > 0) {
      const msg = '단가 미등록 항목이 있어 거래명세서를 발급할 수 없습니다.\n→ ' + zeroItems.join(', ') + '\n\n가격표에 등록 후 다시 시도해주세요.';
      if (typeof toast === 'function') toast(msg, 'error');
      else alert(msg);
      return;
    }
    const dateKey = (draft.shipDate || '').replace(/-/g, '');
    const existingSerials = await getInvoicesByDate(dateKey);
    draft.serial = generateSerial(draft.shipDate || '', existingSerials);
    const saved = await saveInvoice(draft);
    openInvoiceModal(saved, 'preview');
    _setupInvoiceModalButtons(saved);
  } catch (e) {
    console.error('[Invoice] openFromOrder 실패:', e && e.message, e && e.stack);
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
  // H2 fix: 발주자 우회 차단 — 미전송/취소 invoice는 발주자가 열 수 없음
  const _isAdminUser = (typeof isAdmin === 'function') && isAdmin();
  if (!_isAdminUser) {
    if (!invoice || invoice.cancelled || !invoice.sentToCustomer) {
      if (typeof toast === 'function') toast('아직 전송되지 않은 거래명세서입니다.', 'warning');
      return;
    }
    // C1 보강 (Codex): 발주자는 본인 발주서의 invoice만 열람 가능
    try {
      const _curId = (typeof currentUser !== 'undefined' && currentUser && currentUser.id) || '';
      const orders = (typeof DB !== 'undefined' && typeof DB.get === 'function') ? DB.get('orders', []) : [];
      const order = orders.find(o => o && o.orderNum === invoice.orderNum);
      if (!_curId || !order || order.createdBy !== _curId) {
        if (typeof toast === 'function') toast('본인이 등록한 발주서만 거래명세서를 조회할 수 있습니다.', 'warning');
        return;
      }
    } catch (_e) {
      if (typeof toast === 'function') toast('권한 확인 중 오류가 발생했습니다.', 'error');
      return;
    }
  }
  openInvoiceModal(invoice, 'view');
  _setupInvoiceModalButtons(invoice);
  if (!_isAdminUser) _applyReadonlyMode();
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
        console.error('[Invoice] 저장 실패:', e && e.message, e && e.stack);
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
        console.error('[Invoice] PDF 생성 실패:', e && e.message, e && e.stack);
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

/**
 * 발주자(관리자 아님) 모달 진입 시 읽기 전용 처리
 * - 모든 contenteditable 비활성화
 * - 행 추가/삭제 버튼 숨김
 * - 저장 버튼 숨김
 * - PDF/인쇄/닫기는 유지
 */
function _applyReadonlyMode() {
  const modal = document.getElementById('invoiceModal');
  if (!modal) return;
  modal.querySelectorAll('[contenteditable]').forEach(el => {
    el.setAttribute('contenteditable', 'false');
    el.classList.remove('invoice-editable');
    el.style.background = 'transparent';
    el.style.cursor = 'default';
  });
  modal.querySelectorAll('.invoice-row-del, .invoice-add-row-btn, .invoice-add-row-wrap').forEach(el => {
    el.style.display = 'none';
  });
  const btnSave = document.getElementById('invoiceBtnSave');
  if (btnSave) btnSave.style.display = 'none';
}

async function _listInvoices(orderNum) {
  // Codex 3차 보강: 권한 체크 — 관리자 외에는 본인 발주서 + sentToCustomer만 노출
  const all = await getInvoicesByOrderNum(orderNum);
  const _isAdminUser = (typeof isAdmin === 'function') && isAdmin();
  if (_isAdminUser) return all;
  try {
    const _curId = (typeof currentUser !== 'undefined' && currentUser && currentUser.id) || '';
    const orders = (typeof DB !== 'undefined' && typeof DB.get === 'function') ? DB.get('orders', []) : [];
    const order = orders.find(o => o && o.orderNum === orderNum);
    if (!_curId || !order || order.createdBy !== _curId) return [];
    return (all || []).filter(i => i && !i.cancelled && i.sentToCustomer);
  } catch (_e) {
    return [];
  }
}

/**
 * 자동 거래명세서 발급 (모달 없이 백그라운드 saveInvoice만)
 * 발주확정 시점에 orders.js에서 호출
 * 이미 활성 invoice 있으면 skip (중복 방지)
 * 실패 시 silent (발주확정은 유지, 운영 영향 0)
 * @param {Object} order
 * @returns {Promise<{created:boolean, reason?:string}>}
 */
async function _autoCreateForOrder(order) {
  try {
    if (!order || !order.orderNum) {
      return { created: false, reason: 'orderNum 없음' };
    }
    // C2 보강 (Codex): 관리자 외 자동발급 트리거 차단
    // 정상 호출은 발주확정(toggleOrderLock) — 관리자만 가능. 콘솔 우회 방어.
    if (typeof isAdmin !== 'function' || !isAdmin()) {
      console.warn('[Invoice] autoCreateForOrder: 권한 없음 — 차단');
      return { created: false, reason: '권한 없음' };
    }
    // 활성 invoice 이미 있으면 skip (cancelled는 무시 — 새로 발급)
    const existing = await getInvoicesByOrderNum(order.orderNum);
    const active = (existing || []).filter(i => i && !i.cancelled);
    if (active.length > 0) {
      return { created: false, reason: '이미 활성 invoice 있음' };
    }
    const draft = orderToInvoice(order);
    const zeroItems = findZeroPriceItems(draft);
    if (zeroItems.length > 0) {
      if (typeof toast === 'function') {
        toast('⚠ 거래명세서 자동발급 보류: 단가 미등록 항목 → ' + zeroItems.join(', '), 'warning');
      }
      console.warn('[Invoice] autoCreate skip (zero-price):', draft.orderNum, zeroItems);
      return { created: false, reason: '단가 0원 항목 있음: ' + zeroItems.join(', ') };
    }
    const dateKey = (draft.shipDate || '').replace(/-/g, '');
    const existingSerials = await getInvoicesByDate(dateKey);
    draft.serial = generateSerial(draft.shipDate || '', existingSerials);
    await saveInvoice(draft);
    if (typeof toast === 'function') {
      toast('거래명세서가 자동 발급되었습니다. (' + draft.orderNum + ')', 'success');
    }
    return { created: true };
  } catch (e) {
    console.error('[Invoice] autoCreateForOrder 실패:', e && e.message, e && e.stack);
    if (typeof toast === 'function') {
      toast('거래명세서 자동 발급 실패: ' + (e && e.message), 'error');
    }
    return { created: false, reason: e && e.message };
  }
}

/**
 * 발주확정 취소 시 거래명세서 취소 처리 (cancelled=true 플래그)
 * 실패 시 silent
 * @param {string} orderNum
 * @returns {Promise<{cancelled:number}>}
 */
async function _cancelByOrderNum(orderNum) {
  try {
    // C2 보강 (Codex): 관리자 외 호출 차단
    if (typeof isAdmin !== 'function' || !isAdmin()) {
      console.warn('[Invoice] cancelByOrderNum: 권한 없음 — 차단');
      return { cancelled: 0, reason: '권한 없음' };
    }
    const count = await cancelInvoiceByOrderNum(orderNum);
    if (count > 0 && typeof toast === 'function') {
      toast('거래명세서 ' + count + '건 취소되었습니다.', 'warning');
    }
    return { cancelled: count };
  } catch (e) {
    console.error('[Invoice] cancelByOrderNum 실패:', e && e.message, e && e.stack);
    if (typeof toast === 'function') {
      toast('거래명세서 취소 실패: ' + (e && e.message), 'error');
    }
    return { cancelled: 0 };
  }
}

/**
 * 발주자 전송 상태 토글 — 관리자가 정산 페이지에서 호출
 * @param {string} orderNum
 * @param {boolean} sent
 * @returns {Promise<{updated:number}>}
 */
async function _setSentByOrderNum(orderNum, sent) {
  try {
    // C2 보강 (Codex): 관리자 외 호출 차단 (콘솔 우회 방지)
    if (typeof isAdmin !== 'function' || !isAdmin()) {
      if (typeof toast === 'function') toast('권한이 없습니다.', 'error');
      return { updated: 0, reason: '권한 없음' };
    }
    const count = await setInvoiceSent(orderNum, sent);
    if (typeof toast === 'function') {
      if (count > 0) {
        toast(sent ? '거래명세서가 발주자에게 전송되었습니다.' : '전송이 취소되었습니다.', 'success');
      } else {
        toast('발급된 거래명세서가 없습니다. 먼저 발급해주세요.', 'warning');
      }
    }
    return { updated: count };
  } catch (e) {
    console.error('[Invoice] setSentByOrderNum 실패:', e && e.message, e && e.stack);
    if (typeof toast === 'function') toast('전송 상태 변경 실패: ' + (e && e.message), 'error');
    return { updated: 0 };
  }
}

window.LumaneInvoice = {
  openFromOrder:     _openFromOrder,
  openFromSaved:     _openFromSaved,
  list:              _listInvoices,
  autoCreateForOrder: _autoCreateForOrder,
  cancelByOrderNum:  _cancelByOrderNum,
  setSentByOrderNum: _setSentByOrderNum
};

(function () {
  const overlay = document.getElementById('invoiceModal');
  if (overlay) {
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) _closeInvoiceModal();
    });
  }
})();
