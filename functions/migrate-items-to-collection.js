// migrate-items-to-collection.js — Phase 3
// hanger_data/items 배열 → hanger_items/{id} 컬렉션으로 백필
//
// 사용:
//   node functions/migrate-items-to-collection.js                       # dry-run (emu)
//   node functions/migrate-items-to-collection.js --commit              # 실제 실행 (emu)
//   node functions/migrate-items-to-collection.js --target=prod         # dry-run (운영)
//   node functions/migrate-items-to-collection.js --target=prod --commit # 실제 실행 (운영) — 확인 프롬프트
//
// 특징:
//   - 기본 dry-run — --commit 없으면 write 안 함
//   - 멱등 — 여러 번 돌려도 안전 (id 기준 upsert)
//   - 로컬 에뮬레이터: FIRESTORE_EMULATOR_HOST 자동 세팅
//   - 운영: --target=prod 명시 + CONFIRM_PROD=YES 환경변수 필요

const admin = require('firebase-admin');
const readline = require('readline');

const args = process.argv.slice(2);
const isCommit = args.includes('--commit');
const target = (args.find(a => a.startsWith('--target=')) || '--target=emu').split('=')[1];

if (target !== 'emu' && target !== 'prod') {
  console.error(`--target은 emu 또는 prod (받은 값: ${target})`);
  process.exit(1);
}

if (target === 'emu') {
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:18080';
  console.log(`[emu] FIRESTORE_EMULATOR_HOST=${process.env.FIRESTORE_EMULATOR_HOST}`);
} else {
  // 운영 접근 — 이중 확인
  delete process.env.FIRESTORE_EMULATOR_HOST;
  if (isCommit && process.env.CONFIRM_PROD !== 'YES') {
    console.error('운영 write는 CONFIRM_PROD=YES 환경변수 필요 (오타 방지)');
    process.exit(1);
  }
  console.log(`[prod] 운영 tooktakproject 접속 ${isCommit ? '⚠️ WRITE MODE' : '(read-only dry-run)'}`);
}

admin.initializeApp({ projectId: 'tooktakproject' });
const db = admin.firestore();

async function confirmProd() {
  if (target !== 'prod' || !isCommit) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ans = await new Promise(r => rl.question('운영 hanger_items 컬렉션에 실제 write 진행합니까? (yes/no): ', r));
  rl.close();
  return ans.trim().toLowerCase() === 'yes';
}

(async () => {
  if (!(await confirmProd())) { console.log('취소됨'); process.exit(0); }

  console.log('\n=== hanger_data/items 읽기 ===');
  const snap = await db.collection('hanger_data').doc('items').get();
  if (!snap.exists) { console.error('hanger_data/items 문서 없음'); process.exit(1); }
  const arr = snap.data().value;
  if (!Array.isArray(arr)) { console.error('value가 배열 아님'); process.exit(1); }
  console.log(`  ${arr.length}건 로드`);

  const valid = arr.filter(i => i && i.id != null);
  const invalid = arr.filter(i => !i || i.id == null);
  console.log(`  ✓ 유효(id 있음): ${valid.length}건`);
  if (invalid.length > 0) console.log(`  ⚠ id 없음(스킵): ${invalid.length}건`);

  // 중복 id 감지
  const idCount = new Map();
  valid.forEach(i => idCount.set(i.id, (idCount.get(i.id) || 0) + 1));
  const dupIds = [...idCount.entries()].filter(([_, c]) => c > 1);
  if (dupIds.length > 0) {
    console.log(`  ⚠ 중복 id: ${dupIds.length}건 (마지막 값 유지)`);
    dupIds.slice(0, 5).forEach(([id, c]) => console.log(`     id=${id} × ${c}`));
  }

  console.log('\n=== 기존 hanger_items 컬렉션 확인 ===');
  const existing = await db.collection('hanger_items').get();
  console.log(`  기존 문서: ${existing.size}건`);

  console.log('\n=== 계획 ===');
  console.log(`  UPSERT: ${valid.length}건 → hanger_items/{id}`);
  console.log(`  DELETE: 0건 (기존 컬렉션 문서는 건드리지 않음 — 마이그레이션만)`);
  console.log(`  MODE: ${isCommit ? '⚠️ COMMIT (실제 write)' : 'DRY-RUN (write 안 함)'}`);

  if (!isCommit) {
    console.log('\n[dry-run 종료] 실제 실행하려면 --commit 추가');
    process.exit(0);
  }

  console.log('\n=== 실행 ===');
  const batches = [];
  let batch = db.batch(), n = 0, upserted = 0;
  const flush = () => { if (n > 0) { batches.push(batch.commit()); batch = db.batch(); n = 0; } };
  for (const item of valid) {
    batch.set(db.collection('hanger_items').doc(String(item.id)), {
      ...item,
      updatedAt: new Date().toISOString(),
      _migratedAt: new Date().toISOString()
    });
    upserted++;
    if (++n >= 400) { console.log(`  batch flush ${upserted}...`); flush(); }
  }
  flush();
  await Promise.all(batches);
  console.log(`  ✓ ${upserted}건 upsert 완료`);

  console.log('\n=== 확인 ===');
  const after = await db.collection('hanger_items').get();
  console.log(`  hanger_items 컬렉션 최종: ${after.size}건`);
  console.log('\n완료');
  process.exit(0);
})().catch(e => { console.error('실패:', e); process.exit(1); });
