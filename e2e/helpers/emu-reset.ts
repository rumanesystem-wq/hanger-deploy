// e2e/helpers/emu-reset.ts
// Firestore·Auth 에뮬레이터 초기화 + 시드 재실행.
// 각 테스트 시작 시 호출해서 이전 테스트 오염을 없앤다.
// 대상: docker hanger-emu — host 포트 Firestore 18080, Auth 19099 (tooktak-emulator와 반드시 구분)

import { execSync } from "child_process";
import * as path from "path";

// [2026-07-24 Codex] hanger-emu docker 포트 매핑:
//   Firestore: host 18080 → container 8080
//   Auth:      host 19099 → container 9099
//   Hosting:   host 15050 → container 5050
// tooktak-emulator(8080/9099)와 반드시 구분 — 잘못 지우면 다른 프로젝트 데이터 손실
const PROJECT = "tooktakproject"; // hanger 발주앱의 Firebase 프로젝트 ID
const FS_HOST = "http://localhost:18080";
const AUTH_HOST = "http://localhost:19099";

export async function resetFirestore(): Promise<void> {
  const url = `${FS_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`;
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) throw new Error(`Firestore reset failed: ${res.status}`);
}

export async function resetAuth(): Promise<void> {
  const url = `${AUTH_HOST}/emulator/v1/projects/${PROJECT}/accounts`;
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) throw new Error(`Auth reset failed: ${res.status}`);
}

export function runSeed(): void {
  const seedPath = path.resolve(__dirname, "..", "..", "functions", "seed-emulator.js");
  execSync(`node "${seedPath}"`, {
    stdio: "pipe",
    timeout: 15000,
    env: {
      ...process.env,
      FIRESTORE_EMULATOR_HOST: "localhost:18080",
      FIREBASE_AUTH_EMULATOR_HOST: "localhost:19099"
    }
  });
}

export async function resetAndSeed(): Promise<void> {
  await resetFirestore();
  await resetAuth();
  runSeed();
}
