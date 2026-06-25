import { test } from "@playwright/test";

const PAGES = [
  "dashboard", "orders", "shipping-view", "purchase-requests",
  "inventory", "items", "usage-stats", "price-settings",
  "settlement", "accounts",
];

test("모바일 페이지 스샷 일괄", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  await page.locator("#tab-admin").click();
  await page.fill("#login-id", "admin");
  await page.fill("#login-pw", "123456");
  await page.locator('button[onclick="doLogin()"]').click();
  await page.waitForTimeout(1500);

  for (const id of PAGES) {
    try {
      await page.evaluate(v => (window as any).navigate(v), id);
      await page.waitForTimeout(1200);
      await page.screenshot({
        path: `C:/Users/kateb/hanger-deploy/.dev-output/audit-${id}.png`,
        fullPage: false,
      });
      console.log(`✓ ${id}`);
    } catch (e) {
      console.log(`✗ ${id}: ${e.message.slice(0, 50)}`);
    }
  }
});
