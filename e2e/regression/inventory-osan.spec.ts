// inventory-osan.spec.ts
// 오산 창고 추가 회귀 — 재고 관리 전용, 발주 대상 아님

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

async function loginOrderer(page: Page) {
  await page.goto("/");
  await page.waitForSelector('#login-screen', { timeout: 15000 });
  await page.locator('#tab-orderer').click();
  await page.fill("#login-id", "orderer");
  await page.fill("#login-pw", "123456");
  await page.locator('button[onclick="doLogin()"]').click();
  await page.waitForSelector('[data-nav]', { timeout: 15000 });
  await page.waitForTimeout(1500);
}

test.describe("오산 창고 추가 (재고 관리 전용, 발주 대상 아님)", () => {
  test.describe.configure({ retries: 2 });

  test("O1: 재고 관리 화면에 오산 컬럼·카드 표시", async ({ page }) => {
    await loginAdmin(page);
    await page.locator('[data-nav="inventory"]').first().click();
    await page.waitForTimeout(1500);

    // 오산 재고 카드 표시
    const osanCard = page.locator('text=오산 재고').first();
    await expect(osanCard, '오산 재고 카드 표시').toBeVisible();

    // 재고 표 헤더에 오산 컬럼
    const osanHeader = page.locator('#inv-stock-table thead th:has-text("오산")');
    await expect(osanHeader, '재고 표에 오산 헤더').toBeVisible();
  });

  test("O2: 조정 모달에 오산 버튼 표시 + 선택 가능", async ({ page }) => {
    await loginAdmin(page);
    await page.locator('[data-nav="inventory"]').first().click();
    await page.waitForTimeout(1500);

    const adjustBtn = page.locator('.inv-action-btn[data-inv-type="조정"]').first();
    await adjustBtn.waitFor({ state: 'visible', timeout: 10000 });
    await adjustBtn.click();
    await page.waitForSelector('#inv-modal', { state: 'visible', timeout: 5000 });
    await page.waitForTimeout(500);

    // 오산 버튼 존재
    const osanBtn = page.locator('#inv-wh-osan');
    await expect(osanBtn, '오산 버튼 존재').toBeVisible();

    // 클릭해서 활성화
    await osanBtn.click();
    await page.waitForTimeout(300);

    // hidden input 값 = '오산'
    const whValue = await page.locator('#inv-warehouse').inputValue();
    expect(whValue, '창고 선택 = 오산').toBe('오산');
  });

  test("O3: 오산 재고 조정 처리 → 재고 저장 성공", async ({ page }) => {
    await loginAdmin(page);
    await page.locator('[data-nav="inventory"]').first().click();
    await page.waitForTimeout(1500);

    // 대상 품목 id 기록
    const adjustBtn = page.locator('.inv-action-btn[data-inv-type="조정"]').first();
    await adjustBtn.waitFor({ state: 'visible', timeout: 10000 });
    const itemId = await adjustBtn.getAttribute('data-inv-id');
    await adjustBtn.click();
    await page.waitForSelector('#inv-modal', { state: 'visible', timeout: 5000 });
    await page.waitForTimeout(500);

    // 오산 선택 + 첫 색상 수량
    await page.locator('#inv-wh-osan').click();
    const firstInput = page.locator('.inv-bulk-qty').first();
    const color = await firstInput.getAttribute('data-color');
    expect(color, '색상별 일괄 조정 입력칸').toBeTruthy();
    await firstInput.fill('7');
    await page.locator('#inv-submit-btn').click();
    await page.waitForTimeout(2500);

    // 모달 닫힘 (저장 성공)
    const modalHidden = await page.locator('#inv-modal').isHidden().catch(() => false);
    expect(modalHidden, '오산 조정 저장 성공').toBe(true);

    // DB에 stockOsan 반영 확인
    const stockOsan = await page.evaluate(({ id, color }) => {
      const item = window.getItem ? window.getItem(Number(id)) : null;
      return item ? window.getWarehouseStock(item, '오산', color) : -1;
    }, { id: itemId, color });
    expect(stockOsan, '오산 재고 = 7').toBe(7);
  });

  test("O4: 발주 모달 창고 선택엔 오산 안 나옴 (격리)", async ({ page }) => {
    await loginOrderer(page);

    const ordersNav = page.locator('[data-nav="orders"]').first();
    if (await ordersNav.count() > 0) await ordersNav.click().catch(() => {});
    await page.waitForSelector('#new-order-btn', { timeout: 10000 });
    await page.locator('#new-order-btn').click();
    await page.waitForSelector('#order-modal', { state: 'visible', timeout: 5000 });
    await page.waitForTimeout(500);

    // 발주 모달 창고 dropdown (#o-warehouse) 옵션 값들 확인
    const optionTexts = await page.locator('#o-warehouse option').allTextContents();
    // 오산 옵션 없어야
    expect(optionTexts.some(t => t.includes('오산')), '발주 창고에 오산 없어야').toBe(false);
    // 시흥·평택은 있어야
    const hasShouldBe = optionTexts.some(t => t.includes('시흥')) && optionTexts.some(t => t.includes('평택'));
    expect(hasShouldBe, '시흥·평택은 있어야').toBe(true);
  });

  test("O5: 오산 재고는 currentStock(발주 판단용)에 안 포함", async ({ page }) => {
    await loginAdmin(page);
    await page.locator('[data-nav="inventory"]').first().click();
    await page.waitForTimeout(1500);

    // O3에서 이미 오산에 7 조정됨. 모든 서랍장 품목에서 currentStock === 시흥+평택 확인
    const result = await page.evaluate(() => {
      const items = window.getItems ? window.getItems().filter((i: any) => i.category === '서랍장' && i.isActive) : [];
      const mismatches = items.filter((i: any) => {
        const expected = (i.stockSiheung || 0) + (i.stockPyeongtaek || 0);
        return i.currentStock !== expected;
      });
      return {
        total: items.length,
        mismatchCount: mismatches.length,
        sample: mismatches.slice(0, 3).map((i: any) => ({
          id: i.id, name: i.name,
          currentStock: i.currentStock,
          expected: (i.stockSiheung || 0) + (i.stockPyeongtaek || 0),
          stockOsan: i.stockOsan || 0
        }))
      };
    });

    expect(result.mismatchCount, `currentStock ≠ 시흥+평택 인 품목 있으면 오산 격리 실패: ${JSON.stringify(result.sample)}`).toBe(0);
    expect(result.total, '서랍장 품목 최소 1개').toBeGreaterThan(0);
  });
});
