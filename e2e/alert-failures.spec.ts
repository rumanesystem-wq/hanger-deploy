import { expect, test } from '@playwright/test';
import { resetAndSeed } from './helpers/emu-reset';

async function loginAdmin(page: any) {
  await page.goto('/');
  await page.waitForFunction(() => {
    const w: any = window;
    const accounts = w.DB && w.DB.get('accounts', []);
    return Array.isArray(accounts)
      && accounts.some((a: any) => a && a.id === 'admin')
      && w._fbAuth;
  });
  await page.locator('#tab-admin').click();
  await page.fill('#login-id', 'admin');
  await page.fill('#login-pw', '123456');
  await page.locator('button[onclick="doLogin()"]') .click();
  await page.waitForSelector('#app.active');
}

test('관리자 로그인·로그아웃에 맞춰 알림 실패 배지를 구독하고 해제한다', async ({ page }) => {
  await resetAndSeed();
  await loginAdmin(page);

  await page.evaluate(async () => {
    await (window as any).firebase.app('hanger').firestore()
      .collection('hanger_orders_alert_failures')
      .doc('e2e-alert-failure')
      .set({
        docId: '20260804-E2E',
        orderNum: '20260804-E2E',
        eventId: 'e2e-event',
        failedAt: new Date().toISOString(),
        errorMessage: 'E2E Slack failure',
        resolved: false
      });
  });

  const badge = page.locator('#alert-failure-badge');
  await expect(badge).toBeVisible();
  await expect(badge.locator('.alert-failure-count')).toHaveText('1');

  await page.evaluate(() => (window as any).doLogout());
  await expect(badge).toBeHidden();

  await loginAdmin(page);
  await expect(badge).toBeVisible();
  await expect(badge.locator('.alert-failure-count')).toHaveText('1');

  page.once('dialog', dialog => dialog.accept());
  await badge.click();
  await page.locator('.alert-failure-resolve-btn').click();
  await expect(badge).toBeHidden();
});
