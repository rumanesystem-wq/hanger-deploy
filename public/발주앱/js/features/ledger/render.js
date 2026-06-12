// ============================================================
// features/ledger/render.js — 거래처 원장 UI 렌더 + 이벤트
// 의존: shared/format.js, ./types.js, ./utils.js, ./validate.js, ./query.js
// ============================================================

/** @type {string|null} */
let currentCustomer = null;

/** @type {boolean} */
let onlyUnpaid = false;

/**
 * 기간 필터 (YYYY-MM-DD). 빈 문자열이면 전체.
 * @type {{startDate: string, endDate: string}}
 */
let dateRange = { startDate: '', endDate: '' };

// ============================================================
// 화면 전환
// ============================================================
/**
 * 거래처 목록 화면으로 전환
 * @returns {void}
 */
function showListView() {
  currentCustomer = null;
  document.getElementById('view-list').classList.remove('hidden');
  document.getElementById('view-detail').classList.add('hidden');
  renderCustomerList();
}

/**
 * 거래처 원장 상세 화면으로 전환
 * @param {string} name - 납품처 이름
 * @returns {Promise<void>}
 */
async function showDetailView(name) {
  currentCustomer = name;
  document.getElementById('view-list').classList.add('hidden');
  document.getElementById('view-detail').classList.remove('hidden');

  // 기본 기간: 이번 달 1일 ~ 오늘
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const startOfMonth = `${yyyy}-${mm}-01`;
  const todayStr = `${yyyy}-${mm}-${dd}`;
  dateRange.startDate = startOfMonth;
  dateRange.endDate = todayStr;
  const startInp = document.getElementById('ec-start-date');
  const endInp = document.getElementById('ec-end-date');
  if (startInp) startInp.value = startOfMonth;
  if (endInp) endInp.value = todayStr;

  // 납품처 검색 datalist 채우기 + 현재 거래처 표시
  await refreshCustomerSearchOptions();
  const searchInp = document.getElementById('ec-customer-search');
  if (searchInp) searchInp.value = name;

  await renderCustomerDetail();
}

/**
 * 납품처 검색 datalist 옵션 채우기 (모든 거래처 이름)
 */
async function refreshCustomerSearchOptions() {
  const dl = document.getElementById('ec-customer-list');
  if (!dl) return;
  const [orders, payments] = await Promise.all([fetchAllCompletedOrders(), fetchAllPayments()]);
  const summaries = listCustomersSummary(orders, payments);
  dl.innerHTML = summaries
    .map(s => `<option value="${escapeHtml(s.name)}"></option>`)
    .join('');
}

/**
 * 납품처 검색 input 변경 핸들러
 * datalist에서 선택하거나 정확히 일치하는 이름 입력 시 그 거래처로 전환
 */
async function handleCustomerSearch() {
  const inp = document.getElementById('ec-customer-search');
  if (!inp) return;
  const value = inp.value.trim();
  if (!value || value === currentCustomer) return;

  // 정확히 일치하는 거래처가 있는지 확인
  const [orders, payments] = await Promise.all([fetchAllCompletedOrders(), fetchAllPayments()]);
  const summaries = listCustomersSummary(orders, payments);
  const exact = summaries.find(s => s.name === value);
  if (exact) {
    await showDetailView(value);
  }
}

// ============================================================
// 거래처 목록 렌더
// ============================================================
/**
 * 거래처 목록 표를 가져와서 #tbody-customers에 렌더
 * onlyUnpaid 플래그 ON 이면 미수금 > 0 인 거래처만 표시
 * @returns {Promise<void>}
 */
async function renderCustomerList() {
  const [orders, payments] = await Promise.all([fetchAllCompletedOrders(), fetchAllPayments()]);
  const summaries = listCustomersSummary(orders, payments);
  const filtered = onlyUnpaid ? summaries.filter(s => s.balance > 0) : summaries;

  const tbody = document.getElementById('tbody-customers');
  tbody.innerHTML = '';

  filtered.forEach(s => {
    tbody.insertAdjacentHTML('beforeend', `
      <tr class="paid" onclick="showDetailView('${escapeHtml(s.name)}')">
        <td><strong>${escapeHtml(s.name)}</strong></td>
        <td class="num">${s.orderCount}건</td>
        <td class="num">${fmtMoney(s.totalOut)}</td>
        <td class="num" style="color:#15803d">${fmtMoney(s.totalIn)}</td>
        <td class="center"><button class="btn-view" onclick="event.stopPropagation(); showDetailView('${escapeHtml(s.name)}')">▶ 원장 보기</button></td>
      </tr>
    `);
  });
}

