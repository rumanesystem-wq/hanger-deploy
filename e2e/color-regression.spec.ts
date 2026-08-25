import { test, expect } from "@playwright/test";
import { resetAndSeed } from "./helpers/emu-reset";

test.setTimeout(120_000);

test.beforeAll(async () => {
  await resetAndSeed();
});

async function loginAdmin(page: any) {
  await page.goto("/");
  await page.waitForSelector("#login-screen", { state: "visible", timeout: 15_000 });
  await page.waitForFunction(() => {
    const w = window as any;
    const accounts = w.DB?.get("accounts", []) || [];
    return accounts.some((a: any) => a?.id === "admin") && !!w._fbAuth?.signInWithEmailAndPassword;
  }, undefined, { timeout: 15_000 });
  await page.locator("#tab-admin").click();
  await page.fill("#login-id", "admin");
  await page.fill("#login-pw", "123456");
  await page.locator('button[onclick="doLogin()"]').click();
  await page.waitForSelector("[data-nav]", { timeout: 15_000 });
}

async function loginOrderer(page: any) {
  await page.goto("/");
  await page.waitForSelector("#login-screen", { state: "visible", timeout: 15_000 });
  await page.waitForFunction(() => {
    const w = window as any;
    const accounts = w.DB?.get("accounts", []) || [];
    return accounts.some((a: any) => a?.id === "orderer") && !!w._fbAuth?.signInWithEmailAndPassword;
  }, undefined, { timeout: 15_000 });
  await page.locator("#tab-orderer").click();
  await page.fill("#login-id", "orderer");
  await page.fill("#login-pw", "123456");
  await page.locator('button[onclick="doLogin()"]').click();
  await page.waitForSelector("[data-nav]", { timeout: 15_000 });
}

test("다색 옷봉은 주문과 명세서 모두 색상별 FFD를 사용한다", async ({ page }) => {
  await loginAdmin(page);
  const result = await page.evaluate(() => {
    const w = window as any;
    const rods = [
      { size: "1200", qty: 1, color: "화이트" },
      { size: "1200", qty: 1, color: "블랙" },
    ];
    const order = {
      id: 1, orderNum: "COLOR-ROD-1", deliveryTo: "테스트", shipDate: "2026-08-03",
      upperCommonColor: "화이트", rodItems: rods, rod2400Required: 2, rodUnitPrice: 4500,
      upperMaterials: [], shelfItems: [], drawerItems: []
    };
    const invoice = w.orderToInvoice(order);
    const rodLines = invoice.items.filter((i: any) => i.name === "옷봉 2400");
    return {
      orderQty: w.calcRod2400(rods, "화이트"),
      invoiceQty: rodLines.reduce((s: number, i: any) => s + i.qty, 0),
      specs: rodLines.map((i: any) => i.spec).sort(),
      supply: rodLines.reduce((s: number, i: any) => s + i.supply, 0),
    };
  });
  expect(result).toEqual({ orderQty: 2, invoiceQty: 2, specs: ["블랙", "화이트"], supply: 9000 });
});

test("상부 공통색 변경이 기존 수량과 추가색 행을 지우지 않는다", async ({ page }) => {
  await loginAdmin(page);
  const result = await page.evaluate(() => {
    const w = window as any;
    w._openOrderModalRender(null);
    const qty = document.querySelector(".upper-qty") as HTMLInputElement;
    if (!qty) return { ok: false, reason: "upper row missing" };
    qty.value = "3";
    qty.dispatchEvent(new Event("input", { bubbles: true }));
    w._addUpperExtraColorRow(qty.dataset.mat, "블랙", 2);
    const color = document.getElementById("upper-common-color") as HTMLSelectElement;
    color.value = color.value === "화이트" ? "실버" : "화이트";
    color.dispatchEvent(new Event("change", { bubbles: true }));
    return {
      ok: true,
      qty: (document.querySelector(".upper-qty") as HTMLInputElement)?.value,
      extras: document.querySelectorAll(".upper-extra-color-row").length,
      extraQty: (document.querySelector(".upper-extra-qty") as HTMLInputElement)?.value,
    };
  });
  expect(result).toEqual({ ok: true, qty: "3", extras: 1, extraQty: "2" });
});

