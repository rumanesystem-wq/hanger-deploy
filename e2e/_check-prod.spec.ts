import { test } from "@playwright/test";

test("운영 접속 확인", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push("PAGE: " + e.message));
  page.on("console", msg => { if (msg.type() === "error") errors.push("CONSOLE: " + msg.text()); });
  page.on("response", r => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url().slice(0, 100)}`); });

  try {
    await page.goto("https://hanger-deploy.web.app", { timeout: 15000 });
    await page.waitForTimeout(5000);
    await page.screenshot({ path: "C:/Users/kateb/hanger-deploy/.dev-output/prod-check.png" });
    const title = await page.title();
    console.log("TITLE:", title);
    console.log("URL:", page.url());
    console.log("ERRORS:", errors.length);
    errors.slice(0, 15).forEach(e => console.log(" -", e.slice(0, 150)));
  } catch (e) {
    console.log("FAIL:", e.message);
  }
});
