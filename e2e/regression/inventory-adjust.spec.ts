import { test, expect, Page } from "@playwright/test";

test.setTimeout(90_000);

async function waitForAppReady(page: Page, accountId = "admin") {
  await page.waitForFunction(
    (id) => {
      const w = window as any;
      const accounts = w.DB && typeof w.DB.get === "function" ? w.DB.get("accounts", []) : [];
      return Boolean(
        w._booted &&
          w._fbAuth &&
          Array.isArray(accounts) &&
          accounts.some((a: any) => a && a.id === id)
      );
    },
    accountId,
    { timeout: 25_000 }
  );
}

async function loginAdmin(page: Page) {
  await page.goto("/");
  await page.waitForSelector("#login-screen", { timeout: 15_000 });
  await waitForAppReady(page, "admin");
  await page.locator("#tab-admin").click();
  await page.fill("#login-id", "admin");
  await page.fill("#login-pw", "123456");
  await page.locator('button[onclick="doLogin()"]').click();
  await page.waitForSelector('[data-nav="inventory"]', { timeout: 15_000 });
}

async function goToInventory(page: Page) {
  await page.locator('[data-nav="inventory"]').first().click();
  await page.waitForSelector("#inv-stock-table", { timeout: 10_000 });
  await page.waitForSelector('.inv-action-btn[data-inv-type="조정"]', { timeout: 10_000 });
}

async function openFirstBulkAdjustModal(page: Page) {
  const adjustBtn = page.locator('.inv-action-btn[data-inv-type="조정"]').first();
  await adjustBtn.click();
  await page.waitForSelector("#inv-modal", { state: "visible", timeout: 5_000 });
  await expect(page.locator("#inv-bulk-group")).toBeVisible();
  await expect(page.locator(".inv-bulk-qty").first()).toBeVisible();
}

test.describe("재고 조정 모달 회귀 — 색상별 일괄 조정 UI", () => {
  test.describe.configure({ retries: 1 });

  test("I1: 색상 있는 품목은 단일 수량칸 대신 색상별 입력칸이 보여야 한다", async ({ page }) => {
    await loginAdmin(page);
    await goToInventory(page);
    await openFirstBulkAdjustModal(page);

    await expect(page.locator("#inv-qty")).toBeHidden();
    await expect(page.locator("#inv-color")).toBeHidden();
    await expect(page.locator(".inv-bulk-row")).not.toHaveCount(0);
  });

  test("I2: 색상별 조정 저장이 실제 재고에 반영된다", async ({ page }) => {
    await loginAdmin(page);
    await goToInventory(page);

    const itemId = Number(await page.locator('.inv-action-btn[data-inv-type="조정"]').first().getAttribute("data-inv-id"));
    await openFirstBulkAdjustModal(page);

    const firstInput = page.locator(".inv-bulk-qty").first();
    const color = await firstInput.getAttribute("data-color");
    expect(color).toBeTruthy();

    const before = await page.evaluate(
      ({ itemId, color }) => {
        const w = window as any;
        const item = w.DB.get("items", []).find((i: any) => i.id === itemId);
        return w.getWarehouseStock(item, "시흥", color);
      },
      { itemId, color }
    );
    const after = Number(before || 0) + 3;

    await firstInput.fill(String(after));
    await page.locator("#inv-submit-btn").click();
    await page.waitForSelector("#inv-modal", { state: "hidden", timeout: 15_000 });

    const saved = await page.evaluate(
      ({ itemId, color }) => {
        const w = window as any;
        const item = w.DB.get("items", []).find((i: any) => i.id === itemId);
        return w.getWarehouseStock(item, "시흥", color);
      },
      { itemId, color }
    );
    expect(saved).toBe(after);
  });

  test("I3: Enter 연타해도 일괄 조정은 한 번만 처리된다", async ({ page }) => {
    await loginAdmin(page);
    await goToInventory(page);
    await openFirstBulkAdjustModal(page);

    await page.evaluate(() => {
      const w = window as any;
      w.__processInvBatchCalls = 0;
      const orig = w.processInventoryBatch;
      w.processInventoryBatch = async function (...args: any[]) {
        w.__processInvBatchCalls++;
        await new Promise((resolve) => setTimeout(resolve, 300));
        return orig.apply(this, args);
      };
    });

    const input = page.locator(".inv-bulk-qty").first();
    const beforeText = await page.locator(".inv-bulk-before").first().textContent();
    await input.fill(String(Number(beforeText || 0) + 1));
    await input.press("Enter");
    await input.press("Enter");
    await input.press("Enter");
    await page.waitForSelector("#inv-modal", { state: "hidden", timeout: 15_000 });

    const calls = await page.evaluate(() => (window as any).__processInvBatchCalls);
    expect(calls).toBe(1);
  });

  test("I4: 소수 입력은 저장되지 않고 모달이 열린 상태로 남는다", async ({ page }) => {
    await loginAdmin(page);
    await goToInventory(page);
    await openFirstBulkAdjustModal(page);

    await page.locator(".inv-bulk-qty").first().fill("1.9");
    await page.locator("#inv-submit-btn").click();
    await expect(page.locator("#inv-modal")).toBeVisible();
    await expect(page.locator("#toast")).toContainText(/정수/);
  });

  test("I5: 아무 색상도 입력하지 않으면 저장되지 않고 모달이 열린 상태로 남는다", async ({ page }) => {
    await loginAdmin(page);
    await goToInventory(page);
    await openFirstBulkAdjustModal(page);

    await page.locator("#inv-submit-btn").click();
    await expect(page.locator("#inv-modal")).toBeVisible();
    await expect(page.locator("#toast")).toContainText(/입력/);
  });
});
