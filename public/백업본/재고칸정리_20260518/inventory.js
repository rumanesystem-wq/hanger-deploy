// ── 재고 관리 / 발주 필요 목록 / 재고 로그 ──
// 의존: js/store/db.js, js/utils/uiUtils.js, js/price.js

// 발주 필요 목록
let prFilterStatus='',prFilterItem='',prFilterOrderNum='',prFilterDateFrom='',prFilterDateTo='',prSortBy='';
function renderPurchaseRequests(){
  const allPRs=getPRs();
  let prs=allPRs.filter(p=>{
    if(prFilterStatus&&p.status!==prFilterStatus)return false;
    if(prFilterItem){const it=getItem(p.itemId);if(!it||!it.name.includes(prFilterItem))return false;}
    if(prFilterOrderNum){const ord=getOrders().find(o=>o.id===p.orderId);const num=ord?(ord.orderNum||('#'+ord.id)):'';if(!num.includes(prFilterOrderNum))return false;}
    if(prFilterDateFrom&&(p.createdAt||'').slice(0,10)<prFilterDateFrom)return false;
    if(prFilterDateTo&&(p.createdAt||'').slice(0,10)>prFilterDateTo)return false;
    return true;
  });
  if(prSortBy==='shortage')prs=prs.slice().sort((a,b)=>b.shortageQty-a.shortageQty);
  else prs=prs.slice().sort((a,b)=>b.id-a.id);
  const pending=allPRs.filter(p=>p.status==='대기').length;
  const done=allPRs.filter(p=>p.status==='발주완료').length;
  const hasFilter=!!(prFilterStatus||prFilterItem||prFilterOrderNum||prFilterDateFrom||prFilterDateTo);
  let tableHtml='';
  if(prs.length===0){
    tableHtml=`<div class="empty"><i class="fas fa-clipboard-check"></i><p>${hasFilter?'검색 결과가 없습니다.':'발주 필요 목록이 없습니다. 서랍장 재고가 충분한 상태입니다.'}</p></div>`;
  }else{
    tableHtml=`<div class="table-wrap"><table><thead><tr><th>품목명</th><th class="td-center">구분</th><th>현장</th><th class="td-center">필요</th><th class="td-center">당시재고</th><th class="td-center">부족</th><th class="td-center">생성일</th><th class="td-center">상태</th><th class="td-center">처리</th></tr></thead><tbody>
    ${prs.map(pr=>{
      const it=getItem(pr.itemId);const ord=getOrders().find(o=>o.id===pr.orderId);
      return `<tr id="pr-row-${pr.id}"${pr.status==='발주완료'?' style="opacity:.6"':''}>
        <td class="td-name">${it?it.name:'?'}</td>
        <td class="td-center">${it?drawerBadge(it):'-'}</td>
        <td><button class="btn btn-ghost btn-xs order-detail-btn" data-order-id="${pr.orderId}" style="padding:2px 0;font-weight:600">${ord?ord.siteName:'?'}</button><p class="td-muted" style="font-size:11px">${ord?ord.customerName:''}</p></td>
        <td class="td-center">${pr.requiredQty}</td>
        <td class="td-center td-muted">${pr.currentStockSnapshot}</td>
        <td class="td-center td-shortage">${pr.shortageQty}</td>
        <td class="td-center td-muted">${fmt(pr.createdAt)}</td>
        <td class="td-center"><span class="badge ${pr.status==='발주완료'?'badge-done':'badge-pending'}">${pr.status}</span></td>
        <td class="td-center" id="pr-action-${pr.id}">${pr.status==='대기'?`<button class="btn btn-outline btn-xs pr-complete-btn" data-pr-id="${pr.id}"><i class="fas fa-check"></i> 발주완료</button>`:''}</td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
  }
  document.getElementById('content').innerHTML=`
    <div class="section-title">발주 필요 목록</div>
    <div class="section-sub">서랍장 부족 수량이 발생한 품목 목록입니다.</div>
    <div class="grid-2" style="margin-bottom:16px">
      <div style="background:var(--warning-bg);border:1px solid #fde68a;border-radius:var(--r);padding:14px 18px"><p style="font-size:11px;font-weight:700;color:var(--warning)">대기</p><p style="font-size:26px;font-weight:800;color:var(--warning)">${pending}건</p></div>
      <div style="background:var(--success-bg);border:1px solid #bbf7d0;border-radius:var(--r);padding:14px 18px"><p style="font-size:11px;font-weight:700;color:var(--success)">발주완료</p><p style="font-size:26px;font-weight:800;color:var(--success)">${done}건</p></div>
    </div>
    ${pending>0?`<div style="background:var(--warning-bg);border:1px solid #fde68a;border-radius:var(--r);padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
      <p style="font-size:13px;color:var(--warning)">대기 중인 발주 요청 <strong>${pending}건</strong>을 일괄 처리합니다.</p>
      <div id="bulk-btn-wrap"><button class="btn btn-success btn-sm" id="bulk-complete-btn"><i class="fas fa-check-double"></i> 전체 발주완료 처리</button></div>
    </div>`:''}
    <div class="filter-bar" style="flex-wrap:wrap;row-gap:8px">
      <input class="form-input" placeholder="품목명 검색" id="pr-item-search" value="${prFilterItem}" style="max-width:160px"/>
      <input class="form-input" placeholder="발주번호" id="pr-order-num" value="${prFilterOrderNum}" style="max-width:120px"/>
      <select class="form-input" id="pr-status-filter" style="max-width:130px">
        <option value="">전체 상태</option>
        <option value="대기"${prFilterStatus==='대기'?' selected':''}>대기</option>
        <option value="발주완료"${prFilterStatus==='발주완료'?' selected':''}>발주완료</option>
      </select>
      <input type="date" class="form-input" id="pr-from" value="${prFilterDateFrom}" style="max-width:140px"/>
      <input type="date" class="form-input" id="pr-to" value="${prFilterDateTo}" style="max-width:140px"/>
      <select class="form-input" id="pr-sort" style="max-width:150px">
        <option value=""${prSortBy===''?' selected':''}>최신 순</option>
        <option value="shortage"${prSortBy==='shortage'?' selected':''}>부족 수량 순</option>
      </select>
      <button class="btn btn-outline btn-xs" onclick="prFilterStatus='';prFilterItem='';prFilterOrderNum='';prFilterDateFrom='';prFilterDateTo='';prSortBy='';renderPurchaseRequests()">초기화</button>
      <span style="font-size:12px;color:var(--text-3)">총 ${prs.length}건</span>
    </div>
    <div class="card">${tableHtml}</div>`;
  document.getElementById('pr-item-search').addEventListener('input',e=>{prFilterItem=e.target.value;renderPurchaseRequests();});
  document.getElementById('pr-order-num').addEventListener('input',e=>{prFilterOrderNum=e.target.value;renderPurchaseRequests();});
  document.getElementById('pr-status-filter').addEventListener('change',e=>{prFilterStatus=e.target.value;renderPurchaseRequests();});
  document.getElementById('pr-from').addEventListener('change',e=>{prFilterDateFrom=e.target.value;renderPurchaseRequests();});
  document.getElementById('pr-to').addEventListener('change',e=>{prFilterDateTo=e.target.value;renderPurchaseRequests();});
  document.getElementById('pr-sort').addEventListener('change',e=>{prSortBy=e.target.value;renderPurchaseRequests();});
  const bcb=document.getElementById('bulk-complete-btn');
  if(bcb)bcb.addEventListener('click',showBulkConfirm);
}

