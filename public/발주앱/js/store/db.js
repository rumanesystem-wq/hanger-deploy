// DB/State/Firestore Section
// 재고, 발주서, 로그 관리 관련 데이터베이스 함수

// ── IndexedDB 3중 백업 (orders 전용) ──────────────────────────
const _IDB={
  DB_NAME:'sh_safe',DB_VER:1,STORE:'orders',
  _db:null,
  _open(){
    if(this._db) return Promise.resolve(this._db);
    return new Promise((res,rej)=>{
      const req=indexedDB.open(this.DB_NAME,this.DB_VER);
      req.onupgradeneeded=e=>{e.target.result.createObjectStore(this.STORE,{keyPath:'id'});};
      req.onsuccess=e=>{this._db=e.target.result;res(this._db);};
      req.onerror=()=>rej(req.error);
    });
  },
  async save(orders){
    try{
      const db=await this._open();
      const tx=db.transaction(this.STORE,'readwrite');
      const st=tx.objectStore(this.STORE);
      (orders||[]).forEach(o=>{if(o&&o.id!=null)st.put(o);});
      await new Promise((res,rej)=>{tx.oncomplete=res;tx.onerror=()=>rej(tx.error);});
    }catch(e){console.warn('[IDB 백업 실패]',e.message);}
  },
  async loadAll(){
    try{
      const db=await this._open();
      return await new Promise((res,rej)=>{
        const tx=db.transaction(this.STORE,'readonly');
        const req=tx.objectStore(this.STORE).getAll();
        req.onsuccess=()=>res(req.result||[]);
        req.onerror=()=>rej(req.error);
      });
    }catch(e){console.warn('[IDB 복원 실패]',e.message);return [];}
  }
};

// ── DB: localStorage + sessionStorage + IndexedDB + Firestore 4중 보호 ──
// 보호 키(orders 등 배열): get 시 빈 경우 백업에서 복원,
//                          set 시 절대 줄어들지 않도록 병합 후 모든 저장소에 동기화
const DB={
  // 발주서가 사라지면 안 되는 키 목록
  _GUARD:new Set(['orders','purchase_requests','accounts','logs','session']),

  get(k,d=[]){
    try{
      const raw=localStorage.getItem('sh_'+k);
      const val=raw?JSON.parse(raw):null;
      // 보호 키이고 localStorage가 비어 있으면 sessionStorage 복원 시도
      if(this._GUARD.has(k)&&Array.isArray(d)&&(!val||(Array.isArray(val)&&val.length===0))){
        const ss=sessionStorage.getItem('sh_ss_'+k);
        if(ss){
          const ssVal=JSON.parse(ss);
          if(Array.isArray(ssVal)&&ssVal.length>0){
            console.warn(`[DB 복원] localStorage 비어있음 → sessionStorage 복원: ${k} (${ssVal.length}건)`);
            localStorage.setItem('sh_'+k,ss);
            return ssVal;
          }
        }
      }
      return val!==null?val:d;
    }catch{return d;}
  },

  set(k,v){
    let toStore=v;

    // ── 보호 키: 항상 병합 (절대 줄어들지 않음) ──
    if(this._GUARD.has(k)&&Array.isArray(v)){
      try{
        const existing=JSON.parse(localStorage.getItem('sh_'+k)||'[]');
        if(Array.isArray(existing)&&existing.length>0){
          toStore=_mergeById(existing,v);
          if(toStore.length<existing.length){
            // 예외 상황: 병합 후에도 줄어들면 기존 유지
            console.error(`[DB 보호] ${k} 데이터 감소 차단: ${existing.length}→${toStore.length}, 기존 유지`);
            toStore=existing;
          }
        }
      }catch(e){console.warn('[DB 병합 오류]',e.message);}

      // sessionStorage 백업 (2중)
      try{ sessionStorage.setItem('sh_ss_'+k,JSON.stringify(toStore)); }catch(e){}

      // IndexedDB 백업 (3중, orders만)
      if(k==='orders'){ _IDB.save(toStore); }
    }

    // localStorage에 저장 (1중)
    localStorage.setItem('sh_'+k,JSON.stringify(toStore));

    // Firestore에 저장 (4중) — items는 initData 마이그레이션 중 잠금 (race condition 방지)
    if(window._FS && !(k==='items' && window._itemsInitLock)){
      window._FS.set(k,toStore).catch(e=>console.warn('[Firestore sync 실패]',k,e.message));
    }
  },

  nextId(k){const n=(this.get('_seq_'+k,0))+1;this.set('_seq_'+k,n);return n;},

  // 앱 시작 시 IndexedDB → localStorage 긴급 복원 (orders만)
  async restoreFromIDB(){
    try{
      const existing=JSON.parse(localStorage.getItem('sh_orders')||'[]');
      if(Array.isArray(existing)&&existing.length>0) return; // 이미 데이터 있음
      const idbOrders=await _IDB.loadAll();
      if(idbOrders.length>0){
        console.warn(`[IDB 복원] localStorage에 발주서 없음 → IndexedDB에서 ${idbOrders.length}건 복원`);
        // DB.set 우회해서 직접 localStorage에 쓰기 (무한루프 방지)
        localStorage.setItem('sh_orders',JSON.stringify(idbOrders));
        sessionStorage.setItem('sh_ss_orders',JSON.stringify(idbOrders));
        if(window._FS) window._FS.set('orders',idbOrders).catch(()=>{});
      }
    }catch(e){console.warn('[IDB 복원 실패]',e.message);}
  }
};

// ── 배열 ID 기준 병합 (로컬 + Firestore 유니언, 같은 ID면 Firestore 우선) ──
function _mergeById(local, remote){
  const ERP_FIELDS=['colorProdCdMap','prodCd','subTypeProdCdMap','damperProdCd','nonStdProdCd','empCd','bizCd'];
  const result=new Map();
  (local||[]).forEach(item=>{ if(item&&item.id!=null) result.set(item.id, item); });
  (remote||[]).forEach(remoteItem=>{
    if(!remoteItem||remoteItem.id==null) return;
    const localItem=result.get(remoteItem.id);
    if(!localItem){ result.set(remoteItem.id, remoteItem); return; }
    // 기본은 Firestore 우선, ERP 코드 필드는 더 많은 쪽 우선
    const merged={...remoteItem};
    ERP_FIELDS.forEach(f=>{
      const lv=localItem[f], rv=remoteItem[f];
      if(!rv && lv) { merged[f]=lv; return; }
      if(lv && rv && typeof lv==='object' && typeof rv==='object'){
        const lCount=Object.keys(lv).filter(k=>lv[k]&&lv[k]!=='N/A').length;
        const rCount=Object.keys(rv).filter(k=>rv[k]&&rv[k]!=='N/A').length;
        if(lCount>rCount) merged[f]=lv;
      }
    });
    result.set(remoteItem.id, merged);
  });
  return [...result.values()].sort((a,b)=>(a.id||0)-(b.id||0));
}

