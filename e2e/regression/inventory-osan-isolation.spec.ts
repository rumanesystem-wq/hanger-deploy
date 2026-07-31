// inventory-osan-isolation.spec.ts
// Codex 3차 검토 지적사항 회귀
// - 각 테스트 beforeEach에 에뮬레이터 리셋+시드 (완전 격리)
// - 정확한 selector·색상·nav 사용
// - C3는 실제 lifecycle 함수 호출로 검증
// 대상: docker tooktak-emulator, hosting http://localhost:15050

import { test, expect, Page } from "@playwright/test";
import { resetAndSeed } from "../helpers/emu-reset";

test.setTimeout(90_000);

const COLOR = "화이트 오크"; // SHELF_COLORS[0]

// [Codex 4차] boot readiness: DB에 accounts가 로드되고 Auth 초기화까지 대기
// waitForTimeout(500) 같은 임의 대기는 flaky. 실제 readiness 조건으로 검증.
async function waitForAppReady(page: Page, accountId: string) {
  await page.waitForSelector("#login-screen", { state: "visible", timeout: 15000 });
  await page.waitForFunction(
    (id) => {
      const w: any = window as any;
      const accounts =
        w.DB && typeof w.DB.get === "function"
          ? w.DB.get("accounts", [])
          : [];
      const hasAccount =
        Array.isArray(accounts) &&
        accounts.some((a: any) => a && a.id === id);
      const authReady =
        !!w._fbAuth &&
        typeof w._fbAuth.signInWithEmailAndPassword === "function";
      return hasAccount && authReady;
    },
    accountId,
    { timeout: 15000 }
  );
}

async function loginAdmin(page: Page) {
  await page.goto("/");
  await waitForAppReady(page, "admin");
  await page.locator("#tab-admin").click();
  await page.fill("#login-id", "admin");
  await page.fill("#login-pw", "123456");
  await page.locator('button[onclick="doLogin()"]').click();
  await page.waitForSelector("[data-nav]", { timeout: 15000 });
  await page.waitForFunction(() => {
    const w: any = window as any;
    return typeof w.isAdmin === "function" && w.isAdmin();
  }, { timeout: 10000 });
  // 초기 데이터 fetch 완료 대기 — items가 로드되면 postLogin이 끝난 것
  await page.waitForFunction(() => {
    const w: any = window as any;
    return w.DB && w.DB.get && Array.isArray(w.DB.get("items", [])) && w.DB.get("items", []).length > 0;
  }, { timeout: 10000 });
}

async function loginOrderer(page: Page) {
  await page.goto("/");
  await waitForAppReady(page, "orderer");
  await page.locator("#tab-orderer").click();
  await page.fill("#login-id", "orderer");
  await page.fill("#login-pw", "123456");
  await page.locator('button[onclick="doLogin()"]').click();
  await page.waitForSelector("[data-nav]", { timeout: 15000 });
  await page.waitForFunction(() => {
    const w: any = window as any;
    return typeof w.isAdmin === "function" && !w.isAdmin();
  }, { timeout: 10000 });
  await page.waitForFunction(() => {
    const w: any = window as any;
    return !!(w.DB && w.DB.get);
  }, { timeout: 10000 });
}

async function evaluateWithNavigationRetry<T>(page: Page, fn: () => Promise<T> | T): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await page.evaluate(fn);
    } catch (e: any) {
      if (!String(e && e.message || e).includes("Execution context was destroyed") || attempt === 2) throw e;
      await page.waitForTimeout(700);
      await page.waitForFunction(() => {
        const w: any = window as any;
        return w.DB && typeof w.DB.get === "function";
      }, { timeout: 10000 });
    }
  }
  throw new Error("evaluate retry exhausted");
}

async function fillInventoryQty(page: Page, color: string, qty: string) {
  const bulkVisible = await page.locator("#inv-bulk-group").isVisible();
  if (bulkVisible) {
    await page.locator(`.inv-bulk-qty[data-color="${color}"]`).fill(qty);
  } else {
    await page.selectOption("#inv-color", color);
    await page.fill("#inv-qty", qty);
  }
}

async function firstDrawerItem(page: Page): Promise<{ id: number; name: string }> {
  const r = await page.evaluate(() => {
    const items = window.DB.get("items", []).filter(
      (i: any) => i.category === "서랍장" && i.isActive && i.drawerType !== "handle"
    );
    return items[0] ? { id: items[0].id, name: items[0].name } : null;
  });
  if (!r) throw new Error("no drawer item in seed");
  return r;
}

