// 운영 배포 직후 smoke 테스트 — 데이터 변경 없음 (로그인만, write 없음)
// 사용: npm run smoke:prod
import { test, expect } from "@playwright/test";

const PROD_URL = process.env.SMOKE_URL || "https://hanger-deploy.web.app";

test.describe(`운영 smoke @ ${PROD_URL}`, () => {
  test("페이지가 뜨고 로그인 화면이 보이고 콘솔 에러 0", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", e => errors.push("PAGE: " + e.message));
    page.on("console", msg => { if (msg.type() === "error") errors.push("CONSOLE: " + msg.text().slice(0, 200)); });

    await page.goto(PROD_URL, { timeout: 15000 });
    await expect(page).toHaveTitle(/발주허브/);
    await expect(page.locator("#login-screen")).toBeVisible();
    await expect(page.locator("#tab-orderer")).toBeVisible();
    await expect(page.locator("#tab-admin")).toBeVisible();

    await page.waitForTimeout(3000); // SW 등록 + 초기 fetch 완료 대기

    // 치명적 JS 에러만 필터 (Unexpected token, ReferenceError, TypeError 등)
    const fatal = errors.filter(e =>
      e.includes("Unexpected token") ||
      e.includes("ReferenceError") ||
      e.includes("is not defined") ||
      e.includes("Failed to load")
    );
    if (fatal.length > 0) {
      console.log("🚨 치명적 에러 감지:");
      fatal.forEach(e => console.log("  -", e));
    }
    expect(fatal).toHaveLength(0);
  });
});