// ── Firestore ↔ 로컬 안전 동기화 (앱 시작 시 1회 실행) ──
// 규칙:
//   배열 키(orders/accounts/logs/purchase_requests/items): ID 기준 병합 → 절대 줄어들지 않음
//   시퀀스 키(_seq_*): 로컬·Firestore 중 큰 값 사용
//   그 외: Firestore 우선
//   로컬에만 있는 데이터 → Firestore에 역업로드
async function syncFromServer(){
  if(!window._FS){ console.warn('[Firestore] 미초기화, 로컬 데이터로 계속합니다.'); return; }
  try{
    const data=await window._FS.getAll();
    const MERGE_KEYS=['orders','accounts','logs','purchase_requests','items'];
    const SEQ_KEYS=['orders','logs','purchase_requests','order_items'];
    const toUpload={};  // Firestore에 역업로드할 항목

    // 1) Firestore에 있는 키 처리
    for(const [k,v] of Object.entries(data)){
      const localRaw=localStorage.getItem('sh_'+k);
      const localVal=localRaw?JSON.parse(localRaw):null;

      if(MERGE_KEYS.includes(k)&&Array.isArray(v)){
        // 배열: ID 기준 병합
        let merged=_mergeById(Array.isArray(localVal)?localVal:[], v);
        // items 병합 후 이름 기준 즉시 dedup (중복 방지)
        if(k==='items'){
          const byName=new Map();
          merged.forEach(i=>{
            if(!byName.has(i.name)){byName.set(i.name,i);return;}
            const prev=byName.get(i.name);
            const ps=Object.keys(prev.colorProdCdMap||{}).length+(prev.prodCd?10:0);
            const cs=Object.keys(i.colorProdCdMap||{}).length+(i.prodCd?10:0);
            if(cs>ps){
              // 현재가 더 많은 데이터 → ERP 코드 병합 후 교체
              const winner={...i};
              if(prev.colorProdCdMap)winner.colorProdCdMap=Object.assign({},prev.colorProdCdMap,winner.colorProdCdMap||{});
              // isActive는 더 최근에 바꾼 쪽 우선, 둘 다 타임스탬프 없으면 로컬 false 보존
              const pt=prev.isActiveUpdatedAt||'';
              const ct=winner.isActiveUpdatedAt||'';
              if(pt>ct){winner.isActive=prev.isActive;winner.isActiveUpdatedAt=pt;}
              else if(!pt&&!ct&&prev.isActive===false){winner.isActive=false;}
              byName.set(i.name,winner);
            } else {
              // 기존이 더 많은 데이터 → ERP 코드만 보완
              if(i.colorProdCdMap)prev.colorProdCdMap=Object.assign({},i.colorProdCdMap,prev.colorProdCdMap||{});
              // isActive는 더 최근에 바꾼 쪽 우선
              const pt=prev.isActiveUpdatedAt||'';
              const ct=i.isActiveUpdatedAt||'';
              if(ct>pt){prev.isActive=i.isActive;prev.isActiveUpdatedAt=ct;}
            }
          });
          merged=[...byName.values()].sort((a,b)=>(a.id||0)-(b.id||0));
        }
        localStorage.setItem('sh_'+k, JSON.stringify(merged));
        // items는 initData 마이그레이션 이후에 Firestore 동기화 (race condition 방지)
        // 그 외 배열은 즉시 역업로드
        if(k!=='items' && merged.length>v.length) toUpload[k]=merged;
      } else if(k.startsWith('_seq_')){
        // 시퀀스: 더 큰 값 유지
        const fsSeq=parseInt(v)||0;
        const localSeq=parseInt(localVal)||0;
        const maxSeq=Math.max(fsSeq,localSeq);
        localStorage.setItem('sh_'+k, JSON.stringify(maxSeq));
        if(maxSeq>fsSeq) toUpload[k]=maxSeq;
      } else {
        // 그 외: Firestore 우선
        localStorage.setItem('sh_'+k, JSON.stringify(v));
      }
    }

    // 2) 로컬에만 있는 데이터 → Firestore에 역업로드
    for(const k of MERGE_KEYS){
      if(!(k in data)){
        const localRaw=localStorage.getItem('sh_'+k);
        if(localRaw){
          const localVal=JSON.parse(localRaw);
          if(Array.isArray(localVal)&&localVal.length>0){
            toUpload[k]=localVal;
            console.log(`[동기화] 로컬 전용 키 발견, Firestore 업로드: ${k} (${localVal.length}건)`);
          }
        }
      }
    }
    // 시퀀스 키도 로컬에만 있으면 업로드
    for(const k of SEQ_KEYS){
      const seqKey='_seq_'+k;
      if(!(seqKey in data)){
        const localSeq=parseInt(localStorage.getItem('sh_'+seqKey)||'0');
        if(localSeq>0) toUpload[seqKey]=localSeq;
      }
    }

    // 3) 역업로드 실행 (비동기, 실패해도 앱 계속)
    for(const [k,v] of Object.entries(toUpload)){
      window._FS.set(k,v).catch(e=>console.warn('[Firestore 역업로드 실패]',k,e.message));
    }

    const mergedCount=Object.keys(data).length;
    const uploadCount=Object.keys(toUpload).length;
    console.log(`[Firestore 동기화 완료] ${mergedCount}개 키 로드, 역업로드 ${uploadCount}개`);
  }catch(e){
    console.warn('[Firestore 동기화 실패] 로컬 데이터로 계속합니다.',e.message);
  }
}

const DEFAULT_ACCOUNTS=[];
let currentUser=null;

function initAccounts(){
  if(DB.get('accounts',[]).length===0) DB.set('accounts',DEFAULT_ACCOUNTS);
}

// 현재 로그인 탭 ('orderer' | 'admin')
let loginTab='orderer';

function setLoginTab(tab){
  loginTab=tab;
  const isAdmin=tab==='admin';
  // 탭 버튼 스타일
  document.getElementById('tab-orderer').style.background=isAdmin?'#fff':'var(--primary-light)';
  document.getElementById('tab-orderer').style.color=isAdmin?'var(--text-3)':'#fff';
  document.getElementById('tab-admin').style.background=isAdmin?'#0f172a':'#fff';
  document.getElementById('tab-admin').style.color=isAdmin?'#fff':'var(--text-3)';
  // 버튼 텍스트
  document.getElementById('login-btn-text').textContent=isAdmin?'관리자 로그인':'발주자 로그인';
  // 하단 영역
  document.getElementById('orderer-footer').style.display=isAdmin?'none':'block';
  document.getElementById('admin-footer').style.display=isAdmin?'block':'none';
  // 관리자 탭: 관리자 계정 존재 여부에 따라 안내문 변경
  if(isAdmin){
    const msg=document.getElementById('admin-footer-msg');
    msg.innerHTML='<button onclick="showAdminSetup()" style="background:none;border:none;color:var(--primary-light);font-size:12px;font-weight:700;cursor:pointer;padding:0">관리자 계정 생성</button>';
  }
  document.getElementById('login-error').style.display='none';
  document.getElementById('login-id').value='';
  document.getElementById('login-pw').value='';
  document.getElementById('login-id').focus();
}

async function doLogin(){
  const id=document.getElementById('login-id').value.trim();
  const pw=document.getElementById('login-pw').value;
  const err=document.getElementById('login-error');
  err.style.display='none';

  const accounts=DB.get('accounts',[]);
  const isEmail=id.includes('@');
  let found=isEmail ? accounts.find(a=>a.email===id) : accounts.find(a=>a.id===id);
  if(!found&&!isEmail){err.style.display='block';err.textContent='아이디 또는 비밀번호가 올바르지 않습니다.';return;}
  if(!window._fbAuth){err.style.display='block';err.textContent='서버 연결 중입니다. 잠시 후 다시 시도해주세요.';return;}

  // Firebase Auth 로그인
  const loginEmail=found?.email||id;
  try{
    await window._fbAuth.signInWithEmailAndPassword(loginEmail,pw);
  }catch(e){
    if(e.code==='auth/wrong-password'||e.code==='auth/invalid-credential'){
      err.style.display='block';err.textContent='아이디 또는 비밀번호가 올바르지 않습니다.';
    }else if(e.code==='auth/user-not-found'||e.code==='auth/invalid-email'){
      err.style.display='block';err.textContent='계정 초기 설정이 필요합니다. 비밀번호 찾기를 이용해주세요.';
    }else if(e.code==='auth/too-many-requests'){
      err.style.display='block';err.textContent='로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.';
    }else{
      err.style.display='block';err.textContent='로그인 중 오류가 발생했습니다.';
      console.warn('[Firebase Auth 로그인 실패]',e.code,e.message);
    }
    return;
  }

  // 이메일 로그인인데 발주앱 계정 없으면 자동 생성 (일반 권한)
  if(isEmail&&!found){
    if(loginTab==='admin'){err.style.display='block';err.textContent='관리자 계정만 이 화면에서 로그인할 수 있습니다.';return;}
    const base=id.split('@')[0];
    const newId=accounts.find(a=>a.id===base)?`${base}_${Date.now()}`:base;
    // 납품처(deliveryName)는 비워두고 사용자가 직접 설정하게 함 (개인정보 수정에서 변경 가능)
    found={id:newId,name:base,deliveryName:'',email:id,role:'orderer',empCd:'',bizCd:''};
    accounts.push(found);
    DB.set('accounts',accounts);
  }

  if(loginTab==='admin'&&found.role!=='admin'){
    err.style.display='block';err.textContent='관리자 계정만 이 화면에서 로그인할 수 있습니다.';return;
  }
  if(loginTab==='orderer'&&found.role==='admin'){
    err.style.display='block';err.textContent='관리자 계정은 관리자 로그인 탭을 사용해주세요.';return;
  }

  // 아이디 저장 / 자동로그인 처리
  const rememberEl=document.getElementById('remember-id');
  const autoEl=document.getElementById('auto-login');
  const doRemember=rememberEl&&rememberEl.checked;
  const doAuto=autoEl&&autoEl.checked;

  if(doRemember||doAuto){
    localStorage.setItem('sh_saved_login_id', id);
    localStorage.setItem('sh_remember_id','1');
  } else {
    localStorage.removeItem('sh_saved_login_id');
    localStorage.removeItem('sh_remember_id');
  }
  if(doAuto){
    localStorage.setItem('sh_auto_login','1');
    localStorage.setItem('sh_auto_login_user_id', id);
  } else {
    localStorage.removeItem('sh_auto_login');
    localStorage.removeItem('sh_auto_login_user_id');
  }

  currentUser={id:found.id,name:found.name,deliveryName:found.deliveryName||'',role:found.role};
  DB.set('session',currentUser);
  sessionStorage.setItem('sh_tab_session',JSON.stringify(currentUser));
  showApp();
}

// 최초 관리자 계정 생성 화면 (관리자 계정이 없을 때만)
function showAdminSetup(){
  document.getElementById('login-screen').classList.remove('active');
  document.getElementById('admin-setup-screen').classList.add('active');
}

function togglePw(btn){
  const inp=btn.previousElementSibling;
  if(!inp)return;
  const show=inp.type==='password';
  inp.type=show?'text':'password';
  btn.innerHTML=show?'<i class="fas fa-eye-slash"></i>':'<i class="fas fa-eye"></i>';
  btn.title=show?'비밀번호 숨기기':'비밀번호 표시';
}
function wrapPwToggle(id){
  const inp=document.getElementById(id);
  if(!inp||inp.dataset.pwWrapped)return;
  inp.dataset.pwWrapped='1';
  const wrap=document.createElement('div');
  wrap.className='pw-wrap';
  inp.parentNode.insertBefore(wrap,inp);
  wrap.appendChild(inp);
  const btn=document.createElement('button');
  btn.type='button';
  btn.className='pw-toggle';
  btn.innerHTML='<i class="fas fa-eye"></i>';
  btn.title='비밀번호 표시';
  btn.onclick=function(){togglePw(this);};
  wrap.appendChild(btn);
}