test.describe("Codex 3차 회귀 (오산 격리 + PR 안전 + atomicity)", () => {
  test.describe.configure({ retries: 0 });

  test.beforeEach(async () => {
    await resetAndSeed();
  });

  // [2026-07-29] 테스트 전체 종료 후 잔여물 정리 — 사용자가 브라우저 열었을 때 테스트 데이터 안 보이게
  test.afterAll(async () => {
    await resetAndSeed();
  });

  test("C1: 오산 입고(색상 정상 선택) → 시흥 대기 PR 미변경 + before/after 정확 검증", async ({ page }) => {
    await loginAdmin(page);
    const target = await firstDrawerItem(page);

    // 시흥 대기 PR 삽입: 화이트 오크 + shortage=5
    const testPrId = await page.evaluate(({ tid, color }) => {
      const prs = window.DB.get("purchase_requests", []);
      const pid = 999001;
      prs.push({
        id: pid, itemId: tid, warehouse: "시흥", color,
        shortageQty: 5, requiredQty: 5, status: "대기",
        createdAt: new Date().toISOString()
      });
      window.DB.set("purchase_requests", prs);
      return pid;
    }, { tid: target.id, color: COLOR });

    // [Codex 4차] 입고 전 baseline snapshot
    const before = await page.evaluate(async (tid) => {
      const item = window.DB.get("items", []).find((i: any) => i.id === tid);
      const serverItems = window._FS && window._FS.get ? await window._FS.get("items") : [];
      const serverItem = Array.isArray(serverItems) ? serverItems.find((i: any) => i.id === tid) : null;
      const logs = window.DB.get("logs", []).filter((l: any) => l.itemId === tid);
      return {
        osan: serverItem ? serverItem.stockOsan || 0 : (item ? item.stockOsan || 0 : 0),
        siheung: serverItem ? (serverItem.stockSiheung !== undefined ? serverItem.stockSiheung : serverItem.currentStock) : (item ? (item.stockSiheung !== undefined ? item.stockSiheung : item.currentStock) : 0),
        pyeongtaek: serverItem ? serverItem.stockPyeongtaek || 0 : (item ? item.stockPyeongtaek || 0 : 0),
        currentStock: serverItem ? (serverItem.currentStock || 0) : (item ? item.currentStock || 0 : 0),
        osanInLogs: logs.filter((l: any) => l.warehouse === "오산" && l.type === "입고").length
      };
    }, target.id);

    // 오산 입고 3
    await page.locator('[data-nav="inventory"]').first().click();
    await page.waitForFunction(() => document.querySelectorAll(".inv-action-btn").length > 0, { timeout: 10000 });
    await page.locator(`.inv-action-btn[data-inv-id="${target.id}"][data-inv-type="입고"]`).first().click();
    await page.waitForSelector("#inv-modal", { state: "visible" });
    await page.waitForSelector("#inv-wh-osan", { state: "visible" });
    await page.locator("#inv-wh-osan").click();
    await fillInventoryQty(page, COLOR, "3");
    await page.locator("#inv-submit-btn").click();
    await page.waitForSelector("#inv-modal", { state: "hidden", timeout: 10000 });

    // [Codex 4차] 정확 검증: before + 3 (절대값 아님)
    const after = await page.evaluate(({ tid, pid }) => {
      const item = window.DB.get("items", []).find((i: any) => i.id === tid);
      const pr = window.DB.get("purchase_requests", []).find((p: any) => p.id === pid);
      const logs = window.DB.get("logs", []).filter((l: any) => l.itemId === tid);
      const osanIn = logs.filter((l: any) => l.warehouse === "오산" && l.type === "입고");
      return {
        osan: item ? item.stockOsan || 0 : 0,
        siheung: item ? (item.stockSiheung !== undefined ? item.stockSiheung : item.currentStock) : 0,
        pyeongtaek: item ? item.stockPyeongtaek || 0 : 0,
        currentStock: item ? item.currentStock || 0 : 0,
        osanInCount: osanIn.length,
        latestOsanLog: osanIn[osanIn.length - 1] || null,
        prStatus: pr ? pr.status : null
      };
    }, { tid: target.id, pid: testPrId });

    expect(after.osan, "오산 = before + 3").toBe(before.osan + 3);
    expect(after.siheung, "시흥 재고 불변").toBe(before.siheung);
    expect(after.pyeongtaek, "평택 재고 불변").toBe(before.pyeongtaek);
    expect(after.currentStock, "currentStock 불변 (시흥+평택만, 오산 제외)").toBe(before.currentStock);
    expect(after.osanInCount, "오산 입고 로그 1건 증가").toBe(before.osanInLogs + 1);
    expect(after.latestOsanLog?.qty, "새 로그 qty=3").toBe(3);
    expect(after.latestOsanLog?.warehouse, "새 로그 warehouse=오산").toBe("오산");
    expect(after.latestOsanLog?.type, "새 로그 type=입고").toBe("입고");
    expect(after.prStatus, "시흥 대기 PR 미변경").toBe("대기");
  });

  test("C2a: 발주확정 + warehouse='' → 저장 거부", async ({ page }) => {
    await loginAdmin(page);
    const r = await page.evaluate(async () => {
      try {
        await window.saveOrder(
          { deliveryTo: "테스트업체", address: "테", orderDate: "2026-07-24", shipDate: "2026-07-25",
            warehouse: "", drawerItems: [], upperMaterials: [], shelfItems: [], rodItems: [] },
          "발주확정"
        );
        return { ok: true };
      } catch (e: any) {
        return { ok: false, err: e.message };
      }
    });
    expect(r.ok, "발주확정+빈창고 거부").toBe(false);
    expect(r.err, "창고 관련 에러 메시지").toMatch(/창고/);
  });

  test("C2b: 발주확정 + warehouse='오산' → 저장 거부", async ({ page }) => {
    await loginAdmin(page);
    const r = await page.evaluate(async () => {
      try {
        await window.saveOrder(
          { deliveryTo: "테스트업체", address: "테", orderDate: "2026-07-24", shipDate: "2026-07-25",
            warehouse: "오산", drawerItems: [], upperMaterials: [], shelfItems: [], rodItems: [] },
          "발주확정"
        );
        return { ok: true };
      } catch (e: any) {
        return { ok: false, err: e.message };
      }
    });
    expect(r.ok, "오산 저장 거부").toBe(false);
    expect(r.err).toMatch(/시흥|평택|오산/);
  });

  test("C3: 실제 lifecycle — invalid warehouse 주문 취소 시도 → items/logs/order 불변", async ({ page }) => {
    await loginAdmin(page);
    const target = await firstDrawerItem(page);

    // 조작: order.warehouse='오산' + oi.warehouse='오산' (양쪽 invalid) + stockDeducted=true
    // 실제 cancelOrder 호출 → _assertOrderableWarehouses throw → 어떤 mutation도 없어야
    const setup = await page.evaluate(({ tid }) => {
      const orderId = 999901;
      const orders = window.DB.get("orders", []);
      orders.push({
        id: orderId,
        orderNum: "TEST-999901",
        status: "발주확정",
        warehouse: "오산", // invalid
        stockDeducted: true,
        drawerItems: [{ itemId: tid, requiredQty: 3, warehouse: "오산", color: "" }],
        createdBy: "admin",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      window.DB.set("orders", orders);
      // 시흥 재고 스냅샷
      const item = window.DB.get("items", []).find((i: any) => i.id === tid);
      const logsBefore = window.DB.get("logs", []).length;
      return {
        orderId,
        siheungBefore: item ? item.stockSiheung || 0 : 0,
        pyeongtaekBefore: item ? item.stockPyeongtaek || 0 : 0,
        osanBefore: item ? item.stockOsan || 0 : 0,
        logsBefore
      };
    }, { tid: target.id });

    // cancelOrder 호출 — 사전 검증에서 throw 되어야
    const r = await page.evaluate(async (oid) => {
      try {
        const ok = await window.cancelOrder(oid, "테스트");
        return { threw: false, ok };
      } catch (e: any) {
        return { threw: true, err: e.message };
      }
    }, setup.orderId);

    // toast 에러로 처리됐거나 throw됐거나 — 어느 쪽이든 items·logs·order 불변이어야
    const after = await page.evaluate(({ tid, oid }) => {
      const item = window.DB.get("items", []).find((i: any) => i.id === tid);
      const order = window.DB.get("orders", []).find((o: any) => o.id === oid);
      const logsCount = window.DB.get("logs", []).length;
      return {
        siheungAfter: item ? item.stockSiheung || 0 : 0,
        pyeongtaekAfter: item ? item.stockPyeongtaek || 0 : 0,
        osanAfter: item ? item.stockOsan || 0 : 0,
        orderStatus: order ? order.status : null,
        stockDeducted: order ? order.stockDeducted : null,
        logsAfter: logsCount
      };
    }, { tid: target.id, oid: setup.orderId });

    expect(after.siheungAfter, "시흥 재고 불변").toBe(setup.siheungBefore);
    expect(after.pyeongtaekAfter, "평택 재고 불변").toBe(setup.pyeongtaekBefore);
    expect(after.osanAfter, "오산 재고 불변").toBe(setup.osanBefore);
    expect(after.logsAfter, "로그 개수 불변").toBe(setup.logsBefore);
    expect(after.orderStatus, "주문 상태 불변 (발주확정)").toBe("발주확정");
    expect(after.stockDeducted, "stockDeducted 불변 (true)").toBe(true);
  });

  test("H3: 발주자 stock-view — 오산-only 품목의 발주가능=0 + 경고 배경", async ({ page, browser }) => {
    // 관리자로 데이터 세팅 (Firestore 저장까지 대기)
    await loginAdmin(page);
    const target = await firstDrawerItem(page);

    // window._FS.set는 Firestore 서버 반영을 await
    await page.evaluate(async ({ tid, color }) => {
      const items = window.DB.get("items", []);
      const idx = items.findIndex((i: any) => i.id === tid);
      if (idx === -1) return;
      items[idx].stockSiheung = 0;
      items[idx].stockPyeongtaek = 0;
      items[idx].stockOsan = 5;
      items[idx].colorStockSiheung = {};
      items[idx].colorStockPyeongtaek = {};
      items[idx].colorStockOsan = { [color]: 5 };
      items[idx].currentStock = 0;
      // 로컬 반영 + Firestore 저장 완료 대기
      await window.DB.set("items", items);
      if (window._FS && window._FS.set) {
        await window._FS.set("items", items);
      }
    }, { tid: target.id, color: COLOR });

    // 새 context로 발주자 로그인 (admin 세션 격리)
    const ordererContext = await browser.newContext();
    const ordererPage = await ordererContext.newPage();
    await loginOrderer(ordererPage);
    page = ordererPage; // 이하 검증에 새 페이지 사용

    // 발주자 재고 현황 nav
    await page.locator('[data-nav="stock-view"]').first().click();
    await page.waitForTimeout(1500);

    const row = await page.evaluate((targetId) => {
      const r = document.querySelector(`tr.sv-item-row[data-sv-id="${targetId}"]`);
      if (!r) return null;
      const cells = r.querySelectorAll("td");
      return {
        osan: cells[3]?.textContent?.trim(),
        orderable: cells[4]?.textContent?.trim(),
        style: (r as HTMLElement).getAttribute("style") || ""
      };
    }, target.id);

    expect(row, "발주자 뷰에 대상 행 존재").not.toBeNull();
    expect(row!.orderable, "발주가능=0").toBe("0");
    expect(row!.osan, "오산=5").toBe("5");
    expect(row!.style, "경고 배경(#fef2f2)").toContain("#fef2f2");
  });

  test("H4: 관리자 재고없음 필터 실제 클릭 → 오산-only 품목 포함 + 발주가능=0", async ({ page }) => {
    await loginAdmin(page);
    const target = await firstDrawerItem(page);

    // 대상 아이템: 시흥·평택 0, 오산 7. 다른 아이템(id=2)은 정상 재고 유지 → 필터에 제외 확인용
    await page.evaluate(async ({ tid, color }) => {
      const items = window.DB.get("items", []);
      const idx = items.findIndex((i: any) => i.id === tid);
      if (idx === -1) return;
      items[idx].stockSiheung = 0;
      items[idx].stockPyeongtaek = 0;
      items[idx].stockOsan = 7;
      items[idx].colorStockSiheung = {};
      items[idx].colorStockPyeongtaek = {};
      items[idx].colorStockOsan = { [color]: 7 };
      items[idx].currentStock = 0;
      await window.DB.set("items", items);
    }, { tid: target.id, color: COLOR });

    await page.locator('[data-nav="inventory"]').first().click();
    await page.waitForTimeout(1500);

    // "재고 없음" 카드 반드시 visible 확인 후 클릭
    const zeroCard = page.locator('div[onclick*="invOnlyZero"]').filter({ hasText: "재고 없음" }).first();
    await expect(zeroCard, "재고없음 카드 표시").toBeVisible({ timeout: 5000 });
    await zeroCard.click();
    await page.waitForTimeout(1000);

    // invOnlyZero=true 확인
    const invOnlyZero = await page.evaluate(() => invOnlyZero);
    expect(invOnlyZero, "재고없음 필터 활성화").toBe(true);

    // 대상 행 포함 확인
    const check = await page.evaluate(({ targetName }) => {
      const rows = document.querySelectorAll("#inv-stock-table tbody tr.inv-main-row");
      const items = Array.from(rows).map((r) => (r as HTMLElement).textContent || "");
      const targetRow = Array.from(rows).find((r) =>
        (r as HTMLElement).textContent?.includes(targetName)
      );
      const cells = targetRow ? targetRow.querySelectorAll("td") : null;
      return {
        rowCount: rows.length,
        allNames: items.map((t) => t.slice(0, 30)),
        found: !!targetRow,
        orderable: cells ? cells[5]?.textContent?.trim() : null,
        osan: cells ? cells[4]?.textContent?.trim() : null,
        style: targetRow ? (targetRow as HTMLElement).getAttribute("style") || "" : ""
      };
    }, { targetName: target.name });

    expect(check.found, `필터 결과에 대상 행 포함 (${JSON.stringify(check.allNames)})`).toBe(true);
    expect(check.orderable, "발주가능=0").toBe("0");
    expect(check.osan, "오산=7").toBe("7");
    expect(check.style, "경고 배경(#fef2f2)").toContain("#fef2f2");

    // 정상 재고 품목(id=2, 시흥·평택 5·5)은 필터에서 제외돼야
    const otherItemName = await page.evaluate(() => {
      const items = window.DB.get("items", []).filter(
        (i: any) => i.category === "서랍장" && i.isActive && i.drawerType !== "handle" && (i.stockSiheung > 0 || i.stockPyeongtaek > 0)
      );
      return items[0] ? items[0].name : null;
    });
    if (otherItemName) {
      const excluded = !check.allNames.some((n) => n.includes(otherItemName));
      expect(excluded, `정상 재고 품목(${otherItemName})은 재고없음 필터에서 제외`).toBe(true);
    }
  });

  test("N1+N2: 신규 PR에 color 저장 + 다른 색상 입고 시 PR 자동완료 X", async ({ page }) => {
    await loginAdmin(page);
    const target = await firstDrawerItem(page);

    // 재고 0으로 만들고 saveOrder → shortage 유도 → PR 생성
    await page.evaluate(async ({ tid, color }) => {
      const items = window.DB.get("items", []);
      const idx = items.findIndex((i: any) => i.id === tid);
      if (idx === -1) return;
      items[idx].stockSiheung = 0;
      items[idx].stockPyeongtaek = 0;
      items[idx].colorStockSiheung = { [color]: 0 };
      items[idx].colorStockPyeongtaek = {};
      items[idx].currentStock = 0;
      await window.DB.set("items", items);
    }, { tid: target.id, color: COLOR });

    const saveResult = await page.evaluate(async ({ tid, color }) => {
      try {
        const r = await window.saveOrder(
          { deliveryTo: "테스트업체", address: "테스트", orderDate: "2026-07-24", shipDate: "2026-07-25",
            warehouse: "시흥", sharedColor: color,
            drawerItems: [{ itemId: tid, requiredQty: 5, color }],
            upperMaterials: [], shelfItems: [], rodItems: [] },
          "발주대기"
        );
        return { ok: true, orderId: r.orderId, shortage: r.shortageCount };
      } catch (e: any) {
        return { ok: false, err: e.message };
      }
    }, { tid: target.id, color: COLOR });

    expect(saveResult.ok, "발주대기 저장 성공").toBe(true);
    expect(saveResult.shortage, "부족 발생").toBeGreaterThan(0);

    // N1: 신규 PR color 저장 확인
    const pr = await page.evaluate((oid) => {
      const prs = window.DB.get("purchase_requests", []);
      return prs.find((p: any) => p.orderId === oid);
    }, saveResult.orderId);

    expect(pr, "PR 생성됨").toBeTruthy();
    expect(pr.color, "PR에 color 저장").toBe(COLOR);

    // N2: 다른 색상('솔리드') 입고 → PR 자동완료 X
    await page.locator('[data-nav="inventory"]').first().click();
    await page.waitForTimeout(1500);
    await page.locator(`.inv-action-btn[data-inv-id="${target.id}"][data-inv-type="입고"]`).first().click();
    await page.waitForSelector("#inv-modal", { state: "visible" });
    await page.waitForTimeout(500);
    await page.locator("#inv-wh-siheung").click();
    await fillInventoryQty(page, "솔리드", "10"); // 다른 색상
    await page.locator("#inv-submit-btn").click();
    await page.waitForTimeout(2500);

    const prAfter = await page.evaluate((oid) => {
      const prs = window.DB.get("purchase_requests", []);
      return prs.find((p: any) => p.orderId === oid);
    }, saveResult.orderId);

    expect(prAfter.status, "다른 색상 입고에 PR 대기 유지").toBe("대기");
  });

  test("N3: 입고량(3) < 부족량(10) → PR 대기 유지 (엄격 FIFO)", async ({ page }) => {
    await loginAdmin(page);
    const target = await firstDrawerItem(page);

    // 대기 PR: 시흥 + 화이트 오크 + shortage=10
    const testPrId = await page.evaluate(({ tid, color }) => {
      const prs = window.DB.get("purchase_requests", []);
      const pid = 999003;
      prs.push({
        id: pid, itemId: tid, warehouse: "시흥", color,
        shortageQty: 10, requiredQty: 10, status: "대기",
        createdAt: new Date().toISOString()
      });
      window.DB.set("purchase_requests", prs);
      return pid;
    }, { tid: target.id, color: COLOR });

    // 시흥 + 화이트 오크 + 3개만 입고 (동일 창고/색상, 수량만 부족)
    await page.locator('[data-nav="inventory"]').first().click();
    await page.waitForTimeout(1500);
    await page.locator(`.inv-action-btn[data-inv-id="${target.id}"][data-inv-type="입고"]`).first().click();
    await page.waitForSelector("#inv-modal", { state: "visible" });
    await page.waitForTimeout(500);
    await page.locator("#inv-wh-siheung").click();
    await fillInventoryQty(page, COLOR, "3");
    await page.locator("#inv-submit-btn").click();
    await page.waitForTimeout(2500);

    const status = await page.evaluate((pid) => {
      const pr = window.DB.get("purchase_requests", []).find((p: any) => p.id === pid);
      return pr ? pr.status : null;
    }, testPrId);

    expect(status, "입고량(3)<부족량(10) → PR 대기 유지").toBe("대기");
  });

  test("N4 (FIFO queue-jump 금지): 오래된 PR need=10 + 새 PR need=2 + 입고=3 → 둘 다 대기", async ({ page }) => {
    await loginAdmin(page);
    const target = await firstDrawerItem(page);

    const oldPid = 999010;
    const newPid = 999011;
    await page.evaluate(({ tid, color, oldPid, newPid }) => {
      const prs = window.DB.get("purchase_requests", []);
      const older = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const newer = new Date().toISOString();
      prs.push({ id: oldPid, itemId: tid, warehouse: "시흥", color, shortageQty: 10, requiredQty: 10, status: "대기", createdAt: older });
      prs.push({ id: newPid, itemId: tid, warehouse: "시흥", color, shortageQty: 2, requiredQty: 2, status: "대기", createdAt: newer });
      window.DB.set("purchase_requests", prs);
    }, { tid: target.id, color: COLOR, oldPid, newPid });

    // 입고 3 (엄격 FIFO: 오래된 PR 못 채우면 break — 새 PR도 자동완료 X)
    await page.locator('[data-nav="inventory"]').first().click();
    await page.waitForTimeout(1500);
    await page.locator(`.inv-action-btn[data-inv-id="${target.id}"][data-inv-type="입고"]`).first().click();
    await page.waitForSelector("#inv-modal", { state: "visible" });
    await page.waitForTimeout(500);
    await page.locator("#inv-wh-siheung").click();
    await fillInventoryQty(page, COLOR, "3");
    await page.locator("#inv-submit-btn").click();
    await page.waitForTimeout(2500);

    const statuses = await page.evaluate(({ oldPid, newPid }) => {
      const prs = window.DB.get("purchase_requests", []);
      const old = prs.find((p: any) => p.id === oldPid);
      const nw = prs.find((p: any) => p.id === newPid);
      return { oldStatus: old ? old.status : null, newStatus: nw ? nw.status : null };
    }, { oldPid, newPid });

    expect(statuses.oldStatus, "오래된 PR 대기 유지 (엄격 FIFO)").toBe("대기");
    expect(statuses.newStatus, "새 PR 대기 유지 (queue jump 금지)").toBe("대기");
  });

  test("C3+ (partial mutation 방지): 2-item 주문에서 두 번째 invalid → 첫 아이템 재고도 불변", async ({ page }) => {
    await loginAdmin(page);

    // 서랍장 품목 2개 필요 (seed에 겉서랍 2단, 속서랍 2단)
    const targets = await page.evaluate(() => {
      const items = window.DB.get("items", []).filter(
        (i: any) => i.category === "서랍장" && i.isActive && i.drawerType !== "handle"
      );
      return items.slice(0, 2).map((i: any) => ({ id: i.id, name: i.name }));
    });
    expect(targets.length, "서랍장 품목 2개 필요").toBeGreaterThanOrEqual(2);

    // baseline snapshot (2개 아이템)
    const before = await page.evaluate((ids) => {
      const items = window.DB.get("items", []);
      const logsCount = window.DB.get("logs", []).length;
      const snap = ids.map((id: number) => {
        const item = items.find((i: any) => i.id === id);
        return {
          id,
          siheung: item ? (item.stockSiheung !== undefined ? item.stockSiheung : item.currentStock) : 0,
          pyeongtaek: item ? item.stockPyeongtaek || 0 : 0,
          osan: item ? item.stockOsan || 0 : 0,
          currentStock: item ? item.currentStock || 0 : 0
        };
      });
      return { snap, logsCount };
    }, targets.map(t => t.id));

    // order.warehouse는 valid하지만 두 번째 oi.warehouse가 invalid('오산')
    // → _orderableWh(oi='오산', order='시흥') → order='시흥'로 fallback되어 통과.
    // 진짜 fail-closed 조건: oi='오산' + order='오산' 둘 다 invalid.
    const setup = await page.evaluate(async ({ tid1, tid2 }) => {
      const orderId = 999930;
      const orders = window.DB.get("orders", []);
      orders.push({
        id: orderId,
        orderNum: "TEST-C3+",
        status: "발주확정",
        warehouse: "오산", // order-level invalid (fallback도 invalid 조건 만들기 위함)
        stockDeducted: true,
        drawerItems: [
          { itemId: tid1, requiredQty: 3, warehouse: "시흥", color: "" }, // 첫 valid
          { itemId: tid2, requiredQty: 2, warehouse: "오산", color: "" }  // 두 번째 invalid + order도 invalid → throw
        ],
        createdBy: "admin",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      window.DB.set("orders", orders);
      if (window._FS && window._FS.set) await window._FS.set("orders", orders);
      return { orderId };
    }, { tid1: targets[0].id, tid2: targets[1].id });

    // cancelOrder 시도
    const call = await page.evaluate(async (oid) => {
      try {
        await window.cancelOrder(oid, "테스트");
        return { threw: false };
      } catch (e: any) {
        return { threw: true, err: e.message || String(e) };
      }
    }, setup.orderId);

    // [Codex 5차 A] 정확한 warehouse 에러 throw 확인
    expect(call.threw, "두 번째 invalid warehouse에서 throw").toBe(true);
    expect(call.err, "warehouse 사전검증 오류").toMatch(/발주 창고 데이터 오류/);

    // [Codex 5차 B] reload 전 즉시 메모리 상태 검사
    const localAfter = await page.evaluate(({ ids, oid }) => {
      const items = window.DB.get("items", []);
      const order = window.DB.get("orders", []).find((o: any) => o.id === oid);
      const logsCount = window.DB.get("logs", []).length;
      const snap = ids.map((id: number) => {
        const item = items.find((i: any) => i.id === id);
        return {
          id,
          siheung: item
            ? (item.stockSiheung !== undefined
                ? item.stockSiheung
                : item.currentStock)
            : 0,
          pyeongtaek: item ? item.stockPyeongtaek || 0 : 0,
          osan: item ? item.stockOsan || 0 : 0,
          currentStock: item ? item.currentStock || 0 : 0
        };
      });
      return {
        snap, logsCount,
        orderStatus: order ? order.status : null,
        stockDeducted: order ? order.stockDeducted : null
      };
    }, { ids: targets.map(t => t.id), oid: setup.orderId });

    for (let i = 0; i < 2; i++) {
      expect(localAfter.snap[i].siheung, `[memory][${targets[i].name}] 시흥 불변`).toBe(before.snap[i].siheung);
      expect(localAfter.snap[i].pyeongtaek, `[memory][${targets[i].name}] 평택 불변`).toBe(before.snap[i].pyeongtaek);
      expect(localAfter.snap[i].osan, `[memory][${targets[i].name}] 오산 불변`).toBe(before.snap[i].osan);
      expect(localAfter.snap[i].currentStock, `[memory][${targets[i].name}] currentStock 불변`).toBe(before.snap[i].currentStock);
    }
    expect(localAfter.logsCount, "[memory] logs 불변").toBe(before.logsCount);
    expect(localAfter.orderStatus, "[memory] order status 불변").toBe("발주확정");
    expect(localAfter.stockDeducted, "[memory] stockDeducted 불변").toBe(true);

    // [Codex 5차 C] 새로고침 후 Firestore reload — 실제 저장 여부 재검증
    await page.reload();
    await page.waitForSelector("[data-nav]", { timeout: 15000 });
    await page.waitForFunction(() => {
      const w: any = window as any;
      return w.DB && w.DB.get && w.DB.get("items", []).length > 0;
    }, { timeout: 15000 });

    const after = await page.evaluate(({ ids, oid }) => {
      const items = window.DB.get("items", []);
      const order = window.DB.get("orders", []).find((o: any) => o.id === oid);
      const logsCount = window.DB.get("logs", []).length;
      const snap = ids.map((id: number) => {
        const item = items.find((i: any) => i.id === id);
        return {
          id,
          siheung: item ? (item.stockSiheung !== undefined ? item.stockSiheung : item.currentStock) : 0,
          pyeongtaek: item ? item.stockPyeongtaek || 0 : 0,
          osan: item ? item.stockOsan || 0 : 0,
          currentStock: item ? item.currentStock || 0 : 0
        };
      });
      return {
        snap, logsCount,
        orderStatus: order ? order.status : null,
        stockDeducted: order ? order.stockDeducted : null
      };
    }, { ids: targets.map(t => t.id), oid: setup.orderId });

    // 두 아이템 모두 불변 (partial mutation 없음)
    for (let i = 0; i < 2; i++) {
      expect(after.snap[i].siheung, `[${targets[i].name}] 시흥 불변 (reload 후)`).toBe(before.snap[i].siheung);
      expect(after.snap[i].pyeongtaek, `[${targets[i].name}] 평택 불변`).toBe(before.snap[i].pyeongtaek);
      expect(after.snap[i].osan, `[${targets[i].name}] 오산 불변`).toBe(before.snap[i].osan);
      expect(after.snap[i].currentStock, `[${targets[i].name}] currentStock 불변`).toBe(before.snap[i].currentStock);
    }
    expect(after.logsCount, "logs 개수 불변").toBe(before.logsCount);
    expect(after.orderStatus, "주문 상태 발주확정 유지").toBe("발주확정");
    expect(after.stockDeducted, "stockDeducted 유지").toBe(true);
  });

  test("C2c (getNextIds 미호출): 빈 warehouse 발주확정 거부 시 서버 ID 발급 함수 0회 호출", async ({ page }) => {
    await loginAdmin(page);

    // Codex 4차: 실제 window._FN.getNextIds spy로 callCount 검증
    const r = await page.evaluate(async () => {
      const fn: any = window._FN;
      if (!fn || typeof fn.getNextIds !== "function") {
        return { ok: false, err: "window._FN.getNextIds 없음" };
      }
      const original = fn.getNextIds;
      let callCount = 0;
      fn.getNextIds = async (...args: any[]) => {
        callCount++;
        return original.apply(fn, args);
      };
      const ordersBefore = window.DB.get("orders", []).length;
      let saveErr: string | null = null;
      try {
        await window.saveOrder(
          {
            deliveryTo: "테스트업체", address: "테",
            orderDate: "2026-07-24", shipDate: "2026-07-25",
            warehouse: "",
            drawerItems: [], upperMaterials: [], shelfItems: [], rodItems: []
          },
          "발주확정"
        );
      } catch (e: any) {
        saveErr = e.message || String(e);
      } finally {
        fn.getNextIds = original; // 원본 복원 (bound wrapper 아님)
      }
      const ordersAfter = window.DB.get("orders", []).length;
      return {
        ok: true,
        saveErr,
        callCount,
        ordersBefore,
        ordersAfter
      };
    });

    expect(r.ok, "getNextIds spy 세팅").toBe(true);
    expect(r.saveErr, "saveOrder 거부됨").toMatch(/창고/);
    expect(r.callCount, "getNextIds 호출 0회 (검증이 서버 ID 발급 전에)").toBe(0);
    expect(r.ordersAfter, "orders 개수 불변").toBe(r.ordersBefore);
  });

  test("OPT-M1: 활성 옵션만 자동 재고 관리 전환 + 창고별 초기 재고 0", async ({ page }) => {
    await loginAdmin(page);

    const result = await page.evaluate(async () => {
      const items = window.DB.get("items", []);
      items.push(
        { id: 98991, name: "활성 옵션 마이그레이션", category: "옵션", isActive: true, currentStock: 99 },
        { id: 98992, name: "비활성 옵션 마이그레이션", category: "옵션", isActive: false, currentStock: 99 },
        { id: 98996, name: "이불장손잡이(1구)", category: "옵션", isActive: true, trackStock: true, currentStock: 99 }
      );
      await window.DB.set("items", items);
      initData();
      const migrated = window.DB.get("items", []);
      return {
        active: migrated.find((i: any) => i.id === 98991),
        inactive: migrated.find((i: any) => i.id === 98992),
        excluded: migrated.find((i: any) => i.name === "이불장손잡이(1구)")
      };
    });

    expect(result.active.trackStock).toBe(true);
    expect(result.active.stockSiheung).toBe(0);
    expect(result.active.stockPyeongtaek).toBe(0);
    expect(result.active.stockOsan).toBe(0);
    expect(result.active.colorStockSiheung).toEqual({});
    expect(result.active.currentStock).toBe(0);
    expect(result.inactive.trackStock, "비활성 옵션은 재고 관리 제외").toBeUndefined();
    expect(result.excluded.trackStock, "이불장손잡이(1구)는 재고 관리 제외").toBe(false);
  });

  test("OPT-M2: 재고 관리 표에 옵션 표시 + 서랍장 뒤 정렬", async ({ page }) => {
    await loginAdmin(page);
    await page.evaluate(async () => {
      const items = window.DB.get("items", []);
      items.push({
        id: 98993,
        name: "재고표 옵션 테스트",
        category: "옵션",
        isActive: true,
        trackStock: true,
        currentStock: 0,
        stockSiheung: 0,
        stockPyeongtaek: 0,
        stockOsan: 0,
        colorStockSiheung: {},
        colorStockPyeongtaek: {},
        colorStockOsan: {}
      });
      await window.DB.set("items", items);
    });

    await page.locator('[data-nav="inventory"]').first().click();
    await page.waitForSelector("#inv-stock-table");
    const names = await page.locator("#inv-stock-table tr.inv-main-row .td-name").allTextContents();
    const drawerIndex = names.findIndex((name) => name.includes("겉서랍 2단"));
    const optionIndex = names.findIndex((name) => name.includes("재고표 옵션 테스트"));
    expect(drawerIndex).toBeGreaterThanOrEqual(0);
    expect(optionIndex).toBeGreaterThan(drawerIndex);
  });

  test("OPT-M3: 옵션 재고 부족 발주 → 부족량 기준 PR 자동 생성", async ({ page }) => {
    await loginAdmin(page);
    const result = await page.evaluate(async () => {
      const itemId = 98994;
      const items = window.DB.get("items", []);
      items.push({
        id: itemId,
        name: "옵션 부족 PR 테스트",
        category: "옵션",
        isActive: true,
        trackStock: true,
        currentStock: 1,
        stockSiheung: 1,
        stockPyeongtaek: 0,
        stockOsan: 0,
        colorStockSiheung: {},
        colorStockPyeongtaek: {},
        colorStockOsan: {}
      });
      await window.DB.set("items", items);
      const saved = await window.saveOrder(
        {
          deliveryTo: "옵션 PR 테스트",
          address: "테스트",
          orderDate: "2026-07-28",
          shipDate: "2026-07-29",
          warehouse: "시흥",
          drawerItems: [{ itemId, requiredQty: 5, color: "" }],
          upperMaterials: [],
          shelfItems: [],
          rodItems: []
        },
        "발주대기"
      );
      const pr = window.DB.get("purchase_requests", []).find(
        (p: any) => p.orderId === saved.orderId && p.itemId === itemId
      );
      return { shortageCount: saved.shortageCount, shortageQty: pr?.shortageQty };
    });

    expect(result.shortageCount).toBe(1);
    expect(result.shortageQty).toBe(4);
  });

  test("OPT-M4: 무색 옵션은 공통 색상이 있어도 창고 합계 재고로 차감", async ({ page }) => {
    await loginAdmin(page);

    const result = await page.evaluate(async () => {
      const itemId = 98995;
      const items = window.DB.get("items", []);
      items.push({
        id: itemId,
        name: "무색 옵션 차감 테스트",
        category: "옵션",
        isActive: true,
        trackStock: true,
        noColor: true,
        currentStock: 10,
        stockSiheung: 10,
        stockPyeongtaek: 0,
        stockOsan: 0,
        colorStockSiheung: {},
        colorStockPyeongtaek: {},
        colorStockOsan: {}
      });
      await window.DB.set("items", items);

      const saved = await window.saveOrder(
        {
          deliveryTo: "무색 옵션 차감 테스트",
          address: "테스트",
          orderDate: "2026-07-28",
          shipDate: "2026-07-29",
          warehouse: "시흥",
          sharedColor: "화이트 오크",
          drawerItems: [{ itemId, requiredQty: 3, color: "" }],
          upperMaterials: [],
          shelfItems: [],
          rodItems: []
        },
        "발주대기"
      );

      const item = window.DB.get("items", []).find((i: any) => i.id === itemId);
      const order = window.DB.get("orders", []).find((o: any) => o.id === saved.orderId);
      const line = order?.drawerItems?.[0];
      return {
        stockSiheung: item?.stockSiheung,
        currentStock: item?.currentStock,
        colorMap: item?.colorStockSiheung,
        lineColor: line?.color
      };
    });

    expect(result.stockSiheung).toBe(7);
    expect(result.currentStock).toBe(7);
    expect(result.colorMap).toEqual({});
    expect(result.lineColor).toBe("");
  });

  test("OPT-R1: 신규 재고 추적 옵션 발주 취소 → 실제 차감분만 10→7→10 복구", async ({ page }) => {
    await loginAdmin(page);

    const result = await page.evaluate(async () => {
      const itemId = 99001;
      const items = window.DB.get("items", []);
      items.push({
        id: itemId,
        name: "옵션 롤백 테스트",
        category: "옵션",
        isActive: true,
        trackStock: true,
        currentStock: 10,
        stockSiheung: 10,
        stockPyeongtaek: 0,
        stockOsan: 0,
        colorStockSiheung: {},
        colorStockPyeongtaek: {},
        colorStockOsan: {}
      });
      await window.DB.set("items", items);

      const saved = await window.saveOrder(
        {
          deliveryTo: "옵션 롤백 테스트",
          address: "테스트",
          orderDate: "2026-07-28",
          shipDate: "2026-07-29",
          warehouse: "시흥",
          drawerItems: [{ itemId, requiredQty: 3, color: "" }],
          upperMaterials: [],
          shelfItems: [],
          rodItems: []
        },
        "발주대기"
      );

      const afterSave = window.DB.get("items", []).find((i: any) => i.id === itemId)?.stockSiheung;
      const savedOrder = window.DB.get("orders", []).find((o: any) => o.id === saved.orderId);
      const savedLine = savedOrder?.drawerItems?.[0];
      const trackedAtSave = savedLine?.inventoryTracked;
      const deductedAtSave = savedLine?.inventoryDeducted;

      await window.cancelOrder(saved.orderId, "옵션 롤백 회귀");

      const afterCancel = window.DB.get("items", []).find((i: any) => i.id === itemId)?.stockSiheung;
      const cancelledOrder = window.DB.get("orders", []).find((o: any) => o.id === saved.orderId);
      return {
        afterSave,
        afterCancel,
        trackedAtSave,
        deductedAtSave,
        deductedAfterCancel: cancelledOrder?.drawerItems?.[0]?.inventoryDeducted
      };
    });

    expect(result.afterSave, "옵션 재고 차감").toBe(7);
    expect(result.afterCancel, "취소 시 옵션 재고 복구").toBe(10);
    expect(result.trackedAtSave, "신규 행 재고 추적 표식").toBe(true);
    expect(result.deductedAtSave, "신규 행 실제 차감 표식").toBe(true);
    expect(result.deductedAfterCancel, "취소 후 차감 상태 해제").toBe(false);
  });

  test("OPT-R2: 표식 없는 과거 옵션 주문 취소 → 차감 이력 없으므로 재고 불변", async ({ page }) => {
    await loginAdmin(page);

    const result = await page.evaluate(async () => {
      const itemId = 99002;
      const orderId = 99003;
      const items = window.DB.get("items", []);
      items.push({
        id: itemId,
        name: "과거 옵션 주문 테스트",
        category: "옵션",
        isActive: true,
        trackStock: true,
        currentStock: 10,
        stockSiheung: 10,
        stockPyeongtaek: 0,
        stockOsan: 0,
        colorStockSiheung: {},
        colorStockPyeongtaek: {},
        colorStockOsan: {}
      });
      await window.DB.set("items", items);

      const orders = window.DB.get("orders", []);
      orders.push({
        id: orderId,
        orderNum: "LEGACY-OPTION-ROLLBACK",
        status: "발주대기",
        stockDeducted: true,
        warehouse: "시흥",
        createdBy: "admin",
        createdAt: "2026-07-01T00:00:00.000Z",
        statusHistory: [{ status: "발주대기", changedAt: "2026-07-01T00:00:00.000Z" }],
        drawerItems: [{
          id: 99004,
          orderId,
          itemId,
          requiredQty: 3,
          color: "",
          warehouse: "시흥"
        }]
      });
      await window.DB.set("orders", orders);

      const before = window.DB.get("items", []).find((i: any) => i.id === itemId)?.stockSiheung;
      await window.cancelOrder(orderId, "과거 주문 취소");
      const after = window.DB.get("items", []).find((i: any) => i.id === itemId)?.stockSiheung;
      return { before, after };
    });

    expect(result.before, "취소 전 옵션 재고").toBe(10);
    expect(result.after, "과거 미차감 옵션은 허위 롤백 금지").toBe(10);
  });

  test("OPT-V1: noColor option confirm modal does not require shared color and still shows shortage", async ({ page }) => {
    await loginAdmin(page);
    await page.waitForFunction(() => {
      const w: any = window as any;
      return typeof w.openOrderConfirmModal === "function" && w.DB && typeof w.DB.get === "function";
    }, { timeout: 10000 });

    const result = await evaluateWithNavigationRetry(page, async () => {
      const itemId = 99010;
      const items = window.DB.get("items", []);
      items.push({
        id: itemId,
        name: "OPT confirm noColor shortage",
        category: "옵션",
        isActive: true,
        trackStock: true,
        noColor: true,
        currentStock: 0,
        stockSiheung: 0,
        stockPyeongtaek: 0,
        stockOsan: 0,
        colorStockSiheung: {},
        colorStockPyeongtaek: {},
        colorStockOsan: {}
      });
      await window.DB.set("items", items);

      const oldToast = window.toast;
      const oldRender = window.renderOrderDocument;
      const oldOpen = window.openModal;
      const oldClose = window.closeModal;
      const oldSubmit = window.submitOrder;
      const oldIsAdmin = window.isAdmin;
      const toastCalls: string[] = [];
      const opened: string[] = [];

      document.body.innerHTML = `
        <input id="o-delivery-to" value="tester">
        <input id="o-address" value="addr">
        <input id="o-date" value="2026-07-28">
        <input id="o-ship-date" value="2026-07-29">
        <select id="o-warehouse"><option value="시흥" selected>시흥</option></select>
        <select id="shared-color-sel"><option value="" selected></option></select>
        <input id="upper-common-color" value="">
        <input id="o-drawer-memo" value="">
        <input id="o-etc-memo" value="">
        <input id="o-note" value="">
        <table><tbody><tr>
          <td><input class="drawer-qty" data-item-id="${itemId}" data-item-name="OPT confirm noColor shortage" data-stock="0" data-tracks-stock="true" value="2"></td>
        </tr></tbody></table>
        <div id="order-confirm-body"></div>
        <button id="order-confirm-ok-btn"></button>
      `;

      window.rodEntries = [];
      window.shelfRowEntries = [];
      window.cornerEntries = [];
      window.toast = (msg: string) => { toastCalls.push(String(msg)); };
      window.renderOrderDocument = () => "<div>preview</div>";
      window.openModal = (id: string) => { opened.push(id); };
      window.closeModal = () => {};
      window.submitOrder = () => {};
      window.isAdmin = () => true;

      try {
        window.openOrderConfirmModal();
        return {
          toastCalls,
          opened,
          bodyText: document.getElementById("order-confirm-body")?.textContent || ""
        };
      } finally {
        window.toast = oldToast;
        window.renderOrderDocument = oldRender;
        window.openModal = oldOpen;
        window.closeModal = oldClose;
        window.submitOrder = oldSubmit;
        window.isAdmin = oldIsAdmin;
      }
    });

    expect(result.toastCalls, "noColor 옵션은 공통색 미선택 toast가 없어야 함").toEqual([]);
    expect(result.opened).toContain("order-confirm-modal");
    expect(result.bodyText).toContain("OPT confirm noColor shortage");
    expect(result.bodyText).toContain("2");
  });

  test("OPT-X1: inventory Excel export includes tracked option items", async ({ page }) => {
    await loginAdmin(page);

    const result = await page.evaluate(async () => {
      const itemId = 99020;
      const items = window.DB.get("items", []);
      items.push({
        id: itemId,
        name: "OPT excel tracked option",
        category: "옵션",
        isActive: true,
        trackStock: true,
        currentStock: 4,
        stockSiheung: 4,
        stockPyeongtaek: 0,
        stockOsan: 1,
        colorStockSiheung: {},
        colorStockPyeongtaek: {},
        colorStockOsan: {}
      });
      await window.DB.set("items", items);

      const oldXLSX = window.XLSX;
      const oldDownload = window.xlsxDownload;
      const oldToast = window.toast;
      let captured: any[][] | null = null;
      window.XLSX = {
        utils: {
          book_new: () => ({}),
          aoa_to_sheet: (rows: any[][]) => {
            captured = rows;
            return {};
          },
          encode_cell: ({ r, c }: { r: number; c: number }) => `${r}:${c}`,
          book_append_sheet: () => {}
        }
      };
      window.xlsxDownload = () => {};
      window.toast = () => {};

      try {
        window.downloadInventoryExcel();
        const row = captured?.find((r) => r[0] === "OPT excel tracked option");
        return { found: !!row, row };
      } finally {
        window.XLSX = oldXLSX;
        window.xlsxDownload = oldDownload;
        window.toast = oldToast;
      }
    });

    expect(result.found).toBe(true);
    expect(result.row?.slice(0, 8)).toEqual([
      "OPT excel tracked option",
      "옵션",
      "-",
      4,
      0,
      1,
      4,
      5
    ]);
  });

  test("INV-G1: stale local items cannot overwrite newer server inventory", async ({ page }) => {
    await loginAdmin(page);

    const result = await page.evaluate(async () => {
      const oldFS = window._FS;
      const prev = [
        { id: 99101, name: "guard local changed", category: "서랍장", isActive: true, stockSiheung: 10, stockPyeongtaek: 0, currentStock: 10 },
        { id: 99102, name: "guard server newer", category: "서랍장", isActive: true, stockSiheung: 5, stockPyeongtaek: 0, currentStock: 5 }
      ];
      const server = [
        { id: 99101, name: "guard local changed", category: "서랍장", isActive: true, stockSiheung: 10, stockPyeongtaek: 0, currentStock: 10 },
        { id: 99102, name: "guard server newer", category: "서랍장", isActive: true, stockSiheung: 99, stockPyeongtaek: 0, currentStock: 99 }
      ];
      const next = [
        { ...prev[0], stockSiheung: 7, currentStock: 7 },
        { ...prev[1] }
      ];
      let written: any[] | null = null;
      window._mem.items = prev;
      window._FS = {
        ...oldFS,
        get: async (key: string) => key === "items" ? server : oldFS.get(key),
        set: async (key: string, value: any) => {
          if (key === "items") written = value;
          else await oldFS.set(key, value);
        }
      };
      try {
        await window.DB.set("items", next);
        const byId = new Map((written || []).map((i: any) => [i.id, i]));
        return {
          localChanged: byId.get(99101)?.stockSiheung,
          serverNewerPreserved: byId.get(99102)?.stockSiheung
        };
      } finally {
        window._FS = oldFS;
      }
    });

    expect(result.localChanged).toBe(7);
    expect(result.serverNewerPreserved).toBe(99);
  });

  test("INV-G2: items save is blocked when server items cannot be read", async ({ page }) => {
    await loginAdmin(page);

    const result = await page.evaluate(async () => {
      const oldFS = window._FS;
      const prev = [{ id: 99201, name: "guard fail closed", category: "서랍장", isActive: true, stockSiheung: 10 }];
      const next = [{ ...prev[0], stockSiheung: 1 }];
      let setCalled = false;
      let err = "";
      window._mem.items = prev;
      window._FS = {
        ...oldFS,
        get: async (key: string) => key === "items" ? null : oldFS.get(key),
        set: async (key: string, value: any) => {
          if (key === "items") setCalled = true;
          else await oldFS.set(key, value);
        }
      };
      try {
        await window.DB.set("items", next);
      } catch (e: any) {
        err = e?.message || String(e);
      } finally {
        window._FS = oldFS;
      }
      return { setCalled, err, memStock: window._mem.items?.[0]?.stockSiheung };
    });

    expect(result.setCalled).toBe(false);
    expect(result.err).toContain("items");
    expect(result.memStock).toBe(10);
  });

  test("SEC-P1: orderer cannot forge proxy order by calling saveOrder directly", async ({ page }) => {
    await loginOrderer(page);

    const result = await page.evaluate(async () => {
      try {
        await window.saveOrder({
          deliveryTo: "위조 대리발주",
          address: "테스트 주소",
          orderDate: "2026-07-31",
          shipDate: "2026-08-01",
          warehouse: "시흥",
          drawerItems: [],
          upperMaterials: [],
          shelfItems: [],
          rodItems: [],
          proxyOrdererId: "orderer",
          proxyCreatedByAdmin: true,
          proxyOrdererName: "위조 업체",
        }, "발주대기");
        return { ok: true, message: "" };
      } catch (e: any) {
        return { ok: false, message: String(e && e.message || e) };
      }
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("관리자");
  });

  test("SEC-P2: admin can create proxy order and owner is proxy orderer", async ({ page }) => {
    await loginAdmin(page);

    const result = await evaluateWithNavigationRetry(page, async () => {
      const saved = await window.saveOrder({
        deliveryTo: "대리 발주 테스트 업체",
        address: "테스트 주소",
        orderDate: "2026-07-31",
        shipDate: "2026-08-01",
        warehouse: "시흥",
        drawerItems: [],
        upperMaterials: [],
        shelfItems: [],
        rodItems: [],
        proxyOrdererId: "orderer",
        proxyCreatedByAdmin: true,
        proxyOrdererName: "대리 발주 테스트 업체",
      }, "임시저장");
      const order = window.DB.get("orders", []).find((o: any) => o.id === saved.orderId);
      return {
        createdBy: order?.createdBy,
        proxyCreatedByAdmin: order?.proxyCreatedByAdmin,
      };
    });

    expect(result.createdBy).toBe("orderer");
    expect(result.proxyCreatedByAdmin).toBe(true);
  });

  test("EDIT-S1: opening edit modal does not rollback deducted inventory until save", async ({ page }) => {
    await loginAdmin(page);

    const result = await page.evaluate(async () => {
      const itemId = 99100;
      const items = window.DB.get("items", []);
      items.push({
        id: itemId,
        name: "EDIT no premature rollback option",
        category: "옵션",
        isActive: true,
        trackStock: true,
        noColor: true,
        currentStock: 10,
        stockSiheung: 10,
        stockPyeongtaek: 0,
        stockOsan: 0,
        colorStockSiheung: {},
        colorStockPyeongtaek: {},
        colorStockOsan: {},
      });
      await window.DB.set("items", items);

      const saved = await window.saveOrder({
        deliveryTo: "수정 진입 재고 테스트",
        address: "테스트 주소",
        orderDate: "2026-07-31",
        shipDate: "2026-08-01",
        warehouse: "시흥",
        drawerItems: [{ itemId, requiredQty: 3, color: "" }],
        upperMaterials: [],
        shelfItems: [],
        rodItems: [],
      }, "발주대기");

      const afterSave = window.DB.get("items", []).find((i: any) => i.id === itemId)?.stockSiheung;
      await window.openEditOrder(saved.orderId);
      await new Promise((resolve) => setTimeout(resolve, 400));
      const afterOpenEdit = window.DB.get("items", []).find((i: any) => i.id === itemId)?.stockSiheung;
      return { afterSave, afterOpenEdit };
    });

    expect(result.afterSave).toBe(7);
    expect(result.afterOpenEdit).toBe(7);
  });

  test("EDIT-S2: edit save applies only the difference between old and new quantities", async ({ page }) => {
    await loginAdmin(page);

    const result = await page.evaluate(async () => {
      const itemId = 99101;
      const items = window.DB.get("items", []);
      items.push({
        id: itemId,
        name: "EDIT diff only option",
        category: "옵션",
        isActive: true,
        trackStock: true,
        noColor: true,
        currentStock: 10,
        stockSiheung: 10,
        stockPyeongtaek: 0,
        stockOsan: 0,
        colorStockSiheung: {},
        colorStockPyeongtaek: {},
        colorStockOsan: {},
      });
      await window.DB.set("items", items);

      const first = await window.saveOrder({
        deliveryTo: "수정 저장 차이 테스트",
        address: "테스트 주소",
        orderDate: "2026-07-31",
        shipDate: "2026-08-01",
        warehouse: "시흥",
        drawerItems: [{ itemId, requiredQty: 3, color: "" }],
        upperMaterials: [],
        shelfItems: [],
        rodItems: [],
      }, "발주대기");

      const order = window.DB.get("orders", []).find((o: any) => o.id === first.orderId);
      const afterFirst = window.DB.get("items", []).find((i: any) => i.id === itemId)?.stockSiheung;
      const beforeCount = window.DB.get("orders", []).length;
      window._editOverride = {
        id: order.id,
        orderNum: order.orderNum,
        status: order.status,
        createdAt: order.createdAt,
        createdBy: order.createdBy,
        isLocked: order.isLocked,
      };

      await window.saveOrder({
        deliveryTo: "수정 저장 차이 테스트",
        address: "테스트 주소",
        orderDate: "2026-07-31",
        shipDate: "2026-08-01",
        warehouse: "시흥",
        drawerItems: [{ itemId, requiredQty: 1, color: "" }],
        upperMaterials: [],
        shelfItems: [],
        rodItems: [],
      }, "발주대기");

      const afterEdit = window.DB.get("items", []).find((i: any) => i.id === itemId)?.stockSiheung;
      const afterCount = window.DB.get("orders", []).length;
      return { afterFirst, afterEdit, beforeCount, afterCount };
    });

    expect(result.afterFirst).toBe(7);
    expect(result.afterEdit).toBe(9);
    expect(result.afterCount).toBe(result.beforeCount);
  });

  test("DRAFT-R1: orderer opening new order can restore latest temporary draft", async ({ page }) => {
    await loginOrderer(page);

    const result = await page.evaluate(async () => {
      const saved = await window.saveOrder({
        deliveryTo: "임시저장 복구 테스트 업체",
        address: "임시저장 복구 주소",
        orderDate: "2026-07-31",
        shipDate: "",
        warehouse: "",
        note: "DRAFT_RESTORE_MARKER",
        drawerItems: [],
        upperMaterials: [],
        shelfItems: [],
        rodItems: [],
      }, "임시저장");

      const oldConfirm = window.confirm;
      window.confirm = () => true;
      try {
        window.openOrderModal();
        await new Promise((resolve) => setTimeout(resolve, 500));
        return {
          orderId: saved.orderId,
          note: (document.getElementById("o-note") as HTMLInputElement | null)?.value || "",
          address: (document.getElementById("o-address") as HTMLInputElement | null)?.value || "",
        };
      } finally {
        window.confirm = oldConfirm;
      }
    });

    expect(result.note).toContain("DRAFT_RESTORE_MARKER");
    expect(result.address).toContain("임시저장 복구 주소");
  });

  test("GUARD-S1: saveOrder blocks when server inventory changed after local view", async ({ page }) => {
    await loginAdmin(page);

    const result = await page.evaluate(async () => {
      const itemId = 99300;
      const items = window.DB.get("items", []);
      items.push({
        id: itemId,
        name: "stale server inventory guard",
        category: "옵션",
        isActive: true,
        trackStock: true,
        noColor: true,
        currentStock: 10,
        stockSiheung: 10,
        stockPyeongtaek: 0,
        stockOsan: 0,
        colorStockSiheung: {},
        colorStockPyeongtaek: {},
        colorStockOsan: {},
      });
      await window.DB.set("items", items);

      const oldFS = window._FS;
      const serverItems = window.DB.get("items", []).map((i: any) =>
        i.id === itemId ? { ...i, currentStock: 5, stockSiheung: 5 } : i
      );
      let err = "";
      window._FS = {
        ...oldFS,
        get: async (key: string) => key === "items" ? serverItems : oldFS.get(key),
      };
      try {
        await window.saveOrder({
          deliveryTo: "동시 저장 방어 테스트",
          address: "테스트 주소",
          orderDate: "2026-07-31",
          shipDate: "2026-08-01",
          warehouse: "시흥",
          drawerItems: [{ itemId, requiredQty: 1, color: "" }],
          upperMaterials: [],
          shelfItems: [],
          rodItems: [],
        }, "발주대기");
      } catch (e: any) {
        err = String(e && e.message || e);
      } finally {
        window._FS = oldFS;
      }
      return {
        err,
        localStock: window.DB.get("items", []).find((i: any) => i.id === itemId)?.stockSiheung,
        orderCreated: window.DB.get("orders", []).some((o: any) => o.deliveryTo === "동시 저장 방어 테스트"),
      };
    });

    expect(result.err).toContain("재고가 변경");
    expect(result.localStock).toBe(10);
    expect(result.orderCreated).toBe(false);
  });

  test("GUARD-C1: cancelOrder skips rollback when server order is already cancelled", async ({ page }) => {
    await loginAdmin(page);

    const result = await page.evaluate(async () => {
      const itemId = 99301;
      const items = window.DB.get("items", []);
      items.push({
        id: itemId,
        name: "double cancel guard option",
        category: "옵션",
        isActive: true,
        trackStock: true,
        noColor: true,
        currentStock: 10,
        stockSiheung: 10,
        stockPyeongtaek: 0,
        stockOsan: 0,
        colorStockSiheung: {},
        colorStockPyeongtaek: {},
        colorStockOsan: {},
      });
      await window.DB.set("items", items);
      const saved = await window.saveOrder({
        deliveryTo: "중복 취소 방어 테스트",
        address: "테스트 주소",
        orderDate: "2026-07-31",
        shipDate: "2026-08-01",
        warehouse: "시흥",
        drawerItems: [{ itemId, requiredQty: 3, color: "" }],
        upperMaterials: [],
        shelfItems: [],
        rodItems: [],
      }, "발주대기");
      const afterSave = window.DB.get("items", []).find((i: any) => i.id === itemId)?.stockSiheung;

      const oldFS = window._FS;
      const serverOrders = window.DB.get("orders", []).map((o: any) =>
        o.id === saved.orderId ? { ...o, status: "취소", stockDeducted: false } : o
      );
      let cancelResult: any = null;
      window._FS = {
        ...oldFS,
        get: async (key: string) => key === "orders" ? serverOrders : oldFS.get(key),
      };
      try {
        cancelResult = await window.cancelOrder(saved.orderId, "중복 취소 방어");
      } finally {
        window._FS = oldFS;
      }
      const afterCancelAttempt = window.DB.get("items", []).find((i: any) => i.id === itemId)?.stockSiheung;
      return { afterSave, afterCancelAttempt, cancelResult };
    });

    expect(result.afterSave).toBe(7);
    expect(result.afterCancelAttempt).toBe(7);
    expect(result.cancelResult).toBe(false);
  });
});
