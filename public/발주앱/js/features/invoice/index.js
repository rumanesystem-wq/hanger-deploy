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
      if (_isAdminUser && target.needsManualReview && target.pendingAutoDraft) {
        const serverSignature = invoiceContentSignature(target);
        const serverUpdatedAt = target.updatedAt || '';
        target = {
          ...target,
          ...target.pendingAutoDraft,
          id: target.id,
          serial: target.serial,
          createdAt: target.createdAt,
          createdBy: target.createdBy,
          issuerName: target.issuerName,
          revision: target.revision,
          needsManualReview: true,
          _expectedServerSignature: serverSignature,
          _expectedServerUpdatedAt: serverUpdatedAt
        };
        if (typeof toast === 'function') toast('최신 발주 내용을 명세서에 불러왔습니다. 확인 후 저장·전송해주세요.', 'warning');
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

async function _openFromSaved(invoice) {
  // H2 fix: 발주자 우회 차단 — 미전송/취소 invoice는 발주자가 열 수 없음
  const _isAdminUser = (typeof isAdmin === 'function') && isAdmin();
  if (!_isAdminUser) {
    if (!invoice || invoice.cancelled || !invoice.sentToCustomer) {
      if (typeof toast === 'function') toast('아직 전송되지 않은 거래명세서입니다.', 'warning');
      return;
    }
    // C1 보강 (Codex): 발주자는 본인 발주서의 invoice만 열람 가능
    // [2026-08-03 B2] Phase 5 후 DB.get('orders') stale 가능 → 로컬 miss 시 서버 fresh fetch
    try {
      const _curId = (typeof currentUser !== 'undefined' && currentUser && currentUser.id) || '';
      let orders = (typeof DB !== 'undefined' && typeof DB.get === 'function') ? DB.get('orders', []) : [];
      let order = orders.find(o => o && o.orderNum === invoice.orderNum);
      if (!order && window._FS && typeof window._FS.getAllOrders === 'function') {
        try {
          const fresh = await window._FS.getAllOrders({ fromServer: true });
          if (Array.isArray(fresh)) order = fresh.find(o => o && o.orderNum === invoice.orderNum);
        } catch (_e2) { /* fresh 실패 → order 미확인 상태 유지 */ }
      }
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
        const expectedSignature = invoice._expectedServerSignature || invoiceContentSignature(invoice);
        const expectedUpdatedAt = invoice._expectedServerUpdatedAt;
        delete collected._expectedServerSignature;
        delete collected._expectedServerUpdatedAt;
        const savedInvoice = await updateInvoice(collected, {
          reason: 'manual-edit',
          markManual: true,
          expectedSignature,
          expectedUpdatedAt
        });
        if (typeof toast === 'function') toast('거래명세서가 저장되었습니다.', 'success');
        else alert('거래명세서가 저장되었습니다.');
        // 저장된 객체를 기준으로 핸들러 재바인딩 (다음 저장도 최신본 사용)
        invoice = savedInvoice;
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
      const filename = _safeFileName(`거래명세서_${invoice.deliveryTo || ''}_${invoice.serial || invoice.orderNum || ''}_Rev${Math.max(1, Number(invoice.revision) || 1)}`) + '.pdf';
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
    // [2026-08-03 B2] Phase 5 후 DB.get('orders') stale 가능 → 로컬 miss 시 서버 fresh fetch
    let orders = (typeof DB !== 'undefined' && typeof DB.get === 'function') ? DB.get('orders', []) : [];
    let order = orders.find(o => o && o.orderNum === orderNum);
    if (!order && window._FS && typeof window._FS.getAllOrders === 'function') {
      try {
        const fresh = await window._FS.getAllOrders({ fromServer: true });
        if (Array.isArray(fresh)) order = fresh.find(o => o && o.orderNum === orderNum);
      } catch (_e2) { /* fresh 실패 → order 미확인 상태 유지 */ }
    }
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
async function _autoCreateForOrderLegacy(order) {
  // [2026-07-31 H1] 같은 orderNum 재발급 중복 방지 (같은 브라우저 다중 탭·재시도 race)
  if (typeof window !== 'undefined') {
    window._invoiceAutoInflight = window._invoiceAutoInflight || {};
    const _ordKey = order && order.orderNum;
    if (_ordKey && window._invoiceAutoInflight[_ordKey]) {
      return { created: false, reason: '이미 발급 진행 중' };
    }
    if (_ordKey) window._invoiceAutoInflight[_ordKey] = true;
  }
  try {
    if (!order || !order.orderNum) {
      return { created: false, reason: 'orderNum 없음' };
    }
    if (order.status !== '출고완료' && order.status !== '발주확정' && order.status !== '발주대기') {
      return { created: false, reason: '임시저장/취소 발주서' };
    }
    // [2026-08-03 D] 서버 최신 order 상태 재확인 (fire-and-forget 사이 다른 탭이 취소했을 가능성)
    try {
      if (window._FS && typeof window._FS.getAllOrders === 'function') {
        const fresh = await window._FS.getAllOrders({fromServer:true}).catch(() => null);
        if (Array.isArray(fresh)) {
          const freshOrder = fresh.find(o => o && o.orderNum === order.orderNum);
          if (!freshOrder) {
            return { created: false, skipped: true, reason: '발주서를 찾을 수 없음' };
          }
          const validStatuses = new Set(['출고완료', '발주확정', '발주대기']);
          if (!validStatuses.has(freshOrder.status)) {
            return { created: false, skipped: true, reason: '발주 상태 변경됨(취소 등): ' + freshOrder.status };
          }
          // 최신 order 로 갱신 (내용도 최신)
          order = freshOrder;
        }
      }
    } catch(_e) { /* fresh 확인 실패 시 그대로 진행 */ }
    // 관리자 또는 발주서 소유 발주자만 자동발급 가능
    const _isAdminUser = (typeof isAdmin === 'function') && isAdmin();
    if (!_isAdminUser) {
      const _curId = (typeof currentUser !== 'undefined' && currentUser && currentUser.id) || '';
      if (!_curId || order.createdBy !== _curId) {
        console.warn('[Invoice] autoCreateForOrder: 권한 없음 — 차단');
        return { created: false, reason: '권한 없음' };
      }
    }
    // [2026-08-03 v2] 활성 명세서 있으면 "수정" (id·serial 유지, sent=false 리셋).
    // 없으면 신규 발급. 취소+재발급 → 수정으로 변경.
    // 장점: cancelled 유령 이력 안 쌓임 / 문제 2(cancel 실패 시 공백)·3(zero-price 시 공백) 사라짐 / 원자성 확보.
    const existing = await getInvoicesByOrderNum(order.orderNum);
    const active = (existing || []).filter(i => i && !i.cancelled);
    const draft = orderToInvoice(order);

    // 실패 예방: zeroItems 는 write 전에 먼저 검사 → 실패해도 기존 명세서 그대로 보존
    const zeroItems = findZeroPriceItems(draft);
    if (zeroItems.length > 0) {
      if (typeof toast === 'function') {
        toast('⚠ 거래명세서 자동발급 보류: 단가 미등록 항목 → ' + zeroItems.join(', '), 'warning');
      }
      console.warn('[Invoice] autoCreate skip (zero-price):', draft.orderNum, zeroItems);
      return { created: false, reason: '단가 0원 항목 있음: ' + zeroItems.join(', ') };
    }

    if (active.length > 0) {
      // 활성 명세서 수정 (내용만 갱신, id·serial 보존)
      const target = active[active.length - 1]; // 가장 최근 활성
      // [2026-08-03 C] 수기 편집된 명세서는 자동 덮어쓰기 금지
      if (target._manuallyEdited === true) {
        return { created: false, skipped: true, reason: '수기 편집된 명세서 — 자동 갱신 안 함' };
      }
      // [2026-08-03] 실제 diff 없으면 skip (불필요한 sent 리셋 방지)
      const _sig = (inv) => JSON.stringify({
        totalAmount: inv && inv.totalAmount || 0,
        totalSupply: inv && inv.totalSupply || 0,
        items: (inv && inv.items || []).map(i => ({
          name: i.name || '', spec: i.spec || '', qty: i.qty || 0,
          unitPrice: i.unitPrice || 0, supply: i.supply || 0, vat: i.vat || 0
        }))
      });
      if (_sig(draft) === _sig(target)) {
        return { created: false, skipped: true, reason: '변경 없음 (기존 명세서 유지)' };
      }
      // [2026-08-03 A] update 직전 서버 최신값으로 target 재확인 — 사이에 cancel 됐으면 abort
      try {
        const freshList = await window._FS.get('invoices', {fromServer:true}).catch(() => null);
        if (Array.isArray(freshList)) {
          const freshTarget = freshList.find(i => i && i.id === target.id);
          if (!freshTarget || freshTarget.cancelled === true) {
            return { created: false, skipped: true, reason: '명세서가 사이에 취소됨' };
          }
        }
      } catch(_e) { /* fresh 확인 실패 시 그대로 진행 */ }
      // 유령 잔존 정리: 활성 여러 개면 마지막 것 외엔 취소 처리 (원장 이중집계 방지)
      if (active.length > 1) {
        const stragglers = active.slice(0, -1);
        for (const s of stragglers) {
          try {
            await updateInvoice({ ...s, cancelled: true, cancelledAt: new Date().toISOString(), cancelReason: '중복 활성 정리' });
          } catch (e) {
            console.warn('[Invoice] 유령 활성 정리 실패 (계속 진행):', s.id, e && e.message);
          }
        }
      }
      const updated = {
        ...draft,
        id: target.id,
        serial: target.serial,
        sentToCustomer: false, // 관리자 재전송 유도
        sentAt: null,
        updatedAt: new Date().toISOString()
      };
      try {
        await updateInvoice(updated);
      } catch (updErr) {
        console.error('[Invoice] updateInvoice 실패:', updErr && updErr.message);
        if (typeof toast === 'function') {
          toast('⚠ 명세서 갱신 실패. 다시 시도하거나 관리자에게 문의하세요. ('+(updErr&&updErr.message||'')+')', 'error');
        }
        const wrapped = new Error(updErr && updErr.message || 'updateInvoice 실패');
        wrapped.handled = true;
        throw wrapped;
      }
      if (typeof toast === 'function') {
        toast('거래명세서가 갱신되었습니다. 발주자에게 다시 전송해주세요. (' + draft.orderNum + ')', 'success');
      }
      return { created: false, updated: true };
    }

    // 신규 발급
    const dateKey = (draft.shipDate || '').replace(/-/g, '');
    const existingSerials = await getInvoicesByDate(dateKey);
    draft.serial = generateSerial(draft.shipDate || '', existingSerials);
    draft.sentToCustomer = false;
    draft.sentAt = null;
    try {
      await saveInvoice(draft);
    } catch (saveErr) {
      console.error('[Invoice] saveInvoice 실패:', saveErr && saveErr.message);
      if (typeof toast === 'function') {
        toast('⚠ 명세서 저장 실패. 정산 화면에서 재발급하거나 관리자에게 문의하세요. ('+(saveErr&&saveErr.message||'')+')', 'error');
      }
      const wrapped = new Error(saveErr && saveErr.message || 'saveInvoice 실패');
      wrapped.handled = true;
      throw wrapped;
    }
    if (typeof toast === 'function') {
      toast('거래명세서가 자동 발급되었습니다. (' + draft.orderNum + ')', 'success');
    }
    return { created: true };
  } catch (e) {
    console.error('[Invoice] autoCreateForOrder 실패:', e && e.message, e && e.stack);
    if (typeof toast === 'function' && !(e && e.handled)) {
      toast('거래명세서 자동 발급 실패: ' + (e && e.message), 'error');
    }
    return { created: false, reason: e && e.message };
  } finally {
    // in-flight 해제 (방어적 optional 체이닝)
    const _wm = (typeof window !== 'undefined') ? (window && window._invoiceAutoInflight) : null;
    const _on = order && order.orderNum;
    if (_wm && _on) { delete _wm[_on]; }
  }
}

/**
 * 발주확정 취소 시 거래명세서 취소 처리 (cancelled=true 플래그)
 * 실패 시 silent
 * @param {string} orderNum
 * @returns {Promise<{cancelled:number}>}
 */
async function _autoCreateForOrder(order, options = {}) {
  if (!order || !order.orderNum) return { created: false, reason: 'orderNum 없음' };
  window._invoiceAutoInflight = window._invoiceAutoInflight || {};
  if (window._invoiceAutoInflight[order.orderNum]) {
    // [2026-08-03 B4] 연타 시 두 번째 호출이 skip → 사용자에게 상황 인지시켜 [전송] 재클릭 유도
    if (typeof toast === 'function') {
      toast('⚠ 이전 명세서 처리가 아직 진행 중입니다. 잠시 후 발주자 노출을 확인해주세요.', 'warning');
    }
    return { created: false, skipped: true, reason: '이미 명세서 처리 중' };
  }
  window._invoiceAutoInflight[order.orderNum] = true;
  try {
    const transact = _requireInvoiceTransaction();
    const adminUser = (typeof isAdmin === 'function') && isAdmin();
    const actorId = (typeof currentUser !== 'undefined' && currentUser && currentUser.id) || '';
    const proposedId = _invoiceEventId('inv', order.orderNum);
    const forceUnsend = options.forceUnsend === true;
    const reason = options.reason || 'order-save';

    const result = await transact(order.orderNum, ({ order: freshOrder, invoices }) => {
      if (!freshOrder) throw new Error('발주서를 서버에서 확인할 수 없어 명세서 처리를 중단했습니다.');
      const validStatuses = new Set(['출고완료', '발주확정', '발주대기']);
      if (!validStatuses.has(freshOrder.status)) {
        throw new Error('발주 상태가 변경되어 명세서 처리를 중단했습니다: ' + freshOrder.status);
      }
      if (!adminUser && (!actorId || freshOrder.createdBy !== actorId)) {
        throw new Error('명세서 처리 권한이 없습니다.');
      }

      const draft = orderToInvoice(freshOrder);
      const zeroItems = findZeroPriceItems(draft);
      if (zeroItems.length > 0) {
        let changed = false;
        const hidden = invoices.map(inv => {
          if (inv && inv.orderNum === freshOrder.orderNum && !inv.cancelled && inv.sentToCustomer) {
            changed = true;
            return { ...inv, sentToCustomer: false, sentAt: null, needsManualReview: true, autoUpdateError: '단가 미등록', updatedAt: new Date().toISOString() };
          }
          return inv;
        });
        return { invoices: hidden, write: changed, result: { created: false, zeroItems, unsent: changed, reason: '단가 0원 항목 있음' } };
      }

      const activeEntries = invoices
        .map((inv, idx) => ({ inv, idx }))
        .filter(x => x.inv && x.inv.orderNum === freshOrder.orderNum && !x.inv.cancelled)
        .sort((a, b) => String(a.inv.updatedAt || a.inv.createdAt || '').localeCompare(String(b.inv.updatedAt || b.inv.createdAt || '')));

      if (activeEntries.length === 0) {
        const serials = invoices.filter(i => i && i.shipDate === draft.shipDate).map(i => i.serial || '');
        const saved = {
          ...draft,
          id: proposedId,
          serial: generateSerial(draft.shipDate || '', serials),
          revision: 1,
          sentToCustomer: false,
          sentAt: null
        };
        return { invoices: [...invoices, saved], result: { created: true, invoice: saved } };
      }

      const targetEntry = activeEntries[activeEntries.length - 1];
      const target = targetEntry.inv;
      const next = [...invoices];
      activeEntries.slice(0, -1).forEach(({ inv, idx }) => {
        next[idx] = {
          ...inv,
          cancelled: true,
          cancelledAt: new Date().toISOString(),
          cancelReason: '중복 활성 정리',
          sentToCustomer: false,
          sentAt: null
        };
      });

      const contentChanged = invoiceContentSignature(draft) !== invoiceContentSignature(target);
      if (target._manuallyEdited === true && contentChanged) {
        next[targetEntry.idx] = {
          ...target,
          sentToCustomer: false,
          sentAt: null,
          needsManualReview: true,
          pendingAutoDraft: draft,
          updatedAt: new Date().toISOString()
        };
        return { invoices: next, result: { created: false, manualReview: true, reason: '수기 편집 명세서 재검토 필요' } };
      }

      if (!contentChanged) {
        if (forceUnsend && target.sentToCustomer) {
          next[targetEntry.idx] = { ...target, sentToCustomer: false, sentAt: null, updatedAt: new Date().toISOString() };
        }
        const shouldWrite = activeEntries.length > 1 || (forceUnsend && !!target.sentToCustomer);
        return {
          invoices: next,
          write: shouldWrite,
          result: { created: false, skipped: true, unsent: forceUnsend && !!target.sentToCustomer, reason: '변경 없음' }
        };
      }

      const updated = {
        ...draft,
        id: target.id,
        serial: target.serial,
        createdAt: target.createdAt,
        createdBy: target.createdBy,
        issuerName: target.issuerName,
        sentToCustomer: false,
        sentAt: null,
        _manuallyEdited: false,
        _manualEditedAt: null,
        needsManualReview: false,
        pendingAutoDraft: null,
        updatedAt: new Date().toISOString()
      };
      const revision = _invoiceRevision(target, updated, reason);
      updated.revision = revision.revision;
      revision.after = updated;
      next[targetEntry.idx] = updated;
      return { invoices: next, revision, result: { created: false, updated: true, invoice: updated } };
    });

    if (result && result.zeroItems && typeof toast === 'function') {
      toast('⚠ 거래명세서 자동발급 보류: 단가 미등록 항목 — ' + result.zeroItems.join(', '), 'warning');
    } else if (result && result.manualReview && typeof toast === 'function') {
      toast('⚠ 수기 편집 명세서와 발주 내용이 달라 발주자 노출을 중단했습니다. 명세서를 확인해주세요.', 'warning');
    } else if (result && result.updated && typeof toast === 'function') {
      toast('거래명세서가 갱신되었습니다. 발주자에게 다시 전송해주세요. (' + order.orderNum + ')', 'success');
    } else if (result && result.created && typeof toast === 'function') {
      toast('거래명세서가 자동 발급되었습니다. (' + order.orderNum + ')', 'success');
    } else if (result && result.unsent && typeof toast === 'function') {
      // [2026-08-03 B3+B6] forceUnsend 로 sent=false 리셋된 경우 명시 알림
      toast('⚠ 거래명세서가 발주자 화면에서 임시로 내려졌습니다. 다시 [전송] 눌러 노출해주세요. (' + order.orderNum + ')', 'warning');
    }
    return result || { created: false };
  } catch (e) {
    console.error('[Invoice] 안전한 자동발급 실패:', e && e.message, e && e.stack);
    if (typeof toast === 'function') toast('거래명세서 처리 실패: ' + ((e && e.message) || ''), 'error');
    // 가능한 경우 옛 전송본부터 내린다. 네트워크 자체가 끊긴 경우에는 실패 사실을 호출자까지 전달한다.
    try { await setInvoiceSent(order.orderNum, false); } catch (_hideErr) {}
    const wrapped = new Error((e && e.message) || '명세서 처리 실패');
    wrapped.invoiceHandled = true;
    throw wrapped;
  } finally {
    delete window._invoiceAutoInflight[order.orderNum];
  }
}

async function _cancelByOrderNum(orderNum) {
  try {
    // [2026-07-31] 관리자 또는 발주서 소유 발주자만 통과 (H2)
    // 소유자 확인은 서버 최신값 강제 — 로컬 폴백 stale로 인한 오통과·오차단 방지 (팀 검토 M1)
    const _isAdminUser = (typeof isAdmin === 'function') && isAdmin();
    if (!_isAdminUser) {
      const _curId = (typeof currentUser !== 'undefined' && currentUser && currentUser.id) || '';
      if (!_curId) {
        console.warn('[Invoice] cancelByOrderNum: 로그인 정보 없음 — 차단');
        return { cancelled: 0, reason: '권한 없음' };
      }
      let _serverOrders = null;
      if (typeof window !== 'undefined' && window._FS && typeof window._FS.get === 'function') {
        try {
          // [Phase 5] 옛 hanger_data/orders 얼어붙음 → 새 컬렉션 사용
          const _fetcher = (typeof window._FS.getAllOrders === 'function')
            ? window._FS.getAllOrders({ fromServer: true })
            : window._FS.get('orders', { fromServer: true });
          _serverOrders = await Promise.race([
            _fetcher,
            new Promise((_, rj) => setTimeout(() => rj(new Error('TIMEOUT')), 8000))
          ]);
        } catch (e) {
          console.warn('[Invoice] cancelByOrderNum: 서버 orders 조회 실패 — 차단', e && e.message);
          return { cancelled: 0, reason: '서버 확인 실패' };
        }
      } else {
        _serverOrders = (typeof DB !== 'undefined' && typeof DB.get === 'function') ? DB.get('orders', []) : [];
      }
      const _own = Array.isArray(_serverOrders) && _serverOrders.find(o => o && o.orderNum === orderNum && o.createdBy === _curId);
      if (!_own) {
        console.warn('[Invoice] cancelByOrderNum: 권한 없음 — 차단');
        return { cancelled: 0, reason: '권한 없음' };
      }
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
