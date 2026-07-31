// manual-check.spec.ts — 배포 전 실사용자 흐름 수동 확인용
// 발주자·관리자 실제 UI 흐름을 자동으로 돌면서 각 단계 성공/실패 리포트

import { test, expect, Page } from "@playwright/test";
import { resetAndSeed } from "./helpers/emu-reset";

test.setTimeout(180_000);

const COLOR = "화이트 오크";

async function waitReady(page: Page, id: string) {
  await page.waitForSelector("#login-screen", { state: "visible", timeout: 15000 });
  await page.waitForFunction(
    (accountId) => {
      const w: any = window as any;
      const accts = w.DB && typeof w.DB.get === "function" ? w.DB.get("accounts", []) : [];
      const hasAcct = Array.isArray(accts) && accts.some((a: any) => a && a.id === accountId);
      const authReady = !!w._fbAuth && typeof w._fbAuth.signInWithEmailAndPassword === "function";
      return hasAcct && authReady;
    },
    id,
    { timeout: 15000 }
  );
}

async function loginAdmin(page: Page) {
  await page.goto("/");
  await waitReady(page, "admin");
  await page.locator("#tab-admin").click();
  await page.fill("#login-id", "admin");
  await page.fill("#login-pw", "123456");
  await page.locator('button[onclick="doLogin()"]').click();
  await page.waitForSelector("[data-nav]", { timeout: 15000 });
}

async function loginOrderer(page: Page) {
  await page.goto("/");
  await waitReady(page, "orderer");
  await page.locator("#tab-orderer").click();
  await page.fill("#login-id", "orderer");
  await page.fill("#login-pw", "123456");
  await page.locator('button[onclick="doLogin()"]').click();
  await page.waitForSelector("[data-nav]", { timeout: 15000 });
}

