# 발주앱 버그탐지 / 테스트 가이드

Firebase 발주앱(functions)의 테스트는 **에뮬레이터 통합 테스트**다. 운영(tooktakproject)과 격리된 **테스트 전용 프로젝트(tooktak-test)** 에서 돌아 시드 데이터를 절대 건드리지 않는다.

## 돌리는 법

```bash
# 1) 에뮬레이터가 떠 있어야 함 (docker hanger-emu)
docker ps                 # hanger-emu 가 Up 인지 확인
# 2) 테스트 실행
cd functions && npm test
```

- 에뮬레이터가 꺼져 있으면 통합 테스트는 실패한다(연결 불가). 먼저 `docker compose up -d` 등으로 켠다.
- watch 모드: `npx vitest`

## 어떻게 동작하나 (안전)

- 테스트는 `process.env.GCLOUD_PROJECT = "tooktak-test"` 로 **별도 프로젝트 네임스페이스**에서 돈다.
- 운영 시드(`emu-seed`, project=tooktakproject)와 **완전 격리** → 테스트가 시드를 오염시키지 않는다. (격리 검증 완료)
- 🔴 `firestore.rules`·`firebase.json`·`.env` 는 테스트가 건드리지 않는다.

## 새 테스트 추가하는 법

`functions/test/*.test.mjs` 에 추가한다. 패턴:

```js
import { describe, it, expect, beforeEach } from "vitest";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
const fft = (await import("firebase-functions-test")).default({ projectId: "tooktak-test" });
process.env.GCLOUD_PROJECT = "tooktak-test";
process.env.GOOGLE_CLOUD_PROJECT = "tooktak-test";

const fns = await import("../index.js");
const admin = (await import("firebase-admin")).default;
const db = admin.firestore();
const myFn = fft.wrap(fns.myFn);

describe("대상 — 설명", () => {
  beforeEach(async () => {
    // 필요한 시드 문서 세팅 (tooktak-test 네임스페이스라 안전)
    await db.doc("hanger_data/...").set({ ... });
  });
  it("기대 동작", async () => {
    const res = await myFn({ data: { ... }, auth: { uid: "tester" } });
    expect(res).toEqual({ ... });
  });
});
```

## 에이전트로 쓰는 법 (자유자재)

발주앱 탭에서 말로 시키면 위 컨벤션대로 테스트를 짜고 돌린다.
- "이 함수 테스트 설계해줘" → **test-designer** (시나리오·케이스)
- "통합 테스트 짜줘" → **integration-test-writer** (이 에뮬레이터 패턴으로)
- "테스트 돌려봐" → **test-runner**
- "어떻게든 깨보게 해줘" / "적대적으로 테스트해줘" → **adversarial-tester** (비정상 시퀀스·동시·경계 시도)
- "자동 검증해줘" → 검증 게이트 (사람 QA 직전까지 자동)

## 버그 탐지 4겹 (못 떠올린 버그 줄이기)

1. **속성/모델 테스트**: 동작 목록 + 불변식 정의 → 무작위 시퀀스로 위반 탐색
2. **적대적 탐색**: adversarial-tester가 일부러 깨뜨림
3. **운영 모니터링**: 배포 후 에러 감지 (해당 시)
4. **버그 클래스 표**: 겪은 버그 유형별 방어 축적

## 현재 테스트 (functions/test/functions.test.mjs)

- **getNextIds**: 서버 채번 — 연속 ID·검증·권한 (동시 저장 번호 충돌 방지)
- **getEmailById**: 보안 경계 — 이메일만 반환, 비번·권한·이름 미노출

## E2E (프론트 화면 — 에뮬레이터 대상)

위치: 루트 `e2e/*.spec.ts`, 설정 `playwright.config.ts`. 대상은 **에뮬레이터 hosting(http://localhost:5050)**.

```bash
# 에뮬레이터 켠 상태에서
npm run test:e2e            # 루트에서
npx playwright test --ui    # 화면 보며
```

- **범위는 사용자가 정한다.** "로그인→발주작성→저장→조회" 같은 흐름을 정하면 그 spec을 추가한다.
- 핵심 흐름이 **발주서를 실제로 생성**하면, 에뮬레이터 `tooktakproject`에 써져 시드에 남을 수 있으니 → **E2E 전용 계정 + 끝나고 cleanup**(생성한 발주서 삭제)으로 짠다.
- 현재: `e2e/smoke.spec.ts` (앱 부팅·로그인 화면 렌더 — 데이터 변경 0).
- 새 흐름 요청: "○○ 흐름 E2E 짜줘" → 그 spec 작성.
