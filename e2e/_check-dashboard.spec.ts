import { test } from "@playwright/test";

test("대시보드 스샷", async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 900 });
  await page.goto("/");
  await page.locator("#tab-admin").click();
  await page.fill("#login-id", "admin");
  await page.fill("#login-pw", "123456");
  await page.locator('button[onclick="doLogin()"]').click();
  await page.waitForTimeout(1000);
  // 사이드바 열기 (햄버거)
  const ham = page.locator('#nav-toggle, .sb-menu-btn, [onclick*="openSidebar"]').first();
  if (await ham.count() > 0) await ham.click().catch(()=>{});
  await page.waitForTimeout(500);
  await page.locator('[data-nav="dashboard"]').click({ force: true });
  await page.waitForSelector(".card-stock-wh", { timeout: 5000 });
  const card = page.locator(".card-stock-wh");
  await card.screenshot({ path: "C:/Users/kateb/hanger-deploy/.dev-output/dash-card.png" });
  const cardBox = await card.boundingBox();
  const twBox = await card.locator(".table-wrap").boundingBox();
  const tableBox = await card.locator("table").boundingBox();
  console.log("CARD", JSON.stringify(cardBox));
  console.log("TABLE_WRAP", JSON.stringify(twBox));
  console.log("TABLE", JSON.stringify(tableBox));
});