function doLogout(){
  // Firebase Auth 로그아웃
  if(window._fbAuth){window._fbAuth.signOut().catch(()=>{});}
  currentUser=null;
  DB.set('session',null);
  sessionStorage.removeItem('sh_tab_session');
  // 자동로그인 해제 (아이디 저장은 유지)
  localStorage.removeItem('sh_auto_login');
  localStorage.removeItem('sh_auto_login_user_id');
  document.getElementById('app').classList.remove('active');
  document.getElementById('login-screen').classList.add('active');
  // 저장된 아이디 복원, 비밀번호는 항상 비움
  const savedId=localStorage.getItem('sh_saved_login_id');
  const idEl=document.getElementById('login-id');
  if(idEl) idEl.value=savedId||'';
  document.getElementById('login-pw').value='';
}

function isAdmin(){return currentUser&&currentUser.role==='admin';}

function requireAdmin(){
  if(!isAdmin()){toast('관리자만 접근할 수 있습니다.','error');navigate('dashboard');return false;}
  return true;
}

function showApp(){
  document.getElementById('login-screen').classList.remove('active');
  document.getElementById('app').classList.add('active');
  const roleEl=document.getElementById('topbar-role');
  roleEl.textContent=isAdmin()?'관리자':'발주자';
  roleEl.className='topbar-role '+(isAdmin()?'role-admin':'role-orderer');
  document.getElementById('sb-user-info').innerHTML='<strong>'+currentUser.name+'</strong>'+(isAdmin()?'관리자':'발주자');
  document.getElementById('topbar-date').textContent=new Date().toLocaleDateString('ko-KR',{year:'numeric',month:'long',day:'numeric',weekday:'short'});
  // 프로필 초기화
  const initial=currentUser.name.charAt(0);
  const avatarEl=document.getElementById('profile-avatar');
  const nameEl=document.getElementById('profile-name');
  const ddName=document.getElementById('dd-name');
  const ddRole=document.getElementById('dd-role');
  const ddId=document.getElementById('dd-id');
  if(avatarEl)avatarEl.textContent=initial;
  if(nameEl)nameEl.textContent=currentUser.name;
  if(ddName)ddName.textContent=currentUser.name;
  if(ddRole)ddRole.textContent=isAdmin()?'관리자':'발주자';
  if(ddId)ddId.textContent='아이디: '+currentUser.id;
  initDateInputs();
  renderNav();
  const _savedView=sessionStorage.getItem('sh_last_view');
  const _hashView=location.hash.slice(1);
  const _ADMIN_VIEWS=new Set(['items','inventory','price-settings','accounts','purchase-requests','logs','shortage-view']);
  const _raw=_hashView||_savedView||'dashboard';
  const _restoreView=(!isAdmin()&&_ADMIN_VIEWS.has(_raw))?'dashboard':_raw;
  navigate(_restoreView,{addHistory:false});
  setupDateInput('o-date');
  setupDateInput('o-ship-date');
  // 비밀번호 보기 토글 초기화
  ['login-pw','reg-pw','reg-pw2','setup-pw','setup-pw2','profile-pw','profile-pw2','acc-pw'].forEach(wrapPwToggle);
}

document.getElementById('login-pw').addEventListener('keydown',e=>{if(e.key==='Enter')doLogin();});
document.getElementById('login-id').addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('login-pw').focus();});

// 최초 관리자 계정 생성 처리
async function doAdminSetup(){
  const id=document.getElementById('setup-id').value.trim();
  const name=document.getElementById('setup-name').value.trim();
  const email=document.getElementById('setup-email').value.trim();
  const pw=document.getElementById('setup-pw').value;
  const pw2=document.getElementById('setup-pw2').value;
  const errEl=document.getElementById('setup-error');
  errEl.style.display='none';
  if(!id){errEl.style.display='block';errEl.textContent='아이디를 입력해주세요.';return;}
  if(id.length<4){errEl.style.display='block';errEl.textContent='아이디는 4자 이상이어야 합니다.';return;}
  if(!name){errEl.style.display='block';errEl.textContent='이름을 입력해주세요.';return;}
  if(!email){errEl.style.display='block';errEl.textContent='이메일을 입력해주세요.';return;}
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){errEl.style.display='block';errEl.textContent='올바른 이메일 형식이 아닙니다.';return;}
  if(!pw||pw.length<6){errEl.style.display='block';errEl.textContent='비밀번호는 6자 이상이어야 합니다.';return;}
  if(pw!==pw2){errEl.style.display='block';errEl.textContent='비밀번호가 일치하지 않습니다.';return;}
  // 관리자 계정 중복 확인
  const accounts=DB.get('accounts',[]);
  if(accounts.find(a=>a.id===id)){errEl.style.display='block';errEl.textContent='이미 사용 중인 아이디입니다.';return;}
  if(accounts.find(a=>a.email&&a.email===email)){errEl.style.display='block';errEl.textContent='이미 가입된 이메일입니다.';return;}
  if(!window._fbAuth){errEl.style.display='block';errEl.textContent='서버 연결 중입니다. 잠시 후 다시 시도해주세요.';return;}
  // Firebase Auth 등록
  try{
    await window._fbAuth.createUserWithEmailAndPassword(email,pw);
  }catch(e){
    errEl.style.display='block';
    if(e.code==='auth/email-already-in-use'){
      errEl.textContent='이미 가입된 이메일입니다.';
    }else{
      errEl.textContent='계정 생성 중 오류가 발생했습니다.';
      console.warn('[Firebase Auth 관리자 등록 실패]',e.code,e.message);
    }
    return;
  }
  // pw 필드 없이 저장
  try{
    accounts.push({id,name,email,role:'admin'});
    DB.set('accounts',accounts);
  }catch(e){
    if(window._fbAuth.currentUser)await window._fbAuth.currentUser.delete().catch(()=>{});
    errEl.style.display='block';errEl.textContent='계정 저장 중 오류가 발생했습니다. 다시 시도해주세요.';
    return;
  }
  // 생성 후 자동 로그인
  currentUser={id,name,role:'admin'};
  DB.set('session',currentUser);
  sessionStorage.setItem('sh_tab_session',JSON.stringify(currentUser));
  document.getElementById('admin-setup-screen').classList.remove('active');
  showApp();
  toast(name+'님, 관리자 계정이 생성되었습니다.','success');
}
document.getElementById('setup-pw2').addEventListener('keydown',e=>{if(e.key==='Enter')doAdminSetup();});

// 회원가입
function showRegister(){
  document.getElementById('login-screen').classList.remove('active');
  document.getElementById('register-screen').classList.add('active');
  ['reg-delivery-name','reg-id','reg-email','reg-pw','reg-pw2'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('reg-error').style.display='none';
  document.getElementById('reg-success').style.display='none';
}
function showLoginScreen(){
  document.getElementById('register-screen').classList.remove('active');
  document.getElementById('admin-setup-screen').classList.remove('active');
  const fpScreen=document.getElementById('forgot-password-screen');
  if(fpScreen) fpScreen.classList.remove('active');
  document.getElementById('login-screen').classList.add('active');
  setLoginTab('orderer');
}
async function doRegister(){
  const deliveryName=document.getElementById('reg-delivery-name').value.trim();
  const id         =document.getElementById('reg-id').value.trim();
  const email      =document.getElementById('reg-email').value.trim();
  const pw         =document.getElementById('reg-pw').value;
  const pw2        =document.getElementById('reg-pw2').value;
  const errEl      =document.getElementById('reg-error');
  errEl.style.display='none';
  if(!deliveryName){errEl.style.display='block';errEl.textContent='납품처 이름을 입력해주세요.';return;}
  if(!id){errEl.style.display='block';errEl.textContent='아이디를 입력해주세요.';return;}
  if(id.length<4){errEl.style.display='block';errEl.textContent='아이디는 4자 이상이어야 합니다.';return;}
  if(!email){errEl.style.display='block';errEl.textContent='이메일을 입력해주세요.';return;}
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){errEl.style.display='block';errEl.textContent='올바른 이메일 형식이 아닙니다.';return;}
  if(!pw){errEl.style.display='block';errEl.textContent='비밀번호를 입력해주세요.';return;}
  if(pw.length<6){errEl.style.display='block';errEl.textContent='비밀번호는 6자 이상이어야 합니다.';return;}
  if(pw!==pw2){errEl.style.display='block';errEl.textContent='비밀번호가 일치하지 않습니다.';return;}
  const accounts=DB.get('accounts',[]);
  if(accounts.find(a=>a.id===id)){errEl.style.display='block';errEl.textContent='이미 사용 중인 아이디입니다.';return;}
  if(accounts.find(a=>a.email&&a.email===email)){errEl.style.display='block';errEl.textContent='이미 가입된 이메일입니다.';return;}
  if(!window._fbAuth){errEl.style.display='block';errEl.textContent='서버 연결 중입니다. 잠시 후 다시 시도해주세요.';return;}
  // Firebase Auth 등록 (주 인증)
  try{
    await window._fbAuth.createUserWithEmailAndPassword(email,pw);
  }catch(e){
    errEl.style.display='block';
    if(e.code==='auth/email-already-in-use'){
      errEl.textContent='이미 가입된 이메일입니다.';
    }else{
      errEl.textContent='가입 중 오류가 발생했습니다.';
      console.warn('[Firebase Auth 가입 실패]',e.code,e.message);
    }
    return;
  }
  // pw 필드 없이 계정 저장
  try{
    accounts.push({id,name:deliveryName,deliveryName,email,role:'orderer'});
    DB.set('accounts',accounts);
  }catch(e){
    if(window._fbAuth.currentUser)await window._fbAuth.currentUser.delete().catch(()=>{});
    errEl.style.display='block';errEl.textContent='계정 저장 중 오류가 발생했습니다. 다시 시도해주세요.';
    return;
  }
  currentUser={id,name:deliveryName,deliveryName,role:'orderer'};
  DB.set('session',currentUser);
  sessionStorage.setItem('sh_tab_session',JSON.stringify(currentUser));
  document.getElementById('register-screen').classList.remove('active');
  showApp();
  toast(deliveryName+'님, 가입을 환영합니다!','success');
}
document.getElementById('reg-pw2').addEventListener('keydown',e=>{if(e.key==='Enter')doRegister();});

