/**
 * 이카운트 API 연결 테스트
 *
 * [CMD 실행 방법]
 *   cd C:\Users\kateb\hanger-deploy\functions
 *   node test-ecount.js
 */

const axios = require("axios");

const COM_CODE     = "670811";
const USER_ID      = "AUGUST282003";
const API_CERT_KEY = "3d2c6d4dd0abc48a694de9620d50cc8708";
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
  console.log("   이카운트 API 연결 테스트 (실서버)");
  console.log("================================================\n");

  // ── Step 1: Zone ──────────────────────────────────────
  console.log("[Step 1] Zone 확인 중...");
  let zone, baseUrl;
  try {
    const d = await post("https://oapi.ecount.com/OAPI/V2/Zone", { COM_CODE });
    if (String(d.Status) !== "200") { console.log("  ❌ Zone 실패:", d); return; }
    zone    = d.Data?.ZONE;
    baseUrl = `https://oapi${zone.toLowerCase()}.ecount.com`;
    console.log("  ✅ Zone 성공!  서버 =", baseUrl);
  } catch (e) { console.log("  ❌ 오류:", e.message); return; }

  // ── Step 2: 로그인 ────────────────────────────────────
  console.log("\n[Step 2] 로그인 중...");
  let SESSION_ID;
  try {
    const d = await post(`${baseUrl}/OAPI/V2/OAPILogin`, {
      COM_CODE, USER_ID, API_CERT_KEY, ZONE: zone, LAN_TYPE,
    });
    if (String(d.Status) !== "200") { console.log("  ❌ 로그인 실패:", d.Data?.Message); return; }
    SESSION_ID = d.Data?.Datas?.SESSION_ID;
    console.log("  ✅ 로그인 성공!  SESSION_ID:", SESSION_ID?.slice(0, 16) + "...");
  } catch (e) { console.log("  ❌ 오류:", e.message); return; }

  const Q = (path) => `${baseUrl}${path}?SESSION_ID=${SESSION_ID}`;

  // ── Step 3: 판매 전표 생성 테스트 ─────────────────────
  const today = new Date();
  const ioDate = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,"0")}${String(today.getDate()).padStart(2,"0")}`;

  console.log(`\n[Step 3] 판매 전표 생성 테스트... (날짜: ${ioDate})`);
  try {
    // BulkDatas는 객체 {} — 품목 하나당 SaleList에 하나씩
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

    // 전체 응답 출력
    console.log("  [전체 응답]");
    console.log(JSON.stringify(saleData, null, 2));

    if (String(saleData.Status) === "200" && saleData.Data?.SuccessCnt > 0) {
      const slipNos = saleData.Data?.SlipNos || [];
      console.log("  ✅ 판매 전표 생성 성공!  전표번호:", slipNos.join(", "));

      // ── Step 4: 테스트 전표 자동 삭제 ─────────────────────
      console.log("\n[Step 4] 테스트 전표 자동 삭제 중...");
      try {
        const delData = await post(Q("/OAPI/V2/Sale/DeleteSale"), {
          SaleList: slipNos.map(SLIP_NO => ({ BulkDatas: { SLIP_NO } }))
        });
        if (String(delData.Status) === "200" && delData.Data?.SuccessCnt > 0) {
          console.log("  ✅ 전표 삭제 완료!");
        } else {
          console.log("  ❌ 삭제 실패:", JSON.stringify(delData, null, 2));
        }
      } catch (e) { console.log("  ❌ 삭제 오류:", e.message); }

    } else {
      console.log("  ❌ 판매 전표 생성 실패");
    }
  } catch (e) { console.log("  ❌ 오류:", e.message); }

  console.log("\n================================================");
  console.log("   테스트 완료");
  console.log("================================================");
}

main();
