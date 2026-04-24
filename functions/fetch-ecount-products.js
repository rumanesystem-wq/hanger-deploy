/**
 * 이카운트 전체 품목 목록 조회
 *
 * [실행 방법]
 *   cd C:\Users\kateb\hanger-deploy\functions
 *   node fetch-ecount-products.js
 *
 * [출력]
 *   콘솔: 코드 | 품목명(PROD_DES) | 색상/규격(SIZE_DES) | 판매단가
 *   파일: ecount-products.json (전체 데이터)
 *        ecount-products.txt  (보기 좋은 텍스트)
 */

const axios = require("axios");
const fs    = require("fs");
const path  = require("path");

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
  console.log("   이카운트 품목 목록 조회");
  console.log("================================================\n");

  const zoneData = await post("https://oapi.ecount.com/OAPI/V2/Zone", { COM_CODE });
  const zone     = zoneData.Data?.ZONE;
  const baseUrl  = `https://oapi${zone.toLowerCase()}.ecount.com`;
  console.log("✅ Zone:", zone, "→", baseUrl);

  const loginData = await post(`${baseUrl}/OAPI/V2/OAPILogin`, {
    COM_CODE, USER_ID, API_CERT_KEY, ZONE: zone, LAN_TYPE,
  });
  const SESSION_ID = loginData.Data?.Datas?.SESSION_ID;
  console.log("✅ 로그인 성공\n");

  const Q = (p) => `${baseUrl}${p}?SESSION_ID=${SESSION_ID}`;

  const prodData = await post(Q("/OAPI/V2/InventoryBasic/GetBasicProductsList"), {});
  const rawData  = prodData?.Data;
  let products   = [];
  if (rawData) {
    if (Array.isArray(rawData.Datas))           products = rawData.Datas;
    else if (Array.isArray(rawData.Result))     products = rawData.Result;
    else if (Array.isArray(rawData.ResultList)) products = rawData.ResultList;
    else {
      const arr = Object.values(rawData).find(v => Array.isArray(v));
      if (arr) products = arr;
    }
  }

  console.log(`총 ${products.length}개 품목\n`);

  // ── 콘솔 출력 ─────────────────────────────────────
  const header = "PROD_CD       품목명(PROD_DES)                   색상/규격(SIZE_DES)      판매단가";
  console.log(header);
  console.log("─".repeat(90));

  let txtLines = [header, "─".repeat(90)];

  products.forEach(p => {
    const cd    = String(p.PROD_CD  || "").padEnd(14);
    const nm    = String(p.PROD_DES || "").padEnd(36);
    const sz    = String(p.SIZE_DES || "").padEnd(22);
    const price = String(p.OUT_PRICE ? Number(p.OUT_PRICE).toLocaleString() + "원" : "");
    const line  = `${cd}${nm}${sz}${price}`;
    console.log(line);
    txtLines.push(line);
  });

  // ── 파일 저장 ─────────────────────────────────────
  const dir = path.dirname(__filename);

  // JSON (전체 데이터)
  const jsonPath = path.join(dir, "ecount-products.json");
  fs.writeFileSync(jsonPath, JSON.stringify(products, null, 2), "utf8");
  console.log(`\n✅ JSON 저장: ${jsonPath}`);

  // TXT (보기 좋은 텍스트)
  const txtPath = path.join(dir, "ecount-products.txt");
  fs.writeFileSync(txtPath, txtLines.join("\n"), "utf8");
  console.log(`✅ TXT 저장: ${txtPath}`);

  // ── 카테고리별 요약 ────────────────────────────────
  console.log("\n================================================");
  console.log("   앱 연동 관련 품목 (포스트/선반/옷봉/서랍)");
  console.log("================================================");
  const keywords = ["포스트", "선반", "옷봉", "서랍", "코너", "선반바"];
  const related = products.filter(p =>
    keywords.some(kw => (p.PROD_DES || "").includes(kw))
  );
  related.forEach(p => {
    const cd  = String(p.PROD_CD  || "").padEnd(14);
    const nm  = String(p.PROD_DES || "").padEnd(36);
    const sz  = String(p.SIZE_DES || "").padEnd(22);
    console.log(`${cd}${nm}${sz}`);
  });

  console.log("\n================================================");
  console.log("   조회 완료");
  console.log("================================================");
}

main().catch(e => console.error("오류:", e.message, e.stack));
