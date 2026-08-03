import { test, expect, Page } from '@playwright/test';
import { resetAndSeed } from '../helpers/emu-reset';

test.beforeAll(async () => {
  await resetAndSeed();
});

async function loginAdmin(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => {
    const w = window as any;
    const accounts = w.DB && w.DB.get('accounts', []);
    return w._booted && Array.isArray(accounts) && accounts.some((a: any) => a && a.id === 'admin');
  });
  await page.locator('#tab-admin').click();
  await page.fill('#login-id', 'admin');
  await page.fill('#login-pw', '123456');
  await page.locator('button[onclick="doLogin()"]', { hasText: '로그인' }).click();
  await page.waitForSelector('[data-nav="settlement"]');
  await page.waitForFunction(() => {
    const w = window as any;
    return w._FS && w.LumaneInvoice && typeof w.saveOrder === 'function';
  });
}

test('invoice update keeps serial, creates revision, protects manual edits, and force-unsends', async ({ page }) => {
  test.setTimeout(120_000);
  await loginAdmin(page);

  const result = await page.evaluate(async () => {
    const w = window as any;
    const payload = {
      deliveryTo: '명세서안전테스트', address: '서울 테스트로 1',
      orderDate: '2026-08-03', shipDate: '2026-08-05', note: '', warehouse: '시흥',
      upperMaterials: [], upperCommonColor: '', rodItems: [], shelfItems: [],
      drawerItems: [{ itemId: 1, requiredQty: 1, color: '화이트' }],
      drawerMemo: '', etcMemo: '', sharedColor: '화이트',
      totalSupply: 48000, totalVat: 4800, totalAmount: 52800,
      proxyOrdererId: 'orderer', proxyOrdererName: '명세서안전테스트', proxyCreatedByAdmin: true
    };

    const saved = await w.saveOrder(payload, '발주대기');
    let order = saved.order;
    const createResult = await w.LumaneInvoice.autoCreateForOrder(order, { reason: 'order-save' });
    await new Promise(resolve => setTimeout(resolve, 100));
    let invoices = w._mem.invoices || await w._FS.get('invoices', { fromServer: true });
    let invoice = (invoices || []).find((i: any) => i.orderNum === order.orderNum && !i.cancelled) || createResult.invoice;
    if (!invoice) throw new Error('명세서 생성 실패: ' + JSON.stringify(createResult));
    const originalSerial = invoice.serial;

    await w.LumaneInvoice.setSentByOrderNum(order.orderNum, true);
    order = { ...order, address: '부산 변경로 2', updatedAt: new Date().toISOString() };
    await w._FS.upsertOrder(JSON.parse(JSON.stringify(order)));
    await w.LumaneInvoice.autoCreateForOrder(order, { reason: 'order-save' });
    invoices = w._mem.invoices || await w._FS.get('invoices', { fromServer: true });
    invoice = invoices.find((i: any) => i.orderNum === order.orderNum && !i.cancelled);
    const revisionsAfterAuto = await w._FS.collectionGet('hanger_invoice_revisions');

    const autoState = {
      serial: invoice.serial,
      address: invoice.address,
      sent: invoice.sentToCustomer,
      revision: invoice.revision,
      revisionCount: revisionsAfterAuto.filter((r: any) => r.invoiceId === invoice.id).length
    };

    const expectedManual = w.invoiceContentSignature(invoice);
    invoice = await w.updateInvoice(
      { ...invoice, address: '관리자 수기주소' },
      { reason: 'manual-edit', markManual: true, expectedSignature: expectedManual }
    );
    await w.LumaneInvoice.setSentByOrderNum(order.orderNum, true);
    order = { ...order, address: '최신 발주주소', updatedAt: new Date().toISOString() };
    await w._FS.upsertOrder(JSON.parse(JSON.stringify(order)));
    await w.LumaneInvoice.autoCreateForOrder(order, { reason: 'order-save' });
    invoices = w._mem.invoices || await w._FS.get('invoices', { fromServer: true });
    invoice = invoices.find((i: any) => i.orderNum === order.orderNum && !i.cancelled);

    const manualState = {
      address: invoice.address,
      sent: invoice.sentToCustomer,
      needsManualReview: invoice.needsManualReview,
      pendingAddress: invoice.pendingAutoDraft && invoice.pendingAutoDraft.address
    };

    // 관리자가 검토본을 연 뒤 발주가 다시 바뀌면 오래된 검토본 저장을 차단해야 한다.
    const staleReviewed = { ...invoice, ...invoice.pendingAutoDraft, id: invoice.id, serial: invoice.serial };
    const staleExpectedSignature = w.invoiceContentSignature(invoice);
    const staleExpectedUpdatedAt = invoice.updatedAt || '';
    order = { ...order, address: '검토 중 다시 변경된 주소', updatedAt: new Date().toISOString() };
    await w._FS.upsertOrder(JSON.parse(JSON.stringify(order)));
    await w.LumaneInvoice.autoCreateForOrder(order, { reason: 'order-save' });
    let staleReviewBlocked = false;
    try {
      await w.updateInvoice(staleReviewed, {
        reason: 'manual-review', markManual: true,
        expectedSignature: staleExpectedSignature,
        expectedUpdatedAt: staleExpectedUpdatedAt
      });
    } catch (_) {
      staleReviewBlocked = true;
    }

    invoices = w._mem.invoices || await w._FS.get('invoices', { fromServer: true });
    invoice = invoices.find((i: any) => i.orderNum === order.orderNum && !i.cancelled);
    const reviewed = { ...invoice, ...invoice.pendingAutoDraft, id: invoice.id, serial: invoice.serial };
    invoice = await w.updateInvoice(reviewed, {
      reason: 'manual-review', markManual: true,
      expectedSignature: w.invoiceContentSignature(invoice),
      expectedUpdatedAt: invoice.updatedAt || ''
    });
    await w.LumaneInvoice.setSentByOrderNum(order.orderNum, true);
    await w.LumaneInvoice.autoCreateForOrder(order, { reason: 'unlock', forceUnsend: true });
    invoices = w._mem.invoices || await w._FS.get('invoices', { fromServer: true });
    invoice = invoices.find((i: any) => i.orderNum === order.orderNum && !i.cancelled);

    return { originalSerial, autoState, manualState, staleReviewBlocked, forceUnsent: invoice.sentToCustomer === false };
  });

  expect(result.autoState.serial).toBe(result.originalSerial);
  expect(result.autoState.address).toBe('부산 변경로 2');
  expect(result.autoState.sent).toBe(false);
  expect(result.autoState.revision).toBe(2);
  expect(result.autoState.revisionCount).toBeGreaterThanOrEqual(1);
  expect(result.manualState).toEqual({
    address: '관리자 수기주소', sent: false, needsManualReview: true, pendingAddress: '최신 발주주소'
  });
  expect(result.staleReviewBlocked).toBe(true);
  expect(result.forceUnsent).toBe(true);
});