// 비밀번호 찾기
function showForgotPassword(){
  document.getElementById('login-screen').classList.remove('active');
  const fpScreen=document.getElementById('forgot-password-screen');
  if(fpScreen){
    fpScreen.classList.add('active');
    const emailEl=document.getElementById('forgot-email');
    if(emailEl) emailEl.value='';
    const errEl=document.getElementById('forgot-error');
    const okEl=document.getElementById('forgot-success');
    if(errEl) errEl.style.display='none';
    if(okEl) okEl.style.display='none';
    setTimeout(()=>{ if(emailEl) emailEl.focus(); },100);
  }
}
async function doForgotPassword(){
  const emailEl=document.getElementById('forgot-email');
  const errEl=document.getElementById('forgot-error');
  const okEl=document.getElementById('forgot-success');
  if(!emailEl||!errEl||!okEl) return;
  errEl.style.display='none';
  okEl.style.display='none';
  const email=emailEl.value.trim();
  if(!email){ errEl.style.display='block'; errEl.textContent='이메일을 입력해주세요.'; return; }
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ errEl.style.display='block'; errEl.textContent='올바른 이메일 형식이 아닙니다.'; return; }
  if(!window._fbAuth){ errEl.style.display='block'; errEl.textContent='서버 연결 중입니다. 잠시 후 다시 시도해주세요.'; return; }
  try{
    await window._fbAuth.sendPasswordResetEmail(email);
    okEl.style.display='block';
    okEl.textContent='재설정 링크를 보냈습니다. 이메일을 확인해주세요.';
    emailEl.value='';
  } catch(e){
    errEl.style.display='block';
    if(e.code==='auth/user-not-found'){
      errEl.textContent='해당 이메일로 가입된 계정이 없습니다.';
    } else if(e.code==='auth/invalid-email'){
      errEl.textContent='올바른 이메일 형식이 아닙니다.';
    } else if(e.code==='auth/too-many-requests'){
      errEl.textContent='요청이 너무 많습니다. 잠시 후 다시 시도해주세요.';
    } else {
      errEl.textContent='오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
      console.warn('[비밀번호 찾기 오류]', e.code, e.message);
    }
  }
}

// 품목 초기 데이터
const DEFAULT_ITEMS=[
  // 서랍장 (재고 관리 대상)
  {name:'겉서랍 2단',       category:'서랍장',drawerType:'outer',currentStock:0},
  {name:'속서랍 2단',       category:'서랍장',drawerType:'inner',currentStock:0},
  {name:'겉서랍 3단',       category:'서랍장',drawerType:'outer',currentStock:0},
  {name:'속서랍 3단',       category:'서랍장',drawerType:'inner',currentStock:0},
  {name:'겉서랍 4단',       category:'서랍장',drawerType:'outer',currentStock:0},
  {name:'속서랍 4단',       category:'서랍장',drawerType:'inner',currentStock:0},
  {name:'겉서랍 아일랜드',  category:'서랍장',drawerType:'outer',currentStock:0},
  {name:'속서랍 아일랜드',  category:'서랍장',drawerType:'inner',currentStock:0},
  // 옵션 (발주 기록만, 재고 미적용)
  {name:'거울장',              category:'옵션',currentStock:0},
  {name:'디바이더',            category:'옵션',currentStock:0},
  {name:'이불장',              category:'옵션',currentStock:0},
  {name:'화장대세트',          category:'옵션',currentStock:0},
  {name:'인출식 바지걸이',     category:'옵션',currentStock:0,hasColor:true,colorOptions:['화이트','블랙']},
  {name:'선반재단비',          category:'서비스',currentStock:0},
  {name:'포스트조립비',        category:'서비스',currentStock:0},
];