// ============================================================
// 거래처 원장 상세 렌더
// ============================================================
/**
 * 현재 선택된 거래처(currentCustomer)의 원장 상세를 렌더
 * 요약 카드 + 시간순 출고/입금 통합 표 + 잔액 누적 표시
 * @returns {Promise<void>}
 */
async function renderCustomerDetail() {
  if (!currentCustomer) return;
  const [orders, payments] = await Promise.all([fetchAllCompletedOrders(), fetchAllPayments()]);
  const stats = calcCustomerStats(currentCustomer, orders, payments);

  // 헤더: 거래처명·기간
  document.getElementById('ec-doc-customer-name').textContent = currentCustomer;
  const periodText = (dateRange.startDate && dateRange.endDate)
    ? `${formatDateSlash(dateRange.startDate)} ~ ${formatDateSlash(dateRange.endDate)}`
    : '전체 기간';
  document.getElementById('ec-doc-period').textContent = periodText;

  // 본문: 이월잔액 → 거래 행 → 월별 계 → 누계
  renderEcountLedgerBody(stats, dateRange);

  // 출력 시각
  document.getElementById('ec-print-time').textContent = formatPrintTime(new Date());
}

/**
 * 날짜 YYYY-MM-DD → YYYY/MM/DD
 * @param {string} dateStr
 * @returns {string}
 */
function formatDateSlash(dateStr) {
  if (!dateStr) return '';
  return dateStr.replace(/-/g, '/');
}

/**
 * 날짜 YYYY-MM-DD → YYYY/MM/DD -N (N=해당 날짜의 순번)
 * @param {string} dateStr
 * @param {number} seq
 * @returns {string}
 */
function formatDateSeq(dateStr, seq) {
  return `${formatDateSlash(dateStr)} -${seq}`;
}

/**
 * 출력 시각 표시 (YYYY/MM/DD 오전/오후 H:MM:SS)
 * @param {Date} d
 * @returns {string}
 */
