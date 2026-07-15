// order-edit-splits.spec.ts
// 편집 진입 시 포스트바 길이 분할 복원 회귀
// 대상: 로컬 도커 에뮬레이터 (localhost:15050)
// 배경: 사용자 신고 — 저장된 발주서 편집 눌러도 포스트바 길이 분할 정보가 안 나옴
// 검증: 편집 모달 진입 시 lengthSplits 데이터가 DOM에 복원되는지

import { test, expect, Page } from "@playwright/test";

test.setTimeout(90_000);

async function loginAs(page: Page, tab: "orderer" | "admin", id: string, pw: string) {
  await page.goto("/");
  await page.waitForSelector('#login-screen', { timeout: 15000 });
  await page.waitForTimeout(500);
  await page.locator(`#tab-${tab}`).click();
  await page.fill("#login-id", id);
  await page.fill("#login-pw", pw);
  await page.locator('button[onclick="doLogin()"]').click();
  await page.waitForSelector('[data-nav]', { timeout: 15000 });
  await page.waitForTimeout(1500);
}

/**
 * 브라우저 컨텍스트에서 직접 발주서 하나 만들고 저장 (관리자 세션 필요)
 * lengthSplits 필드가 든 발주서를 만든다 (실제 UI를 통하지 않고 fetch/set으로 저장)
 */
async function seedOrderWithLengthSplits(page: Page): Promise<{orderNum: string, deliveryTo: string}> {
  const result = await page.evaluate(async () => {
    // 현재 앱 컨텍스트에서 window._FS 접근
    if (!window._FS || typeof window._FS.upsertOrder !== 'function') {
      throw new Error('_FS.upsertOrder 없음 — 앱이 완전히 로드 안 됐음');
    }
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth()+1).padStart(2,'0');
    const d = String(today.getDate()).padStart(2,'0');
    const dateStr = `${y}-${m}-${d}`;
    const orderNum = `E2E-SPLIT-${Date.now()}`;
    const deliveryTo = '테스트업체_E2E_SPLIT';
    const orderId = 9999000 + Math.floor(Math.random() * 100);
    const order = {
      id: orderId,
      deliveryTo,
      address: '',
      orderDate: dateStr,
      shipDate: dateStr,
      warehouse: '시흥',
      note: '',
      upperMaterials: [
        {
          name: '포스트바 2400',
          qty: 5,
          note: '',
          color: '실버',
          lengthSplits: [
            { length: 2000, qty: 3 },
            { length: 2400, qty: 2 },
          ],
        },
      ],
      upperCommonColor: '실버',
      rodItems: [],
      shelfItems: [],
      sharedColor: '화이트 오크',
      drawerItems: [],
      drawerMemo: '',
      etcMemo: '',
      totalSupply: 0,
      totalVat: 0,
      totalAmount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      orderNum,
      status: '발주대기',
      stockDeducted: false,
      createdBy: 'admin',
      statusHistory: [{status:'발주대기', changedBy:'admin', changedByName:'관리자', changedAt: new Date().toISOString(), note:'E2E 시드'}],
      items: [],
      siteName: deliveryTo,
      customerName: '',
    };
    await window._FS.upsertOrder(order);
    return { orderNum, deliveryTo, orderId };
  });
  return result;
}

test.describe("편집 진입 시 포스트바 길이 분할 복원 회귀", () => {
  test.describe.configure({ retries: 2 });

  test("E1: 저장된 발주서 편집 시 lengthSplits가 DOM에 복원된다", async ({ page }) => {
    // 1) 관리자 로그인
    await loginAs(page, "admin", "admin", "123456");

    // 2) 브라우저 컨텍스트에서 lengthSplits 든 발주서 시드
    const seeded = await seedOrderWithLengthSplits(page);

    // 3) 시드가 클라이언트 sync에 반영되도록 페이지 새로고침 후 재로그인
    await page.reload();
    await page.waitForTimeout(1500);
    // 세션 유지 확인 — 로그인 화면 뜨면 다시 로그인
    const loginScreenVisible = await page.locator('#login-screen').isVisible().catch(() => false);
    if (loginScreenVisible) {
      await loginAs(page, "admin", "admin", "123456");
    } else {
      await page.waitForSelector('[data-nav]', { timeout: 15000 });
      await page.waitForTimeout(1500);
    }

    // 4) 발주 리스트 진입
    const ordersNav = page.locator('[data-nav="orders"]').first();
    if (await ordersNav.count() > 0) await ordersNav.click().catch(() => {});
    await page.waitForTimeout(2500);

    // 4) 방금 시드한 발주서 행 찾기 (deliveryTo로 필터링)
    const targetRow = page.locator(`tr[data-order-id] >> text=${seeded.deliveryTo}`).first();
    await targetRow.waitFor({ state: 'visible', timeout: 10000 });

    // 5) 클릭 → 상세 모달 오픈
    await targetRow.click();
    await page.waitForSelector('#edit-order-btn', { state: 'visible', timeout: 10000 });

    // 6) [수정] 클릭 → 편집 모달 진입
    await page.locator('#edit-order-btn').click();
    await page.waitForSelector('#order-modal', { state: 'visible', timeout: 10000 });

    // 편집 진입 후 restore 지연 있으니 여유 대기
    await page.waitForTimeout(1500);

    // 7) 검증 A: 포스트바 2400 input의 dataset.splits에 데이터가 있어야 함
    const splitsData = await page.evaluate(() => {
      const inp = document.querySelector('.upper-qty[data-mat="포스트바 2400"]') as HTMLInputElement | null;
      return inp?.dataset?.splits || null;
    });
    expect(splitsData, "포스트바 2400 input의 dataset.splits가 복원되어야 함").toBeTruthy();
    if (splitsData) {
      const parsed = JSON.parse(splitsData);
      expect(Array.isArray(parsed), "splits는 배열이어야 함").toBe(true);
      expect(parsed.length, "splits 항목 2건이어야 함").toBe(2);
      // 검증: 원본과 동일 (length + qty)
      const sortedActual = [...parsed].sort((a,b)=>a.length-b.length);
      expect(sortedActual[0].length).toBe(2000);
      expect(sortedActual[0].qty).toBe(3);
      expect(sortedActual[1].length).toBe(2400);
      expect(sortedActual[1].qty).toBe(2);
    }

    // 8) 검증 B: 화면에 split 정보 div가 렌더되어 있어야 함 (사용자가 눈으로 봄)
    const splitInfoVisible = await page.evaluate(() => {
      const el = document.querySelector('.upper-split-info[data-mat="포스트바 2400"]') as HTMLElement | null;
      if (!el) return false;
      // display none 또는 innerHTML empty 아닌지
      const style = getComputedStyle(el);
      return style.display !== 'none' && (el.innerHTML || '').trim().length > 0;
    });
    expect(splitInfoVisible, "포스트바 2400 split 정보가 화면에 표시되어야 함").toBe(true);
  });

});
