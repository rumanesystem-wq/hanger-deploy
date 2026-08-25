// order-save-flow.spec.ts
// 유케이 07-08 사고 재발 방지 회귀 — 발주 저장 흐름 전체 검증
// 대상: 로컬 도커 에뮬레이터 (localhost:15050) — 운영 절대 안 건드림
// S1: 발주자 저장 → 관리자 화면 노출
// S2: 관리자 발주서 수정 저장 → 발주서 사라지거나 중복 안 됨

import { test, expect, Page } from "@playwright/test";
import { resetAndSeed } from "../helpers/emu-reset";

// 이 파일 전체: 발주 저장 흐름은 서버 저장 완료를 await로 대기하므로 (평상시 즉시, 실패 시 최대 10초)
// 각 테스트에 여유 시간 제공
test.setTimeout(90_000);

async function loginAs(page: Page, tab: "orderer" | "admin", id: string, pw: string) {
  const loginScreen = page.locator('#login-screen.active');
  if (!await loginScreen.isVisible().catch(() => false)) {
    await page.goto("/");
  }
  // DOM 존재 여부가 아니라 실제 로그인 화면 노출까지 기다린다.
  await page.waitForSelector('#login-screen.active', { state: 'visible', timeout: 15000 });
  await page.waitForTimeout(500);
  await page.locator(`#tab-${tab}`).click();
  await page.fill("#login-id", id);
  await page.fill("#login-pw", pw);
  await page.locator('button[onclick="doLogin()"]').click();
  await page.waitForSelector('[data-nav]', { timeout: 15000 });
  // 로그인 후 데이터 sync 여유 (accounts/items 로드)
  await page.waitForTimeout(1500);
}

async function logout(page: Page) {
  const didLogout = await page.evaluate(() => {
    const fn = (window as any).doLogout;
    if (typeof fn !== 'function') return false;
    fn();
    return true;
  }).catch(() => false);
  if (!didLogout) {
    await page.evaluate(() => {
      try { localStorage.clear(); sessionStorage.clear(); } catch (_) {}
    });
    await page.goto("/");
  }
  await page.waitForSelector('#login-screen.active', { state: 'visible', timeout: 10000 });
}

// 최소 유효 발주서 하나 만들기 (발주자 로그인 후 호출 — 세션 유지 상태 가정 X, 내부에서 로그인)
async function setFirstVisibleDrawerQty(page: Page, qty: string) {
  const result = await page.evaluate((value) => {
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("#drawer-body .drawer-qty"));
    const input = inputs.find((el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return !el.disabled && style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    });
    if (!input) return { ok: false, count: inputs.length, value: "" };

    input.focus();
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.blur();

    return { ok: true, count: inputs.length, id: input.id, value: input.value };
  }, qty);

  expect(result.ok, `수량 입력 가능한 서랍장/옵션 칸을 찾아야 함: ${JSON.stringify(result)}`).toBe(true);
  expect(result.value, `수량 입력값이 유지되어야 함: ${JSON.stringify(result)}`).toBe(qty);
}

async function createTestOrderAsOrderer(page: Page) {
  await loginAs(page, "orderer", "orderer", "123456");

  const ordersNav = page.locator('[data-nav="orders"]').first();
  if (await ordersNav.count() > 0) await ordersNav.click().catch(() => {});
  await page.waitForSelector("#new-order-btn", { timeout: 10000 });
  await page.locator("#new-order-btn").click();
  await page.waitForSelector("#order-modal", { state: "visible", timeout: 5000 });

  const today = new Date();
  const y = String(today.getFullYear());
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");

  await page.fill("#o-date-y", y);
  await page.fill("#o-date-m", m);
  await page.fill("#o-date-d", d);
  await page.fill("#o-ship-y", y);
  await page.fill("#o-ship-m", m);
  await page.fill("#o-ship-d", d);

  await page.selectOption("#o-warehouse", "시흥");

  const upperColorEl = page.locator("#upper-common-color");
  const upperOpts = await upperColorEl.locator("option").allTextContents();
  const validUpper = upperOpts.find(t => t && t !== "" && t !== "색상 선택") || upperOpts[1] || "";
  if (validUpper) await upperColorEl.selectOption({ label: validUpper });

  const sharedColorEl = page.locator("#shared-color-sel");
  const sharedOpts = await sharedColorEl.locator("option").allTextContents();
  const validShared = sharedOpts.find(t => t && t !== "" && t !== "색상 선택") || sharedOpts[1] || "";
  if (validShared) await sharedColorEl.selectOption({ label: validShared });

  await setFirstVisibleDrawerQty(page, "1");

  const saveBtn = page.locator("#order-modal .order-modal-bottom .btn-primary").first();
  await saveBtn.click();

  // 확인 다이얼로그 대기 후 [발주 넣기] 버튼 클릭 (#order-confirm-ok-btn)
  const confirmOk = page.locator("#order-confirm-ok-btn");
  await confirmOk.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  if (await confirmOk.isVisible().catch(() => false)) {
    await confirmOk.click();
  }

  await page.waitForTimeout(5000);

  const errorCount = await page.locator('text=/저장 실패|서버 연결 확인/i').count();
  expect(errorCount, "발주 저장 시 에러 토스트가 뜨면 안 됨").toBe(0);

  await page.waitForSelector("#order-modal", { state: "hidden", timeout: 30000 }).catch(() => {
    throw new Error("저장 후 모달이 닫히지 않음");
  });
}