function initData(){
  initAccounts();
  if(DB.get('items',[]).length===0){
    DB.set('items',DEFAULT_ITEMS.map((it,i)=>({id:i+1,...it,isActive:true,createdAt:new Date().toISOString()})));
    DB.set('_seq_items',DEFAULT_ITEMS.length);
    DB.set('orders',[]);
    DB.set('purchase_requests',[]);
    DB.set('logs',[]);
  } else {
    // items Firestore write 잠금 — 마이그레이션 중 중간 상태가 Firestore에 올라가지 않도록
    window._itemsInitLock = true;
    // 마이그레이션: 선반바(ABS) 400이 서랍/옵션 목록에 잘못 들어간 경우만 제거 (상부자재는 유지)
    {const _items=DB.get('items',[]);const _before=_items.length;
    const _cleaned=_items.filter(i=>i.name!=='선반바(ABS) 400'||i.category==='상부자재');
    if(_cleaned.length<_before)DB.set('items',_cleaned);}
    // 기존 DB 마이그레이션: 인출식 바지걸이 보정
    let items=DB.get('items',[]);
    const target=items.find(i=>i.name==='인출식 바지걸이');
    if(!target){
      // 없으면 추가
      const newId=Math.max(0,...items.map(i=>i.id||0))+1;
      items.push({id:newId,name:'인출식 바지걸이',category:'옵션',currentStock:0,hasColor:true,colorOptions:['화이트','블랙'],isActive:true,createdAt:new Date().toISOString()});
      DB.set('items',items);
    } else {
      // 있으면 속성 보정
      let changed=false;
      if(target.category!=='옵션'){target.category='옵션';changed=true;}
      if(!target.hasColor){target.hasColor=true;changed=true;}
      if(!target.colorOptions){target.colorOptions=['화이트','블랙'];changed=true;}
      if(changed)DB.set('items',items);
    }
    // 마이그레이션: 선반재단비, 포스트조립비 없으면 추가
    {
      let _items=DB.get('items',[]);
      let _changed=false;
      const _svcItems=[
        {name:'선반재단비',category:'서비스',currentStock:0},
        {name:'포스트조립비',category:'서비스',currentStock:0},
      ];
      _svcItems.forEach(svc=>{
        if(!_items.find(i=>i.name===svc.name)){
          const newId=Math.max(0,..._items.map(i=>i.id||0))+1;
          _items.push({id:newId,...svc,isActive:true,createdAt:new Date().toISOString()});
          _changed=true;
        }
      });
      if(_changed)DB.set('items',_items);
    }
    // 마이그레이션: 창고별 재고(stockSiheung / stockPyeongtaek) 필드 추가
    {
      let _items=DB.get('items',[]);
      let _changed=false;
      _items.forEach(item=>{
        if(item.category==='서랍장'){
          if(item.stockSiheung===undefined){item.stockSiheung=item.currentStock||0;_changed=true;}
          if(item.stockPyeongtaek===undefined){item.stockPyeongtaek=0;_changed=true;}
        }
      });
      if(_changed)DB.set('items',_items);
    }
    // 재고 구조 전면 개편 v2: 겉서랍/속서랍 체계 + 색상별 시흥50/평택50 (1회만 실행)
    localStorage.setItem('sh_stock_init_v2','1');
    // 단가 설정 v2 초기화: 겉서랍/속서랍 단가 자동 세팅 (1회만 실행)
    if(!localStorage.getItem('sh_price_init_v2')){
      const dp=getDefaultPrices();
      if(dp&&dp.length>0){
        DB.set('price_settings',dp);
        localStorage.setItem('sh_price_init_v2','1');
      }
    }
    // 단가 설정 v3: 인출식 바지걸이·선반재단비·포스트조립비 항목 추가 (없으면 추가)
    if(!localStorage.getItem('sh_price_init_v3')){
      const ps=DB.get('price_settings',[]);
      const newItems=[
        {name:'인출식 바지걸이',category:'서랍/옵션',price:39000},
        {name:'선반재단비',category:'서랍/옵션',price:1000},
        {name:'포스트조립비',category:'서랍/옵션',price:3000},
      ];
      let changed=false;
      newItems.forEach(item=>{
        if(!ps.find(p=>p.name===item.name)){
          ps.push(item);
          changed=true;
        }
      });
      if(changed)DB.set('price_settings',ps);
      localStorage.setItem('sh_price_init_v3','1');
    }
    // 마이그레이션: 공간박스 항목 추가 (없으면 추가)
    {
      let _items=DB.get('items',[]);
      if(!_items.find(i=>i.name==='공간박스')){
        const newId=Math.max(0,..._items.map(i=>i.id||0))+1;
        _items.push({id:newId,name:'공간박스',category:'옵션',currentStock:0,isActive:false,createdAt:new Date().toISOString()});
        DB.set('items',_items);
      }
    }
    // 마이그레이션: 상부자재 품목 추가/보정 (이카운트 연동용)
    {
      let _items=DB.get('items',[]);
      let _changed=false;
      // 없으면 추가
      const upperItems=[
        {name:'포스트 2050', colorProdCdMap:{'실버':'00032'}},
        {name:'스패너',      colorProdCdMap:{}, prodCd:'00059', noColor:true},
      ];
      upperItems.forEach(ui=>{
        const existing=_items.find(i=>i.name===ui.name);
        if(!existing){
          const newId=Math.max(0,..._items.map(i=>i.id||0))+1;
          _items.push({id:newId, name:ui.name, category:'상부자재', currentStock:0, isActive:true, createdAt:new Date().toISOString(), ...ui});
          _changed=true;
        } else {
          // 이미 있으면 누락 필드만 보정 (기존 colorProdCdMap 유지)
          if(ui.noColor&&!existing.noColor){existing.noColor=true;_changed=true;}
          if(ui.prodCd&&!existing.prodCd){
            // colorProdCdMap['실버']에 넣은 코드가 있으면 prodCd로 옮기기
            existing.prodCd=existing.colorProdCdMap?.['실버']||ui.prodCd;
            _changed=true;
          }
        }
      });
      if(_changed) DB.set('items',_items);
    }
    // 마이그레이션: 서랍장 비규격 3종 + 손잡이 추가 (없으면 추가, 발주서 미노출)
    {
      let _items=DB.get('items',[]);
      let _changed=false;
      const newItems=[
        {name:'2단서랍 비규격', category:'서랍장', drawerType:'outer', colorOptions:['화이트오크']},
        {name:'3단서랍 비규격', category:'서랍장', drawerType:'outer', colorOptions:['솔리드화이트','화이트오크']},
        {name:'4단서랍 비규격', category:'서랍장', drawerType:'outer', colorOptions:['화이트오크']},
        {name:'서랍장손잡이(속서랍용)', category:'옵션', colorOptions:['실버','블랙','골드']},
      ];
      newItems.forEach(ni=>{
        const existing=_items.find(i=>i.name===ni.name);
        if(!existing){
          const newId=Math.max(0,..._items.map(i=>i.id||0))+1;
          _items.push({id:newId,...ni,currentStock:0,isActive:false,createdAt:new Date().toISOString()});
          _changed=true;
        } else if(!existing.colorOptions){
          // 이미 있지만 colorOptions 없으면 업데이트
          existing.colorOptions=ni.colorOptions;
          _changed=true;
        }
      });
      if(_changed)DB.set('items',_items);
    }
    // 마이그레이션: 이불장 → 이불 반장/긴장 분리
    {
      let _items=DB.get('items',[]);
      let _changed=false;
      const SHELF_C=['화이트 오크','솔리드','메이플','다크월넛','진그레이','스톤그레이','민트그린'];
      // 이불장 비활성화
      const ibulIdx=_items.findIndex(i=>i.name==='이불장');
      if(ibulIdx!==-1&&_items[ibulIdx].isActive!==false){
        _items[ibulIdx].isActive=false;
        _changed=true;
      }
      // 이불 반장/긴장 추가
      [{name:'이불 반장',price:80000},{name:'이불 긴장',price:220000}].forEach(ni=>{
        if(!_items.find(i=>i.name===ni.name)){
          const newId=Math.max(0,..._items.map(i=>i.id||0))+1;
          _items.push({id:newId,name:ni.name,category:'옵션',currentStock:0,isActive:true,colorOptions:SHELF_C,createdAt:new Date().toISOString()});
          _changed=true;
        }
      });
      if(_changed)DB.set('items',_items);
      // price_settings에 누락 시 추가 (기존 가격은 보존 — UI 변경값 유지)
      let _ps=DB.get('price_settings',[]);
      let _psChanged=false;
      [{name:'이불 반장',price:80000},{name:'이불 긴장',price:255000}].forEach(ni=>{
        const existing=_ps.find(p=>p.name===ni.name);
        if(!existing){
          _ps.push({name:ni.name,category:'서랍/옵션',price:ni.price});
          _psChanged=true;
        }
      });
      if(_psChanged)DB.set('price_settings',_ps);
    }
    // 마이그레이션: 품목 마스터 items → price_settings 동기화 (누락된 항목 추가)
    {
      const _items=DB.get('items',[]);
      const _ps=DB.get('price_settings',[]);
      let _changed=false;
      _items.forEach(item=>{
        if(!item.name)return;
        const already=_ps.find(p=>(p.name||'').replace(/\s+/g,'').trim()===(item.name||'').replace(/\s+/g,'').trim());
        if(already){
          // price_settings에 있는데 null이면 DRAWER_OPTION_PRICES로 복원 시도
          if((already.price===null||already.price===undefined)){
            const dp=DRAWER_OPTION_PRICES&&DRAWER_OPTION_PRICES[item.name];
            if(dp!==undefined&&dp!==null){already.price=dp;_changed=true;}
          }
          return;
        }
        // 없으면 추가
        const dp=DRAWER_OPTION_PRICES&&DRAWER_OPTION_PRICES[item.name];
        const cat=(item.category==='서랍장'||item.category==='옵션'||item.category==='서비스')?'서랍/옵션':item.category;
        _ps.push({name:item.name,category:cat,price:dp!==undefined?dp:null});
        _changed=true;
      });
      if(_changed)DB.set('price_settings',_ps);
    }
    // 마이그레이션: 서브타입 품목 추가 (거울장 목대, 화장대(대), 이불장 부자재 등)
    {
      let _items=DB.get('items',[]);
      let _changed=false;
      const subtypeItems=[
        {name:'거울장 목대',             category:'옵션',isSubtype:true,
          colorProdCdMap:{'솔리드화이트':'117','화이트오크':'118','메이플':'119','다크월넛':'120','진그레이':'121','스톤그레이':'122'}},
        {name:'거울장 거울문',            category:'옵션',isSubtype:true,
          colorProdCdMap:{'블랙':'249','실버':'250','골드':'00004'}},
        {name:'화장대(대)',               category:'옵션',isSubtype:true,
          colorProdCdMap:{'솔리드화이트':'143','화이트오크':'144','메이플':'145','다크월넛':'146','진그레이':'147','스톤그레이':'148'}},
        {name:'화장대 디바이더',          category:'옵션',isSubtype:true,
          colorProdCdMap:{'솔리드화이트':'135','화이트오크':'136','메이플':'137','다크월넛':'138','진그레이':'139','스톤그레이':'140'}},
        {name:'화장대(디바이더 600포함)', category:'옵션',isSubtype:true,
          colorProdCdMap:{'솔리드화이트':'129','화이트오크':'130','메이플':'131','다크월넛':'132','진그레이':'133','스톤그레이':'134','민트그린':'00019'}},
        {name:'화장대 거울문',            category:'옵션',isSubtype:true,
          colorProdCdMap:{'실버':'141','블랙':'142'}},
        {name:'디바이더 속서랍',          category:'옵션',isSubtype:true,
          colorProdCdMap:{'솔리드화이트':'241','스톤그레이':'242','민트그린':'243'}},
        {name:'이불장 목대',              category:'옵션',isSubtype:true,
          colorProdCdMap:{'솔리드화이트':'191','화이트오크':'192','메이플':'193','다크월넛':'194','진그레이':'195','스톤그레이':'196'}},
        {name:'이불장손잡이(1구)',         category:'옵션',isSubtype:true,noColor:true,prodCd:'00014'},
        {name:'이불 긴장문',              category:'옵션',isSubtype:true,
          colorProdCdMap:{'솔리드화이트':'179','화이트오크':'180','메이플':'181','다크월넛':'182','진그레이':'183','스톤그레이':'184'}},
        {name:'이불 반장문',              category:'옵션',isSubtype:true,
          colorProdCdMap:{'솔리드화이트':'185','화이트오크':'186','메이플':'187','다크월넛':'188','진그레이':'189','스톤그레이':'190','민트그린':'00022'}},
      ];
      subtypeItems.forEach(si=>{
        const existing=_items.find(i=>i.name===si.name);
        if(!existing){
          const newId=Math.max(0,..._items.map(i=>i.id||0))+1;
          _items.push({id:newId,...si,currentStock:0,isActive:true,createdAt:new Date().toISOString()});
          _changed=true;
        } else {
          if(!existing.isSubtype){existing.isSubtype=true;_changed=true;}
          if(si.colorProdCdMap&&!existing.colorProdCdMap){existing.colorProdCdMap=si.colorProdCdMap;_changed=true;}
          if(si.noColor&&!existing.noColor){existing.noColor=true;_changed=true;}
          if(si.prodCd&&!existing.prodCd){existing.prodCd=si.prodCd;_changed=true;}
        }
      });
      // 이불 긴장/반장 이카운트 코드 보정
      const ibulCodes={
        '이불 긴장':{colorProdCdMap:{'솔리드화이트':'167','화이트오크':'168','메이플':'169','다크월넛':'170','진그레이':'171','스톤그레이':'172'}},
        '이불 반장':{colorProdCdMap:{'솔리드화이트':'173','화이트오크':'174','메이플':'175','다크월넛':'176','진그레이':'177','스톤그레이':'178','민트그린':'00021'}},
      };
      Object.entries(ibulCodes).forEach(([nm,data])=>{
        const it=_items.find(i=>i.name===nm);
        if(it&&!it.colorProdCdMap){it.colorProdCdMap=data.colorProdCdMap;_changed=true;}
      });
      if(_changed)DB.set('items',_items);
    }
    // 마이그레이션: 중복 품목 제거 (같은 이름 2개↑ → 데이터 많은 쪽 유지, 발주서 itemId 자동 교체)
    if(!localStorage.getItem('sh_dedup_items_v1')){
      let _items=DB.get('items',[]);
      const nameMap=new Map();
      _items.forEach(item=>{
        const existing=nameMap.get(item.name);
        if(!existing){nameMap.set(item.name,item);}
        else{
          const existScore=(existing.colorProdCdMap?2:0)+(existing.isSubtype?1:0);
          const newScore=(item.colorProdCdMap?2:0)+(item.isSubtype?1:0);
          if(newScore>existScore)nameMap.set(item.name,item);
        }
      });
      const keepIds=new Set([...nameMap.values()].map(i=>i.id));
      const idRemap=new Map();
      _items.forEach(item=>{if(!keepIds.has(item.id)){const kept=nameMap.get(item.name);if(kept)idRemap.set(item.id,kept.id);}});
      if(idRemap.size>0){
        const _oi=DB.get('order_items',[]);let _oiC=false;
        _oi.forEach(oi=>{if(idRemap.has(oi.itemId)){oi.itemId=idRemap.get(oi.itemId);_oiC=true;}});
        if(_oiC)DB.set('order_items',_oi);
        const _logs=DB.get('logs',[]);let _lC=false;
        _logs.forEach(l=>{if(idRemap.has(l.itemId)){l.itemId=idRemap.get(l.itemId);_lC=true;}});
        if(_lC)DB.set('logs',_logs);
        const _prs=DB.get('purchase_requests',[]);let _pC=false;
        _prs.forEach(pr=>{if(idRemap.has(pr.itemId)){pr.itemId=idRemap.get(pr.itemId);_pC=true;}});
        if(_pC)DB.set('purchase_requests',_prs);
        _items=_items.filter(i=>keepIds.has(i.id));
        DB.set('items',_items);
      }
      localStorage.setItem('sh_dedup_items_v1','1');
    }
    // 중복 품목 제거 v2 — ERP 코드 합친 후 하나만 남김
    if(!localStorage.getItem('sh_dedup_items_v2')){
      let _items=DB.get('items',[]);
      const byName=new Map();
      _items.forEach(i=>{ if(!byName.has(i.name)) byName.set(i.name,[]); byName.get(i.name).push(i); });
      const keepIds=new Set();
      const idRemap=new Map();
      byName.forEach((group)=>{
        if(group.length===1){ keepIds.add(group[0].id); return; }
        // ERP 코드 많은 순 정렬
        group.sort((a,b)=>{
          const ac=Object.keys(a.colorProdCdMap||{}).length+(a.prodCd?10:0);
          const bc=Object.keys(b.colorProdCdMap||{}).length+(b.prodCd?10:0);
          return bc-ac;
        });
        const winner=group[0];
        // 나머지 ERP 코드를 winner에 병합
        group.slice(1).forEach(dup=>{
          if(dup.colorProdCdMap) winner.colorProdCdMap=Object.assign({},dup.colorProdCdMap,winner.colorProdCdMap||{});
          if(dup.prodCd&&!winner.prodCd) winner.prodCd=dup.prodCd;
          if(dup.subTypeProdCdMap) winner.subTypeProdCdMap=Object.assign({},dup.subTypeProdCdMap,winner.subTypeProdCdMap||{});
          idRemap.set(dup.id, winner.id);
        });
        keepIds.add(winner.id);
      });
      if(idRemap.size>0){
        ['order_items','logs','purchase_requests'].forEach(key=>{
          const arr=DB.get(key,[]); let changed=false;
          arr.forEach(r=>{ if(idRemap.has(r.itemId)){r.itemId=idRemap.get(r.itemId);changed=true;} });
          if(changed) DB.set(key,arr);
        });
        DB.set('items',_items.filter(i=>keepIds.has(i.id)));
      }
      localStorage.setItem('sh_dedup_items_v2','1');
    }
    // 마이그레이션: 상부자재·선반·코너선반·옷봉 품목을 items DB에 통합
    if(!localStorage.getItem('sh_upper_items_v2')){
      let _items=DB.get('items',[]);
      let _changed=false;
      const now=new Date().toISOString();
      const nextId=()=>Math.max(0,..._items.map(i=>i.id||0))+1;

      // 구버전 이름 → 정규화 이름 (DB에서 이름 교체)
      const _renameMap={
        '포스트 2050':'포스트바 2050','포스트 2250':'포스트바 2250','포스트 2400':'포스트바 2400',
        '선반바 400':'선반바(ABS) 400',
        '옷봉캡(단방)':'옷봉캡','옷봉캡(양방)':'옷봉캡',
        '코너옷봉캡':'코너 옷봉캡 (단방, 양방)','코너옷봉캡(단방)':'코너 옷봉캡 (단방, 양방)','코너옷봉캡(양방)':'코너 옷봉캡 (단방, 양방)',
        '조절방 연장캡 15mm':'조절발 연장캡','포스트조절발(연장캡 15mm)':'조절발 연장캡','벽고정앵글':'벽고정 앵글',
      };
      _items.forEach(item=>{
        if(_renameMap[item.name]){
          // 이미 정규화 이름이 있으면 스킵 (중복 방지)
          if(!_items.find(i=>i.name===_renameMap[item.name]&&i.id!==item.id)){
            item.name=_renameMap[item.name];_changed=true;
          }
        }
      });

      // 추가할 품목 정의
      const toAdd=[
        // 상부자재 (포스트바 계열 - 색상 있음)
        {name:'포스트바 2050',category:'상부자재'},
        {name:'포스트바 2250',category:'상부자재'},
        {name:'포스트바 2400',category:'상부자재'},
        {name:'선반바(ABS) 400',category:'상부자재'},
        // 상부자재 (단색/단일코드 계열)
        {name:'코너바 2200',category:'상부자재'},
        {name:'코너앵글',category:'상부자재'},
        {name:'조절발',category:'상부자재'},
        {name:'포스트마감캡',category:'상부자재'},
        {name:'옷봉캡',category:'상부자재'},
        {name:'코너 옷봉캡 (단방, 양방)',category:'상부자재'},
        {name:'포스트연결캡',category:'상부자재'},
        {name:'조절발 연장캡',category:'상부자재'},
        {name:'벽고정 앵글',category:'상부자재'},
        {name:'벽고정 프레임 800',category:'상부자재',noColor:true},
        {name:'벽고정 프레임 1000',category:'상부자재',noColor:true},
        {name:'스패너',category:'상부자재',noColor:true},
        // 옷봉
        {name:'옷봉 2400',category:'옷봉'},
        // 선반
        {name:'선반 370',category:'선반'},
        {name:'선반 570',category:'선반'},
        {name:'선반 770',category:'선반'},
        {name:'선반 2400',category:'선반'},
        {name:'선반 비규격',category:'선반'},
        // 코너선반
        {name:'코너선반 780',category:'코너선반'},
        {name:'코너선반 비규격',category:'코너선반'},
      ];
      toAdd.forEach(ni=>{
        if(!_items.find(i=>i.name===ni.name)){
          _items.push({id:nextId(),currentStock:0,isActive:true,createdAt:now,...ni});
          _changed=true;
        }
      });
      if(_changed)DB.set('items',_items);
      localStorage.setItem('sh_upper_items_v2','1');
    }
    // 조절발 연장캡 15mm → 조절발 연장캡 이름 변경 (1회성 — 이름 변경은 구조 변경)
    if(!localStorage.getItem('sh_rename_ext_cap_v1')){
      let _items=DB.get('items',[]);
      const old=_items.find(i=>i.name==='조절발 연장캡 15mm');
      if(old){old.name='조절발 연장캡';DB.set('items',_items);}
      localStorage.setItem('sh_rename_ext_cap_v1','1');
    }
    // 잘못된 선반 품목 제거 v1 (1회성)
    if(!localStorage.getItem('sh_clean_shelf_items_v1')){
      let _items=DB.get('items',[]);
      const removeNames=['비규격 선반','비규격 코너선반','코너선반'];
      const filtered=_items.filter(i=>!removeNames.includes(i.name));
      if(filtered.length<_items.length)DB.set('items',filtered);
      localStorage.setItem('sh_clean_shelf_items_v1','1');
    }
    // 잘못된 선반 품목 제거 v2 — Firestore에서 재유입된 구버전 중복 이름 재정리
    if(!localStorage.getItem('sh_clean_shelf_items_v2')){
      let _items=DB.get('items',[]);
      const removeNames=['비규격 선반','비규격 코너선반','코너선반'];
      const filtered=_items.filter(i=>!removeNames.includes(i.name));
      if(filtered.length<_items.length){localStorage.setItem('sh_items',JSON.stringify(filtered));console.log('[cleanup v2] 구버전 선반 중복 제거');}
      localStorage.setItem('sh_clean_shelf_items_v2','1');
    }
    // ── 필드 보정 (매번 실행 — Firestore 덮어써도 자동 복구) ──
    {
      let _items=DB.get('items',[]);
      let _changed=false;
      // noColor 제거 대상 (색상별 코드 입력 가능해야 하는 품목)
      const shouldHaveColor=['옷봉캡','코너 옷봉캡 (단방, 양방)','조절발','포스트마감캡',
                             '포스트연결캡','조절발 연장캡','코너앵글'];
      shouldHaveColor.forEach(nm=>{
        const it=_items.find(i=>i.name===nm);
        if(it&&it.noColor){it.noColor=false;_changed=true;}
      });
      // colorOptions 보정 (ERP 모달에서 올바른 색상 행 표시용)
      // 디바이더 속서랍 colorOptions 제거 + colorProdCdMap 보정 (공통색 기준 활성/비활성 처리)
      {
        const it=_items.find(i=>i.name==='디바이더 속서랍');
        if(it){
          if(it.colorOptions){delete it.colorOptions;_changed=true;}
          // colorProdCdMap 비어있으면 기본값 세팅 (없으면 비활성화 로직이 동작 안 함)
          if(!it.colorProdCdMap||Object.keys(it.colorProdCdMap).length===0){
            it.colorProdCdMap={'솔리드화이트':'241','스톤그레이':'242','민트그린':'243'};
            _changed=true;
          }
        }
      }
      const colorOptionsMap={
        '거울장 거울문':    ['골드','블랙','실버'],
        '화장대 거울문':    ['실버','블랙'],
      };
      Object.entries(colorOptionsMap).forEach(([nm,opts])=>{
        const it=_items.find(i=>i.name===nm);
        if(!it)return;
        const same=it.colorOptions&&it.colorOptions.length===opts.length&&opts.every((v,i2)=>it.colorOptions[i2]===v);
        if(!same){it.colorOptions=opts;_changed=true;}
      });
      if(_changed)DB.set('items',_items);
    }
    // ── 중복 품목 제거 v3 (이름 기준 — 매번 실행하여 중복 즉시 제거) ──
    {
      let _items=DB.get('items',[]);
      const byName=new Map();
      _items.forEach(i=>{
        if(!byName.has(i.name))byName.set(i.name,[]);
        byName.get(i.name).push(i);
      });
      let hasDup=false;
      byName.forEach(group=>{if(group.length>1)hasDup=true;});
      if(hasDup){
        const keepIds=new Set();
        const idRemap=new Map();
        byName.forEach(group=>{
          if(group.length===1){keepIds.add(group[0].id);return;}
          // ERP 코드 많은 순 정렬 후 winner 선정
          group.sort((a,b)=>{
            const as=Object.keys(a.colorProdCdMap||{}).length+(a.prodCd?10:0)+(a.isActive?5:0);
            const bs=Object.keys(b.colorProdCdMap||{}).length+(b.prodCd?10:0)+(b.isActive?5:0);
            return bs-as;
          });
          const winner=group[0];
          group.slice(1).forEach(dup=>{
            if(dup.colorProdCdMap)winner.colorProdCdMap=Object.assign({},dup.colorProdCdMap,winner.colorProdCdMap||{});
            if(dup.prodCd&&!winner.prodCd)winner.prodCd=dup.prodCd;
            idRemap.set(dup.id,winner.id);
          });
          keepIds.add(winner.id);
        });
        if(idRemap.size>0){
          ['order_items','logs','purchase_requests'].forEach(key=>{
            const arr=DB.get(key,[]);let changed=false;
            arr.forEach(r=>{if(idRemap.has(r.itemId)){r.itemId=idRemap.get(r.itemId);changed=true;}});
            if(changed)DB.set(key,arr);
          });
        }
        const deduped=_items.filter(i=>keepIds.has(i.id));
        DB.set('items',deduped);
        console.log(`[dedup v3] ${_items.length}→${deduped.length}개`);
      }
    }
    // ── 누락 품목 복구 (매번 실행 — 삭제된 품목 자동 복원) ──
    {
      let _items=DB.get('items',[]);
      let _changed=false;
      const _ensure=(spec)=>{
        if(_items.find(i=>i.name===spec.name))return;
        const newId=Math.max(0,..._items.map(i=>i.id||0))+1;
        _items.push({id:newId,currentStock:0,isActive:true,createdAt:new Date().toISOString(),...spec});
        _changed=true;
      };
      // 서랍장 기본 품목
      [{name:'겉서랍 2단',category:'서랍장',drawerType:'outer'},{name:'속서랍 2단',category:'서랍장',drawerType:'inner'},
       {name:'겉서랍 3단',category:'서랍장',drawerType:'outer'},{name:'속서랍 3단',category:'서랍장',drawerType:'inner'},
       {name:'겉서랍 4단',category:'서랍장',drawerType:'outer'},{name:'속서랍 4단',category:'서랍장',drawerType:'inner'},
       {name:'겉서랍 아일랜드',category:'서랍장',drawerType:'outer'},{name:'속서랍 아일랜드',category:'서랍장',drawerType:'inner'}
      ].forEach(_ensure);
      // 옵션/서비스 기본 품목
      [{name:'거울장',category:'옵션'},{name:'디바이더',category:'옵션'},{name:'이불장',category:'옵션'},
       {name:'화장대세트',category:'옵션'},{name:'공간박스',category:'옵션'},
       {name:'인출식 바지걸이',category:'옵션',hasColor:true,colorOptions:['화이트','블랙']},
       {name:'이불 반장',category:'옵션',colorOptions:['화이트 오크','솔리드','메이플','다크월넛','진그레이','스톤그레이','민트그린']},
       {name:'이불 긴장',category:'옵션',colorOptions:['화이트 오크','솔리드','메이플','다크월넛','진그레이','스톤그레이','민트그린']},
       {name:'선반재단비',category:'서비스'},{name:'포스트조립비',category:'서비스'},
       {name:'2단서랍 비규격',category:'서랍장',drawerType:'outer',colorOptions:['화이트오크']},
       {name:'3단서랍 비규격',category:'서랍장',drawerType:'outer',colorOptions:['솔리드화이트','화이트오크']},
       {name:'4단서랍 비규격',category:'서랍장',drawerType:'outer',colorOptions:['화이트오크']},
      ].forEach(_ensure);
      // 서브타입 품목
      [{name:'거울장 목대',category:'옵션',isSubtype:true},
       {name:'거울장 거울문',category:'옵션',isSubtype:true,colorOptions:['골드','블랙','실버']},
       {name:'화장대(대)',category:'옵션',isSubtype:true},
       {name:'화장대 디바이더',category:'옵션',isSubtype:true},
       {name:'화장대(디바이더 600포함)',category:'옵션',isSubtype:true},
       {name:'화장대 거울문',category:'옵션',isSubtype:true,colorOptions:['실버','블랙']},
       {name:'디바이더 속서랍',category:'옵션',isSubtype:true},
       {name:'이불장 목대',category:'옵션',isSubtype:true},
       {name:'이불장손잡이(1구)',category:'옵션',isSubtype:true,noColor:true},
       {name:'이불 긴장문',category:'옵션',isSubtype:true},
       {name:'이불 반장문',category:'옵션',isSubtype:true},
      ].forEach(_ensure);
      // 상부자재
      [{name:'포스트바 2050',category:'상부자재'},{name:'포스트바 2250',category:'상부자재'},
       {name:'포스트바 2400',category:'상부자재'},{name:'선반바(ABS) 400',category:'상부자재'},
       {name:'코너바 2200',category:'상부자재'},{name:'코너앵글',category:'상부자재'},
       {name:'조절발',category:'상부자재'},{name:'포스트마감캡',category:'상부자재'},
       {name:'옷봉캡',category:'상부자재'},{name:'코너 옷봉캡 (단방, 양방)',category:'상부자재'},
       {name:'포스트연결캡',category:'상부자재'},{name:'조절발 연장캡',category:'상부자재'},
       {name:'벽고정 앵글',category:'상부자재'},{name:'벽고정 프레임 800',category:'상부자재',noColor:true},
       {name:'벽고정 프레임 1000',category:'상부자재',noColor:true},{name:'스패너',category:'상부자재',noColor:true},
      ].forEach(_ensure);
      // 옷봉/선반/코너선반
      [{name:'옷봉 2400',category:'옷봉'},
       {name:'선반 370',category:'선반'},{name:'선반 570',category:'선반'},
       {name:'선반 770',category:'선반'},{name:'선반 2400',category:'선반'},{name:'선반 비규격',category:'선반'},
       {name:'코너선반 780',category:'코너선반'},{name:'코너선반 비규격',category:'코너선반'},
      ].forEach(_ensure);
      // localStorage만 업데이트 (Firestore 직접 쓰기 금지 — syncFromServer 역업로드로 처리)
      if(_changed){DB.set('items',_items);console.log('[복구] 누락 품목 추가됨');}
    }
    // ── 모든 마이그레이션 완료 — 잠금 해제 후 items Firestore 최종 1회 동기화 ──
    window._itemsInitLock = false;
    {
      const _finalItems=DB.get('items',[]);
      if(window._FS&&_finalItems.length>0){
        window._FS.set('items',_finalItems).catch(e=>console.warn('[items 최종 동기화 실패]',e.message));
        console.log(`[items 최종 동기화] ${_finalItems.length}개 → Firestore`);
      }
    }
  }
}

