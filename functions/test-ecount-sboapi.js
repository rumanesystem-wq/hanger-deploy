/**
 * 이카운트 API 연결 테스트 (테스트 서버 - sboapi)
 *
 * [CMD 실행 방법]
 *   cd C:\Users\kateb\hanger-deploy\functions
 *   node test-ecount-sboapi.js
 *
 * ※ 이 테스트가 성공하면 API인증현황에서 판매전표 API가 '검증' 처리됩니다.
 */

const axios = require("axios");

const COM_CODE     = "670811";
const USER_ID      = "AUGUST282003";
const API_CERT_KEY = "38650c06f13e74f7a925e407738b5e77c8"; // ← 테스트 인증키
const LAN_TYPE     = "ko-KR";

async function post(url, body) {
  const res = await axios.post(url, body, {
    headers: { "Content-Type": "application/json" },
    timeout: 15000,
  });
  return res.data;
}

async function main() {
  console.log("================================================");
  console.log("   이카운트 API 연결 테스트 (테스트 서버 sboapi)");
  console.log("================================================\n");

  // ── Step 1: Zone ──────────────────────────────────────
  console.log("[Step 1] Zone 확인 중...");
  let zone, baseUrl;
  try {
    const d = await post("https://oapi.ecount.com/OAPI/V2/Zone", { COM_CODE });
    if (String(d.Status) !== "200") { console.log("  ❌ Zone 실패:", d); return; }
    zone    = d.Data?.ZONE;
    baseUrl = `https://sboapi${zone.toLowerCase()}.ecount.com`;
    console.log("  ✅ Zone 성공!  테스트 서버 =", baseUrl);
  } catch (e) { console.log("  ❌ 오류:", e.message); return; }

  // ── Step 2: 로그인 ────────────────────────────────────
  console.log("\n[Step 2] 로그인 중...");
  let SESSION_ID;
  try {
    const d = await post(`${baseUrl}/OAPI/V2/OAPILogin`, {
      COM_CODE, USER_ID, API_CERT_KEY, ZONE: zone, LAN_TYPE,
    });
    if (String(d.Status) !== "200") { console.log("  ❌ 로그인 실패:", JSON.stringify(d, null, 2)); return; }
    SESSION_ID = d.Data?.Datas?.SESSION_ID;
    console.log("  ✅ 로그인 성공!  SESSION_ID:", SESSION_ID?.slice(0, 16) + "...");
  } catch (e) { console.log("  ❌ 오류:", e.message); return; }

  const Q = (path) => `${baseUrl}${path}?SESSION_ID=${SESSION_ID}`;

  // ── Step 3: 판매 전표 생성 테스트 ─────────────────────
  const today = new Date();
  const ioDate = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,"0")}${String(today.getDate()).padStart(2,"0")}`;

  console.log(`\n[Step 3] 판매 전표 생성 테스트... (날짜: ${ioDate})`);
  try {
    const saleData = await post(Q("/OAPI/V2/Sale/SaveSale"), {
      SaleList: [{
        BulkDatas: {
          UPLOAD_SER_NO: "",
          IO_DATE:       ioDate,
          CUST:          "",
          CUST_DES:      "테스트거래처",
          EMP_CD:        "",
          WH_CD:         "101",
          IO_TYPE:       "",
          PROD_CD:       "00001",
          PROD_DES:      "",
          SIZE_DES:      "",
          QTY:           "1",
          PRICE:         "1000",
          REMARKS:       "API테스트(삭제예정)",
        }
      }]
    });

    console.log("  [전체 응답]");
    console.log(JSON.stringify(saleData, null, 2));

    if (String(saleData.Status) === "200" && saleData.Data?.SuccessCnt > 0) {
      console.log("\n  ✅ 판매 전표 생성 성공!");
      console.log("  🎉 검증 완료! 이제 실서버에서도 판매 API 사용 가능합니다.");
    } else {
      console.log("  ❌ 판매 전표 생성 실패");
    }
  } catch (e) { console.log("  ❌ 오류:", e.message); }

  console.log("\n================================================");
  console.log("   테스트 완료");
  console.log("================================================");
}

main();