test("재고 부족 주문을 편집 삭제해도 재고가 실제 차감량보다 늘지 않는다", async ({ page }) => {
  await loginAdmin(page);
  const result = await page.evaluate(async () => {
    const w = window as any;
    const items = await w._FS.get("items", { fromServer: true });
    const item = items.find((i: any) => i && i.category === "서랍장");
    if (!item) return { ok: false, reason: "drawer missing" };
    item.stockSiheung = 2;
    item.colorStockSiheung = { 화이트: 2 };
    item.currentStock = 2 + (item.stockPyeongtaek || 0);
    await w.DB.set("items", items);

    const payload = {
      deliveryTo: "테스트업체", address: "테스트주소", orderDate: "2026-08-03", shipDate: "2026-08-04",
      warehouse: "시흥", sharedColor: "화이트", upperMaterials: [], shelfItems: [], rodItems: [],
      drawerItems: [{ itemId: item.id, requiredQty: 5, color: "화이트", unitPrice: 1000 }],
      totalSupply: 5000, totalVat: 500, totalAmount: 5500,
      proxyOrdererId: "orderer", proxyOrdererName: "테스트업체", proxyCreatedByAdmin: true
    };
    const saved = await w.saveOrder(payload, "발주대기");
    const afterDeduct = (await w._FS.get("items", { fromServer: true })).find((i: any) => i.id === item.id);
    w._editOverride = {
      id: saved.order.id, orderNum: saved.order.orderNum, originalStatus: saved.order.status,
      status: saved.order.status, createdBy: saved.order.createdBy, createdAt: saved.order.createdAt
    };
    await w.saveOrder({ ...payload, drawerItems: [], totalSupply: 0, totalVat: 0, totalAmount: 0 }, "발주대기");
    const afterEdit = (await w._FS.get("items", { fromServer: true })).find((i: any) => i.id === item.id);
    return {
      ok: true,
      deductedStock: afterDeduct.colorStockSiheung?.화이트,
      restoredStock: afterEdit.colorStockSiheung?.화이트,
      deductedQty: saved.order.drawerItems[0].inventoryDeductedQty,
    };
  });
  expect(result).toEqual({ ok: true, deductedStock: 0, restoredStock: 2, deductedQty: 2 });
});

test("인쇄 미디어에서 print-area가 숨겨지지 않는다", async ({ page }) => {
  await loginAdmin(page);
  await page.evaluate(() => {
    const area = document.getElementById("print-area")!;
    area.innerHTML = '<div id="invoiceContent"><div class="invoice-wrap">PRINT TEST</div></div>';
  });
  await page.emulateMedia({ media: "print" });
  const display = await page.locator("#print-area").evaluate((el: Element) => getComputedStyle(el).display);
  expect(display).not.toBe("none");
});

test("발주자가 관리자 대리발주의 추가색을 다시 저장해도 보존된다", async ({ page }) => {
  await loginAdmin(page);
  const created = await page.evaluate(async () => {
    const w = window as any;
    const item = w.DB.get("items", []).find((i: any) => i?.category === "서랍장" && !i.noColor);
    const upperName = "포스트바 2050";
    if (!item || !upperName) return { ok: false, reason: "seed item missing" };
    const saved = await w.saveOrder({
      deliveryTo: "테스트업체", address: "테스트주소", orderDate: "2026-08-03", shipDate: "2026-08-04",
      warehouse: "시흥", upperCommonColor: "화이트", sharedColor: "화이트",
      upperMaterials: [
        { name: upperName, color: "화이트", qty: 1, unitPrice: 1000, amount: 1000 },
        { name: upperName, color: "블랙", qty: 2, unitPrice: 1000, amount: 2000 },
      ],
      shelfItems: [], rodItems: [],
      drawerItems: [
        { itemId: item.id, requiredQty: 1, color: "화이트", unitPrice: 1000 },
        { itemId: item.id, requiredQty: 2, color: "블랙", unitPrice: 1000 },
      ],
      totalSupply: 6000, totalVat: 600, totalAmount: 6600,
      proxyOrdererId: "orderer", proxyOrdererName: "테스트업체", proxyCreatedByAdmin: true
    }, "발주대기");
    return { ok: true, id: saved.order.id, orderNum: saved.order.orderNum };
  });
  expect(created.ok).toBe(true);

  await page.evaluate(async () => { if ((window as any).doLogout) await (window as any).doLogout(); });
  await loginOrderer(page);
  await page.evaluate((id) => (window as any).openEditOrder(id), created.id);
  await page.waitForSelector("#order-modal", { state: "visible", timeout: 15_000 });
  await page.waitForFunction(() => document.querySelectorAll(".upper-extra-color-row").length === 1 && document.querySelectorAll(".drawer-extra-color-row").length === 1, undefined, { timeout: 15_000 });
  expect(await page.locator(".upper-extra-color-row").isVisible()).toBe(false);
  expect(await page.locator(".drawer-extra-color-row").isVisible()).toBe(false);

  await page.evaluate((id) => (window as any).submitEditOrder(id, "발주대기"), created.id);
  await page.waitForFunction(() => !(window as any)._editOverride, undefined, { timeout: 15_000 });
  const preserved = await page.evaluate(async (orderNum) => {
    const orders = await (window as any)._FS.getAllOrders({ fromServer: true });
    const order = orders.find((o: any) => o.orderNum === orderNum);
    return { upper: order?.upperMaterials?.length || 0, drawer: order?.drawerItems?.length || 0 };
  }, created.orderNum);
  expect(preserved).toEqual({ upper: 2, drawer: 2 });
});