function showPRConfirm(prId){
  const cell=document.getElementById('pr-action-'+prId);
  cell.innerHTML='<div class="confirm-btns"><button class="btn btn-success btn-xs pr-confirm-yes" data-pr-id="'+prId+'">확인</button><button class="btn btn-ghost btn-xs pr-confirm-no">취소</button></div>';
  cell.querySelector('.pr-confirm-yes').addEventListener('click',()=>completePR(prId));
  cell.querySelector('.pr-confirm-no').addEventListener('click',renderPurchaseRequests);
}
function completePR(prId){
  const prs=getPRs();const idx=prs.findIndex(p=>p.id===prId);if(idx===-1)return;
  prs[idx].status='발주완료';prs[idx].updatedAt=new Date().toISOString();
  DB.set('purchase_requests',prs);toast('발주완료 처리되었습니다.','success');renderPurchaseRequests();
}
function showBulkConfirm(){
  const wrap=document.getElementById('bulk-btn-wrap');
  wrap.innerHTML='<div class="confirm-btns"><span style="font-size:12px;color:var(--warning)">전체 발주완료로 변경할까요?</span><button class="btn btn-success btn-sm" id="bulk-yes">확인</button><button class="btn btn-ghost btn-sm" id="bulk-no">취소</button></div>';
  document.getElementById('bulk-yes').addEventListener('click',bulkComplete);
  document.getElementById('bulk-no').addEventListener('click',renderPurchaseRequests);
}
function bulkComplete(){
  const prs=getPRs();let count=0;
  prs.forEach(p=>{if(p.status==='대기'){p.status='발주완료';p.updatedAt=new Date().toISOString();count++;}});
  DB.set('purchase_requests',prs);toast(`${count}건 일괄 발주완료 처리되었습니다.`,'success');renderPurchaseRequests();
}

// ── 발주자 전용 재고 현황 페이지 ──
// ── 발주자 전용: 재고 부족 페이지 ──
function renderShortageView(){
  const items=getItems().filter(i=>i.isActive&&isTrackStock(i));
  const logs=getLogs();
  const lastLog={};
  logs.forEach(l=>{if(!lastLog[l.itemId]||l.createdAt>lastLog[l.itemId])lastLog[l.itemId]=l.createdAt;});

  const shortageItems=items.filter(i=>i.currentStock===0);
  const lowItems=items.filter(i=>i.currentStock>0&&i.currentStock<=3);
  const normalItems=items.filter(i=>i.currentStock>3);

  function makeRow(item, level){
    const color=level==='zero'?'#dc2626':level==='low'?'#d97706':'#16a34a';
    const bg=level==='zero'?'#fef2f2':level==='low'?'#fffbeb':'';
    const label=level==='zero'?'재고 없음':level==='low'?'부족 주의':'충분';
    const labelCls=level==='zero'?'badge-red':level==='low'?'badge-pending':'badge-done';
    return `<tr style="background:${bg}">
      <td class="td-name">${item.name} ${drawerBadge(item)}</td>
      <td class="td-center"><span style="font-size:17px;font-weight:800;color:${color}">${item.currentStock}</span></td>
      <td class="td-center"><span class="badge ${labelCls}">${label}</span></td>
      <td class="td-center td-muted" style="font-size:12px">${lastLog[item.id]?fmtDt(lastLog[item.id]):'-'}</td>
    </tr>`;
  }

  const allRows=[
    ...shortageItems.map(i=>makeRow(i,'zero')),
    ...lowItems.map(i=>makeRow(i,'low')),
    ...normalItems.map(i=>makeRow(i,'normal')),
  ].join('');

  document.getElementById('content').innerHTML=`
    <div class="section-title">재고 부족 현황</div>
    <div class="section-sub">서랍장 품목의 재고 상태를 확인합니다. (재고 없음 → 부족 주의 → 충분 순)</div>
    <div style="display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap">
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:var(--r);padding:12px 20px;min-width:110px">
        <p style="font-size:11px;font-weight:700;color:#dc2626;margin-bottom:3px">재고 없음</p>
        <p style="font-size:26px;font-weight:800;color:#dc2626">${shortageItems.length}개</p>
      </div>
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:var(--r);padding:12px 20px;min-width:110px">
        <p style="font-size:11px;font-weight:700;color:#d97706;margin-bottom:3px">부족 주의 (1~3개)</p>
        <p style="font-size:26px;font-weight:800;color:#d97706">${lowItems.length}개</p>
      </div>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:var(--r);padding:12px 20px;min-width:110px">
        <p style="font-size:11px;font-weight:700;color:#16a34a;margin-bottom:3px">재고 충분</p>
        <p style="font-size:26px;font-weight:800;color:#16a34a">${normalItems.length}개</p>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><h3>품목별 재고 상태</h3></div>
      <div class="table-wrap"><table>
        <thead><tr><th>품목명</th><th class="td-center">현재고</th><th class="td-center">상태</th><th class="td-center">최근 변동일</th></tr></thead>
        <tbody>${allRows||'<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--text-3)">품목 없음</td></tr>'}</tbody>
      </table></div>
    </div>`;
}

