/**
 * 로컬 테스트: REMARKS 필드가 올바르게 들어가는지만 검증
 * 이카운트 API 호출 안 함 (axios를 mock)
 *
 * 실행: cd functions && node test-remarks-local.js
 */

const Module = require('module');
const path = require('path');
const fs = require('fs');

// ── axios mock ─────────────────────────────────────
// 실제 호출 안 하고 페이로드만 캡처
const capturedPayloads = [];

const mockAxios = {
  post: async (url, body) => {
    capturedPayloads.push({ url, body });
    // ecount login 응답 흉내
    if (url.includes('Zone')) {
      return { data: { Status: '200', Data: { ZONE: 'AA' } } };
    }
    if (url.includes('OAPILogin')) {
      return { data: { Status: '200', Data: { Datas: { SESSION_ID: 'MOCK_SESSION_ID' } } } };
    }
    // SaveSale 응답 흉내
    return {
      data: {
        Status: '200',
        Data: {
          SuccessCnt: body?.SaleList?.length || 1,
          FailCnt: 0,
          SlipNos: ['MOCK-SLIP-001'],
          ResultDetails: [{ IsSuccess: true, TotalError: 'OK' }]
        }
      }
    };
  }
};

// require('axios') 가로채기
const originalResolve = Module._resolveFilename;
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id) {
  if (id === 'axios') return mockAxios;
  return originalRequire.apply(this, arguments);
};

// firebase-functions 모듈 mock (onCall 흉내)
const callableHandlers = {};
const mockOnCall = (options, handler) => {
  return { __isCallable: true, handler };
};
const mockHttpsError = class extends Error {
  constructor(code, message) { super(message); this.code = code; }
};

Module.prototype.require = function(id) {
  if (id === 'axios') return mockAxios;
  if (id === 'firebase-functions/v2/https') {
    return { onCall: mockOnCall, HttpsError: mockHttpsError };
  }
  if (id === 'firebase-functions/v2/scheduler') {
    return { onSchedule: () => ({ __isScheduled: true }) };
  }
  if (id === 'firebase-functions/logger') {
    return { info: console.log, error: console.error, warn: console.warn };
  }
  if (id === 'firebase-admin') {
    return {
      initializeApp: () => {},
      firestore: () => ({
        collection: () => ({ doc: () => ({ get: async () => ({ exists: false, data: () => ({}) }), set: async () => {} }), get: async () => ({ docs: [] }) })
      })
    };
  }
  return originalRequire.apply(this, arguments);
};

// ── 실제 deployed 함수 import ─────────────────────────
const indexPath = path.join(__dirname, 'index.js');
const indexExports = require(indexPath);

// createEcountSaleOrder 핸들러 찾기
const createSaleOrderObj = indexExports.createEcountSaleOrder;
if (!createSaleOrderObj || !createSaleOrderObj.handler) {
  console.error('❌ createEcountSaleOrder 함수를 못 찾았습니다.');
  process.exit(1);
}

// ── 테스트 시나리오 ───────────────────────────────────
const testCases = [
  {
    name: '정상 발주번호 (26-5-11-1)',
    input: {
      data: {
        custCd: 'CUST001',
        custNm: '코데코',
        empCd: 'EMP01',
        whCd: '101',
        ioDate: '20260511',
        remarks: '26-5-11-1',
        items: [
          { prodCd: '00001', prodNm: '포스트바', qty: 2, price: 10500 }
        ]
      }
    },
    expectedRemarks: '26-5-11-1'
  },
  {
    name: 'fallback (#id) 형식',
    input: {
      data: {
        custNm: '테스트',
        whCd: '101',
        remarks: '발주 #123',
        items: [{ prodCd: '00002', qty: 1, price: 5000 }]
      }
    },
    expectedRemarks: '발주 #123'
  },
  {
    name: '빈 remarks',
    input: {
      data: {
        whCd: '101',
        remarks: '',
        items: [{ prodCd: '00003', qty: 1, price: 1000 }]
      }
    },
    expectedRemarks: ''
  },
];

(async () => {
  console.log('\n📋 로컬 REMARKS 자동 입력 검증 테스트\n');
  console.log('='.repeat(60));

  let passCount = 0, failCount = 0;

  for (const tc of testCases) {
    capturedPayloads.length = 0;
    console.log(`\n[테스트] ${tc.name}`);
    console.log(`  입력 remarks: "${tc.input.data.remarks}"`);

    try {
      await createSaleOrderObj.handler(tc.input);

      // SaveSale 호출 페이로드 찾기
      const savePayload = capturedPayloads.find(p => p.url.includes('SaveSale'));
      if (!savePayload) {
        console.log('  ❌ SaveSale 호출 안 됨');
        failCount++; continue;
      }

      const bulkData = savePayload.body?.SaleList?.[0]?.BulkDatas;
      if (!bulkData) {
        console.log('  ❌ BulkDatas 구조 비정상');
        failCount++; continue;
      }

      const actualTtl = bulkData.TTL_CTT;
      const actualRemarks = bulkData.REMARKS;

      console.log(`  TTL_CTT(제목)   : "${actualTtl}"`);
      console.log(`  REMARKS(적요)   : "${actualRemarks}"`);

      const ttlOK = actualTtl === tc.expectedRemarks;
      const remarksOK = actualRemarks === tc.expectedRemarks;

      if (ttlOK && remarksOK) {
        console.log(`  ✅ PASS — 제목과 적요 둘 다 발주번호 들어감`);
        passCount++;
      } else {
        console.log(`  ❌ FAIL`);
        if (!ttlOK) console.log(`     TTL_CTT 기대: "${tc.expectedRemarks}" / 실제: "${actualTtl}"`);
        if (!remarksOK) console.log(`     REMARKS 기대: "${tc.expectedRemarks}" / 실제: "${actualRemarks}"`);
        failCount++;
      }
    } catch (e) {
      console.log(`  ❌ 예외:`, e.message);
      failCount++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`총 ${testCases.length}건 — PASS ${passCount} / FAIL ${failCount}`);
  console.log('='.repeat(60));

  process.exit(failCount > 0 ? 1 : 0);
})();