// 테스트용 재고 시드 (색상별로 다른 수량 — 이미 데이터 있으면 스킵)
function _seedDemoStock(){
  const items=DB.get('items',[]);
  const drawerItems=items.filter(i=>i.category==='서랍장'&&i.isActive);
  if(!drawerItems.length)return;
  // 이미 색상별 재고가 하나라도 있으면 스킵
  if(drawerItems.some(i=>i.colorStockSiheung&&Object.keys(i.colorStockSiheung).length>0))return;
  // 색상별 기본 재고 (시흥 창고, 품목마다 조금씩 다르게)
  const colorSeeds=[
    {color:'화이트 오크', base:8},
    {color:'솔리드',      base:5},
    {color:'메이플',      base:3},
    {color:'다크월넛',    base:4},
    {color:'진그레이',    base:2},
    {color:'스톤그레이',  base:1},
    {color:'민트그린',    base:0},
  ];
  let changed=false;
  drawerItems.forEach((item,idx)=>{
    const iIdx=items.findIndex(i=>i.id===item.id);
    if(iIdx===-1)return;
    const map={};
    colorSeeds.forEach(({color,base})=>{
      // 품목마다 약간씩 다르게 분산
      map[color]=Math.max(0,base+(idx%3===0?1:idx%3===1?-1:0));
    });
    items[iIdx].colorStockSiheung=map;
    items[iIdx].stockSiheung=Object.values(map).reduce((s,v)=>s+v,0);
    if(items[iIdx].stockPyeongtaek===undefined)items[iIdx].stockPyeongtaek=0;
    items[iIdx].currentStock=items[iIdx].stockSiheung+items[iIdx].stockPyeongtaek;
    changed=true;
  });
  if(changed)DB.set('items',items);
}

