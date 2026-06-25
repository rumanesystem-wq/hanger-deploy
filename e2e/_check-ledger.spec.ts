import { test } from "@playwright/test";

test("원장 표 스샷", async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 900 });
  await page.goto("/");
  await page.locator("#tab-admin").click();
  await page.fill("#login-id", "admin");
  await page.fill("#login-pw", "123456");
  await page.locator('button[onclick="doLogin()"]').click();
  await page.waitForTimeout(1500);
  const ham = page.locator('#nav-toggle, .sb-menu-btn').first();
  if (await ham.count() > 0) await ham.click().catch(()=>{});
  await page.waitForTimeout(300);
  await page.locator('[data-nav="settlement"]').click({ force: true });
  await page.waitForTimeout(800);
  await page.locator('[data-stl-tab="ledger"]').click();
  await page.waitForTimeout(600);
  const firstCustomer = page.locator('#tbody-customers tr.paid').first();
  await firstCustomer.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: "C:/Users/kateb/hanger-deploy/.dev-output/ledger-detail.png", fullPage: false });
});
