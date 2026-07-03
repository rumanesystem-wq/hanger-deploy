// ─────────────────────────────────────────────────────────────
// find-account.js — 계정 정보 진단 (읽기 전용)
// 사용:  cd functions && node find-account.js <아이디 또는 이메일>
// 예시:  node find-account.js kim123
//        node find-account.js kim@example.com
// 확인 항목: accounts 배열의 name, deliveryName, role, empCd, bizCd 등
// ─────────────────────────────────────────────────────────────

const admin = require("firebase-admin");
admin.initializeApp({ projectId: "tooktakproject" });
const db = admin.firestore();

const query = (process.argv[2] || "").trim().toLowerCase();
if (!query) {
  console.log("사용법: node find-account.js <아이디 또는 이메일>");
  process.exit(1);
}

(async () => {
  console.log(`\n━━━ "${query}" 계정 진단 ━━━\n`);

  const doc = await db.collection("hanger_data").doc("accounts").get();
  if (!doc.exists) {
    console.log("❌ hanger_data/accounts 문서 자체가 없음");
    return;
  }
  const accounts = doc.data().value || [];
  console.log(`전체 계정: ${accounts.length}개\n`);

  const matched = accounts.filter(a => {
    if (!a) return false;
    const id = String(a.id || "").toLowerCase();
    const email = String(a.email || "").toLowerCase();
    const name = String(a.name || "").toLowerCase();
    return id.includes(query) || email.includes(query) || name.includes(query);
  });

  if (matched.length === 0) {
    console.log("❌ 매칭된 계정 없음\n");
    console.log("[힌트] 최근 등록된 계정 5개:");
    accounts.slice(-5).forEach(a => {
      console.log(`  - id: "${a.id}", name: "${a.name}", email: "${a.email || '-'}", role: ${a.role}`);
    });
    return;
  }

  console.log(`✅ 매칭 ${matched.length}건\n`);
  matched.forEach((a, i) => {
    console.log(`[${i + 1}] ─────────────────────`);
    console.log(`  id:           "${a.id}"`);
    console.log(`  name:         "${a.name || ''}"  ${!a.name ? "⚠️ 비어있음" : ""}`);
    console.log(`  deliveryName: "${a.deliveryName || ''}"  ${!a.deliveryName ? "⚠️ 비어있음 (← 발주 시 '납품처 입력' 에러 원인)" : ""}`);
    console.log(`  email:        "${a.email || '-'}"`);
    console.log(`  role:         ${a.role}`);
    console.log(`  empCd:        "${a.empCd || '-'}"`);
    console.log(`  bizCd:        "${a.bizCd || '-'}"`);
    console.log(`  uid:          ${a.uid || '-'}`);
    console.log("");
  });

  // 진단 요약
  const bad = matched.filter(a => a.role === 'orderer' && !a.deliveryName);
  if (bad.length > 0) {
    console.log(`🚨 문제 발견: 발주자 ${bad.length}명의 deliveryName 비어있음`);
    console.log(`   → 해결책: 관리자 화면 → 계정 관리 → 해당 계정 [수정] → [저장]`);
    console.log(`   → (수정 시 name이 자동으로 deliveryName에 복사됨)`);
  }
})().catch(e => {
  console.error("실패:", e.message);
  process.exit(1);
});