function formatPrintTime(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  let h = d.getHours();
  const ampm = h < 12 ? '오전' : '오후';
  h = h % 12 || 12;
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd} ${ampm} ${h}:${mi}:${ss}`;
}

/**
 * 이카운트 형식 본문 렌더
 * 흐름: 이월잔액 → 시간순 거래 → 월말 합계 → 누계
 * @param {CustomerStats} stats
 * @param {{startDate: string, endDate: string}} range
 */
function renderEcountLedgerBody(stats, range) {
  const tbody = document.getElementById('tbody-ledger');
  tbody.innerHTML = '';

  // 이월잔액 = 시작일 이전까지의 누적 (판매 - 수금)
  const carryOver = calcCarryOver(stats, range.startDate);

  // 기간 내 거래만 추출 (시간순 정렬)
  const inRangeOrders = filterOrdersInRange(stats.orders, range);
  const inRangePayments = filterPaymentsInRange(stats.payments, range);
  const events = buildTimelineEvents(inRangeOrders, inRangePayments);

  // 이월잔액 행
  tbody.insertAdjacentHTML('beforeend', renderCarryOverRow(carryOver));

  let balance = carryOver;
  let monthSale = 0, monthRecv = 0;
  let totalSale = 0, totalRecv = 0;
  let currentMonth = '';
  const daySeqMap = {}; // {date: count}

  events.forEach(ev => {
    const month = ev.date.slice(0, 7); // YYYY-MM

    // 월이 바뀌면 이전 월 합계 행 추가
    if (currentMonth && month !== currentMonth) {
      tbody.insertAdjacentHTML('beforeend', renderMonthSumRow(currentMonth, monthSale, monthRecv));
      monthSale = 0; monthRecv = 0;
    }
    currentMonth = month;

    // 해당 날짜 순번
    daySeqMap[ev.date] = (daySeqMap[ev.date] || 0) + 1;
    const seq = daySeqMap[ev.date];

    if (ev.type === 'out') {
      balance += ev.amountWithVat;
      monthSale += ev.amountWithVat;
      totalSale += ev.amountWithVat;
      tbody.insertAdjacentHTML('beforeend', renderOrderHeaderRow(ev, seq, balance));
      (ev.items || []).forEach(item => {
        tbody.insertAdjacentHTML('beforeend', renderItemRow(item));
      });
    } else {
      balance -= ev.amount;
      monthRecv += ev.amount;
      totalRecv += ev.amount;
      tbody.insertAdjacentHTML('beforeend', renderPaymentRow(ev, seq, balance));
    }
  });

  // 마지막 월 합계
  if (currentMonth) {
    tbody.insertAdjacentHTML('beforeend', renderMonthSumRow(currentMonth, monthSale, monthRecv));
  }

  // 누계
  tbody.insertAdjacentHTML('beforeend', renderGrandSumRow(totalSale, totalRecv, balance));
}

/**
 * 이월잔액 행
 */
function renderCarryOverRow(amount) {
  return `<tr class="ec-row-carry">
    <td></td>
    <td class="center">이월잔액</td>
    <td class="num"></td>
    <td class="num"></td>
    <td class="num">${fmtMoney(amount)}</td>
  </tr>`;
}

/**
 * 발주서 합계 행 (회색)
 */
function renderOrderHeaderRow(ev, seq, balance) {
  const addr = ev.address ? `(${escapeHtml(ev.address)})` : '';
  return `<tr class="ec-row-header">
    <td class="date">${formatDateSeq(ev.date, seq)}</td>
    <td>${escapeHtml(ev.orderNum || '')}${addr}</td>
    <td class="num">${fmtMoney(ev.amountWithVat)}</td>
    <td class="num"></td>
    <td class="num">${fmtMoney(balance)}</td>
  </tr>`;
}

/**
 * 품목 상세 행 (들여쓰기, 분홍색)
 */
function renderItemRow(item) {
  const colorPart = item.color ? ` [${escapeHtml(item.color)}]` : '';
  const lineAmount = Math.round(item.qty * item.unitPrice * 1.1); // 부가세 포함
  return `<tr class="ec-row-item">
    <td></td>
    <td>${escapeHtml(item.name)}${colorPart} / ${item.qty} * ${fmtMoney(item.unitPrice)}</td>
    <td class="num">${fmtMoney(lineAmount)}</td>
    <td class="num"></td>
    <td class="num"></td>
  </tr>`;
}

/**
 * 입금 행 (연두색)
 */
function renderPaymentRow(ev, seq, balance) {
  return `<tr class="ec-row-payment">
    <td class="date">${formatDateSeq(ev.date, seq)}</td>
    <td>${escapeHtml(ev.description || '')}</td>
    <td class="num"></td>
    <td class="num">${fmtMoney(ev.amount)}</td>
    <td class="num">${fmtMoney(balance)}</td>
  </tr>`;
}

/**
 * 월 합계 행
 */
function renderMonthSumRow(yyyyMm, sale, recv) {
  return `<tr class="ec-row-month-sum">
    <td></td>
    <td>${yyyyMm.replace('-', '/')} 계</td>
    <td class="num">${fmtMoney(sale)}</td>
    <td class="num">${fmtMoney(recv)}</td>
    <td class="num"></td>
  </tr>`;
}

/**
 * 누계 행
 */
function renderGrandSumRow(sale, recv, balance) {
  return `<tr class="ec-row-grand-sum">
    <td></td>
    <td>누계</td>
    <td class="num">${fmtMoney(sale)}</td>
    <td class="num">${fmtMoney(recv)}</td>
    <td class="num">${fmtMoney(balance)}</td>
  </tr>`;
}

/**
 * 이월잔액 계산: 시작일 이전까지의 누적 (판매(부가세포함) - 수금)
 */
function calcCarryOver(stats, startDate) {
  if (!startDate) return 0;
  let carry = 0;
  (stats.orders || []).forEach(o => {
    const dateField = o.shipDate || o.orderDate || '';
    if (dateField && dateField < startDate) {
      carry += (o.totalAmount || (o.totalSupply || 0) * 1.1);
    }
  });
  (stats.payments || []).forEach(p => {
    if (p.date && p.date < startDate) carry -= (p.amount || 0);
  });
  return Math.round(carry);
}

/**
 * 기간 내 발주서만 필터
 */
function filterOrdersInRange(orders, range) {
  if (!range.startDate || !range.endDate) return [...orders];
  return orders.filter(o => {
    const d = o.shipDate || o.orderDate || '';
    return d >= range.startDate && d <= range.endDate;
  });
}

/**
 * 기간 내 입금만 필터
 */
function filterPaymentsInRange(payments, range) {
  if (!range.startDate || !range.endDate) return [...payments];
  return payments.filter(p => p.date >= range.startDate && p.date <= range.endDate);
}

/**
 * 발주서·입금을 시간순 통합 (날짜 오름차순)
 * @returns {Array<{type:'out'|'in', date:string, ...}>}
 */
function buildTimelineEvents(orders, payments) {
  const events = [];
  orders.forEach(o => {
    events.push({
      type: 'out',
      date: o.shipDate || o.orderDate || '',
      orderNum: o.orderNum,
      address: o.address || '',
      warehouse: o.warehouse || '',
      amount: o.totalSupply || 0,
      amountWithVat: o.totalAmount || Math.round((o.totalSupply || 0) * 1.1),
      items: o.items || []
    });
  });
  payments.forEach(p => {
    events.push({
      type: 'in',
      date: p.date,
      description: p.memo || p.customer || '',
      amount: p.amount,
      id: p.id
    });
  });
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return events;
}

/**
 * 기간 필터 적용 (UI input → state → 재렌더)
 */
async function applyDateRange() {
  const s = document.getElementById('ec-start-date').value;
  const e = document.getElementById('ec-end-date').value;
  dateRange.startDate = s;
  dateRange.endDate = e;
  await renderCustomerDetail();
}

// ============================================================
// 입금 등록 모달
// ============================================================
/**
 * 입금 등록 모달 열기 (오늘 날짜로 초기화)
 * @returns {void}
 */
function openPaymentModal() {
  document.getElementById('payment-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('payment-amount').value = '';
  document.getElementById('payment-memo').value = '';
  document.getElementById('payment-modal').classList.add('show');
}

/**
 * 입금 등록 모달 닫기 (저장 안 함)
 * @returns {void}
 */
function closePaymentModal() {
  document.getElementById('payment-modal').classList.remove('show');
}

/**
 * [저장] 버튼 핸들러 — 폼 검증 후 저장 → 모달 닫고 표 갱신
 * @returns {Promise<void>}
 */
async function handleSavePayment() {
  if (!currentCustomer) return;

  /** @type {Omit<Payment, 'id'>} */
  const draft = {
    customer: currentCustomer,
    date: document.getElementById('payment-date').value,
    amount: parseInt(document.getElementById('payment-amount').value) || 0,
    memo: document.getElementById('payment-memo').value.trim()
  };

  const err = validatePayment(draft);
  if (err) { alert(err); return; }

  try {
    await createPayment(draft);
    closePaymentModal();
    await renderCustomerDetail();
  } catch (e) {
    alert('저장 실패: ' + e.message);
  }
}

/**
 * 입금 삭제 핸들러 — 확인 후 삭제 → 표 갱신
 * @param {string} id - 삭제할 입금 문서 ID
 * @returns {Promise<void>}
 */
async function handleDeletePayment(id) {
  if (!confirm('입금 내역을 삭제할까요?')) return;
  try {
    await deletePayment(id);
    await renderCustomerDetail();
  } catch (e) {
    alert('삭제 실패: ' + e.message);
  }
}

// escapeHtml 함수는 shared/format.js로 이동됨

// ============================================================
// goBackToList — HTML onclick에서 호출되는 글로벌 함수
// ============================================================
/**
 * 거래처 상세에서 목록으로 돌아가기 (HTML 버튼 onclick에서 호출)
 * @returns {void}
 */
function goBackToList() {
  showListView();
}

// ============================================================
// 초기화 + 이벤트 바인딩
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('filter-unpaid').addEventListener('change', e => {
    onlyUnpaid = e.target.checked;
    renderCustomerList();
  });

  showListView();
});
