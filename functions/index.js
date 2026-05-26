/**
 * 이카운트 ERP 연동 Firebase Cloud Functions
 * 프로젝트: tooktakproject
 * v2 — SESSION_ID URL 파라미터 방식으로 통일 (2026-03-27)
 *
 * 확인된 설정:
 *   COM_CODE = 670811  /  ZONE = AA
 *   테스트 서버: https://sboapiAA.ecount.com  → https://sboapiaa.ecount.com
 *   실서버:      https://oapiAA.ecount.com    → https://oapiaa.ecount.com
 *
 *   ※ 현재는 테스트 서버 사용 (테스트 인증키 갱신: 2026-04-14)
 *      실서버 인증키 발급 후 BASE_URL 을 PROD_URL 로 교체하면 됨
 */

const { onCall, HttpsError, onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { logger } = require("firebase-functions");
const admin  = require("firebase-admin");
const axios  = require("axios");

admin.initializeApp();

// ─── 이카운트 API 설정 ─────────────────────────────────────────
const ECOUNT = {
  COM_CODE:     "670811",
  USER_ID:      "AUGUST282003",
  API_CERT_KEY: "26e9b8701e059420ea6a159d6aa1477610",
  ZONE:         "AA",   // Zone API 로 확인된 값
  LAN_TYPE:     "ko-KR",

  // 테스트 서버 (테스트 인증키)
  // BASE_URL: "https://sboapiaa.ecount.com",

  // 실서버 (실서버 인증키)
  BASE_URL: "https://oapiaa.ecount.com",

  // 창고코드: ERP > 재고I > 창고관리에서 확인 (101=시흥, 102=평택, 103=오산)
  // 앱에서 창고 선택 시 해당 코드가 넘어오므로 이 기본값은 fallback 용도
  WH_CD: "101"
};

// ─── 공통: 이카운트 로그인 → SESSION_ID 반환 ──────────────────
// Zone API 확인 결과: ZONE=AA, 서버=sboapiaa.ecount.com
async function ecountLogin() {
  const loginUrl  = `${ECOUNT.BASE_URL}/OAPI/V2/OAPILogin`;
  const loginBody = {
    COM_CODE:     ECOUNT.COM_CODE,
    USER_ID:      ECOUNT.USER_ID,
    API_CERT_KEY: ECOUNT.API_CERT_KEY,
    ZONE:         ECOUNT.ZONE,
    LAN_TYPE:     ECOUNT.LAN_TYPE
  };

  const res = await axios.post(loginUrl, loginBody, {
    headers: { "Content-Type": "application/json" }
  });

  logger.info("[ECount Login] Status:", res.data.Status);
  logger.info("[ECount Login] Full Response:", JSON.stringify(res.data));

  if (String(res.data.Status) !== "200") {
    const msg = res.data.Error?.Message || JSON.stringify(res.data);
    throw new Error(`이카운트 로그인 실패 (${res.data.Status}): ${msg}`);
  }

  const sessionId = res.data.Data?.Datas?.SESSION_ID;
  if (!sessionId) throw new Error("SESSION_ID를 받아오지 못했습니다. 응답: " + JSON.stringify(res.data));

  return sessionId;
}

// ─── 1. 연결 테스트 ────────────────────────────────────────────
exports.testEcountConnection = onCall(
  { region: "asia-northeast3", invoker: "public" },
  async () => {
    try {
      const sessionId = await ecountLogin();
      return {
        success: true,
        message: "이카운트 연결 성공!",
        sessionPreview: sessionId.slice(0, 12) + "..."
      };
    } catch (e) {
      logger.error("[testEcountConnection] 오류:", e.message);
      throw new HttpsError("internal", `연결 실패: ${e.message}`);
    }
  }
);

// ─── 2. 품목 목록 조회 (PROD_CD 확인용) ──────────────────────
exports.getEcountProducts = onCall(
  { region: "asia-northeast3", invoker: "public" },
  async (request) => {
    try {
      const searchName = request.data?.searchName || '';
      const sessionId = await ecountLogin();

      const res = await axios.post(
        `${ECOUNT.BASE_URL}/OAPI/V2/InventoryBasic/GetBasicProductsList?SESSION_ID=${sessionId}`,
        {},
        { headers: { "Content-Type": "application/json" } }
      );

      logger.info("[getEcountProducts] Status:", res.data.Status);

      // 응답 구조 디버깅 — 실제 키 확인
      const dataKeys = Object.keys(res.data?.Data || {});
      logger.info("[getEcountProducts] Data keys:", JSON.stringify(dataKeys));
      if (res.data?.Data) {
        const firstKey = dataKeys[0];
        const sample = res.data.Data[firstKey];
        logger.info("[getEcountProducts] Data 샘플:", JSON.stringify(sample)?.slice(0, 300));
      }

      // Datas 가 배열인 경우와 객체인 경우 모두 대응
      let products = [];
      const rawData = res.data?.Data;
      if (rawData) {
        if (Array.isArray(rawData.Datas)) {
          products = rawData.Datas;
        } else if (Array.isArray(rawData.Result)) {
          products = rawData.Result;
        } else if (Array.isArray(rawData.ResultList)) {
          products = rawData.ResultList;
        } else {
          // Data 자체가 배열일 수도 있음
          const vals = Object.values(rawData);
          const arr = vals.find(v => Array.isArray(v));
          if (arr) products = arr;
        }
      }

      logger.info("[getEcountProducts] 전체 품목 수:", products.length);

      // 첫 번째 품목 구조 출력 (v4)
      if (products.length > 0) {
        logger.info("[getEcountProducts][v4] 첫 번째 품목:", JSON.stringify(products[0]).slice(0, 600));
      }

      // 이름으로 필터링 — PROD_NM 또는 모든 문자열 필드에서 검색 (v4)
      const filtered = searchName
        ? products.filter(p =>
            Object.values(p).some(v => typeof v === 'string' && v.includes(searchName))
          )
        : products;

      logger.info("[getEcountProducts] 필터 결과:", filtered.length, "건 (검색어:", searchName, ")");

      return {
        success: true,
        count: filtered.length,
        products: filtered.map(p => ({
          PROD_CD:  p.PROD_CD,
          PROD_NM:  p.PROD_NM,
          SIZE_DES: p.SIZE_DES
        }))
      };
    } catch (e) {
      logger.error("[getEcountProducts] 오류:", e.message, e.stack?.slice(0, 300));
      throw new HttpsError("internal", `품목 조회 실패: ${e.message}`);
    }
  }
);

// ─── 3. 출고 처리 → 이카운트 판매 전표 생성 ─────────────────
/**
 * request.data 형식:
 * {
 *   custCd:  "거래처코드",           // 납품처 ERP 코드 (없으면 빈값)
 *   custNm:  "거래처명",             // 납품처 이름
 *   whCd:    "창고코드",             // 없으면 ECOUNT.WH_CD 기본값 사용
 *   ioDate:  "20260327",             // 없으면 오늘 날짜
 *   items: [
 *     { prodCd: "품목코드", qty: 10, price: 5000 },
 *     ...
 *   ]
 * }
 */
exports.createEcountSaleOrder = onCall(
  { region: "asia-northeast3", invoker: "public" },
  async (request) => {
    const { custCd = "", custNm = "", empCd = "", whCd, ioDate, remarks = "", items } = request.data || {};

    // 입력값 검증
    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new HttpsError("invalid-argument", "출고 품목이 비어 있습니다.");
    }
    for (const it of items) {
      if (!it.prodCd) throw new HttpsError("invalid-argument", `품목코드가 없습니다: ${JSON.stringify(it)}`);
      if (!it.qty || it.qty <= 0) throw new HttpsError("invalid-argument", `수량이 올바르지 않습니다: ${it.prodCd}`);
    }

    // 날짜 기본값: 오늘
    const today = new Date();
    const defaultDate = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,"0")}${String(today.getDate()).padStart(2,"0")}`;
    const saleDateStr = ioDate || defaultDate;

    // 창고코드 기본값
    const warehouseCd = whCd || ECOUNT.WH_CD;

    try {
      // 1) 로그인
      const sessionId = await ecountLogin();

      // 2) 판매 전표 생성
      // BulkDatas: 품목별로 한 행씩 (같은 UPLOAD_SER_NO = 동일 전표로 묶임)
      const bulkDatas = items.map((it) => ({
        // ── 전표 헤더 ──────────────────────────────────────────
        UPLOAD_SER_NO:   "1",          // 동일 전표로 묶기
        IO_DATE:         saleDateStr,  // 판매일자 (YYYYMMDD)
        CUST:            custCd,       // 거래처코드
        CUST_DES:        custNm,       // 거래처명
        EMP_CD:          empCd,         // 담당자
        WH_CD:           warehouseCd, // 출하창고
        IO_TYPE:         "",           // 구분(거래유형)
        EXCHANGE_TYPE:   "",           // 외화종류
        EXCHANGE_RATE:   "",           // 환율
        SITE:            "",           // 부서
        PJT_CD:          "",           // 프로젝트
        DOC_NO:          "",           // 판매No.
        TTL_CTT:         remarks,       // 제목 (발주번호)
        U_MEMO1:         remarks,      // 문자형식1 (발주번호 - 거래처관리대장 적요 후보)
        U_MEMO2:         remarks,      // 문자형식2 (발주번호 - 거래처관리대장 적요 후보)
        U_MEMO3:         "",           // 문자형식3
        U_MEMO4:         "",           // 문자형식4
        U_MEMO5:         "",           // 문자형식5
        ADD_TXT_01_T:    "",
        ADD_TXT_02_T:    "",
        ADD_TXT_03_T:    "",
        ADD_TXT_04_T:    "",
        ADD_TXT_05_T:    "",
        ADD_TXT_06_T:    "",
        ADD_TXT_07_T:    "",
        ADD_TXT_08_T:    "",
        ADD_TXT_09_T:    "",
        ADD_TXT_10_T:    "",
        ADD_NUM_01_T:    "",
        ADD_NUM_02_T:    "",
        ADD_NUM_03_T:    "",
        ADD_NUM_04_T:    "",
        ADD_NUM_05_T:    "",
        ADD_CD_01_T:     "",
        ADD_CD_02_T:     "",
        ADD_CD_03_T:     "",
        ADD_DATE_01_T:   "",
        ADD_DATE_02_T:   "",
        ADD_DATE_03_T:   "",
        U_TXT1:          "",           // 장문형식1
        ADD_LTXT_01_T:   "",
        ADD_LTXT_02_T:   "",
        ADD_LTXT_03_T:   "",
        // ── 품목 행 ────────────────────────────────────────────
        PROD_CD:         it.prodCd,                                    // 품목코드
        PROD_DES:        it.prodNm  || "",                             // 품목명
        SIZE_DES:        it.sizeNm  || "",                             // 규격
        UQTY:            "",                                           // 추가수량
        QTY:             String(it.qty),                               // 수량
        PRICE:           (it.price != null) ? String(Math.round(it.price)) : "", // 단가
        USER_PRICE_VAT:  "",                                           // 단가(vat포함)
        SUPPLY_AMT:      (it.price != null) ? String(Math.round(it.price) * it.qty) : "", // 공급가액
        SUPPLY_AMT_F:    "",                                           // 공급가액(외화)
        VAT_AMT:         (it.price != null) ? String(Math.round(Math.round(it.price) * it.qty * 0.1)) : "", // 부가세
        REMARKS:         remarks,                                      // 적요 (발주번호 표시)
        ITEM_CD:         "",                                           // 관리항목
        P_REMARKS1:      remarks,                                      // 항목 추가 적요1 (발주번호 - 거래처관리대장 적요 후보)
        P_REMARKS2:      "",
        P_REMARKS3:      "",
        P_AMT1:          "",
        P_AMT2:          "",
        ADD_TXT_01:      "",
        ADD_TXT_02:      "",
        ADD_TXT_03:      "",
        ADD_TXT_04:      "",
        ADD_TXT_05:      "",
        ADD_TXT_06:      "",
        ADD_NUM_01:      "",
        ADD_NUM_02:      "",
        ADD_NUM_03:      "",
        ADD_NUM_04:      "",
        ADD_NUM_05:      "",
        ADD_CD_01:       "",
        ADD_CD_02:       "",
        ADD_CD_03:       "",
        ADD_CD_NM_01:    "",
        ADD_CD_NM_02:    "",
        ADD_CD_NM_03:    "",
        ADD_DATE_01:     "",
        ADD_DATE_02:     "",
        ADD_DATE_03:     ""
      }));

      const saveUrl = `${ECOUNT.BASE_URL}/OAPI/V2/Sale/SaveSale?SESSION_ID=${sessionId}`;
      // BulkDatas는 객체{}여야 함 — SaleList 배열에 품목별로 하나씩 넣고
      // 같은 UPLOAD_SER_NO 끼리 한 전표로 묶임
      const saveBody = {
        SaleList: bulkDatas.map(item => ({ BulkDatas: item }))
      };

      logger.info("[createEcountSaleOrder] 요청:", JSON.stringify(saveBody).slice(0, 500));

      const saveRes = await axios.post(saveUrl, saveBody, {
        headers: { "Content-Type": "application/json" }
      });

      logger.info("[createEcountSaleOrder] 응답:", JSON.stringify(saveRes.data).slice(0, 500));

      if (String(saveRes.data.Status) !== "200") {
        const errMsg = saveRes.data.Error?.Message || JSON.stringify(saveRes.data);
        throw new Error(`판매 전표 생성 실패 (${saveRes.data.Status}): ${errMsg}`);
      }

      const data = saveRes.data.Data || {};
      const slipNos = data.SlipNos || [];

      return {
        success:   true,
        slipNos,
        message:   `✅ 이카운트 판매 전표가 생성되었습니다. (전표번호: ${slipNos.join(", ") || "-"})`
      };

    } catch (e) {
      logger.error("[createEcountSaleOrder] 오류:", e.message);
      if (e instanceof HttpsError) throw e;
      throw new HttpsError("internal", `이카운트 출고 연동 오류: ${e.message}`);
    }
  }
);

// ─── 4. 단가 수정 → 이카운트 품목 단가 업데이트 ─────────────
/**
 * request.data: { prodCd: "품목코드", price: 숫자 }
 *
 * 단계:
 *   1) 로그인 → SESSION_ID
 *   2) GetBasicProduct 로 기존 품목 데이터 전체 조회
 *   3) SALE_PRICE 만 변경 후 SaveBasicProduct 로 저장
 */
exports.updateEcountPrice = onCall(
  { region: "asia-northeast3", invoker: "public" },
  async (request) => {
    const { prodCd, price } = request.data || {};

    if (!prodCd) throw new HttpsError("invalid-argument", "품목코드(prodCd)가 필요합니다.");
    if (price === undefined || price === null || price < 0) {
      throw new HttpsError("invalid-argument", "올바른 단가를 입력해주세요 (0 이상 숫자).");
    }

    try {
      const sessionId = await ecountLogin();

      // ── 직접 단가 업데이트 (품목 조회 없이 바로 저장) ──────
      const saveUrl = `${ECOUNT.BASE_URL}/OAPI/V2/InventoryBasic/SaveBasicProduct?SESSION_ID=${sessionId}`;

      const saveBody = {
        ProductList: [{
          SAVE_MODE: "U",
          BulkDatas: {
            PROD_CD:   prodCd,
            SIZE_FLAG: 0,
            IN_PRICE:  "0",
            OUT_PRICE: String(price),
            TAX:       "Y",
          }
        }]
      };

      logger.info("[updateEcountPrice] 저장 요청 body (첫 300자):", JSON.stringify(saveBody).slice(0, 300));

      const saveRes = await axios.post(saveUrl, saveBody, {
        headers: { "Content-Type": "application/json" }
      });

      logger.info("[updateEcountPrice] 저장 Status:", saveRes.data.Status);
      logger.info("[updateEcountPrice] 저장 응답 전체:", JSON.stringify(saveRes.data).slice(0, 1000));

      // Status 200이어도 SuccessCnt=0 이면 실제 저장 실패
      // top-level Errors 는 항상 null — ResultDetails[].IsSuccess 와 SuccessCnt 로 판별
      const resData       = saveRes.data?.Data || {};
      const successCnt    = resData.SuccessCnt ?? -1;
      const resultDetails = resData.ResultDetails || [];

      logger.info("[updateEcountPrice] SuccessCnt:", successCnt,
                  "/ ResultDetails:", JSON.stringify(resultDetails).slice(0, 500));

      // 실제 성공 여부: SuccessCnt > 0 이거나 ResultDetails 모두 IsSuccess=true
      const actualSuccess = successCnt > 0
        || (resultDetails.length > 0 && resultDetails.every(r => r.IsSuccess === true));

      if (String(saveRes.data.Status) !== "200" || !actualSuccess) {
        const errMsg = resultDetails
          .map(r => r.TotalError || r.Message || r.Memo)
          .filter(Boolean)
          .join(' / ')
          || JSON.stringify(saveRes.data).slice(0, 300);
        throw new Error(`단가 저장 실패: ${errMsg}`);
      }

      return {
        success: true,
        message: `✅ '${prodCd}' 단가(${Number(price).toLocaleString()}원)가 이카운트에 반영되었습니다.`
      };

    } catch (e) {
      logger.error("[updateEcountPrice] 오류:", e.message);
      logger.error("[updateEcountPrice] 이카운트 응답:", (JSON.stringify(e.response?.data) || '없음').slice(0, 500));
      if (e instanceof HttpsError) throw e;
      throw new HttpsError("internal", `이카운트 단가 연동 오류: ${e.message}`);
    }
  }
);

// ─── 아이디 → 이메일 조회 (로그인 전 미인증 호출용) ──────────
// 발주앱 로그인 시 아이디로 이메일 매핑. admin SDK가 보안 룰 우회.
// 보안 경계: 이메일만 반환. role/name/비번/납품처 등 일체 미포함.
exports.getEmailById = onCall(
  { region: "asia-northeast3", invoker: "public" },
  async (request) => {
    const { id } = request.data || {};
    if (!id || typeof id !== "string") {
      throw new HttpsError("invalid-argument", "아이디(id)가 필요합니다.");
    }
    try {
      const doc = await admin.firestore()
        .collection("hanger_data").doc("accounts").get();
      if (!doc.exists) {
        throw new HttpsError("not-found", "계정 데이터가 없습니다.");
      }
      const accounts = doc.data().value;
      if (!Array.isArray(accounts)) {
        throw new HttpsError("not-found", "계정 데이터 형식 오류.");
      }
      const found = accounts.find(a => a && a.id === id);
      if (!found || !found.email) {
        throw new HttpsError("not-found", "해당 아이디의 계정을 찾을 수 없습니다.");
      }
      logger.info(`[getEmailById] id=${id} → 이메일 조회 성공`);
      return { success: true, email: found.email };
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      logger.error("[getEmailById] 오류:", e.message);
      throw new HttpsError("internal", `이메일 조회 오류: ${e.message}`);
    }
  }
);

// ─── 4-bis. 서버 단일 ID 발급 (다중 PC 동시 저장 시 번호 충돌 방지) ──
// 호출: window._FN.getNextIds({ counts: { orders: 1, order_items: N, purchase_requests: N, logs: N } })
// 응답: { success: true, ids: { orders: [42], order_items: [200,201,...], ... } }
// 규칙: 로그인 필수 / 허용 컬렉션 화이트리스트 / 컬렉션당 1회 트랜잭션으로 원자적 증가
exports.getNextIds = onCall(
  { region: "asia-northeast3", invoker: "public" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }
    const counts = (request.data && request.data.counts) || {};
    const ALLOWED = new Set(["orders", "order_items", "purchase_requests", "logs"]);
    const MAX_PER = 100;
    const keys = Object.keys(counts);
    if (keys.length === 0) {
      throw new HttpsError("invalid-argument", "counts가 비어 있습니다.");
    }
    for (const k of keys) {
      if (!ALLOWED.has(k)) {
        throw new HttpsError("permission-denied", `허용되지 않은 컬렉션: ${k}`);
      }
      const n = counts[k];
      if (!Number.isInteger(n) || n < 1 || n > MAX_PER) {
        throw new HttpsError("invalid-argument", `잘못된 개수 (${k}=${n}, 1-${MAX_PER})`);
      }
    }
    try {
      const db = admin.firestore();
      const result = {};
      await Promise.all(keys.map(async (k) => {
        const ref = db.collection("hanger_data").doc("_seq_" + k);
        const ids = await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          let cur = 0;
          if (snap.exists) {
            const v = snap.data() && snap.data().value;
            if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
              cur = Math.floor(v);
            } else {
              throw new HttpsError(
                "failed-precondition",
                `_seq_${k} 값 형식 오류 (admin 확인 필요)`
              );
            }
          }
          const newVal = cur + counts[k];
          tx.set(
            ref,
            { value: newVal, updatedAt: new Date().toISOString() },
            { merge: true }
          );
          return Array.from({ length: counts[k] }, (_, i) => cur + 1 + i);
        });
        result[k] = ids;
      }));
      logger.info(
        `[getNextIds] uid=${request.auth.uid} counts=${JSON.stringify(counts)} ` +
        `firstIds=${JSON.stringify(Object.fromEntries(keys.map(k => [k, result[k][0]])))}`
      );
      return { success: true, ids: result };
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      logger.error("[getNextIds] 오류:", e.message);
      throw new HttpsError("internal", `ID 발급 오류: ${e.message}`);
    }
  }
);

// ─── 5. Firestore 정기 백업 (매일 KST 00:00) ─────────────────
// hanger_data 컬렉션 전체를 _backups/{YYYY-MM-DD} 문서에 스냅샷으로 저장
// 8일 이상 된 백업은 자동 삭제 (7일치 보관)
exports.dailyFirestoreBackup = onSchedule(
  { schedule: "0 15 * * *", timeZone: "UTC", region: "asia-northeast3" },
  async () => {
    const db = admin.firestore();

    // 오늘 날짜 (KST = UTC+9)
    const now = new Date();
    now.setHours(now.getHours() + 9);
    const dateStr = now.toISOString().slice(0, 10); // "YYYY-MM-DD"

    try {
      // 1) hanger_data 컬렉션 전체 읽기
      const snapshot = await db.collection("hanger_data").get();
      const data = {};
      snapshot.forEach(doc => { data[doc.id] = doc.data(); });

      // 2) _backups/{YYYY-MM-DD} 에 저장
      await db.collection("_backups").doc(dateStr).set({
        backedUpAt: admin.firestore.FieldValue.serverTimestamp(),
        data
      });
      logger.info(`[dailyFirestoreBackup] ${dateStr} 백업 완료 — ${Object.keys(data).length}개 키`);

      // 3) 8일 이상 된 백업 삭제
      const cutoff = new Date(now);
      cutoff.setDate(cutoff.getDate() - 7);
      const cutoffStr = cutoff.toISOString().slice(0, 10);

      const oldSnap = await db.collection("_backups")
        .where(admin.firestore.FieldPath.documentId(), "<", cutoffStr)
        .get();

      const batch = db.batch();
      oldSnap.forEach(doc => batch.delete(doc.ref));
      if (!oldSnap.empty) {
        await batch.commit();
        logger.info(`[dailyFirestoreBackup] 오래된 백업 ${oldSnap.size}건 삭제`);
      }
    } catch (e) {
      logger.error("[dailyFirestoreBackup] 오류:", e.message);
      throw e;
    }
  }
);

