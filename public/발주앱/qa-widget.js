// ─────────────────────────────────────────────────────────────
// qa-widget.js — 로컬 QA 도우미 (도커 emulator 전용)
// 운영(hanger-deploy.web.app)에선 절대 안 뜸 — localhost/127.0.0.1만 분기
// 탭: 시나리오 자동 실행 / 상태 진단 / 빠른 시드
// ─────────────────────────────────────────────────────────────
(function () {
  const _isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!_isLocal) return;
  if (window._qaWidgetLoaded) return;
  window._qaWidgetLoaded = true;

  // ── 유틸 ──
  const $ = (s) => document.querySelector(s);
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const fmt = (n) => (n == null ? '-' : String(n));

  // ── CSS ──
  const style = document.createElement('style');
  style.textContent = `
    #qa-fab { position:fixed; bottom:18px; right:18px; z-index:9998; width:52px; height:52px; border-radius:50%; border:none; background:#dc2626; color:#fff; font-size:20px; cursor:pointer; box-shadow:0 4px 14px rgba(220,38,38,.35); transition:transform .15s; }
    #qa-fab:hover { transform:scale(1.08); }
    #qa-panel { position:fixed; bottom:80px; right:18px; z-index:9999; width:340px; max-height:70vh; background:#fff; border:2px solid #dc2626; border-radius:10px; box-shadow:0 12px 30px rgba(0,0,0,.25); display:none; flex-direction:column; font-family:'Pretendard',-apple-system,sans-serif; font-size:12px; }
    #qa-panel.open { display:flex; }
    .qa-head { padding:10px 14px; background:#dc2626; color:#fff; border-radius:8px 8px 0 0; display:flex; justify-content:space-between; align-items:center; }
    .qa-head b { font-size:13px; }
    .qa-close { background:none; border:none; color:#fff; font-size:18px; cursor:pointer; padding:0; line-height:1; }
    .qa-tabs { display:flex; border-bottom:1px solid #e5e7eb; }
    .qa-tab { flex:1; padding:8px; background:#f9fafb; border:none; border-right:1px solid #e5e7eb; cursor:pointer; font-size:12px; color:#6b7280; }
    .qa-tab:last-child { border-right:none; }
    .qa-tab.active { background:#fff; color:#dc2626; font-weight:700; border-bottom:2px solid #dc2626; margin-bottom:-1px; }
    .qa-body { padding:12px; overflow-y:auto; flex:1; }
    .qa-pane { display:none; }
    .qa-pane.active { display:block; }
    .qa-btn { display:block; width:100%; padding:8px 10px; margin-bottom:6px; border:1px solid #d1d5db; border-radius:6px; background:#fff; cursor:pointer; font-size:12px; text-align:left; color:#111; }
    .qa-btn:hover { background:#f3f4f6; border-color:#dc2626; }
    .qa-btn.danger { border-color:#fca5a5; color:#dc2626; }
    .qa-btn.danger:hover { background:#fef2f2; }
    .qa-log { font-family:'Consolas',monospace; font-size:11px; line-height:1.5; max-height:160px; overflow-y:auto; background:#1f2937; color:#d1d5db; padding:8px; border-radius:4px; margin-top:8px; }
    .qa-log .pass { color:#86efac; }
    .qa-log .fail { color:#fca5a5; }
    .qa-log .info { color:#93c5fd; }
    .qa-state-row { display:flex; justify-content:space-between; padding:5px 0; border-bottom:1px dotted #e5e7eb; font-size:12px; }
    .qa-state-row b { color:#dc2626; font-family:'Consolas',monospace; }
    .qa-input { width:60px; padding:4px 6px; border:1px solid #d1d5db; border-radius:4px; margin-right:6px; font-size:12px; }
    .qa-warn { background:#fef3c7; padding:6px 8px; border-radius:4px; font-size:11px; color:#92400e; margin-bottom:8px; }
  `;
  document.head.appendChild(style);

  // ── DOM ──
  const fab = document.createElement('button');
  fab.id = 'qa-fab';
  fab.textContent = '🧪';
  fab.title = 'QA 위젯 (로컬 전용)';
  document.body.appendChild(fab);

  const panel = document.createElement('div');
  panel.id = 'qa-panel';
  panel.innerHTML = `
    <div class="qa-head"><b>🧪 QA 위젯 (LOCAL)</b><button class="qa-close">×</button></div>
    <div class="qa-tabs">
      <button class="qa-tab active" data-tab="scenarios">시나리오</button>
      <button class="qa-tab" data-tab="state">상태</button>
      <button class="qa-tab" data-tab="seed">시드</button>
    </div>
    <div class="qa-body">
      <div class="qa-pane active" data-pane="scenarios">
        <div class="qa-warn">⚠️ 직접 화면을 조작한 후 "지금 검증" 클릭</div>
        <div id="qa-scenario-list"></div>
      </div>
      <div class="qa-pane" data-pane="state">
        <div id="qa-state-content">로딩...</div>
      </div>
      <div class="qa-pane" data-pane="seed">
        <div class="qa-warn">⚠️ emulator DB만 영향, 운영 0</div>
        <div style="margin-bottom:8px">
          <input type="number" class="qa-input" id="qa-seed-count" value="30" min="1" max="500"/>
          <button class="qa-btn" style="display:inline-block;width:auto" data-seed="orders">발주서 N건 추가</button>
        </div>
        <button class="qa-btn" data-seed="invoices">발주확정 발주서에 invoice 자동발급</button>
        <button class="qa-btn danger" data-seed="reset-orders">⚠️ orders 전부 삭제</button>
        <button class="qa-btn danger" data-seed="reset-invoices">⚠️ invoices 전부 삭제</button>
        <div class="qa-log" id="qa-seed-log">대기 중...</div>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  // ── 이벤트 ──
  fab.addEventListener('click', () => panel.classList.toggle('open'));
  panel.querySelector('.qa-close').addEventListener('click', () => panel.classList.remove('open'));

  panel.querySelectorAll('.qa-tab').forEach(t => t.addEventListener('click', () => {
    panel.querySelectorAll('.qa-tab').forEach(x => x.classList.toggle('active', x === t));
    panel.querySelectorAll('.qa-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === t.dataset.tab));
    if (t.dataset.tab === 'state') updateState();
  }));

  // ── 로그 헬퍼 ──
  function mkLog(elId) {
    const el = document.getElementById(elId);
    el.innerHTML = '';
    const w = (cls, msg) => {
      const line = document.createElement('div');
      line.className = cls;
      line.textContent = `[${new Date().toTimeString().slice(0, 8)}] ${msg}`;
      el.appendChild(line);
      el.scrollTop = el.scrollHeight;
    };
    return { info: (m) => w('info', m), pass: (m) => w('pass', '✓ ' + m), fail: (m) => w('fail', '✗ ' + m) };
  }

  // ── 시나리오 (사람이 직접 조작, 위젯은 결과만 검증) ──
  const SCENARIOS = [
    {
      id: 'R1',
      name: '정렬 상태가 탭 이동 후 초기화되는지',
      desc: '정산에서 "오래된순"으로 바꾼 뒤 다른 메뉴 갔다 돌아오면 자동으로 "최신순"으로 돌아와야 정상',
      goto: () => document.querySelector('[data-nav="settlement"]')?.click(),
      gotoLabel: '정산 페이지로 이동',
      steps: [
        '정산 메뉴로 이동',
        '"최신순" 버튼 한 번 클릭 (→ "오래된순"으로 바뀜)',
        '대시보드 같은 다른 메뉴 클릭',
        '다시 정산 메뉴 클릭',
        '→ 위 버튼이 "최신순"으로 돌아와 있어야 OK',
      ],
      verify: () => {
        const t = $('#sort-toggle');
        if (!t) return { ok: false, msg: '정산 페이지가 아닙니다' };
        if (t.dataset.order === 'desc') return { ok: true, msg: '최신순으로 정상 복귀됨' };
        return { ok: false, msg: '아직 "오래된순"으로 남아 있음' };
      }
    },
    {
      id: 'R2',
      name: '검색 중에 정렬을 바꿔도 검색 결과가 유지되는지',
      desc: '검색해서 일부만 보이는 상태에서 정렬을 바꿨을 때, 검색 필터가 풀려서 안 봐도 될 항목까지 다시 보이면 안 됨',
      goto: () => document.querySelector('[data-nav="settlement"]')?.click(),
      gotoLabel: '정산 페이지로 이동',
      steps: [
        '정산 페이지에서 거래처 행 클릭 (펼침)',
        '상단 🔍 검색창에 발주번호 일부 입력 (예: "20260601")',
        '→ 일부 항목만 보이는 것 확인',
        '"최신순" 버튼 클릭 (정렬 변경)',
        '→ 검색 결과는 그대로 유지되어야 OK',
      ],
      verify: () => {
        const hidden = document.querySelectorAll('.detail-table tbody tr.search-hidden').length;
        const search = $('#quick-search');
        const q = search ? search.value : '';
        if (!q) return { ok: false, msg: '검색창이 비어 있습니다 — 검색 입력 후 정렬 누른 다음 검증' };
        if (hidden > 0) return { ok: true, msg: '숨겨진 항목 ' + hidden + '개 유지 OK' };
        return { ok: false, msg: '검색 필터가 풀려버림 — 정렬이 검색을 깨뜨림' };
      }
    },
    {
      id: 'R3',
      name: '검색 결과가 적을 때 "더보기" 버튼이 사라지는지',
      desc: '발주서가 많은 거래처에서 검색했을 때, 검색 결과가 10건 이하면 "더보기" 버튼이 의미 없으니 숨겨져야 함',
      goto: () => document.querySelector('[data-nav="settlement"]')?.click(),
      gotoLabel: '정산 페이지로 이동',
      steps: [
        '발주서 11건 이상 있는 거래처 행 펼침',
        '검색창에 매칭 결과가 10건 이하 나올 키워드 입력 (예: "포스트바")',
        '→ "+ 더보기" 버튼이 사라져야 OK',
      ],
      verify: () => {
        const search = $('#quick-search');
        const q = search ? search.value : '';
        if (!q) return { ok: false, msg: '검색창이 비어 있습니다' };
        const visible = document.querySelectorAll('.detail-table tbody tr:not(.search-hidden):not(.hidden-row)').length;
        const moreBtn = document.querySelector('.detail-load-more');
        const more = moreBtn && moreBtn.style.display !== 'none';
        if (visible <= 10 && !more) return { ok: true, msg: '검색 결과 ' + visible + '건 → 더보기 숨김 OK' };
        if (visible > 10 && more) return { ok: true, msg: '검색 결과 ' + visible + '건 → 더보기 표시 OK' };
        return { ok: false, msg: '검색 ' + visible + '건인데 더보기는 ' + (more ? '표시' : '숨김') + ' (어긋남)' };
      }
    },
    {
      id: 'R6',
      name: '원장 검색 후 관리대장 보고 뒤로가면 검색 유지되는지',
      desc: '거래처 원장에서 검색해서 거래처 클릭 → 관리대장 보고 → 뒤로가면, 검색어와 필터링 결과가 그대로 유지되어야 사용자가 다시 찾을 필요 없음',
      goto: async () => {
        document.querySelector('[data-nav="settlement"]')?.click();
        await wait(500);
        document.querySelector('[data-stl-tab="ledger"]')?.click();
      },
      gotoLabel: '거래처 원장 탭으로 이동',
      steps: [
        '정산 메뉴 → "거래처 원장" 탭 클릭',
        '검색창에 여러 납품처명 시도 (예: "A업체", "B업체", "테스트A" 등)',
        '매칭된 거래처 행 또는 "원장 보기" 클릭 (관리대장 진입)',
        '"뒤로" 버튼 클릭',
        '→ 검색어 그대로 + 검색 결과만 보여야 OK',
        '※ 여러 납품처명으로 반복 시도 권장',
      ],
      verify: () => {
        const s = $('#ledger-search');
        if (!s) return { ok: false, msg: '거래처 원장 목록 화면이 아닙니다' };
        if (!s.value || !s.value.trim()) return { ok: false, msg: '검색창이 비어 있음 — 검색이 풀려버림' };
        // 검색어 + 필터 적용 여부 둘 다 확인
        const tbody = document.getElementById('tbody-customers');
        const total = tbody ? tbody.querySelectorAll('tr.paid').length : 0;
        const visible = tbody ? Array.from(tbody.querySelectorAll('tr.paid')).filter(r => r.style.display !== 'none').length : 0;
        if (total > 0 && visible < total) return { ok: true, msg: '검색어 "' + s.value + '" 유지 + 필터 적용 (' + visible + '/' + total + '건 표시)' };
        if (total === visible) return { ok: false, msg: '검색어는 있는데 필터가 풀림 (' + visible + '/' + total + '건)' };
        return { ok: true, msg: '검색어 "' + s.value + '" 유지' };
      }
    }
  ];

  // 시나리오 카드 렌더
  const list = document.getElementById('qa-scenario-list');
  list.innerHTML = SCENARIOS.map(sc => `
    <div class="qa-sc" data-sc-id="${sc.id}" style="border:1px solid #e5e7eb;border-radius:6px;padding:10px;margin-bottom:8px;background:#f9fafb">
      <div style="font-weight:700;font-size:12px;margin-bottom:4px;color:#111">${sc.name}</div>
      <div style="font-size:11px;color:#6b7280;margin-bottom:8px;line-height:1.5">${sc.desc || ''}</div>
      <div style="font-size:11px;color:#dc2626;font-weight:600;margin-bottom:4px">📋 따라할 순서</div>
      <ol style="margin:0 0 8px 18px;padding:0;font-size:11px;color:#374151;line-height:1.6">
        ${sc.steps.map(s => `<li>${s}</li>`).join('')}
      </ol>
      <div style="display:flex;gap:6px">
        ${sc.goto ? `<button class="qa-btn qa-goto" data-goto="${sc.id}" style="margin:0;flex:1;background:#eff6ff;border-color:#3b82f6;color:#1d4ed8">▶ ${sc.gotoLabel || '페이지로 이동'}</button>` : ''}
        <button class="qa-btn qa-verify" data-verify="${sc.id}" style="margin:0;flex:1">🔍 지금 검증</button>
      </div>
      <div class="qa-result" data-result="${sc.id}" style="margin-top:6px;font-size:11px"></div>
    </div>
  `).join('');

  panel.querySelectorAll('.qa-goto').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.dataset.goto;
    const sc = SCENARIOS.find(s => s.id === id);
    if (sc && sc.goto) await sc.goto();
  }));

  panel.querySelectorAll('.qa-verify').forEach(btn => btn.addEventListener('click', () => {
    const id = btn.dataset.verify;
    const sc = SCENARIOS.find(s => s.id === id);
    const res = sc.verify();
    const out = panel.querySelector(`.qa-result[data-result="${id}"]`);
    out.innerHTML = res.ok
      ? `<span style="color:#16a34a;font-weight:700">✓ PASS</span> <span style="color:#374151">${res.msg}</span>`
      : `<span style="color:#dc2626;font-weight:700">✗ FAIL</span> <span style="color:#374151">${res.msg}</span>`;
  }));

  // ── 상태 진단 ──
  function updateState() {
    const sort = $('#sort-toggle');
    const search = $('#quick-search');
    const ledgerSearch = $('#ledger-search');
    const tbodyOrderer = $('#tbody-ordererwise');
    const dt = document.querySelectorAll('.detail-table').length;
    const hr = document.querySelectorAll('.detail-table tbody tr.hidden-row').length;
    const sh = document.querySelectorAll('.detail-table tbody tr.search-hidden').length;
    const more = document.querySelectorAll('.detail-load-more').length;
    const cur = (typeof window.currentView !== 'undefined') ? window.currentView : '?';
    const rows = [
      ['현재 view', cur],
      ['sort-toggle dataset', sort ? sort.dataset.order : '없음'],
      ['검색어 (정산)', search ? `"${search.value}"` : '없음'],
      ['검색어 (원장)', ledgerSearch ? `"${ledgerSearch.value}"` : '없음'],
      ['거래처 row 수', tbodyOrderer ? tbodyOrderer.querySelectorAll('tr.row-main').length : 0],
      ['detail-table 갯수', dt],
      ['hidden-row 갯수', hr],
      ['search-hidden 갯수', sh],
      ['더보기 버튼 갯수', more],
    ];
    document.getElementById('qa-state-content').innerHTML = rows.map(([k, v]) =>
      `<div class="qa-state-row"><span>${k}</span><b>${fmt(v)}</b></div>`).join('');
  }
  setInterval(() => { if (panel.classList.contains('open') && panel.querySelector('.qa-tab.active').dataset.tab === 'state') updateState(); }, 600);

  // ── 빠른 시드 ──
  const CUSTOMERS = ['테스트업체', '테스트A업체', '테스트B업체'];
  const ADDRESSES = ['서울시 강남구 테스트로 1', '경기도 성남시 분당구 정자동 2', '인천시 남동구 구월동 3'];
  const rnd = (a) => a[Math.floor(Math.random() * a.length)];
  const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

  async function seedOrders(count, log) {
    if (!window._FS || !window._FS.get) return log.fail('_FS 인터페이스 없음');
    log.info('기존 orders 로드...');
    const existing = (await window._FS.get('orders')) || [];
    let maxId = existing.reduce((m, o) => Math.max(m, o.id || 0), 0);
    const seqByDate = {};
    existing.forEach(o => { if (o.orderNum) { const d = o.orderNum.split('-')[0]; seqByDate[d] = (seqByDate[d] || 0) + 1; } });
    const newOrders = [];
    for (let i = 0; i < count; i++) {
      const days = ri(0, 30);
      const od = new Date(Date.now() - days * 86400000);
      const pf = `${od.getFullYear()}${String(od.getMonth() + 1).padStart(2, '0')}${String(od.getDate()).padStart(2, '0')}`;
      seqByDate[pf] = (seqByDate[pf] || 0) + 1;
      const orderNum = `${pf}-${String(seqByDate[pf]).padStart(3, '0')}`;
      maxId++;
      const supply = ri(1, 5) * 12000 + ri(1, 3) * 5300;
      newOrders.push({
        id: maxId, orderNum, deliveryTo: rnd(CUSTOMERS), address: rnd(ADDRESSES),
        orderDate: `${od.getFullYear()}-${String(od.getMonth() + 1).padStart(2, '0')}-${String(od.getDate()).padStart(2, '0')}`,
        shipDate: `${od.getFullYear()}-${String(od.getMonth() + 1).padStart(2, '0')}-${String(od.getDate()).padStart(2, '0')}`,
        warehouse: rnd(['시흥', '평택']), status: rnd(['발주확정', '출고완료']),
        upperMaterials: [{ name: '포스트바 2400', color: '화이트', qty: ri(1, 5), unitPrice: 12000 }],
        totalSupply: supply, totalVat: Math.round(supply * 0.1), totalAmount: supply + Math.round(supply * 0.1),
        createdAt: od.toISOString(), updatedAt: od.toISOString(),
      });
    }
    await window._FS.set('orders', [...existing, ...newOrders]);
    log.pass(`발주서 ${count}건 추가 (${existing.length} → ${existing.length + count})`);
  }

  async function seedInvoices(log) {
    const orders = (await window._FS.get('orders')) || [];
    const targets = orders.filter(o => o.status === '발주확정' || o.status === '출고완료');
    const existing = (await window._FS.get('invoices')) || [];
    const have = new Set(existing.filter(i => !i.cancelled).map(i => i.orderNum));
    const newInv = [];
    const seq = {};
    for (const o of targets) {
      if (have.has(o.orderNum)) continue;
      const items = (o.upperMaterials || []).filter(m => m.qty).map(m => ({
        name: m.name, spec: m.color, qty: m.qty, unitPrice: m.unitPrice,
        supply: m.qty * (m.unitPrice || 0), vat: Math.round(m.qty * (m.unitPrice || 0) * 0.1)
      }));
      if (!items.length) continue;
      const dk = (o.shipDate || o.orderDate || '').replace(/-/g, '/');
      seq[dk] = (seq[dk] || 0) + 1;
      const totalSupply = items.reduce((s, i) => s + i.supply, 0);
      const totalVat = items.reduce((s, i) => s + i.vat, 0);
      newInv.push({
        id: 'inv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        orderNum: o.orderNum, shipDate: o.shipDate || o.orderDate,
        deliveryTo: o.deliveryTo, address: o.address, items,
        totalSupply, totalVat, totalAmount: totalSupply + totalVat,
        createdAt: o.createdAt || new Date().toISOString(),
        createdBy: 'admin', issuerName: '관리자',
        serial: dk + ' -' + seq[dk], sentToCustomer: true, sentAt: new Date().toISOString()
      });
    }
    if (!newInv.length) return log.info('생성할 invoice 없음');
    await window._FS.set('invoices', [...existing, ...newInv]);
    log.pass(`invoice ${newInv.length}건 자동발급 (${existing.length} → ${existing.length + newInv.length})`);
  }

  async function resetKey(key, log) {
    if (!confirm(`emulator ${key} 전부 삭제? (운영 영향 0)`)) return;
    await window._FS.set(key, []);
    log.pass(key + ' 초기화 완료 (0건)');
  }

  panel.querySelectorAll('[data-seed]').forEach(btn => btn.addEventListener('click', async () => {
    const log = mkLog('qa-seed-log');
    const action = btn.dataset.seed;
    try {
      if (action === 'orders') {
        const n = Math.max(1, Math.min(500, Number(document.getElementById('qa-seed-count').value) || 30));
        await seedOrders(n, log);
      } else if (action === 'invoices') await seedInvoices(log);
      else if (action === 'reset-orders') await resetKey('orders', log);
      else if (action === 'reset-invoices') await resetKey('invoices', log);
    } catch (e) { log.fail('예외: ' + e.message); }
  }));

  console.log('🧪 [QA Widget] 활성 (로컬 전용)');
})();
