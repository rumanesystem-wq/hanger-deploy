// corner-delete.spec.ts
// 신고: "코너선반 한 번 추가하면 삭제가 안 됨"
// 실제 재현되는지 확인 (2026-07-22)

import { test, expect, Page } from "@playwright/test";

test.setTimeout(60_000);

async function loginOrderer(page: Page) {
  await page.goto("/");
  await page.waitForSelector('#login-screen', { timeout: 15000 });
  await page.waitForTimeout(500);
  await page.locator('#tab-orderer').click();
  await page.fill("#login-id", "orderer");
  await page.fill("#login-pw", "123456");
  await page.locator('button[onclick="doLogin()"]').click();
  await page.waitForSelector('[data-nav]', { timeout: 15000 });
  await page.waitForTimeout(1500);
}

test.describe("코너선반 추가·삭제 회귀 (신고 재현 시도)", () => {
  test.describe.configure({ retries: 1 });

  test("C1: 코너선반 1건 추가 → X 버튼 클릭 → 삭제되는지", async ({ page }) => {
    await loginOrderer(page);

    // 발주 모달 열기
    const ordersNav = page.locator('[data-nav="orders"]').first();
    if (await ordersNav.count() > 0) await ordersNav.click().catch(() => {});
    await page.waitForSelector('#new-order-btn', { timeout: 10000 });
    await page.locator('#new-order-btn').click();
    await page.waitForSelector('#order-modal', { state: 'visible', timeout: 5000 });
    await page.waitForTimeout(500);

    // 코너선반 입력 (가로 300, 세로 400, 수량 2)
    await page.fill('#corner-width', '300');
    await page.fill('#corner-height', '400');
    await page.fill('#corner-qty', '2');
    // 정확히 코너선반 "추가" 버튼 (onclick="addCornerRow()")
    await page.locator('button[onclick="addCornerRow()"]').click();
    await page.waitForTimeout(500);

    // 추가된 행 확인 (data-idx=0 인 corner-remove-btn 있어야)
    const rowsBefore = await page.locator('#corner-rows tr[data-price-row]').count();
    expect(rowsBefore, '추가 후 행 1개').toBe(1);

    // X 버튼 클릭 (data-idx="0")
    await page.locator('#corner-rows .corner-remove-btn[data-idx="0"]').click();
    await page.waitForTimeout(500);

    // 삭제 확인
    const rowsAfter = await page.locator('#corner-rows tr[data-price-row]').count();
    expect(rowsAfter, '삭제 후 행 0개').toBe(0);

    // "추가된 항목 없음" 텍스트 다시 뜨는지
    const emptyText = await page.locator('#corner-rows').textContent();
    expect(emptyText).toContain('추가된 항목 없음');
  });

  test("C3: 모바일 뷰포트 (375x667) 코너선반 추가·삭제", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await loginOrderer(page);
    const ordersNav = page.locator('[data-nav="orders"]').first();
    if (await ordersNav.count() > 0) await ordersNav.click().catch(() => {});
    await page.waitForSelector('#new-order-btn', { timeout: 10000 });
    await page.locator('#new-order-btn').click();
    await page.waitForSelector('#order-modal', { state: 'visible', timeout: 5000 });
    await page.waitForTimeout(500);

    // 코너선반 섹션까지 스크롤
    await page.locator('#corner-width').scrollIntoViewIfNeeded();
    await page.fill('#corner-width', '350');
    await page.fill('#corner-height', '450');
    await page.fill('#corner-qty', '1');
    await page.locator('button[onclick="addCornerRow()"]').click();
    await page.waitForTimeout(500);

    const rowsBefore = await page.locator('#corner-rows tr[data-price-row]').count();
    expect(rowsBefore, '모바일 추가').toBe(1);

    // X 버튼 클릭 (모바일에서도 클릭 가능해야)
    const removeBtn = page.locator('#corner-rows .corner-remove-btn').first();
    await removeBtn.scrollIntoViewIfNeeded();
    await removeBtn.click();
    await page.waitForTimeout(500);

    const rowsAfter = await page.locator('#corner-rows tr[data-price-row]').count();
    expect(rowsAfter, '모바일 삭제').toBe(0);
  });

  test("C4: X 아이콘(fa-times) 정확히 클릭 → 삭제", async ({ page }) => {
    await loginOrderer(page);
    const ordersNav = page.locator('[data-nav="orders"]').first();
    if (await ordersNav.count() > 0) await ordersNav.click().catch(() => {});
    await page.waitForSelector('#new-order-btn', { timeout: 10000 });
    await page.locator('#new-order-btn').click();
    await page.waitForSelector('#order-modal', { state: 'visible', timeout: 5000 });
    await page.waitForTimeout(500);

    await page.fill('#corner-width', '400');
    await page.fill('#corner-height', '500');
    await page.fill('#corner-qty', '2');
    await page.locator('button[onclick="addCornerRow()"]').click();
    await page.waitForTimeout(500);

    // <i class="fas fa-times"> 아이콘 자체를 클릭 (버튼 아니라)
    await page.locator('#corner-rows .corner-remove-btn i.fa-times').first().click();
    await page.waitForTimeout(500);

    const rows = await page.locator('#corner-rows tr[data-price-row]').count();
    expect(rows, '아이콘 클릭도 삭제 트리거').toBe(0);
  });

  test("C5: 추가·삭제 5회 반복 (race condition)", async ({ page }) => {
    await loginOrderer(page);
    const ordersNav = page.locator('[data-nav="orders"]').first();
    if (await ordersNav.count() > 0) await ordersNav.click().catch(() => {});
    await page.waitForSelector('#new-order-btn', { timeout: 10000 });
    await page.locator('#new-order-btn').click();
    await page.waitForSelector('#order-modal', { state: 'visible', timeout: 5000 });
    await page.waitForTimeout(500);

    for (let i = 0; i < 5; i++) {
      await page.fill('#corner-width', String(100 + i));
      await page.fill('#corner-height', String(200 + i));
      await page.fill('#corner-qty', '1');
      await page.locator('button[onclick="addCornerRow()"]').click();
      await page.waitForTimeout(200);
      await page.locator('#corner-rows .corner-remove-btn').first().click();
      await page.waitForTimeout(200);
    }

    const finalCount = await page.locator('#corner-rows tr[data-price-row]').count();
    expect(finalCount, '5회 추가·삭제 후 0').toBe(0);
  });

  test("C6: 편집 진입 → 기존 코너선반 삭제", async ({ page }) => {
    // 사용자 신고가 편집 흐름일 수 있음 — 기존 발주서 수정 진입 후 코너선반 삭제 시도
    await loginOrderer(page);

    // 1) 코너선반 든 발주서 시드
    const orderData = await page.evaluate(async () => {
      if (!window._FS?.upsertOrder) throw new Error('_FS.upsertOrder 없음');
      const orderId = 6660000 + Math.floor(Math.random() * 99999);
      const orderNum = 'E2E-CORNER-' + Date.now();
      const now = new Date().toISOString();
      const order = {
        id: orderId, orderNum, deliveryTo: '테스트업체',
        address: '', orderDate: '2026-07-22', shipDate: '2026-07-22',
        warehouse: '시흥', note: '',
        upperMaterials: [], upperCommonColor: '실버',
        rodItems: [],
        shelfItems: [{
          name: '코너선반',
          entries: [
            { width: '400', height: '600', qty: 2, color: '화이트 오크' },
            { width: '500', height: '700', qty: 1, color: '화이트 오크' },
          ]
        }],
        sharedColor: '화이트 오크',
        drawerItems: [],
        totalSupply: 0, totalVat: 0, totalAmount: 0,
        createdAt: now, updatedAt: now,
        status: '발주대기',
        stockDeducted: false,
        createdBy: 'orderer',
        statusHistory: [{ status: '발주대기', changedBy: 'orderer', changedByName: 'orderer', changedAt: now, note: 'E2E 시드' }],
        items: [], siteName: '테스트업체', customerName: '',
      };
      await window._FS.upsertOrder(order);
      return { orderId, orderNum };
    });

    // 2) 새로고침 후 재로그인
    await page.reload();
    await page.waitForTimeout(1500);
    const loginVis = await page.locator('#login-screen').isVisible().catch(() => false);
    if (loginVis) await loginOrderer(page);
    else await page.waitForSelector('[data-nav]', { timeout: 15000 });
    await page.waitForTimeout(1500);

    // 3) 발주 리스트에서 시드 발주서 찾기 → 클릭 → [수정] 진입
    const ordersNav = page.locator('[data-nav="orders"]').first();
    if (await ordersNav.count() > 0) await ordersNav.click().catch(() => {});
    await page.waitForTimeout(1500);
    const orderRow = page.locator(`tr[data-order-id="${orderData.orderId}"]`).first();
    await orderRow.waitFor({ state: 'visible', timeout: 10000 });
    await orderRow.click();
    await page.waitForSelector('#edit-order-btn', { state: 'visible', timeout: 10000 });
    await page.locator('#edit-order-btn').click();
    await page.waitForSelector('#order-modal', { state: 'visible', timeout: 10000 });
    await page.waitForTimeout(1500);

    // 4) 편집 모달에 코너선반 2건 복원됐는지 확인
    const rowsBefore = await page.locator('#corner-rows tr[data-price-row]').count();
    expect(rowsBefore, '편집 진입 시 기존 코너선반 2건 복원').toBe(2);

    // 5) 첫 번째 코너선반 삭제 (X 클릭)
    await page.locator('#corner-rows .corner-remove-btn').first().click();
    await page.waitForTimeout(500);
    const rowsAfterFirst = await page.locator('#corner-rows tr[data-price-row]').count();
    expect(rowsAfterFirst, '1건 삭제 후 1건 남음').toBe(1);

    // 6) 남은 것도 삭제
    await page.locator('#corner-rows .corner-remove-btn').first().click();
    await page.waitForTimeout(500);
    const rowsAfterAll = await page.locator('#corner-rows tr[data-price-row]').count();
    expect(rowsAfterAll, '전부 삭제').toBe(0);
  });

  test("C7: 편집 → 코너선반 삭제 → 수정 저장 → 재조회 → 삭제 반영 확인", async ({ page }) => {
    // 사용자 신고 핵심 시나리오 — 편집에서 삭제 클릭은 UI상 사라진 것처럼 보이지만
    // 저장 후 다시 열면 그대로 남아있는 케이스 재현 시도
    await loginOrderer(page);

    // 1) 코너선반 2건 든 발주서 시드
    const orderData = await page.evaluate(async () => {
      if (!window._FS?.upsertOrder) throw new Error('_FS.upsertOrder 없음');
      const orderId = 5550000 + Math.floor(Math.random() * 99999);
      const orderNum = 'E2E-CORNER-SAVE-' + Date.now();
      const now = new Date().toISOString();
      const order = {
        id: orderId, orderNum, deliveryTo: '테스트업체',
        address: '', orderDate: '2026-07-22', shipDate: '2026-07-22',
        warehouse: '시흥', note: '',
        upperMaterials: [], upperCommonColor: '실버',
        rodItems: [],
        shelfItems: [{
          name: '코너선반',
          entries: [
            { width: '400', height: '600', qty: 2, color: '화이트 오크' },
            { width: '500', height: '700', qty: 1, color: '화이트 오크' },
          ]
        }],
        sharedColor: '화이트 오크',
        drawerItems: [],
        totalSupply: 0, totalVat: 0, totalAmount: 0,
        createdAt: now, updatedAt: now,
        status: '발주대기', stockDeducted: false,
        createdBy: 'orderer',
        statusHistory: [{ status: '발주대기', changedBy: 'orderer', changedByName: 'orderer', changedAt: now, note: 'C7 시드' }],
        items: [], siteName: '테스트업체', customerName: '',
      };
      await window._FS.upsertOrder(order);
      return { orderId, orderNum };
    });

    // 2) 새로고침 + 로그인
    await page.reload();
    await page.waitForTimeout(1500);
    const loginVis = await page.locator('#login-screen').isVisible().catch(() => false);
    if (loginVis) await loginOrderer(page);
    else await page.waitForSelector('[data-nav]', { timeout: 15000 });
    await page.waitForTimeout(1500);

    // 3) 발주 리스트 → 시드 발주서 → 편집
    const ordersNav = page.locator('[data-nav="orders"]').first();
    if (await ordersNav.count() > 0) await ordersNav.click().catch(() => {});
    await page.waitForTimeout(1500);
    const orderRow = page.locator(`tr[data-order-id="${orderData.orderId}"]`).first();
    await orderRow.waitFor({ state: 'visible', timeout: 10000 });
    await orderRow.click();
    await page.waitForSelector('#edit-order-btn', { state: 'visible', timeout: 10000 });
    await page.locator('#edit-order-btn').click();
    await page.waitForSelector('#order-modal', { state: 'visible', timeout: 10000 });
    await page.waitForTimeout(1500);

    // 4) 편집 모달에 2건 복원 확인
    let rows = await page.locator('#corner-rows tr[data-price-row]').count();
    expect(rows, '편집 진입 시 2건 복원').toBe(2);

    // 5) 첫 번째 삭제
    await page.locator('#corner-rows .corner-remove-btn').first().click();
    await page.waitForTimeout(500);
    rows = await page.locator('#corner-rows tr[data-price-row]').count();
    expect(rows, '1건 삭제 후 1건 남음').toBe(1);

    // 6) [수정 저장] 클릭 (편집 모드에선 버튼 라벨 '수정 저장')
    const saveBtn = page.locator('#order-modal .order-modal-bottom .btn-primary').first();
    await saveBtn.click();

    // 확인 다이얼로그 있을 수 있음
    const confirmBtn = page.locator('#order-confirm-ok-btn');
    if (await confirmBtn.count() > 0 && await confirmBtn.isVisible().catch(() => false)) {
      await confirmBtn.click();
    }
    await page.waitForTimeout(3000);

    // 저장 성공 → 모달 닫힘 확인
    await page.waitForSelector('#order-modal', { state: 'hidden', timeout: 15000 }).catch(() => {
      throw new Error('저장 후 모달이 닫히지 않음');
    });

    // 7) 발주서 다시 클릭 → 편집 재진입 → 코너선반 1건만 남아있어야
    await page.waitForTimeout(1500);
    await orderRow.click();
    await page.waitForSelector('#edit-order-btn', { state: 'visible', timeout: 10000 });
    await page.locator('#edit-order-btn').click();
    await page.waitForSelector('#order-modal', { state: 'visible', timeout: 10000 });
    await page.waitForTimeout(1500);

    const rowsAfterReopen = await page.locator('#corner-rows tr[data-price-row]').count();
    expect(rowsAfterReopen, '저장 후 재조회 시 1건 남아야 (삭제 반영)').toBe(1);
  });

  test("C2: 코너선반 3건 추가 → 각각 삭제", async ({ page }) => {
    await loginOrderer(page);
    const ordersNav = page.locator('[data-nav="orders"]').first();
    if (await ordersNav.count() > 0) await ordersNav.click().catch(() => {});
    await page.waitForSelector('#new-order-btn', { timeout: 10000 });
    await page.locator('#new-order-btn').click();
    await page.waitForSelector('#order-modal', { state: 'visible', timeout: 5000 });
    await page.waitForTimeout(500);

    // 3건 추가
    const rows = [['300','400','2'],['500','600','1'],['700','800','3']];
    for (const [w,h,q] of rows) {
      await page.fill('#corner-width', w);
      await page.fill('#corner-height', h);
      await page.fill('#corner-qty', q);
      await page.locator('button[onclick="addCornerRow()"]').click();
      await page.waitForTimeout(300);
    }

    let count = await page.locator('#corner-rows tr[data-price-row]').count();
    expect(count, '3건 추가 완료').toBe(3);

    // 첫 번째 삭제
    await page.locator('#corner-rows .corner-remove-btn').first().click();
    await page.waitForTimeout(300);
    count = await page.locator('#corner-rows tr[data-price-row]').count();
    expect(count, '1건 삭제 후 2건 남음').toBe(2);

    // 다시 첫 번째 삭제
    await page.locator('#corner-rows .corner-remove-btn').first().click();
    await page.waitForTimeout(300);
    count = await page.locator('#corner-rows tr[data-price-row]').count();
    expect(count, '2건 삭제 후 1건 남음').toBe(1);

    // 마지막 삭제
    await page.locator('#corner-rows .corner-remove-btn').first().click();
    await page.waitForTimeout(300);
    count = await page.locator('#corner-rows tr[data-price-row]').count();
    expect(count, '전부 삭제').toBe(0);
  });
});