let _stockViewSearch='';
function renderStockView(){
  // +손잡이 제외
  let items=getItems().filter(i=>i.isActive&&isTrackStock(i)&&i.drawerType!=='handle');
  if(_stockViewSearch)items=items.filter(i=>i.name.includes(_stockViewSearch));
  const siheungTotal=items.reduce((s,i)=>s+(i.stockSiheung!==undefined?i.stockSiheung:i.currentStock),0);
  const pyeongtaekTotal=items.reduce((s,i)=>s+(i.stockPyeongtaek||0),0);

  // 품목별 색상 행 생성 (클릭 시 접기/펼치기)
  const rows=items.map(item=>{
    const sTotal=item.stockSiheung!==undefined?item.stockSiheung:item.currentStock;
    const pTotal=item.stockPyeongtaek||0;
    const grandTotal=sTotal+pTotal;
    const itemBg=grandTotal===0?'background:#fef2f2':grandTotal<=3?'background:#fffbeb':'';

    const colorRows=SHELF_COLORS.map(color=>{
      const sC=(item.colorStockSiheung||{})[color]||0;
      const pC=(item.colorStockPyeongtaek||{})[color]||0;
      const tot=sC+pC;
      const sColor=sC===0?'#9ca3af':sC<=2?'#d97706':'#1e40af';
      const pColor=pC===0?'#9ca3af':pC<=2?'#d97706':'#065f46';
      const tColor=tot===0?'#9ca3af':tot<=2?'#d97706':'#111827';
      return `<tr class="sv-color-row sv-cr-${item.id}" style="display:none;background:#fafafa">
        <td style="padding-left:22px;font-size:12px;color:#374151;border-bottom:1px solid #f1f5f9">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${tot===0?'#e5e7eb':tot<=2?'#fbbf24':'#60a5fa'};margin-right:6px;vertical-align:middle"></span>${color}
        </td>
        <td class="td-center" style="font-size:13px;font-weight:700;color:${sColor};border-bottom:1px solid #f1f5f9">${sC}</td>
        <td class="td-center" style="font-size:13px;font-weight:700;color:${pColor};border-bottom:1px solid #f1f5f9">${pC}</td>
        <td class="td-center" style="font-size:13px;font-weight:800;color:${tColor};border-bottom:1px solid #f1f5f9">${tot}</td>
      </tr>`;
    }).join('');

    return `<tr class="sv-item-row" data-sv-id="${item.id}" style="${itemBg}cursor:pointer" title="클릭해서 색상별 재고 보기">
      <td class="td-name" style="font-weight:800">
        <span class="sv-toggle-icon" data-sv-id="${item.id}" style="font-size:10px;color:#94a3b8;margin-right:6px">▶</span>${item.name}
      </td>
      <td class="td-center"><span style="font-size:15px;font-weight:800;color:${sTotal===0?'#dc2626':sTotal<=3?'#d97706':'#1e40af'}">${sTotal}</span></td>
      <td class="td-center"><span style="font-size:15px;font-weight:800;color:${pTotal===0?'#dc2626':pTotal<=3?'#d97706':'#065f46'}">${pTotal}</span></td>
      <td class="td-center"><span style="font-size:15px;font-weight:800;color:${grandTotal===0?'#dc2626':grandTotal<=3?'#d97706':'#111827'}">${grandTotal}</span></td>
    </tr>${colorRows}`;
  }).join('');

  document.getElementById('content').innerHTML=`
    <div class="section-title">재고 현황</div>
    <div class="section-sub">서랍장 품목의 창고별 · 색상별 현재 재고입니다.</div>
    <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap">
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:var(--r);padding:12px 20px">
        <p style="font-size:11px;font-weight:700;color:#3b82f6;margin-bottom:2px">시흥 재고</p>
        <p style="font-size:28px;font-weight:800;color:#1e40af">${siheungTotal}개</p>
      </div>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:var(--r);padding:12px 20px">
        <p style="font-size:11px;font-weight:700;color:#16a34a;margin-bottom:2px">평택 재고</p>
        <p style="font-size:28px;font-weight:800;color:#065f46">${pyeongtaekTotal}개</p>
      </div>
    </div>
    <div class="card">
      <div class="card-header">
        <h3>서랍장 재고 (창고별 · 색상별)</h3>
        <input class="form-input" id="sv-search-input" placeholder="품목명 검색" value="${_stockViewSearch}" style="max-width:150px;padding:5px 8px;font-size:12px"/>
      </div>
      <p style="font-size:12px;color:#94a3b8;padding:0 16px 8px">품목 행을 클릭하면 색상별 재고를 확인할 수 있습니다.</p>
      <div class="table-wrap"><table>
        <thead><tr>
          <th>품목 / 색상</th>
          <th class="td-center" style="color:#1e40af">시흥</th>
          <th class="td-center" style="color:#065f46">평택</th>
          <th class="td-center">합계</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>`;

  // 검색 이벤트 바인딩
  const svSearchEl=document.getElementById('sv-search-input');
  if(svSearchEl)svSearchEl.addEventListener('input',e=>{_stockViewSearch=e.target.value;renderStockView();});

  // 아코디언 이벤트 바인딩
  document.querySelectorAll('.sv-item-row').forEach(row=>{
    row.addEventListener('click',()=>{
      const id=row.dataset.svId;
      const colorRows=document.querySelectorAll(`.sv-cr-${id}`);
      const icon=document.querySelector(`.sv-toggle-icon[data-sv-id="${id}"]`);
      const isOpen=colorRows[0]&&colorRows[0].style.display!=='none';
      colorRows.forEach(r=>r.style.display=isOpen?'none':'');
      if(icon)icon.textContent=isOpen?'▶':'▼';
    });
  });
}

// ── 재고 기록 페이지 (관리자 전용) ──
let stockLogFilter='',stockLogType='',stockLogItem='',stockLogDateFrom='',stockLogDateTo='';
let stockLogPage=1; // 재고 기록 페이지 (독립 페이지)
let invLogPage=1;   // 재고 관리 내 기록 섹션 페이지
let invItemSearch='',invOnlyZero=false,invOnlyLow=false;

