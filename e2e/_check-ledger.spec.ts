import { test, expect } from "@playwright/test";
import { execSync } from "child_process";
import path from "path";

test.beforeAll(() => {
  const seedPath = path.resolve(__dirname, "..", "functions", "seed-ledger-print-test.js");
  execSync(`node "${seedPath}"`, {
    stdio: "pipe",
    timeout: 15_000,
    env: {
      ...process.env,
      FIRESTORE_EMULATOR_HOST: "localhost:18080",
      FIREBASE_AUTH_EMULATOR_HOST: "localhost:19099",
    },
  });
});

test("원장 표 스샷", async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 900 });
  await page.goto("/");
  await page.waitForFunction(() => {
    const w = window as any;
    const accounts = w.DB && typeof w.DB.get === "function" ? w.DB.get("accounts", []) : [];
    return Boolean(w._booted && w._fbAuth && Array.isArray(accounts) && accounts.some((a: any) => a && a.id === "admin"));
  }, { timeout: 25_000 });

  await page.locator("#tab-admin").click();
  await page.fill("#login-id", "admin");
  await page.fill("#login-pw", "123456");
  await page.locator('button[onclick="doLogin()"]').click();
  await page.waitForSelector('[data-nav="settlement"]', { timeout: 15_000 });

  await page.evaluate(() => (window as any).navigate("settlement"));
  await page.waitForSelector('[data-stl-tab="ledger"]', { timeout: 10_000 });
  await page.locator('[data-stl-tab="ledger"]').click();
  await page.waitForSelector("#tbody-customers", { timeout: 10_000 });

  const firstCustomer = page.locator("#tbody-customers tr").filter({ hasText: /원장테스트상사|남다른디자인/ }).first();
  await expect(firstCustomer).toBeVisible();
  await firstCustomer.click();
  await page.waitForTimeout(800);

  await page.screenshot({ path: "C:/Users/kateb/hanger-deploy/.dev-output/ledger-detail.png", fullPage: false });
});
