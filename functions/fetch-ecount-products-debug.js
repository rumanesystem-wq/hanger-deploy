/**
 * 이카운트 품목 구조 확인용 (첫 3개 전체 필드 출력)
 *
 *   node fetch-ecount-products-debug.js
 */

const axios = require("axios");

const COM_CODE     = "670811";
const USER_ID      = "AUGUST282003";
const API_CERT_KEY = "3d2c6d4dd0abc48a694de9620d50cc8708";
const LAN_TYPE     = "ko-KR";

async function post(url, body) {
  const res = await axios.post(url, body, { headers: { "Content-Type": "application/json" }, timeout: 15000 });
  return res.data;
}

async function main() {
  const zd = await post("https://oapi.ecount.com/OAPI/V2/Zone", { COM_CODE });
  const zone = zd.Data?.ZONE;
  const baseUrl = `https://oapi${zone.toLowerCase()}.ecount.com`;

  const ld = await post(`${baseUrl}/OAPI/V2/OAPILogin`, { COM_CODE, USER_ID, API_CERT_KEY, ZONE: zone, LAN_TYPE });
  const SESSION_ID = ld.Data?.Datas?.SESSION_ID;

  const res = await axios.post(
    `${baseUrl}/OAPI/V2/InventoryBasic/GetBasicProductsList?SESSION_ID=${SESSION_ID}`,
    {}, { headers: { "Content-Type": "application/json" } }
  );

  const rawData = res.data?.Data;
  let products = [];
  if (rawData) {
    if (Array.isArray(rawData.Datas)) products = rawData.Datas;
    else if (Array.isArray(rawData.Result)) products = rawData.Result;
    else if (Array.isArray(rawData.ResultList)) products = rawData.ResultList;
    else { const arr = Object.values(rawData).find(v => Array.isArray(v)); if (arr) products = arr; }
  }

  console.log("=== 첫 번째 품목 전체 필드 ===");
  console.log(JSON.stringify(products[0], null, 2));
  console.log("\n=== 두 번째 품목 ===");
  console.log(JSON.stringify(products[1], null, 2));
  console.log("\n=== 이름이 있는 품목 찾기 ===");
  const withName = products.filter(p => Object.values(p).some(v => typeof v === 'string' && v.length > 1 && v !== p.PROD_CD));
  console.log("이름 있는 품목 샘플:", JSON.stringify(withName.slice(0,3), null, 2));
}

main().catch(e => console.error("오류:", e.message));
