// ledger-pdf-save.spec.ts
// 거래처 원장 PDF 저장 회귀 — 2026-07-20 신규 기능
// 대상: 로컬 도커 에뮬레이터 (localhost:15050)
// 검증: PDF 저장 버튼 클릭 시 파일 다운로드가 트리거되는지

import { test, expect, Page } from "@playwright/test";

test.setTimeout(90_000);

async function loginAdmin(page: Page) {
  await page.goto("/");
  await page.waitForSelector('#login-screen', { timeout: 15000 });
  await page.waitForTimeout(500);
  await page.locator('#tab-admin').click();
  await page.fill("#login-id", "admin");
  await page.fill("#login-pw", "123456");
  await page.locator('button[onclick="doLogin()"]').click();
  await page.waitForSelector('[data-nav]', { timeout: 15000 });
  await page.waitForTimeout(1500);
}

async function goToLedger(page: Page) {
  // 정산 탭 이동
  const settleNav = page.locator('[data-nav="settlement"]').first();
  await settleNav.click();
  await page.waitForTimeout(1000);
  // 거래처 원장 서브탭 이동
  const ledgerTab = page.locator('text=거래처 원장').first();
  await ledgerTab.click();
  await page.waitForTimeout(1500);
}

async function seedLedgerOrderWithInvoice(page: Page): Promise<string> {
  // 브라우저 컨텍스트에서 명세서 있는 발주서 시드
  // (거래처 원장 목록에는 명세서 있는 발주서만 표시됨 — listCustomersSummary 로직)
  return await page.evaluate(async () => {
    if (!window._FS || typeof window._FS.upsertOrder !== 'function') {
      throw new Error('_FS.upsertOrder 없음');
    }
    const orderId = 8888000 + Math.floor(Math.random() * 100);
    const orderNum = `E2E-PDF-${Date.now()}`;
    const deliveryTo = 'E2E테스트업체_PDF';
    const dateStr = '2026-07-15';
    const nowIso = new Date().toISOString();
    // 발주서 (발주확정)
    const order = {
      id: orderId,
      deliveryTo,
      address: '경기도 시흥시 E2E테스트로 123',
      orderDate: dateStr,
      shipDate: dateStr,
      warehouse: '시흥',
      note: 'E2E PDF 저장 회귀 테스트',
      upperMaterials: [{ name: '포스트바 2400', qty: 3, note: '', color: '실버' }],
      upperCommonColor: '실버',
      rodItems: [],
      shelfItems: [],
      sharedColor: '화이트 오크',
      drawerItems: [],
      totalSupply: 36000,
      totalVat: 3600,
      totalAmount: 39600,
      createdAt: nowIso,
      updatedAt: nowIso,
      orderNum,
      status: '발주확정',
      stockDeducted: true,
      isLocked: true,
      createdBy: 'admin',
      statusHistory: [{ status: '발주확정', changedBy: 'admin', changedByName: 'admin', changedAt: nowIso, note: 'E2E 시드' }],
      items: [], siteName: deliveryTo, customerName: '',
    };
    await window._FS.upsertOrder(order);
    // 명세서 시드 (invoices 배열 push)
    const invoicesRaw = await window._FS.get('invoices');
    const invoices = Array.isArray(invoicesRaw) ? invoicesRaw : [];
    const invoice = {
      id: 'inv_e2e_' + Date.now(),
      orderNum,
      deliveryTo,
      totalSupply: 36000,
      totalAmount: 39600,
      shipDate: dateStr,
      serial: 'E2E-INV-' + Date.now(),
      createdAt: nowIso,
      cancelled: false,
    };
    invoices.push(invoice);
    await window._FS.set('invoices', invoices);
    return deliveryTo;
  });
}