// makePaginationHtml, logTypeCls → js/utils.js
function renderStockLogs(){
  const allLogs=getLogs().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  const items=getItems();
  // 선택 품목 요약
  const selItem=stockLogItem?items.find(i=>i.id===parseInt(stockLogItem)):null;
  const filtered=allLogs.filter(l=>{
    if(stockLogItem&&l.itemId!==parseInt(stockLogItem))return false;
    if(stockLogFilter){const it=items.find(i=>i.id===l.itemId);if(!it||!it.name.includes(stockLogFilter))return false;}
    if(stockLogType&&l.type!==stockLogType)return false;
    if(stockLogDateFrom&&l.createdAt.slice(0,10)<stockLogDateFrom)return false;
    if(stockLogDateTo&&l.createdAt.slice(0,10)>stockLogDateTo)return false;
    return true;
  });
  // 요약 계산
  const selLogs=stockLogItem?allLogs.filter(l=>l.itemId===parseInt(stockLogItem)):[];
  const totalIn=selLogs.filter(l=>l.qty>0).reduce((s,l)=>s+l.qty,0);
  const totalOut=selLogs.filter(l=>l.qty<0).reduce((s,l)=>s+Math.abs(l.qty),0);
  const last7=new Date();last7.setDate(last7.getDate()-7);
  const recent7=selLogs.filter(l=>new Date(l.createdAt)>=last7).length;
  const lastLog=selLogs[0];
  const itemOpts=items.filter(i=>i.isActive&&isTrackStock(i)&&i.drawerType!=='handle').map(i=>`<option value="${i.id}"${stockLogItem===String(i.id)?' selected':''}>${i.name}</option>`).join('');
  const typeOpts=['입고','출고','조정','발주차감','발주수정재반영','취소롤백'].map(t=>`<option value="${t}"${stockLogType===t?' selected':''}>${t}</option>`).join('');
  const PER=20;
  const totalFiltered=filtered.length;
  if(stockLogPage>Math.ceil(totalFiltered/PER)||stockLogPage<1)stockLogPage=1;
  const paginated=filtered.slice((stockLogPage-1)*PER, stockLogPage*PER);
  const rows=paginated.map(l=>{
    const it=items.find(i=>i.id===l.itemId);
    const logOrder=l.orderId?getOrders().find(o=>o.id===l.orderId):null;
    const orderLink=l.orderId?`<button class="btn btn-ghost btn-xs slog-order-link" data-order-id="${l.orderId}" style="font-size:11px;padding:1px 5px">${logOrder?(logOrder.orderNum||('#'+l.orderId)):('#'+l.orderId)}</button>`:'-';
    return`<tr>
      <td class="td-muted" style="font-size:11px;white-space:nowrap">${fmtDt(l.createdAt)}</td>
      <td class="td-name" style="font-size:12px">${it?it.name:'?'}</td>
      <td class="td-center"><span class="badge ${logTypeCls(l.type)}" style="font-size:10px">${l.type}</span></td>
      <td class="td-center" style="font-weight:800;color:${l.qty>=0?'#16a34a':'#dc2626'}">${l.qty>0?'+':''}${l.qty}</td>
      <td class="td-center">${l.beforeStock} → <strong>${l.afterStock}</strong></td>
      <td class="td-center">${orderLink}</td>
      <td class="td-muted" style="font-size:11px;max-width:120px;overflow:hidden;text-overflow:ellipsis">${l.memo||'-'}</td>
      <td class="td-muted" style="font-size:11px">${l.createdBy||'-'}</td>
    </tr>`;
  }).join('');
  const pgHtml=makePaginationHtml(totalFiltered,stockLogPage,PER,'_goStockLogPage');
  const summaryHtml=selItem?`<div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap">
    <div style="background:#fff;border:1px solid var(--border);border-radius:var(--r);padding:10px 16px;min-width:110px">
      <p style="font-size:10px;font-weight:700;color:var(--text-3);margin-bottom:2px">현재 재고</p>
      <p style="font-size:22px;font-weight:800;color:${selItem.currentStock===0?'#dc2626':'#111827'}">${selItem.currentStock}</p>
    </div>
    <div style="background:#fff;border:1px solid var(--border);border-radius:var(--r);padding:10px 16px;min-width:110px">
      <p style="font-size:10px;font-weight:700;color:var(--text-3);margin-bottom:2px">누적 입고</p>
      <p style="font-size:22px;font-weight:800;color:#16a34a">+${totalIn}</p>
    </div>
    <div style="background:#fff;border:1px solid var(--border);border-radius:var(--r);padding:10px 16px;min-width:110px">
      <p style="font-size:10px;font-weight:700;color:var(--text-3);margin-bottom:2px">누적 출고</p>
      <p style="font-size:22px;font-weight:800;color:#dc2626">-${totalOut}</p>
    </div>
    <div style="background:#fff;border:1px solid var(--border);border-radius:var(--r);padding:10px 16px;min-width:110px">
      <p style="font-size:10px;font-weight:700;color:var(--text-3);margin-bottom:2px">최근 7일 변동</p>
      <p style="font-size:22px;font-weight:800;color:#1d4ed8">${recent7}건</p>
    </div>
    <div style="background:#fff;border:1px solid var(--border);border-radius:var(--r);padding:10px 16px;min-width:160px">
      <p style="font-size:10px;font-weight:700;color:var(--text-3);margin-bottom:2px">마지막 변동</p>
      <p style="font-size:12px;font-weight:700;color:#374151">${lastLog?fmtDt(lastLog.createdAt):'-'}</p>
    </div>
  </div>`:'';
  document.getElementById('content').innerHTML=`
    <div class="section-title">재고 기록</div>
    <div class="section-sub">입출고·조정·발주 차감·취소 롤백 이력을 확인합니다.</div>
    <div class="filter-bar" style="flex-wrap:wrap;gap:8px">
      <select class="form-input" id="slog-item-sel" style="max-width:160px">
        <option value="">전체 품목</option>${itemOpts}
      </select>
      <input class="form-input" placeholder="품목명 검색" id="slog-item" value="${stockLogFilter}" style="max-width:140px"/>
      <select class="form-input" id="slog-type" style="max-width:140px">
        <option value="">전체 유형</option>${typeOpts}
      </select>
      <input type="date" class="form-input" id="slog-date-from" value="${stockLogDateFrom}" style="max-width:130px"/>
      <input type="date" class="form-input" id="slog-date-to" value="${stockLogDateTo}" style="max-width:130px"/>
      <button class="btn btn-outline btn-sm" id="slog-reset">초기화</button>
      <span style="font-size:12px;color:var(--text-3)">총 ${totalFiltered}건</span>
    </div>
    ${summaryHtml}
    <div class="card">
      ${rows?`<div class="table-wrap"><table>
        <thead><tr><th>일시</th><th>품목명</th><th class="td-center">구분</th><th class="td-center">수량</th><th class="td-center">변동</th><th class="td-center">발주</th><th>메모</th><th>처리자</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>${pgHtml}`:'<div class="empty"><i class="fas fa-clock-rotate-left"></i><p>기록이 없습니다.</p></div>'}
    </div>`;
  document.getElementById('slog-item-sel').addEventListener('change',e=>{stockLogItem=e.target.value;stockLogPage=1;renderStockLogs();});
  document.getElementById('slog-item').addEventListener('input',e=>{stockLogFilter=e.target.value;stockLogPage=1;renderStockLogs();});
  document.getElementById('slog-type').addEventListener('change',e=>{stockLogType=e.target.value;stockLogPage=1;renderStockLogs();});
  document.getElementById('slog-date-from').addEventListener('change',e=>{stockLogDateFrom=e.target.value;stockLogPage=1;renderStockLogs();});
  document.getElementById('slog-date-to').addEventListener('change',e=>{stockLogDateTo=e.target.value;stockLogPage=1;renderStockLogs();});
  document.getElementById('slog-reset').addEventListener('click',()=>{stockLogFilter='';stockLogType='';stockLogItem='';stockLogDateFrom='';stockLogDateTo='';stockLogPage=1;renderStockLogs();});
  // 페이지 버튼 이벤트 위임
  document.querySelectorAll('.pg-btn[data-fn="_goStockLogPage"]').forEach(btn=>{
    btn.addEventListener('click',()=>{stockLogPage=parseInt(btn.dataset.pg);renderStockLogs();window.scrollTo(0,0);});
  });
  document.querySelectorAll('.pg-go-btn[data-fn="_goStockLogPage"]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const val=parseInt(document.getElementById(btn.dataset.input)?.value)||1;
      stockLogPage=Math.max(1,Math.min(parseInt(btn.dataset.max),val));
      renderStockLogs();window.scrollTo(0,0);
    });
  });
}

