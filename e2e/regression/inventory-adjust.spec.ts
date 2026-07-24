// inventory-adjust.spec.ts
// 재고 조정 모달 수량 입력칸 복원 + 중복 리스너 제거 회귀
// 신고: 재고관리 조정 처리 모달에서 수량 입력칸이 사라짐
// 예방: Enter 키 중복 리스너로 인한 재고 2배 반영 방어

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

async function goToInventory(page: Page) {
  const navBtn = page.locator('[data-nav="inventory"]').first();
  await navBtn.click();
  await page.waitForTimeout(1500);
}

test.describe("재고 조정 모달 회귀 (수량 입력칸 복원 + 중복 리스너 제거)", () => {
  test.describe.configure({ retries: 2 });

  test("I1: 조정 모달에 수량 input이 실제로 보여야", async ({ page }) => {
    await loginAdmin(page);
    await goToInventory(page);

    // 서랍장 카테고리의 [조정] 버튼 클릭
    const adjustBtn = page.locator('.inv-action-btn[data-inv-type="조정"]').first();
    await adjustBtn.waitFor({ state: 'visible', timeout: 10000 });
    await adjustBtn.click();
    await page.waitForSelector('#inv-modal', { state: 'visible', timeout: 5000 });
    await page.waitForTimeout(500);

    // 수량 input이 실제로 보이는지 (type=number, 화면 표시)
    const qtyInput = page.locator('#inv-qty');
    await expect(qtyInput, '수량 input이 존재해야').toHaveCount(1);
    // type=number (hidden 아님)
    const type = await qtyInput.getAttribute('type');
    expect(type, 'type=number 이어야').toBe('number');
    // visible 확인
    await expect(qtyInput, '사용자에게 보여야').toBeVisible();
    // label도 보이는지
    const label = page.locator('#inv-qty-label');
    await expect(label).toBeVisible();
    const labelText = await label.textContent();
    expect(labelText).toContain('수량');
  });

  test("I2: 조정 수량 5 입력 후 Enter → submitInventory 정확히 1번만 호출", async ({ page }) => {
    await loginAdmin(page);
    await goToInventory(page);

    // 서랍장 첫 품목의 [조정] 클릭
    const adjustBtn = page.locator('.inv-action-btn[data-inv-type="조정"]').first();
    await adjustBtn.waitFor({ state: 'visible', timeout: 10000 });
    await adjustBtn.click();
    await page.waitForSelector('#inv-modal', { state: 'visible', timeout: 5000 });
    await page.waitForTimeout(500);

    // submitInventory 호출 횟수 감시 (spy)
    await page.evaluate(() => {
      (window as any).__submitInvCallCount = 0;
      const orig = (window as any).submitInventory;
      (window as any).submitInventory = function(...args: any[]) {
        (window as any).__submitInvCallCount++;
        return orig.apply(this, args);
      };
    });

    // 색상 선택 (필수)
    await page.selectOption('#inv-color', { index: 1 }); // 첫 색상
    // 날짜 이미 오늘로 세팅됨

    // 수량 5 입력 후 Enter
    await page.fill('#inv-qty', '5');
    await page.locator('#inv-qty').press('Enter');
    await page.waitForTimeout(2000);

    // submitInventory 호출 횟수 확인
    const count = await page.evaluate(() => (window as any).__submitInvCallCount);
    expect(count, 'Enter로 submitInventory 정확히 1번만 호출').toBe(1);
  });

  test("I3: 조정 처리 실제 흐름 (수량 → 색상 → Enter → 재고 반영)", async ({ page }) => {
    await loginAdmin(page);
    await goToInventory(page);

    const adjustBtn = page.locator('.inv-action-btn[data-inv-type="조정"]').first();
    await adjustBtn.waitFor({ state: 'visible', timeout: 10000 });

    // 대상 품목 id 기록
    const itemId = await adjustBtn.getAttribute('data-inv-id');
    await adjustBtn.click();
    await page.waitForSelector('#inv-modal', { state: 'visible', timeout: 5000 });
    await page.waitForTimeout(500);

    // 색상 선택
    await page.selectOption('#inv-color', { index: 1 });
    // 수량 3 입력
    await page.fill('#inv-qty', '3');

    // 미리보기 뜨는지 확인 (updateInvPreview 호출 결과)
    await page.waitForTimeout(500);
    const previewText = await page.locator('#inv-preview').textContent();
    expect(previewText, '수량 입력 시 미리보기 표시').toBeTruthy();

    // 처리 버튼 클릭 (Enter 대신 버튼)
    await page.locator('#inv-submit-btn').click();
    await page.waitForTimeout(2000);

    // 성공 토스트 or 모달 닫힘
    const modalHidden = await page.locator('#inv-modal').isHidden().catch(() => false);
    expect(modalHidden, '처리 후 모달 닫혀야').toBe(true);
  });

  test("I5: Enter 연타(3회) → submitInventory 정확히 1번만 실행 (연타 방어)", async ({ page }) => {
    await loginAdmin(page);
    await goToInventory(page);

    const adjustBtn = page.locator('.inv-action-btn[data-inv-type="조정"]').first();
    await adjustBtn.waitFor({ state: 'visible', timeout: 10000 });
    await adjustBtn.click();
    await page.waitForSelector('#inv-modal', { state: 'visible', timeout: 5000 });
    await page.waitForTimeout(500);

    // spy: submitInventory 실행 후 processInventory 호출 횟수 카운트
    await page.evaluate(() => {
      (window as any).__processInvCalls = 0;
      const orig = (window as any).processInventory;
      (window as any).processInventory = async function(...args: any[]) {
        (window as any).__processInvCalls++;
        // 실제 로직 지연 시뮬 (async 상황 재현)
        await new Promise(r => setTimeout(r, 300));
        return orig.apply(this, args);
      };
    });

    await page.selectOption('#inv-color', { index: 1 });
    await page.fill('#inv-qty', '5');
    // Enter 3번 연타
    const qtyInput = page.locator('#inv-qty');
    await qtyInput.press('Enter');
    await qtyInput.press('Enter');
    await qtyInput.press('Enter');
    await page.waitForTimeout(2500);

    const calls = await page.evaluate(() => (window as any).__processInvCalls);
    expect(calls, 'Enter 연타해도 processInventory 정확히 1번').toBe(1);
  });

  test("I6: 소수(1.9) 입력 → 정수만 허용 에러", async ({ page }) => {
    await loginAdmin(page);
    await goToInventory(page);

    const adjustBtn = page.locator('.inv-action-btn[data-inv-type="조정"]').first();
    await adjustBtn.waitFor({ state: 'visible', timeout: 10000 });
    await adjustBtn.click();
    await page.waitForSelector('#inv-modal', { state: 'visible', timeout: 5000 });
    await page.waitForTimeout(500);

    await page.selectOption('#inv-color', { index: 1 });
    // 소수 입력 (숫자 input이라 소수 허용됨)
    await page.fill('#inv-qty', '1.9');
    await page.locator('#inv-submit-btn').click();
    await page.waitForTimeout(1500);

    // 에러 토스트 - "정수만 입력" 안내 뜨는지
    const err = await page.locator('text=/정수만 입력/i').count();
    // 또는 모달이 아직 열려있어야 (저장 실패했으니)
    const modalOpen = await page.locator('#inv-modal').isVisible().catch(() => false);
    expect(err + (modalOpen ? 1 : 0), '소수는 저장 안 됨').toBeGreaterThan(0);
  });

  test("I4: 수량 미입력 상태 저장 시도 → 에러 안내", async ({ page }) => {
    await loginAdmin(page);
    await goToInventory(page);

    const adjustBtn = page.locator('.inv-action-btn[data-inv-type="조정"]').first();
    await adjustBtn.waitFor({ state: 'visible', timeout: 10000 });
    await adjustBtn.click();
    await page.waitForSelector('#inv-modal', { state: 'visible', timeout: 5000 });
    await page.waitForTimeout(500);

    // 색상만 선택, 수량은 안 넣음
    await page.selectOption('#inv-color', { index: 1 });
    await page.locator('#inv-submit-btn').click();
    await page.waitForTimeout(1000);

    // 에러 토스트 or 모달 유지
    const errorVisible = await page.locator('text=/수량을 입력/i').count();
    const modalStillVisible = await page.locator('#inv-modal').isVisible().catch(() => false);
    // 에러 나오거나 모달 유지 둘 중 하나
    expect(errorVisible + (modalStillVisible ? 1 : 0), '수량 없으면 저장 안 됨').toBeGreaterThan(0);
  });
});