// 핵심 로직
function calcShortage(req,cur){return Math.max(req-cur,0);}

// 발주번호 생성: YYYYMMDD-NNN
function generateOrderNum(dateStr){
  // dateStr: 'YYYY-MM-DD' 형식
  const d=(dateStr||todayStr()).replace(/-/g,'');
  const orders=DB.get('orders',[]);
  const todayOrders=orders.filter(o=>o.orderNum&&o.orderNum.startsWith(d));
  const maxSeq=todayOrders.reduce((max,o)=>{
    const seq=parseInt((o.orderNum||'').split('-')[1]||'0');
    return seq>max?seq:max;
  },0);
  const seq=String(maxSeq+1).padStart(3,'0');
  return `${d}-${seq}`;
}

function saveOrder(payload, saveMode='발주확정'){
  // payload: {deliveryTo, address, orderDate, shipDate, note, warehouse,
  //           upperMaterials:[{name,white,black,silver,note}],
  //           shelfItems:[{name,white,maple,walnut,gray}],
  //           drawerItems:[{itemId,requiredQty}],
  //           drawerMemo, etcMemo}
  const dbItems=DB.get('items',[]),orders=DB.get('orders',[]),prs=DB.get('purchase_requests',[]);
  // 수정 모드: _editOverride로 원래 id/orderNum/status/등록자/등록일 유지
  const _eo=window._editOverride||null;
  if(_eo)window._editOverride=null;
  const orderId=_eo?_eo.id:DB.nextId('orders'),now=new Date().toISOString();
  const orderNum=_eo?_eo.orderNum:generateOrderNum(payload.orderDate||todayStr());
  const effectiveSaveMode=_eo?(_eo.status||saveMode):saveMode;
  const savedDrawerItems=[];let shortageCount=0;
  // 임시저장은 창고 미선택 허용, 차감 시에는 시흥 기본값 사용
  const warehouse=payload.warehouse||'';

  // 서랍장 항목 재고 비교 · 차감 · 발주 필요 목록 생성
  (payload.drawerItems||[]).forEach((drawerItem)=>{
    const {itemId,requiredQty}=drawerItem;
    if(!requiredQty||requiredQty<1)return;
    const item=dbItems.find(i=>i.id===itemId);if(!item)return;
    // 마이그레이션 보정
    if(item.stockSiheung===undefined)item.stockSiheung=item.currentStock||0;
    if(item.stockPyeongtaek===undefined)item.stockPyeongtaek=0;
    const orderColor=drawerItem.color||payload.sharedColor||'';
    const whStock=getWarehouseStock(item,warehouse,orderColor);
    const shortage=item.category==='서랍장'?calcShortage(requiredQty,whStock):0;
    savedDrawerItems.push({id:DB.nextId('order_items'),orderId,itemId,requiredQty,color:orderColor,currentStockSnapshot:whStock,shortageQty:shortage,warehouse,createdAt:now,handleOption:drawerItem.handleOption||'basic',displayName:drawerItem.displayName||'',note:drawerItem.note||'',subTypeChecked:drawerItem.subTypeChecked||[]});
    if(shortage>0){
      prs.push({id:DB.nextId('purchase_requests'),orderId,itemId,requiredQty,currentStockSnapshot:whStock,shortageQty:shortage,warehouse,status:'대기',createdAt:now,updatedAt:now});
      shortageCount++;
    }
    // 서랍장 실재고 차감 — 발주대기·발주확정 모두 발주 넣는 시점에 즉시 차감 (임시저장은 미차감)
    if(item.category==='서랍장'&&(effectiveSaveMode==='발주대기'||effectiveSaveMode==='발주확정')){
      const whKey=getWhKey(warehouse);
      const cwKey=getColorWhKey(warehouse);
      let before, afterVal;
      if(orderColor){
        if(!item[cwKey])item[cwKey]={};
        before=item[cwKey][orderColor]||0;
        afterVal=Math.max(0,before-requiredQty);
        item[cwKey][orderColor]=afterVal;
        item[whKey]=Object.values(item[cwKey]).reduce((s,v)=>s+(v||0),0);
      } else {
        before=item[whKey];
        afterVal=Math.max(0,before-requiredQty);
        item[whKey]=afterVal;
      }
      item.currentStock=(item.stockSiheung||0)+(item.stockPyeongtaek||0);
      const logs2=DB.get('logs',[]);
      logs2.push({id:DB.nextId('logs'),itemId:item.id,type:'발주차감',qty:-requiredQty,beforeStock:before,afterStock:afterVal,warehouse,color:orderColor||'',memo:`발주 #${orderId}`,orderId,createdBy:currentUser?currentUser.id:'',createdAt:now});
      DB.set('logs',logs2);
    }
  });
  // 차감된 재고 저장
  DB.set('items',dbItems);

  const orderDoc={
    id:orderId,
    // 기본 정보
    deliveryTo:payload.deliveryTo||'',
    address:payload.address||'',
    orderDate:payload.orderDate||'',
    shipDate:payload.shipDate||'',
    warehouse,
    note:payload.note||'',
    // 구역별 입력값
    upperMaterials:payload.upperMaterials||[],
    upperCommonColor:payload.upperCommonColor||'화이트',
    rodItems:payload.rodItems||[],
    rod2400Required:payload.rod2400Required||0,
    rodTotalLen:payload.rodTotalLen||0,
    shelfItems:payload.shelfItems||[],
    sharedColor:payload.sharedColor||'',
    drawerItems:savedDrawerItems,
    drawerMemo:payload.drawerMemo||'',
    etcMemo:payload.etcMemo||'',
    // 금액
    totalSupply:payload.totalSupply||0,
    totalVat:payload.totalVat||0,
    totalAmount:payload.totalAmount||0,
    // 메타
    createdAt:_eo?(_eo.createdAt||now):now,updatedAt:now,
    orderNum,
    status:effectiveSaveMode,
    stockDeducted:effectiveSaveMode==='발주대기'||effectiveSaveMode==='발주확정',
    createdBy:_eo?(_eo.createdBy||currentUser?.id||''):(currentUser?currentUser.id:''),  // 등록자 ID
    statusHistory:_eo?(_eo.statusHistory||[{status:effectiveSaveMode,changedBy:currentUser?currentUser.id:'',changedByName:currentUser?currentUser.name:'',changedAt:now,note:'발주서 수정'}]):[{status:effectiveSaveMode,changedBy:currentUser?currentUser.id:'',changedByName:currentUser?currentUser.name:'',changedAt:now,note:'발주서 등록'}],
    // 하위 호환
    items:savedDrawerItems,
    siteName:payload.deliveryTo||'',
    customerName:payload.address||'',
  };
  orders.push(orderDoc);
  DB.set('orders',orders);DB.set('purchase_requests',prs);
  return{orderId,shortageCount};
}