// 재고 관리 (관리자·서랍장만)
let invModalState={itemId:null,type:'입고'};
function renderInventory(filterItemId){
  if(!requireAdmin())return;
  const allItems=getItems().filter(i=>i.isActive&&isTrackStock(i)&&i.drawerType!=='handle');
  // 현재고 표 필터 적용
  let items=allItems;
  if(invItemSearch)items=items.filter(i=>i.name.includes(invItemSearch));
  if(invOnlyZero)items=items.filter(i=>i.currentStock===0);
  else if(invOnlyLow)items=items.filter(i=>i.currentStock>0&&i.currentStock<=3);

  const totalStock=allItems.reduce((s,i)=>s+i.currentStock,0);
  const zeroCount=allItems.filter(i=>i.currentStock===0).length;
  const lowCount=allItems.filter(i=>i.currentStock>0&&i.currentStock<=3).length;

  // 현재고 표 — 색상별 행 표시
  const tableRows=items.map(item=>{
    const sTotal=item.stockSiheung!==undefined?item.stockSiheung:item.currentStock;
    const pTotal=item.stockPyeongtaek||0;
    const grandTotal=sTotal+pTotal;
    const rowBg=grandTotal===0?'background:#fef2f2':grandTotal<=3?'background:#fffbeb':'';
    // 색상별 행 생성
    const colorRows=SHELF_COLORS.map(color=>{
      const sC=(item.colorStockSiheung||{})[color]||0;
      const pC=(item.colorStockPyeongtaek||{})[color]||0;
      const tot=sC+pC;
      const cColor=tot===0?'#9ca3af':tot<=3?'#d97706':'var(--text)';
      return `<tr style="background:#fafafa">
        <td style="padding-left:24px;font-size:12px;color:var(--text-2)">${color}</td>
        <td class="td-center" style="font-size:11px;color:#9ca3af"></td>
        <td class="td-center"><span style="font-size:13px;font-weight:600;color:${sC===0?'#9ca3af':sC<=3?'#d97706':'#1e40af'}">${sC}</span></td>
        <td class="td-center"><span style="font-size:13px;font-weight:600;color:${pC===0?'#9ca3af':pC<=3?'#d97706':'#065f46'}">${pC}</span></td>
        <td class="td-center"><span style="font-size:13px;font-weight:700;color:${cColor}">${tot}</span></td>
        <td></td>
      </tr>`;
    }).join('');
    return `<tr style="${rowBg}">
      <td class="td-name">${item.name}</td>
      <td class="td-center">${drawerBadge(item)}</td>
      <td class="td-center"><span class="td-num" style="font-size:14px;font-weight:700;color:${sTotal===0?'#dc2626':sTotal<=3?'#d97706':'#1e40af'}">${sTotal}</span></td>
      <td class="td-center"><span class="td-num" style="font-size:14px;font-weight:700;color:${pTotal===0?'#dc2626':pTotal<=3?'#d97706':'#065f46'}">${pTotal}</span></td>
      <td class="td-center"><span class="td-num" style="font-size:14px;font-weight:700;color:${grandTotal===0?'#dc2626':grandTotal<=3?'#d97706':'var(--text)'}">${grandTotal}</span></td>
      <td class="td-center">
        <div style="display:flex;gap:4px;justify-content:center;flex-wrap:wrap">
          <button class="btn btn-xs inv-action-btn" style="background:#dbeafe;color:#1e40af;border:none" data-inv-id="${item.id}" data-inv-type="입고">입고</button>
          <button class="btn btn-xs inv-action-btn" style="background:#fee2e2;color:#991b1b;border:none" data-inv-id="${item.id}" data-inv-type="출고">출고</button>
          <button class="btn btn-xs inv-action-btn" style="background:#f3f4f6;color:#374151;border:none" data-inv-id="${item.id}" data-inv-type="조정">조정</button>
          <button class="btn btn-xs inv-log-filter-btn" data-item-id="${item.id}" style="background:#f0fdf4;color:#15803d;border:none"><i class="fas fa-list-ul"></i> 기록</button>
        </div>
      </td>
    </tr>${colorRows}`;
  }).join('')||'<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-3)">검색 결과가 없습니다.</td></tr>';

  // 재고 기록 필터 상태 (renderInventory 호출 시 품목 필터 주입 가능)
  if(filterItemId!==undefined)stockLogItem=String(filterItemId);
  const allLogs=getLogs().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  const logItems=getItems();
  const selItem=stockLogItem?logItems.find(i=>i.id===parseInt(stockLogItem)):null;
  const filtered=allLogs.filter(l=>{
    if(stockLogItem&&l.itemId!==parseInt(stockLogItem))return false;
    if(stockLogFilter){const it=logItems.find(i=>i.id===l.itemId);if(!it||!it.name.includes(stockLogFilter))return false;}
    if(stockLogType&&l.type!==stockLogType)return false;
    if(stockLogDateFrom&&l.createdAt.slice(0,10)<stockLogDateFrom)return false;
    if(stockLogDateTo&&l.createdAt.slice(0,10)>stockLogDateTo)return false;
    return true;
  });
  const selLogs=stockLogItem?allLogs.filter(l=>l.itemId===parseInt(stockLogItem)):[];
  const totalIn=selLogs.filter(l=>l.qty>0).reduce((s,l)=>s+l.qty,0);
  const totalOut=selLogs.filter(l=>l.qty<0).reduce((s,l)=>s+Math.abs(l.qty),0);
  const last7=new Date();last7.setDate(last7.getDate()-7);
  const recent7=selLogs.filter(l=>new Date(l.createdAt)>=last7).length;
  const lastLog=selLogs[0];
  const itemOpts=allItems.filter(i=>i.drawerType!=='handle').map(i=>`<option value="${i.id}"${stockLogItem===String(i.id)?' selected':''}>${i.name}</option>`).join('');
  const typeOpts=['입고','출고','조정','발주차감','발주수정재반영','취소롤백'].map(t=>`<option value="${t}"${stockLogType===t?' selected':''}>${t}</option>`).join('');
  const INVPER=20;
  const totalInvLog=filtered.length;
  if(invLogPage>Math.ceil(totalInvLog/INVPER)||invLogPage<1)invLogPage=1;
  const invPaginated=filtered.slice((invLogPage-1)*INVPER, invLogPage*INVPER);
  const logRows=invPaginated.map(l=>{
    const it=logItems.find(i=>i.id===l.itemId);
    const typeCls=logTypeCls(l.type);
    const orderLink=l.orderId?`<button class="btn btn-ghost btn-xs slog-order-link" data-order-id="${l.orderId}" style="font-size:11px;padding:1px 5px">#${l.orderId}</button>`:'-';
    const whBadge=l.warehouse?`<span style="font-size:10px;padding:1px 6px;border-radius:20px;font-weight:700;background:${l.warehouse==='시흥'?'#dbeafe':'#dcfce7'};color:${l.warehouse==='시흥'?'#1e40af':'#065f46'}">${l.warehouse}</span>`:'<span style="font-size:10px;color:var(--text-3)">-</span>';
    const colorBadge=l.color?`<span style="font-size:10px;padding:1px 6px;border-radius:20px;background:#ede9fe;color:#6d28d9;font-weight:700">${l.color}</span>`:'<span style="font-size:10px;color:var(--text-3)">-</span>';
    return`<tr>
      <td class="td-muted" style="font-size:11px;white-space:nowrap">${fmtDt(l.createdAt)}</td>
      <td class="td-name" style="font-size:12px">${it?it.name:'?'}</td>
      <td class="td-center"><span class="badge ${typeCls}" style="font-size:10px">${l.type}</span></td>
      <td class="td-center">${whBadge}</td>
      <td class="td-center">${colorBadge}</td>
      <td class="td-center" style="font-weight:800;color:${l.qty>=0?'#16a34a':'#dc2626'}">${l.qty>0?'+':''}${l.qty}</td>
      <td class="td-center">${l.beforeStock} → <strong>${l.afterStock}</strong></td>
      <td class="td-center">${orderLink}</td>
      <td class="td-muted" style="font-size:11px">${l.memo||'-'}</td>
    </tr>`;
  }).join('');
  const invPgHtml=makePaginationHtml(totalInvLog,invLogPage,INVPER,'_goInvLogPage');
  const selSiheung=selItem?(selItem.stockSiheung!==undefined?selItem.stockSiheung:selItem.currentStock):0;
  const selPyeongtaek=selItem?(selItem.stockPyeongtaek||0):0;
  const summaryHtml=selItem?`<div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap">
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:var(--r);padding:10px 16px"><p style="font-size:10px;font-weight:700;color:#3b82f6;margin-bottom:2px">시흥 재고</p><p style="font-size:22px;font-weight:800;color:${selSiheung===0?'#dc2626':'#1e40af'}">${selSiheung}</p></div>
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:var(--r);padding:10px 16px"><p style="font-size:10px;font-weight:700;color:#16a34a;margin-bottom:2px">평택 재고</p><p style="font-size:22px;font-weight:800;color:${selPyeongtaek===0?'#dc2626':'#065f46'}">${selPyeongtaek}</p></div>
    <div style="background:#fff;border:1px solid var(--border);border-radius:var(--r);padding:10px 16px"><p style="font-size:10px;font-weight:700;color:var(--text-3);margin-bottom:2px">누적 입고</p><p style="font-size:22px;font-weight:800;color:#16a34a">+${totalIn}</p></div>
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:var(--r);padding:10px 16px"><p style="font-size:10px;font-weight:700;color:#dc2626;margin-bottom:2px">누적 출고</p><p style="font-size:22px;font-weight:800;color:#dc2626">-${totalOut}</p></div>
    <div style="background:#fff;border:1px solid var(--border);border-radius:var(--r);padding:10px 16px"><p style="font-size:10px;font-weight:700;color:var(--text-3);margin-bottom:2px">최근 7일</p><p style="font-size:22px;font-weight:800;color:#1d4ed8">${recent7}건</p></div>
    <div style="background:#fff;border:1px solid var(--border);border-radius:var(--r);padding:10px 16px"><p style="font-size:10px;font-weight:700;color:var(--text-3);margin-bottom:2px">마지막 변동</p><p style="font-size:13px;font-weight:700;color:#374151">${lastLog?fmtDt(lastLog.createdAt):'-'}</p></div>
  </div>`:'';

  document.getElementById('content').innerHTML=`
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:2px">
      <div class="section-title" style="margin-bottom:0">재고 관리</div>
      <button onclick="downloadInventoryExcel()" class="btn btn-outline btn-sm" style="border:1.5px solid #15803d;color:#15803d;font-weight:700"><i class="fas fa-file-excel"></i> 재고 현황 엑셀</button>
    </div>
    <div class="section-sub">현재고 확인 · 입고/출고/조정 처리 · 재고 기록 조회를 한 화면에서 처리합니다.</div>

    <!-- 상단 요약 카드 -->
    <div style="display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap">
      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:var(--r);padding:12px 20px;min-width:120px">
        <p style="font-size:11px;font-weight:700;color:#3b82f6;margin-bottom:3px">시흥 재고</p>
        <p style="font-size:26px;font-weight:800;color:#1e40af">${allItems.reduce((s,i)=>s+(i.stockSiheung!==undefined?i.stockSiheung:i.currentStock),0)}</p>
      </div>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:var(--r);padding:12px 20px;min-width:120px">
        <p style="font-size:11px;font-weight:700;color:#16a34a;margin-bottom:3px">평택 재고</p>
        <p style="font-size:26px;font-weight:800;color:#065f46">${allItems.reduce((s,i)=>s+(i.stockPyeongtaek||0),0)}</p>
      </div>
      <div style="background:#fff;border:1px solid var(--border);border-radius:var(--r);padding:12px 20px;min-width:120px">
        <p style="font-size:11px;font-weight:700;color:var(--text-3);margin-bottom:3px">전체 합계</p>
        <p style="font-size:26px;font-weight:800;color:#374151">${totalStock}</p>
      </div>
      <div style="background:#fff;border:1px solid var(--border);border-radius:var(--r);padding:12px 20px;min-width:120px">
        <p style="font-size:11px;font-weight:700;color:var(--text-3);margin-bottom:3px">관리 품목</p>
        <p style="font-size:26px;font-weight:800;color:#374151">${allItems.length}</p>
      </div>
      ${zeroCount>0?`<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:var(--r);padding:12px 20px;min-width:120px;cursor:pointer" onclick="invOnlyZero=!invOnlyZero;invOnlyLow=false;renderInventory()">
        <p style="font-size:11px;font-weight:700;color:#dc2626;margin-bottom:3px">재고 없음</p>
        <p style="font-size:26px;font-weight:800;color:#dc2626">${zeroCount}</p>
      </div>`:''}
      ${lowCount>0?`<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:var(--r);padding:12px 20px;min-width:120px;cursor:pointer" onclick="invOnlyLow=!invOnlyLow;invOnlyZero=false;renderInventory()">
        <p style="font-size:11px;font-weight:700;color:#d97706;margin-bottom:3px">부족 위험 (≤3)</p>
        <p style="font-size:26px;font-weight:800;color:#d97706">${lowCount}</p>
      </div>`:''}
    </div>

    <!-- 현재고 표 -->
    <div class="card" style="margin-bottom:24px">
      <div class="card-header">
        <h3>품목별 현재고 (창고별)</h3>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <input class="form-input" id="inv-item-search" placeholder="품목명 검색" value="${invItemSearch}" style="max-width:150px;padding:5px 8px;font-size:12px"/>
          <label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;white-space:nowrap">
            <input type="checkbox" id="inv-only-zero" ${invOnlyZero?'checked':''}> 재고 0만
          </label>
          <label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;white-space:nowrap">
            <input type="checkbox" id="inv-only-low" ${invOnlyLow?'checked':''}> 부족 위험만
          </label>
          ${(invItemSearch||invOnlyZero||invOnlyLow)?`<button class="btn btn-ghost btn-xs" onclick="invItemSearch='';invOnlyZero=false;invOnlyLow=false;renderInventory()">초기화</button>`:''}
          <span style="font-size:12px;color:var(--text-3)">${items.length}/${allItems.length}</span>
        </div>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>품목명</th><th class="td-center">구분</th><th class="td-center" style="color:#1e40af">시흥</th><th class="td-center" style="color:#065f46">평택</th><th class="td-center">합계</th><th class="td-center" style="min-width:200px">처리</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table></div>
    </div>

    <!-- 재고 기록 조회 -->
    <div class="card">
      <div class="card-header"><h3 id="inv-log-section-title">재고 기록${selItem?' — '+selItem.name:''}</h3>${selItem?`<button class="btn btn-ghost btn-xs" id="inv-log-clear-filter" style="font-size:12px">전체 보기</button>`:''}</div>
      <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <select class="form-input" id="slog-item-sel" style="max-width:150px">
          <option value="">전체 품목</option>${itemOpts}
        </select>
        <input class="form-input" placeholder="품목명 검색" id="slog-item" value="${stockLogFilter}" style="max-width:130px"/>
        <select class="form-input" id="slog-type" style="max-width:140px">
          <option value="">전체 유형</option>${typeOpts}
        </select>
        <input type="date" class="form-input" id="slog-date-from" value="${stockLogDateFrom}" style="max-width:130px"/>
        <span style="font-size:12px;color:var(--text-3)">~</span>
        <input type="date" class="form-input" id="slog-date-to" value="${stockLogDateTo}" style="max-width:130px"/>
        <button class="btn btn-outline btn-sm" id="slog-reset">초기화</button>
        <span style="font-size:12px;color:var(--text-3)">총 ${filtered.length}건</span>
      </div>
      ${summaryHtml?`<div style="padding:12px 16px;border-bottom:1px solid var(--border)">${summaryHtml}</div>`:''}
      ${logRows?`<div class="table-wrap"><table>
        <thead><tr><th>일시</th><th>품목명</th><th class="td-center">구분</th><th class="td-center">창고</th><th class="td-center">색상</th><th class="td-center">수량</th><th class="td-center">변동</th><th class="td-center">발주</th><th>메모</th></tr></thead>
        <tbody>${logRows}</tbody>
      </table></div>${invPgHtml}`:'<div class="empty"><i class="fas fa-clock-rotate-left"></i><p>기록이 없습니다.</p></div>'}
    </div>`;

  // 이벤트 바인딩 — 현재고 표 필터
  const invSearch=document.getElementById('inv-item-search');
  if(invSearch)invSearch.addEventListener('input',e=>{invItemSearch=e.target.value;renderInventory();});
  const invZeroChk=document.getElementById('inv-only-zero');
  if(invZeroChk)invZeroChk.addEventListener('change',e=>{invOnlyZero=e.target.checked;invOnlyLow=false;renderInventory();});
  const invLowChk=document.getElementById('inv-only-low');
  if(invLowChk)invLowChk.addEventListener('change',e=>{invOnlyLow=e.target.checked;invOnlyZero=false;renderInventory();});
  // 재고 기록 필터 (페이지 초기화)
  document.getElementById('slog-item-sel').addEventListener('change',e=>{stockLogItem=e.target.value;invLogPage=1;renderInventory();});
  document.getElementById('slog-item').addEventListener('input',e=>{stockLogFilter=e.target.value;invLogPage=1;renderInventory();});
  document.getElementById('slog-type').addEventListener('change',e=>{stockLogType=e.target.value;invLogPage=1;renderInventory();});
  document.getElementById('slog-date-from').addEventListener('change',e=>{stockLogDateFrom=e.target.value;invLogPage=1;renderInventory();});
  document.getElementById('slog-date-to').addEventListener('change',e=>{stockLogDateTo=e.target.value;invLogPage=1;renderInventory();});
  document.getElementById('slog-reset').addEventListener('click',()=>{stockLogFilter='';stockLogType='';stockLogItem='';stockLogDateFrom='';stockLogDateTo='';invLogPage=1;renderInventory();});
  const clearFilter=document.getElementById('inv-log-clear-filter');
  if(clearFilter)clearFilter.addEventListener('click',()=>{stockLogItem='';invLogPage=1;renderInventory();});
  // 페이지 버튼 이벤트 위임
  document.querySelectorAll('.pg-btn[data-fn="_goInvLogPage"]').forEach(btn=>{
    btn.addEventListener('click',()=>{invLogPage=parseInt(btn.dataset.pg);renderInventory();document.getElementById('inv-log-section-title')?.scrollIntoView({behavior:'smooth'});});
  });
  document.querySelectorAll('.pg-go-btn[data-fn="_goInvLogPage"]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const val=parseInt(document.getElementById(btn.dataset.input)?.value)||1;
      invLogPage=Math.max(1,Math.min(parseInt(btn.dataset.max),val));
      renderInventory();document.getElementById('inv-log-section-title')?.scrollIntoView({behavior:'smooth'});
    });
  });
}

