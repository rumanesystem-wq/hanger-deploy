// R1, R2 회귀 — 정산 페이지 정렬 + 검색 상호작용
// 적대적 테스트 B1, B2 박제 (도커 emulator + admin 시드 계정 사용)
import { test, expect, Page } from "@playwright/test";

async function loginAsAdmin(page: Page) {
  await page.goto("/");
  await page.locator("#tab-admin").click();
  await page.fill("#login-id", "admin");
  await page.fill("#login-pw", "123456");
  await page.locator('button[onclick="doLogin()"]').click();
  await page.waitForSelector('[data-nav="settlement"]', { timeout: 10000 });
}

async function goToSettlement(page: Page) {
  await page.locator('[data-nav="settlement"]').click();
  await page.waitForSelector("#tbody-ordererwise", { timeout: 5000 });
  await page.waitForSelector("#sort-toggle", { timeout: 5000 });
}

test.describe("정산 — 정렬 + 검색 회귀 (R1, R2)", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await goToSettlement(page);
  });

  // R1: 정렬 토글 → 탭 전환 → 정렬 dataset.order 와 표 실제 순서 일치
  test("R1: 탭 왕복 후 sort-toggle dataset 과 표 순서 일치", async ({ page }) => {
    const toggle = page.locator("#sort-toggle");

    // 1. 정렬 토글 (desc → asc)
    await toggle.click();
    await expect(toggle).toHaveAttribute("data-order", "asc");

    // 2. 다른 탭 (대시보드) → 정산 복귀
    await page.locator('[data-nav="dashboard"]').click();
    await page.waitForTimeout(500);
    await page.locator('[data-nav="settlement"]').click();
    await page.waitForSelector("#sort-toggle");

    // 3. 재진입 후 dataset.order 와 표 순서 일치 검증
    const orderAttr = await page.locator("#sort-toggle").getAttribute("data-order");

    // 첫 거래처 펼치고 첫 발주서 발주일 캡처
    const firstCustomer = page.locator("#tbody-ordererwise tr.row-main").first();
    await firstCustomer.click();
    const detailRows = page.locator(".detail-table tbody tr:not(.hidden-row):not(.search-hidden)");
    const rowCount = await detailRows.count();
    test.skip(rowCount < 2, "데이터 부족 — 시드 발주서 2건 이상 필요");

    const firstDate = await detailRows.nth(0).locator("td.col-date").textContent();
    const lastDate = await detailRows.nth(rowCount - 1).locator("td.col-date").textContent();

    // 불변식: dataset.order가 가리키는 순서 == 표의 실제 순서
    if (orderAttr === "asc") {
      expect(firstDate?.localeCompare(lastDate || "") || 0).toBeLessThanOrEqual(0);
    } else {
      expect(firstDate?.localeCompare(lastDate || "") || 0).toBeGreaterThanOrEqual(0);
    }
  });

  // R2: 검색 중 정렬 토글 → search-hidden 잔류 + 비매칭 행 미표시
  test("R2: 검색 활성 상태에서 정렬 → search-hidden 유지", async ({ page }) => {
    // 거래처 펼침
    const firstCustomer = page.locator("#tbody-ordererwise tr.row-main").first();
    await firstCustomer.click();
    await page.waitForTimeout(200);

    // 빠른 검색 입력
    const search = page.locator("#quick-search");
    await search.fill("20260601");  // 특정 날짜 매칭 (시드 데이터 기준)
    await page.waitForTimeout(250); // debounce 150ms 후

    // search-hidden 갯수 캡처
    const hiddenBefore = await page.locator(".detail-table tbody tr.search-hidden").count();
    test.skip(hiddenBefore === 0, "search-hidden 생성 안 됨 — 시드 데이터 또는 검색어 조정 필요");

    // 정렬 토글
    await page.locator("#sort-toggle").click();
    await page.waitForTimeout(200);

    // search-hidden 갯수 재확인
    const hiddenAfter = await page.locator(".detail-table tbody tr.search-hidden").count();

    // 불변식: 정렬은 검색 필터와 직교 — search-hidden 유지되어야
    expect(hiddenAfter).toBe(hiddenBefore);
  });
});