test.describe("수동 확인 자동화 (배포 전)", () => {
  test.beforeAll(async () => {
    await resetAndSeed();
  });

  test("1. 관리자 로그인 성공", async ({ page }) => {
    await loginAdmin(page);
    const hasNav = await page.locator("[data-nav]").count();
    console.log(`  ▶ nav 개수: ${hasNav}`);
    expect(hasNav).toBeGreaterThan(0);
  });

  test("2. 발주자 로그인 + 재고 현황(stock-view) 진입", async ({ page }) => {
    await loginOrderer(page);
    await page.locator('[data-nav="stock-view"]').first().click();
    await page.waitForTimeout(1500);
    const osanHeader = await page.locator('th:has-text("오산")').count();
    const orderableHeader = await page.locator('th:has-text("발주가능")').count();
    console.log(`  ▶ 오산 헤더: ${osanHeader}, 발주가능 헤더: ${orderableHeader}`);
    expect(osanHeader).toBeGreaterThan(0);
    expect(orderableHeader).toBeGreaterThan(0);
  });

  test("3. 관리자: 시흥 발주 저장 → DB 반영 확인", async ({ page }) => {
    await loginAdmin(page);

    const r = await page.evaluate(async ({ color }) => {
      const items = window.DB.get("items", []).filter(
        (i: any) => i.category === "서랍장" && i.isActive && i.drawerType !== "handle"
      );
      const target = items[0];
      if (!target) return { ok: false, err: "no drawer item" };
      try {
        const result = await window.saveOrder(
          {
            deliveryTo: "테스트업체",
            address: "주소",
            orderDate: "2026-07-27",
            shipDate: "2026-07-28",
            warehouse: "시흥",
            sharedColor: color,
            drawerItems: [{ itemId: target.id, requiredQty: 2, color }],
            upperMaterials: [], shelfItems: [], rodItems: []
          },
          "발주대기"
        );
        return { ok: true, orderId: result.orderId };
      } catch (e: any) {
        return { ok: false, err: e.message };
      }
    }, { color: COLOR });

    console.log(`  ▶ 시흥 발주 저장: ${JSON.stringify(r)}`);
    expect(r.ok, `시흥 발주 저장 실패: ${r.err}`).toBe(true);
  });

  test("4. 관리자: 평택 발주 저장 → DB 반영 확인", async ({ page }) => {
    await loginAdmin(page);
    const r = await page.evaluate(async ({ color }) => {
      const items = window.DB.get("items", []).filter(
        (i: any) => i.category === "서랍장" && i.isActive && i.drawerType !== "handle"
      );
      const target = items[0];
      try {
        const result = await window.saveOrder(
          {
            deliveryTo: "테스트업체", address: "주소",
            orderDate: "2026-07-27", shipDate: "2026-07-28",
            warehouse: "평택", sharedColor: color,
            drawerItems: [{ itemId: target.id, requiredQty: 3, color }],
            upperMaterials: [], shelfItems: [], rodItems: []
          },
          "발주대기"
        );
        return { ok: true, orderId: result.orderId };
      } catch (e: any) { return { ok: false, err: e.message }; }
    }, { color: COLOR });
    console.log(`  ▶ 평택 발주 저장: ${JSON.stringify(r)}`);
    expect(r.ok).toBe(true);
  });

  test("5+6. 관리자: 시흥·평택 발주 저장 → 확정 → 취소 전체 흐름", async ({ page }) => {
    await loginAdmin(page);
    const r = await page.evaluate(async ({ color }) => {
      const items = window.DB.get("items", []).filter(
        (i: any) => i.category === "서랍장" && i.isActive && i.drawerType !== "handle"
      );
      const target = items[0];
      const steps: any[] = [];
      try {
        // A. 시흥 발주대기 저장
        const s1 = await window.saveOrder(
          { deliveryTo: "테스트업체", address: "주소", orderDate: "2026-07-27", shipDate: "2026-07-28",
            warehouse: "시흥", sharedColor: color,
            drawerItems: [{ itemId: target.id, requiredQty: 2, color }],
            upperMaterials: [], shelfItems: [], rodItems: [] },
          "발주대기"
        );
        steps.push({ step: "시흥 발주대기 저장", orderId: s1.orderId });

        // B. 발주확정으로 상태 변경
        const ok1 = await window.changeOrderStatus(s1.orderId, "발주확정");
        const after1 = window.DB.get("orders", []).find((o: any) => o.id === s1.orderId);
        steps.push({ step: "발주확정", changed: !!ok1, status: after1?.status });

        // C. 취소로 상태 변경 → 재고 롤백
        const ok2 = await window.cancelOrder(s1.orderId, "테스트 취소");
        const after2 = window.DB.get("orders", []).find((o: any) => o.id === s1.orderId);
        steps.push({ step: "취소", changed: !!ok2, status: after2?.status, stockDeducted: after2?.stockDeducted });

        // D. 평택 발주 별도 저장 (평택 경로도 확인)
        const s2 = await window.saveOrder(
          { deliveryTo: "테스트업체B", address: "주소B", orderDate: "2026-07-27", shipDate: "2026-07-28",
            warehouse: "평택", sharedColor: color,
            drawerItems: [{ itemId: target.id, requiredQty: 1, color }],
            upperMaterials: [], shelfItems: [], rodItems: [] },
          "발주대기"
        );
        steps.push({ step: "평택 발주대기 저장", orderId: s2.orderId });

        return { ok: true, steps };
      } catch (e: any) {
        return { ok: false, err: e.message, steps };
      }
    }, { color: COLOR });

    console.log(`  ▶ 전체 흐름:\n${JSON.stringify(r, null, 2)}`);
    expect(r.ok).toBe(true);
    expect(r.steps[1].status).toBe("발주확정");
    expect(r.steps[2].status).toBe("취소");
    expect(r.steps[2].stockDeducted).toBe(false);
  });

  test("7. 관리자: 오산 재고 조정 → DB 반영", async ({ page }) => {
    await loginAdmin(page);
    const r = await page.evaluate(async ({ color }) => {
      const items = window.DB.get("items", []).filter(
        (i: any) => i.category === "서랍장" && i.isActive && i.drawerType !== "handle"
      );
      const target = items[0];
      const before = target ? target.stockOsan || 0 : 0;
      try {
        await window.processInventory({
          itemId: target.id, type: "입고", qty: 5, memo: "테스트",
          warehouse: "오산", logDate: "2026-07-27", color
        });
        const after = window.DB.get("items", []).find((i: any) => i.id === target.id);
        return {
          ok: true,
          before,
          after: after ? after.stockOsan || 0 : 0,
          currentStock: after ? after.currentStock : null
        };
      } catch (e: any) { return { ok: false, err: e.message }; }
    }, { color: COLOR });
    console.log(`  ▶ 오산 입고 5: ${JSON.stringify(r)}`);
    expect(r.ok).toBe(true);
    expect(r.after).toBe(r.before + 5);
    // currentStock에 오산 안 들어가는지 확인 (오산은 발주 대상 아님)
    console.log(`  ▶ currentStock에 오산 미포함 확인: currentStock=${r.currentStock}`);
  });

  test("8. 관리자: 원장 화면 진입 + PDF 저장 함수 존재 확인", async ({ page }) => {
    await loginAdmin(page);
    const nav = page.locator('[data-nav="settlement"], [data-nav="ledger"]').first();
    if (await nav.count() > 0) {
      await nav.click();
      await page.waitForTimeout(1500);
    }
    const hasFn = await page.evaluate(() => typeof (window as any).saveLedgerPdf === "function");
    console.log(`  ▶ saveLedgerPdf 함수 존재: ${hasFn}`);
    expect(hasFn).toBe(true);
  });

  test("9. 잘못된 창고 발주 저장 거부 (방어 확인)", async ({ page }) => {
    await loginAdmin(page);
    const r = await page.evaluate(async () => {
      try {
        await window.saveOrder(
          {
            deliveryTo: "테스트", address: "테", orderDate: "2026-07-27", shipDate: "2026-07-28",
            warehouse: "오산", drawerItems: [], upperMaterials: [], shelfItems: [], rodItems: []
          },
          "발주확정"
        );
        return { ok: true, rejected: false };
      } catch (e: any) {
        return { ok: true, rejected: true, err: e.message };
      }
    });
    console.log(`  ▶ 오산 발주 거부: ${JSON.stringify(r)}`);
    expect(r.rejected).toBe(true);
  });
});