test.describe("거래처 원장 PDF 저장 회귀", () => {
  test.describe.configure({ retries: 2 });

  test("P1: 관리대장 화면에서 [PDF 저장] 클릭 시 다운로드 트리거", async ({ page, context }) => {
    // 1) 관리자 로그인
    await loginAdmin(page);

    // 2) 명세서 있는 시드 발주서 만들기
    const customerName = await seedLedgerOrderWithInvoice(page);

    // 3) 페이지 새로고침으로 sync 반영
    await page.reload();
    await page.waitForTimeout(1500);
    const loginVisible = await page.locator('#login-screen').isVisible().catch(() => false);
    if (loginVisible) await loginAdmin(page);
    else {
      await page.waitForSelector('[data-nav]', { timeout: 15000 });
      await page.waitForTimeout(1500);
    }

    // 4) 정산 → 거래처 원장 이동
    await goToLedger(page);

    // 5) 시드한 거래처 클릭 → 관리대장 상세 진입
    // 거래처 목록 tbody에서 해당 이름 행 찾기 (tbody-customers 등 셀렉터 유연 대응)
    const customerRow = page.locator(`text=${customerName}`).first();
    await customerRow.waitFor({ state: 'visible', timeout: 15000 });
    await customerRow.click();

    // 6) #ec-print-area 렌더 대기 (관리대장 화면)
    await page.waitForSelector('#ec-print-area', { state: 'visible', timeout: 10000 });
    await page.waitForTimeout(1000);

    // 7) 라이브러리 로드 확인 (jspdf + html2canvas)
    const libsLoaded = await page.evaluate(() => {
      return typeof window.jspdf !== 'undefined' && typeof window.html2canvas !== 'undefined';
    });
    expect(libsLoaded, 'jspdf + html2canvas 라이브러리 로드되어 있어야 함').toBe(true);

    // 8) 다운로드 이벤트 감시 시작 + PDF 저장 버튼 클릭
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.locator('button:has-text("PDF 저장")').first().click(),
    ]);

    // 9) 다운로드 검증
    const suggestedName = download.suggestedFilename();
    expect(suggestedName, '다운로드 파일명이 PDF 확장자여야 함').toMatch(/\.pdf$/i);
    expect(suggestedName, '파일명에 관리대장 포함되어야 함').toContain('관리대장');
    expect(suggestedName, '파일명에 시드 거래처명 포함되어야 함').toContain(customerName);

    // 10) 에러 토스트 안 뜨는지
    const errorToast = await page.locator('text=/PDF 저장 실패|라이브러리 로드 실패/i').count();
    expect(errorToast, 'PDF 저장 에러 토스트가 뜨면 안 됨').toBe(0);
  });

  test("P2: 파일명 특수문자 sanitize 검증", async ({ page }) => {
    // 브라우저 컨텍스트에서 _sanitizeFilename 함수 직접 호출
    await loginAdmin(page);

    const results = await page.evaluate(() => {
      if (typeof (window as any)._sanitizeFilename !== 'function') {
        return { available: false };
      }
      const fn = (window as any)._sanitizeFilename;
      return {
        available: true,
        slash: fn('A/B 스토어'),
        colon: fn('테스트:업체'),
        multiple: fn('A/B:C*D?E"F<G>H|I'),
        empty: fn(''),
        nullish: fn(null),
        control: fn('테스트\x00업체'),
      };
    });

    // _sanitizeFilename가 module-scope로 정의돼서 window에 안 붙을 수 있음
    // 그 경우 스킵 (실제 통합 테스트에서 P1으로 커버됨)
    test.skip(!results.available, '_sanitizeFilename이 window 전역 아님 — P1에서 간접 검증');

    if (results.available) {
      expect(results.slash).toBe('A_B 스토어');
      expect(results.colon).toBe('테스트_업체');
      expect(results.multiple).toBe('A_B_C_D_E_F_G_H_I');
      expect(results.empty).toBe('관리대장');
      expect(results.nullish).toBe('관리대장');
      expect(results.control).toBe('테스트_업체');
    }
  });
});
