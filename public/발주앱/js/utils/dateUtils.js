// Date Utilities Section
// Date parsing, formatting, and synchronization

// ── 분리형 날짜 입력 헬퍼 ──
// 날짜 prefix → 분리칸 ID prefix 변환 (o-ship-date → o-ship, o-date → o-date)
function _datePartPrefix(prefix){
  if(prefix==='o-ship-date')return 'o-ship';
  return prefix; // o-date → o-date-y/m/d
}
function syncDateParts(prefix){
  const p=_datePartPrefix(prefix);
  const yEl=document.getElementById(p+'-y');
  const mEl=document.getElementById(p+'-m');
  const dEl=document.getElementById(p+'-d');
  const hidden=document.getElementById(prefix);
  if(!yEl||!mEl||!dEl||!hidden)return;
  const y=yEl.value.padStart(4,'0');
  const m=(mEl.value||'').padStart(2,'0');
  const d=(dEl.value||'').padStart(2,'0');
  if(y.length===4&&m.length===2&&d.length===2&&/\d{4}/.test(y)&&/\d{2}/.test(m)&&/\d{2}/.test(d)){
    hidden.value=`${y}-${m}-${d}`;
  } else {
    hidden.value='';
  }
}
// 출고일 미정 상태 토글
function orderSelectWarehouse(wh){
  const sel=document.getElementById('o-warehouse');
  if(sel&&sel.tagName==='SELECT')sel.value=wh;
  // 색상 포함해서 재고 갱신
  const color=(document.getElementById('shared-color-sel')||{}).value||'';
  _refreshDrawerStockDisplay(wh,color);
}
// 창고+색상 기준으로 발주서 내 서랍장 재고 표시 일괄 갱신
function _refreshDrawerStockDisplay(wh,color){
  const items=getItems();
  const noColor=!color; // 색상 미선택
  document.querySelectorAll('.drawer-qty[data-item-id]').forEach(inp=>{
    const itemId=parseInt(inp.dataset.itemId);
    const item=items.find(i=>i.id===itemId);
    if(!item||item.category!=='서랍장')return;
    const tr=inp.closest('tr');if(!tr)return;
    const stockSpan=tr.querySelector('.cur-stock-val');
    const shortageEl=document.getElementById(`oshortage-${itemId}`);
    if(noColor){
      // 색상 미선택: 창고 합계 재고 표시
      const whKey2=getWhKey(wh);
      const total=item[whKey2]||0;
      inp.dataset.stock=total;
      if(stockSpan){stockSpan.textContent=total+'개';stockSpan.className='cur-stock-val'+(total===0?' zero':'');}
      if(shortageEl)shortageEl.innerHTML='<span style="font-size:11px;color:var(--text-3)">색상 선택 필요</span>';
      return;
    }
    const stock=getWarehouseStock(item,wh,color);
    inp.dataset.stock=stock;
    if(stockSpan){stockSpan.textContent=stock+'개';stockSpan.className='cur-stock-val'+(stock===0?' zero':'');}
    const qty=parseInt(inp.value)||0;
    if(shortageEl){
      const shortage=Math.max(0,qty-stock);
      shortageEl.innerHTML=shortage>0?`<span class="sh-ng">부족 ${shortage}개</span>`:`<span class="sh-ok">부족없음</span>`;
    }
  });
}
function _setShipDateUndecided(isUndecided){
  const p=_datePartPrefix('o-ship-date');
  const yEl=document.getElementById(p+'-y');
  const mEl=document.getElementById(p+'-m');
  const dEl=document.getElementById(p+'-d');
  const hidden=document.getElementById('o-ship-date');
  const btn=document.getElementById('o-ship-undecided-btn');
  if(!yEl||!mEl||!dEl||!hidden)return;
  if(isUndecided){
    yEl.value=''; mEl.value=''; dEl.value='';
    hidden.value='0000-00-00';
    if(btn){btn.style.background='var(--primary)';btn.style.color='#fff';btn.style.borderColor='var(--primary)';}
  }else{
    yEl.value=''; mEl.value=''; dEl.value='';
    hidden.value='';
    if(btn){btn.style.background='';btn.style.color='';btn.style.borderColor='';}
  }
}
function setDateValue(prefix, val){
  // val: 'YYYY-MM-DD'
  if(!val){
    const p=_datePartPrefix(prefix);
    const yEl=document.getElementById(p+'-y');
    const mEl=document.getElementById(p+'-m');
    const dEl=document.getElementById(p+'-d');
    const hidden=document.getElementById(prefix);
    if(yEl)yEl.value='';
    if(mEl)mEl.value='';
    if(dEl)dEl.value='';
    if(hidden)hidden.value='';
    return;
  }
  // 미정 처리 (출고일만)
  if(val==='0000-00-00'&&prefix==='o-ship-date'){
    _setShipDateUndecided(true);
    return;
  }
  const parts=val.split('-');
  if(parts.length!==3)return;
  const p=_datePartPrefix(prefix); // 분리칸 ID prefix 변환
  const yEl=document.getElementById(p+'-y');
  const mEl=document.getElementById(p+'-m');
  const dEl=document.getElementById(p+'-d');
  const hidden=document.getElementById(prefix);
  if(yEl)yEl.value=parts[0];
  if(mEl)mEl.value=parts[1].replace(/^0/,'');
  if(dEl)dEl.value=parts[2].replace(/^0/,'');
  if(hidden)hidden.value=val;
}
function getDateValue(prefix){
  return (document.getElementById(prefix)||{}).value||'';
}
function setupDateInput(id){
  // 분리형으로 교체됐으므로 no-op (호환용)
}


