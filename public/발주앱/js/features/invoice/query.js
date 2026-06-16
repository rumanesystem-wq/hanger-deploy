// ============================================================
// features/invoice/query.js — 거래명세서 Firestore 쿼리
// Q1=B: hanger_data/invoices 문서 배열 push (핫픽스 A 패턴)
// 로컬 폴백 금지 — 서버 미수신 시 빈 배열 반환 + console.warn
// ============================================================

const INVOICE_DOC_KEY = 'invoices';

/**
 * 안전 fetch + 가드: invoices 통째 덮어쓰기 시나리오 차단
 *   1. _FS.get이 null/undefined 반환 시 throw (저장 중단)
 *   2. 반환된 list가 비배열 + 비-falsy면 throw (예상 외 형식)
 * @returns {Promise<Array>}
 */
async function _safeFetchInvoiceList() {
  if (!window._FS) throw new Error('[Invoice] _FS 미초기화');
  const list = await window._FS.get(INVOICE_DOC_KEY);
  // null/undefined: 진짜 처음(컬렉션 없음) 또는 일시 실패 — 구분 불가하므로 빈 배열 가정 단, 추가 가드
  if (list === null || list === undefined) {
    return null; // 호출처에서 별도 처리 (신규/실패 구분)
  }
  if (!Array.isArray(list)) {
    throw new Error('[Invoice] invoices 형식 불일치 — 저장 중단');
  }
  return list;
}

/**
 * 저장 직전 운영 DB 재검증 — 동시 수정·sync 깨짐 감지
 * 우리가 가진 list보다 운영 list가 더 크면 → 다른 호출이 데이터 추가했음 → 저장 중단
 * @param {Array} ourList - 저장 직전 우리가 갖고 있는 list
 * @returns {Promise<void>} 안전하면 그냥 끝, 위험하면 throw
 */
async function _verifyBeforeSave(ourList) {
  const verify = await window._FS.get(INVOICE_DOC_KEY);
  if (verify === null || verify === undefined) return; // 신규
  if (!Array.isArray(verify)) {
    throw new Error('[Invoice] 재검증 형식 불일치 — 저장 중단');
  }
  if (verify.length > ourList.length) {
    throw new Error(`[Invoice] 동시 수정 감지 (DB ${verify.length}건 > 우리 ${ourList.length}건) — 저장 중단, 새로고침 후 재시도`);
  }
}

/**
 * 거래명세서 저장 — hanger_data/invoices 문서의 배열에 push
 * 안전망:
 *   1. _safeFetchInvoiceList — null/형식 가드
 *   2. push 후 길이 검증 (절대 줄어들 수 없음)
 *   3. _verifyBeforeSave — 직전 재검증 (동시 수정 차단)
 * @param {Invoice} invoice
 * @returns {Promise<Invoice>}
 */
async function saveInvoice(invoice) {
  let list = await _safeFetchInvoiceList();
  // 처음 (null) 케이스: 빈 배열로 시작 — 단, 이 경우 운영 invoices가 정말 0건이어야 함
  // recheck로 확인
  if (list === null) {
    const recheck = await window._FS.get(INVOICE_DOC_KEY);
    if (recheck === null || recheck === undefined) {
      list = []; // 진짜 신규
    } else if (Array.isArray(recheck)) {
      list = recheck; // 사이에 누가 만든 거 사용
    } else {
      throw new Error('[Invoice] recheck 형식 불일치 — 저장 중단');
    }
  }
  const beforeLen = list.length;
  const saved = { ...invoice, id: 'inv_' + Date.now() };
  list.push(saved);
  if (list.length !== beforeLen + 1) {
    throw new Error('[Invoice] push 후 길이 불일치 — 저장 중단');
  }
  // 저장 직전 운영 DB 재검증 (동시 수정 차단)
  await _verifyBeforeSave({ length: beforeLen });
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
 * 안전망: _safeFetchInvoiceList + 길이 가드(교체는 같음, 신규는 +1) + recheck
 * @param {Invoice} invoice - id 필수, 이외 필드는 갱신될 최종값
 * @returns {Promise<Invoice>}
 */
async function updateInvoice(invoice) {
  if (!invoice || !invoice.id) throw new Error('[Invoice] update: id 없음');
  let list = await _safeFetchInvoiceList();
  if (list === null) {
    const recheck = await window._FS.get(INVOICE_DOC_KEY);
    if (recheck === null || recheck === undefined) {
      list = [];
    } else if (Array.isArray(recheck)) {
      list = recheck;
    } else {
      throw new Error('[Invoice] recheck 형식 불일치 — 저장 중단');
    }
  }
  const beforeLen = list.length;
  const idx = list.findIndex(inv => inv && inv.id === invoice.id);
  if (idx < 0) {
    // 기존에 없으면 push (신규로 취급)
    list.push(invoice);
    if (list.length !== beforeLen + 1) {
      throw new Error('[Invoice] push 후 길이 불일치 — 저장 중단');
    }
  } else {
    list[idx] = invoice;
    if (list.length !== beforeLen) {
      throw new Error('[Invoice] 교체 후 길이 변화 — 저장 중단');
    }
  }
  // 저장 직전 운영 DB 재검증
  await _verifyBeforeSave({ length: beforeLen });
  await window._FS.set(INVOICE_DOC_KEY, list);
  return invoice;
}

/**
 * 발주확정 취소 시 — 해당 orderNum의 활성 invoice에 cancelled=true 플래그
 * 삭제 X (사용자 수기 편집값 보존 + 복구 가능)
 * 5중 안전망 동일 적용
 * @param {string} orderNum
 * @returns {Promise<number>} 취소 처리된 invoice 수
 */
async function cancelInvoiceByOrderNum(orderNum) {
  if (!window._FS) throw new Error('[Invoice] _FS 미초기화');
  if (!orderNum) return 0;
  let list = await _safeFetchInvoiceList();
  if (list === null) return 0;
  const beforeLen = list.length;
  let changed = 0;
  const newList = list.map(inv => {
    if (inv && inv.orderNum === orderNum && !inv.cancelled) {
      changed++;
      return { ...inv, cancelled: true, cancelledAt: new Date().toISOString() };
    }
    return inv;
  });
  if (changed === 0) return 0;
  if (newList.length !== beforeLen) throw new Error('[Invoice] cancel: 길이 변경 — 저장 중단');
  await _verifyBeforeSave({ length: beforeLen });
  await window._FS.set(INVOICE_DOC_KEY, newList);
  return changed;
}

/**
 * 발주자 전송 상태 토글 — 해당 orderNum의 활성 invoice의 sentToCustomer 갱신
 * 5중 안전망 동일 적용
 * @param {string} orderNum
 * @param {boolean} sent
 * @returns {Promise<number>} 갱신된 invoice 수
 */
async function setInvoiceSent(orderNum, sent) {
  if (!window._FS) throw new Error('[Invoice] _FS 미초기화');
  if (!orderNum) return 0;
  let list = await _safeFetchInvoiceList();
  if (list === null) return 0;
  const beforeLen = list.length;
  let changed = 0;
  const newList = list.map(inv => {
    if (inv && inv.orderNum === orderNum && !inv.cancelled) {
      changed++;
      return { ...inv, sentToCustomer: !!sent, sentAt: sent ? new Date().toISOString() : null };
    }
    return inv;
  });
  if (changed === 0) return 0;
  if (newList.length !== beforeLen) throw new Error('[Invoice] setSent: 길이 변경 — 저장 중단');
  await _verifyBeforeSave({ length: beforeLen });
  await window._FS.set(INVOICE_DOC_KEY, newList);
  return changed;
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
