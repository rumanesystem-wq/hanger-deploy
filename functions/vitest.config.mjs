import { defineConfig } from "vitest/config";

// 에뮬레이터 통합 테스트 전용 설정.
// 테스트는 별도 프로젝트(tooktak-test) 네임스페이스에서 돌아 운영 시드(tooktakproject)와 격리된다.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.mjs"],
    testTimeout: 20000,
    hookTimeout: 20000,
    fileParallelism: false, // 에뮬레이터 상태 격리(순차 실행)
  },
});