function openItemLog(itemId, itemName){
  const logs=getLogs().filter(l=>l.itemId===itemId).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  document.getElementById('item-log-title').textContent=itemName+' — 재고 기록';
  const typeCls=t=>t==='입고'?'type-in':t==='출고'?'type-out':t==='발주차감'?'badge-red':t==='취소롤백'?'badge-done':'type-adj';
  const rows=logs.map(l=>`<tr>
    <td class="td-muted" style="font-size:12px">${fmtDt(l.createdAt)}</td>
    <td class="td-center"><span class="badge ${typeCls(l.type)}">${l.type}</span></td>
    <td class="td-center" style="font-weight:700;color:${l.qty>=0?'#16a34a':'#dc2626'}">${l.qty>0?'+':''}${l.qty}</td>
    <td class="td-center">${l.beforeStock} → <strong>${l.afterStock}</strong></td>
    <td class="td-muted" style="font-size:12px">${l.memo||'-'}</td>
    <td class="td-muted" style="font-size:12px">${l.createdBy||'-'}</td>
  </tr>`).join('');
  document.getElementById('item-log-body').innerHTML=rows
    ?`<div class="table-wrap"><table>
        <thead><tr><th>일시</th><th class="td-center">구분</th><th class="td-center">수량</th><th class="td-center">변동</th><th>메모</th><th>처리자</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`
    :'<div class="empty"><i class="fas fa-list-ul"></i><p>기록이 없습니다.</p></div>';
  openModal('item-log-modal');
}

