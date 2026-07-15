import { defineConfig } from "@playwright/test";

/**
 * E2E — 로컬 Firebase 에뮬레이터(안전 환경) 전용. 운영에는 절대 돌리지 않는다.
 * 대상: 에뮬레이터 hosting(http://localhost:15050). 에뮬레이터(docker hanger-emu)가 떠 있어야 한다.
 * [2026-07-09] 포트 5050→15050: 툭탁 에뮬레이터와 충돌 회피
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:15050",
    headless: true,
    browserName: "chromium",
    actionTimeout: 10_000,
  },
});
