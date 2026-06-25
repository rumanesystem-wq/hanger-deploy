import { test, expect } from "@playwright/test";

// 스모크 — 앱이 에뮬레이터에서 뜨고 로그인 화면이 정상 렌더되는지.
// 로그인·데이터 변경 없음(안전). 핵심 흐름 E2E는 별도 spec에서 다룬다.
test.describe("발주허브 부팅·로그인 화면", () => {
  test("앱이 뜨고 로그인 화면이 보인다", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/발주허브/);
    await expect(page.locator("#login-screen")).toBeVisible();
    await expect(page.locator("#login-id")).toBeVisible();
    await expect(page.locator("#login-pw")).toBeVisible();
  });

  test("발주자/관리자 로그인 탭이 보인다", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#tab-orderer")).toBeVisible();
    await expect(page.locator("#tab-admin")).toBeVisible();
  });
});