// 7색 일괄 입력 행 생성 (창고별 현재 색상재고 기준)
function renderInvColorRows(item,type,wh){
  const cont=document.getElementById('inv-color-rows');
  if(!cont)return;
  const cwKey=getColorWhKey(wh);
  const cmap=item[cwKey]||{};
  cont.innerHTML=SHELF_COLORS.map(c=>{
    const cur=cmap[c]||0;
    const ph=type==='조정'?'조정 후':(type==='입고'?'입고 수량':'출고 수량');
    const preVal=type==='조정'?cur:'';
    return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <span style="width:80px;font-size:12px">${c}</span>
      <span style="width:54px;font-size:12px;color:var(--text-3)">현재 ${cur}</span>
      <input type="number" min="0" class="form-input inv-color-qty" data-color="${c}" data-cur="${cur}" value="${preVal}" placeholder="${ph}" style="flex:1;min-width:60px" oninput="updateInvPreview()"/>
      <span class="inv-color-after" data-color="${c}" style="width:64px;font-size:12px;text-align:right;color:var(--text-3)"></span>
    </div>`;
  }).join('');
  // Enter = 다음 색상 칸으로 이동 (제출 아님)
  const inputs=[...cont.querySelectorAll('.inv-color-qty')];
  inputs.forEach((el,i)=>{
    el.addEventListener('keydown',e=>{
      if(e.key==='Enter'){e.preventDefault();const nx=inputs[i+1];if(nx)nx.focus();}
    });
  });
}
function invSelectWarehouse(wh){
  document.getElementById('inv-warehouse').value=wh;
  const sBtn=document.getElementById('inv-wh-siheung');
  const pBtn=document.getElementById('inv-wh-pyeongtaek');
  if(sBtn){sBtn.style.background=wh==='시흥'?'var(--primary)':'';sBtn.style.color=wh==='시흥'?'#fff':'';sBtn.style.borderColor=wh==='시흥'?'var(--primary)':'';}
  if(pBtn){pBtn.style.background=wh==='평택'?'var(--primary)':'';pBtn.style.color=wh==='평택'?'#fff':'';pBtn.style.borderColor=wh==='평택'?'var(--primary)':'';}
  // 창고 선택 시 해당 창고 기준 7색 입력 행 (재)렌더
  const grp=document.getElementById('inv-color-rows-group');
  if(wh){
    const item=getItem(invModalState.itemId);
    if(item)renderInvColorRows(item,invModalState.type,wh);
    if(grp)grp.style.display='';
  }else if(grp){grp.style.display='none';}
  updateInvPreview();
}

function openInvModal(itemId,type){
  invModalState={itemId,type};
  const item=getItem(itemId);
  const typeColor=type==='입고'?'#1e40af':type==='출고'?'#991b1b':'#713f12';
  document.getElementById('inv-modal-title').innerHTML=`<span style="color:${typeColor}">${type}</span> 처리`;
  const sStock=item.stockSiheung!==undefined?item.stockSiheung:item.currentStock;
  const pStock=item.stockPyeongtaek||0;
  // 색상별 재고 요약 표시
  const colorSummary=SHELF_COLORS.map(c=>{
    const cs=item.colorStockSiheung||{};
    const cp=item.colorStockPyeongtaek||{};
    const tot=(cs[c]||0)+(cp[c]||0);
    return tot>0?`${c}:${tot}`:null;
  }).filter(Boolean).join(', ');
  document.getElementById('inv-modal-info').innerHTML=
    `<strong>${item.name}</strong><br>`+
    `<span style="font-size:12px;color:#1e40af">시흥 계: ${sStock}개</span> &nbsp;/&nbsp; <span style="font-size:12px;color:#065f46">평택 계: ${pStock}개</span>`+
    (colorSummary?`<br><span style="font-size:11px;color:var(--text-3)">${colorSummary}</span>`:'');
  document.getElementById('inv-qty-label').innerHTML=type==='조정'?'색상별 조정 후 재고 <span class="req">*</span>':`색상별 ${type} 수량 <span class="req">*</span>`;
  document.getElementById('inv-qty').value='';
  document.getElementById('inv-date').value=new Date().toISOString().slice(0,10);
  document.getElementById('inv-memo').value='';
  document.getElementById('inv-preview').innerHTML='';
  // 단일 색상 select는 7색 일괄 모드에서 미사용 (숨김 유지)
  const colorGroup=document.getElementById('inv-color-group');
  if(colorGroup)colorGroup.style.display='none';
  // 창고 미선택 초기 상태 (시흥 기본 제거 — 평택 입력 실수 방지)
  document.getElementById('inv-warehouse').value='';
  const sBtn=document.getElementById('inv-wh-siheung');
  const pBtn=document.getElementById('inv-wh-pyeongtaek');
  [sBtn,pBtn].forEach(b=>{if(b){b.style.background='';b.style.color='';b.style.borderColor='';}});
  // 7색 행 영역: 창고 선택 전 숨김 + 안내
  const rowsGrp=document.getElementById('inv-color-rows-group');
  if(rowsGrp)rowsGrp.style.display='none';
  const rowsCont=document.getElementById('inv-color-rows');
  if(rowsCont)rowsCont.innerHTML='';
  const btn=document.getElementById('inv-submit-btn');
  btn.className='btn '+(type==='입고'?'btn-primary':type==='출고'?'btn-danger':'btn-outline');
  btn.textContent=type+' 처리';
  openModal('inv-modal');
  setTimeout(()=>{if(sBtn)sBtn.focus();},100);
}

function updateInvPreview(){
  const item=getItem(invModalState.itemId);if(!item)return;
  const preview=document.getElementById('inv-preview');
  const{type}=invModalState;
  const wh=document.getElementById('inv-warehouse')?.value||'';
  if(!wh){preview.innerHTML='<div class="preview-box" style="color:var(--text-3)">창고를 먼저 선택하세요.</div>';return;}
  const cwKey=getColorWhKey(wh);
  const cmap=item[cwKey]||{};
  const rows=[...document.querySelectorAll('#inv-color-rows .inv-color-qty')];
  let whBefore=0,whAfter=0;const lines=[];
  SHELF_COLORS.forEach(c=>{whBefore+=cmap[c]||0;});
  rows.forEach(el=>{
    const c=el.getAttribute('data-color');
    const cur=parseInt(el.getAttribute('data-cur'))||0;
    const raw=el.value.trim();
    let after=cur;
    if(raw!==''){
      const v=parseInt(raw);
      if(!isNaN(v)){
        if(type==='입고')after=cur+v;
        else if(type==='출고')after=Math.max(cur-v,0);
        else after=v;
      }
    }
    whAfter+=after;
    const aft=document.querySelector(`#inv-color-rows .inv-color-after[data-color="${c}"]`);
    const d=after-cur;
    if(aft)aft.innerHTML=d!==0?`→ <strong style="color:${d<0?'#dc2626':'#16a34a'}">${after}</strong>`:`${after}`;
    if(d!==0)lines.push(`${c}: ${cur}→${after} (${d>0?'+':''}${d})`);
  });
  const whDiff=whAfter-whBefore;
  preview.innerHTML=`<div class="preview-box">[${wh}] 합계: ${whBefore} → <strong style="color:${whDiff<0?'#dc2626':'#16a34a'}">${whAfter}</strong> <span style="color:var(--text-3)">(${whDiff>0?'+':''}${whDiff})</span>`+
    (lines.length?`<br><span style="font-size:11px;color:var(--text-3)">${lines.join(', ')}</span>`:'<br><span style="font-size:11px;color:var(--text-3)">변경할 값을 입력하세요.</span>')+`</div>`;
}