test.describe("발주 저장 흐름 회귀 (유케이 07-08 사고 재발 방지)", () => {
  // 순차 실행 흐름에서 축적된 상태(재고·발주서 수 등)로 인한 flakiness 완화
  test.describe.configure({ retries: 2 });

  test.beforeEach(async () => {
    await resetAndSeed();
  });

  test("S1: 발주자가 저장한 발주서가 관리자 화면에 표시된다", async ({ page }) => {
    await createTestOrderAsOrderer(page);

    await logout(page);
    await loginAs(page, "admin", "admin", "123456");

    const adminOrdersNav = page.locator('[data-nav="orders"]').first();
    if (await adminOrdersNav.count() > 0) await adminOrdersNav.click().catch(() => {});
    await page.waitForTimeout(1500);

    const orderRows = page.locator('table tbody tr');
    const rowCount = await orderRows.count();
    expect(rowCount, "관리자 화면 발주 리스트에 발주서가 있어야 함").toBeGreaterThan(0);

    const rowsText = await orderRows.allTextContents();
    const foundTestBusiness = rowsText.some(t => t.includes("테스트업체"));
    expect(foundTestBusiness, "관리자 화면에 '테스트업체' 발주서가 보여야 함").toBe(true);
  });

  test("S2: 관리자가 발주서를 수정·저장해도 사라지거나 중복되지 않는다", async ({ page }) => {
    // 1) 사전 준비: 발주자로 발주서 하나 생성
    await createTestOrderAsOrderer(page);

    // 2) 관리자 로그인
    await logout(page);
    await loginAs(page, "admin", "admin", "123456");

    const adminOrdersNav = page.locator('[data-nav="orders"]').first();
    if (await adminOrdersNav.count() > 0) await adminOrdersNav.click().catch(() => {});
    await page.waitForTimeout(1500);

    // 3) 수정 전 발주서 개수 기록 — data-order-id 속성으로 리스트의 발주서만 카운트
    // (일반 'table tbody tr'은 상세 모달의 하위 표까지 세게 되어 부정확)
    const orderRows = page.locator('tr[data-order-id]');
    const beforeCount = await orderRows.count();
    expect(beforeCount, "관리자 화면에 발주서가 최소 1건 있어야 함").toBeGreaterThan(0);

    // 4) 첫 번째 발주서 클릭 → 상세 모달 오픈
    await orderRows.first().click();
    // 상세 모달의 수정 버튼 대기
    await page.waitForSelector("#edit-order-btn", { state: "visible", timeout: 10000 });

    // 5) 수정 버튼 클릭 → 편집 모드 진입
    await page.locator("#edit-order-btn").click();
    await page.waitForSelector("#order-modal", { state: "visible", timeout: 10000 });
    await page.waitForFunction(() => {
      const input = document.querySelector<HTMLInputElement>("#o-delivery-to");
      return !!input?.value.trim();
    });

    // 6) 최소 수정: 비고에 한 글자 추가 (원본 값 보존 + 수정 감지)
    const noteInput = page.locator("#o-note");
    if (await noteInput.count() > 0) {
      const current = (await noteInput.inputValue()) || "";
      await noteInput.fill(current + " [E2E-편집확인]");
    }

    // 7) 저장 버튼 클릭
    const saveBtn = page.locator("#order-modal .order-modal-bottom .btn-primary").first();
    await saveBtn.click();

    // 8) 확인 다이얼로그 있으면 확정
    const confirmBtn = page.locator("#order-confirm-ok-btn");
    await confirmBtn.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
    if (await confirmBtn.isVisible().catch(() => false)) {
      await confirmBtn.click();
    }

    // 9) 저장 결과 대기
    await page.waitForTimeout(3000);

    // 10) 에러 토스트 없는지 확인
    const errorCount = await page.locator('text=/저장 실패|서버 연결 확인/i').count();
    expect(errorCount, "수정 저장 시 에러 토스트가 뜨면 안 됨").toBe(0);

    // 11) 모달 닫히는지 확인 (성공 시 자동 닫힘)
    await page.waitForSelector("#order-modal", { state: "hidden", timeout: 10000 }).catch(() => {
      throw new Error("수정 저장 후 모달이 닫히지 않음 — 저장 실패했을 가능성");
    });

    // 12) 발주 리스트 재조회 (자동 refresh 지연 대비)
    await page.waitForTimeout(1500);
    if (await adminOrdersNav.count() > 0) await adminOrdersNav.click().catch(() => {});
    await page.waitForTimeout(1500);

    // 13) 수정 후 발주서 개수 확인 — data-order-id로만 카운트 (리스트 행만)
    const afterCount = await page.locator('tr[data-order-id]').count();
    expect(afterCount, `수정 저장 후 발주서 개수 변화 — 사라짐(before=${beforeCount}, after=${afterCount}) 또는 중복`).toBe(beforeCount);

    // 14) 여전히 '테스트업체' 발주서가 리스트에 존재하는지 확인 (수정 후 사라짐 방지)
    const rowsText = await page.locator('tr[data-order-id]').allTextContents();
    const stillFound = rowsText.some(t => t.includes("테스트업체"));
    expect(stillFound, "수정 저장 후에도 '테스트업체' 발주서가 리스트에 있어야 함").toBe(true);
  });

  test("S3: 발주 편집 검증 실패 시 기존 PR을 삭제하지 않는다", async ({ page }) => {
    await createTestOrderAsOrderer(page);

    const seeded = await page.evaluate(async () => {
      const w = window as any;
      const orders = w.DB.get("orders", []);
      const order = orders[orders.length - 1];
      if (!order) return null;
      const pr = {
        id: 990003,
        orderId: order.id,
        itemId: 1,
        requiredQty: 10,
        shortageQty: 5,
        warehouse: "시흥",
        status: "대기",
        createdAt: new Date().toISOString(),
      };
      w.DB.set("purchase_requests", [...w.DB.get("purchase_requests", []), pr]);
      await w._FS.awaitPendingWrites(["purchase_requests"]);
      return { orderId: order.id, prId: pr.id };
    });
    expect(seeded, "편집 실패 검증용 발주/PR 생성").toBeTruthy();

    await logout(page);
    await loginAs(page, "admin", "admin", "123456");
    await page.locator('[data-nav="orders"]').first().click().catch(() => {});
    await page.waitForTimeout(1000);
    await page.locator(`tr[data-order-id="${seeded!.orderId}"]`).click();
    await page.locator("#edit-order-btn").click();
    await page.waitForSelector("#order-modal", { state: "visible" });

    // submitEditOrder에는 진입하지만 submitOrder 검증에서 실패하도록 출고일을 비운다.
    await page.fill("#o-ship-y", "");
    await page.locator("#order-modal .order-modal-bottom .btn-primary").first().click();
    await page.waitForTimeout(500);
    await page.evaluate(async () => {
      const w = window as any;
      await w._FS.awaitPendingWrites(["purchase_requests"]);
    });

    const serverPrExists = await page.evaluate(async (prId) => {
      const prs = await (window as any)._FS.get("purchase_requests", { fromServer: true });
      return Array.isArray(prs) && prs.some((p: any) => p.id === prId);
    }, seeded!.prId);
    expect(serverPrExists, "검증 실패 전의 기존 PR이 서버에 남아야 함").toBe(true);
  });

  test("S4: 연속 삭제·복원 write는 직전 committed baseline을 사용한다", async ({ page }) => {
    await loginAs(page, "admin", "admin", "123456");

    const restored = await page.evaluate(async () => {
      const w = window as any;
      const pr = {
        id: 990004,
        orderId: 990004,
        itemId: 1,
        requiredQty: 1,
        shortageQty: 1,
        warehouse: "시흥",
        status: "대기",
        createdAt: new Date().toISOString(),
      };
      w.DB.set("purchase_requests", [pr]);
      await w._FS.awaitPendingWrites(["purchase_requests"]);

      // 첫 write가 커밋되기 전에 복원 write를 큐에 넣어 stale baseline 회귀를 재현한다.
      w.DB.set("purchase_requests", []);
      w.DB.set("purchase_requests", [pr]);
      await w._FS.awaitPendingWrites(["purchase_requests"]);

      const server = await w._FS.get("purchase_requests", { fromServer: true });
      return Array.isArray(server) && server.some((p: any) => p.id === pr.id);
    });

    expect(restored, "삭제 직후 큐잉한 복원 write가 서버에 반영되어야 함").toBe(true);
  });

});
