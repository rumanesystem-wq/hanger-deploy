import { test } from "@playwright/test";

test("운영 발주자 발주서 확인", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push("PAGE: " + e.message));
  page.on("console", msg => { if (msg.type() === "error" || msg.type() === "warning") errors.push(`${msg.type().toUpperCase()}: ${msg.text().slice(0, 200)}`); });

  await page.setViewportSize({ width: 400, height: 900 });
  await page.goto("https://hanger-deploy.web.app", { timeout: 15000 });
  await page.waitForTimeout(3000);
  await page.locator("#tab-orderer").click();
  // 발주자 계정 정보 입력 (실제 발주자 ID 모름 — 시도)
  await page.fill("#login-id", "orderer");
  await page.fill("#login-pw", "123456");
  await page.locator('button[onclick="doLogin()"]').click();
  await page.waitForTimeout(3000);

  // nav 보임 확인
  const navCount = await page.locator('[data-nav="orders"]').count();
  console.log("발주서 nav 보임:", navCount > 0);

  if (navCount > 0) {
    await page.evaluate(() => (window as any).navigate('orders'));
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "C:/Users/kateb/hanger-deploy/.dev-output/prod-orderer-orders.png" });
    const orderRowCount = await page.locator('.order-row').count();
    const emptyVisible = await page.locator('.empty').count();
    console.log("발주서 row 갯수:", orderRowCount);
    console.log("empty 상태:", emptyVisible);
  }

  console.log("\n에러 갯수:", errors.length);
  errors.slice(0, 20).forEach(e => console.log(" -", e));
});