function submitInventory(){
  const{itemId,type}=invModalState;
  const memo=document.getElementById('inv-memo').value.trim();
  const warehouse=document.getElementById('inv-warehouse')?.value||'';
  const logDate=document.getElementById('inv-date')?.value||'';
  if(!logDate){toast('날짜를 입력해주세요.','error');return;}
  if(!warehouse){toast('창고를 먼저 선택해주세요.','error');return;}
  const item=getItem(itemId);
  if(!item){toast('품목을 찾을 수 없습니다.','error');return;}
  const cwKey=getColorWhKey(warehouse);
  const cmap=item[cwKey]||{};
  const rows=[...document.querySelectorAll('#inv-color-rows .inv-color-qty')];
  // 1) 처리 대상 색상 수집 (변화 있는 색상만)
  const targets=[];
  for(const el of rows){
    const color=el.getAttribute('data-color');
    const cur=parseInt(el.getAttribute('data-cur'))||0;
    const raw=el.value.trim();
    if(raw===''){continue;}
    const v=parseInt(raw);
    if(isNaN(v)){toast(`[${color}] 올바른 수량을 입력해주세요.`,'error');return;}
    if(type==='조정'){
      if(v<0){toast(`[${color}] 조정 후 재고는 0 이상이어야 합니다.`,'error');return;}
      if(v===cur){continue;}
      targets.push({color,qty:v});
    }else{
      if(v===0){continue;}
      if(v<1){toast(`[${color}] ${type} 수량은 1 이상이어야 합니다.`,'error');return;}
      targets.push({color,qty:v});
    }
  }
  if(targets.length===0){toast('변경할 값을 입력해주세요.','error');return;}
  // 2) 사전 검증 (출고 초과를 처리 전에 전부 확인 — 부분반영 방지)
  if(type==='출고'){
    for(const t of targets){
      const cur=cmap[t.color]||0;
      if(t.qty>cur){toast(`[${t.color}] 출고 수량(${t.qty})이 ${warehouse} 재고(${cur})를 초과합니다.`,'error');return;}
    }
  }
  // 3) 검증 통과한 색상만 순차 처리 (processInventory 코어 미변경, 색상별 호출)
  let okCount=0;let firstBefore=null,lastAfter=null;
  try{
    for(const t of targets){
      const{before,after}=processInventory({itemId,type,qty:t.qty,memo,warehouse,logDate,color:t.color});
      if(firstBefore===null)firstBefore=before;
      lastAfter=after;okCount++;
    }
  }catch(e){
    renderInventory(stockLogItem?parseInt(stockLogItem):undefined);
    toast(`일부만 처리됨 (${okCount}/${targets.length}): ${e.message}`,'error');
    return;
  }
  closeModal('inv-modal');
  toast(`[${warehouse}] ${type} 처리 완료: ${okCount}개 색상`,'success');
  renderInventory(stockLogItem?parseInt(stockLogItem):undefined);
}
document.getElementById('inv-qty').addEventListener('keydown',e=>{if(e.key==='Enter')submitInventory();});
