// ─────────────────────────────────────────────────────────────
// seed-from-json.js — 로컬 JSON 파일만 읽어 에뮬레이터에 시드
// ★ 운영 접속 코드 0. 로컬 에뮬레이터에만 씀.
// 사용:
//   1) Firebase 콘솔 → Firestore → hanger_data/price_settings 문서 열기
//   2) 우측 점 3개 → "문서 내보내기" 또는 value 필드 통째 복사
//   3) functions/_prod_price_settings.json 로 저장 (아래 예시 형식)
//   4) 같은 방식으로 items → functions/_prod_items.json
//   5) node functions/seed-from-json.js 실행
//
// JSON 파일 형식 (Firestore 문서 데이터 그대로):
//   { "value": [ ... ], "updatedAt": "..." }
// ─────────────────────────────────────────────────────────────

process.env.FIRESTORE_EMULATOR_HOST = 'localhost:18080';

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

admin.initializeApp({ projectId: 'tooktakproject' });
const db = admin.firestore();

const PRICE_PATH = path.join(__dirname, '_prod_price_settings.json');
const ITEMS_PATH = path.join(__dirname, '_prod_items.json');

function resetStockFields(item) {
  const clone = { ...item };
  clone.currentStock = 0;
  clone.stockSiheung = 0;
  clone.stockPyeongtaek = 0;
  clone.stockOsan = 0;
  clone.colorStockSiheung = {};
  clone.colorStockPyeongtaek = {};
  clone.colorStockOsan = {};
  return clone;
}

function readJsonOrExit(filePath, label) {
  if (!fs.existsSync(filePath)) {
    console.error(`❌ 파일 없음: ${filePath}`);
    console.error(`   ${label} JSON을 이 경로에 저장 후 다시 실행.`);
    process.exit(1);
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.error(`❌ JSON 파싱 실패 (${filePath}):`, e.message);
    process.exit(1);
  }
}

async function main() {
  console.log('━━━ 로컬 시드 (JSON → 에뮬레이터) ━━━\n');
  console.log('에뮬레이터: localhost:18080\n');

  // 1) price_settings
  console.log('[1/2] price_settings 로드 중...');
  const priceDoc = readJsonOrExit(PRICE_PATH, 'price_settings');
  const priceValue = Array.isArray(priceDoc.value) ? priceDoc.value : priceDoc;
  if (!Array.isArray(priceValue)) {
    console.error('❌ price_settings JSON의 value가 배열이 아님. 확인 필요.');
    process.exit(1);
  }
  console.log(`   → ${priceValue.length}건`);

  // 2) items
  console.log('[2/2] items 로드 중 (재고 필드 0 초기화)...');
  const itemsDoc = readJsonOrExit(ITEMS_PATH, 'items');
  const itemsRaw = Array.isArray(itemsDoc.value) ? itemsDoc.value : itemsDoc;
  if (!Array.isArray(itemsRaw)) {
    console.error('❌ items JSON의 value가 배열이 아님. 확인 필요.');
    process.exit(1);
  }
  const itemsSanitized = itemsRaw.map(resetStockFields);
  console.log(`   → ${itemsSanitized.length}건 (재고 0)`);

  // 3) 로컬 에뮬레이터에 쓰기
  console.log('\n로컬 에뮬레이터에 저장...');
  await db.collection('hanger_data').doc('price_settings').set({
    value: priceValue,
    updatedAt: new Date().toISOString(),
    _seededFromJson: true,
    _seededAt: new Date().toISOString()
  });
  console.log(`   ✓ price_settings ${priceValue.length}건`);

  await db.collection('hanger_data').doc('items').set({
    value: itemsSanitized,
    updatedAt: new Date().toISOString(),
    _seededFromJson: true,
    _seededAt: new Date().toISOString(),
    _note: '재고 필드 모두 0 초기화됨'
  });
  console.log(`   ✓ items ${itemsSanitized.length}건`);

  console.log('\n━━━ 완료 ━━━');
  console.log('운영 접속 0. 로컬 에뮬레이터에만 씀.');
  console.log('로컬 앱 새로고침(Ctrl+Shift+R) 후 확인.\n');
}

main().then(() => process.exit(0)).catch(e => {
  console.error('시드 실패:', e.message);
  process.exit(1);
});
