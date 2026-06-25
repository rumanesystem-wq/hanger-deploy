# hanger-deploy (발주앱) — 프로젝트 설정

Firebase 발주앱. 프론트 `public/발주앱/`(순수 JS), 백엔드 `functions/`(Cloud Functions, Node 20), DB Firestore. 안전 테스트 환경 = **Firebase 에뮬레이터**(docker `hanger-emu`).

## 🔴 절대 임의 수정·실행 금지 (명시 허락 시에만)
- `firestore.rules` (보안 규칙) — 현재 `allow read,write: if true`(전면 개방). **고치면 툭탁 앱 로그인이 깨질 수 있어** 신중. 운영 규칙 변경·배포는 사용자 명시 OK 후에만.
- `firebase.json`, `.firebaserc` (배포 설정)
- `functions/.env`, `public/발주앱/firebase-config.js` (비밀값) — 읽기·출력 금지
- `firebase deploy`, `deploy.ps1` 자동 실행 금지

## 테스트 / 버그 탐지
- 방식: **에뮬레이터 통합 테스트** (자세히는 `functions/TESTING.md`)
- 실행: 에뮬레이터 켠 상태에서 `cd functions && npm test`
- 안전: 테스트 전용 프로젝트(`tooktak-test`)에서 격리 → 운영 시드(`emu-seed`) 안 건드림
- "테스트 짜줘/돌려봐", "적대적으로 테스트해줘", "자동 검증해줘" → 위 컨벤션대로

## 작업 규칙
- 전역 규칙(`~/.claude/CLAUDE.md`) + AI 행동 원칙 적용.
- HTML/CSS/JS(`public/발주앱/app.js` 등) 수정 후 → 팀 에이전트 검토.
- 코드 변경 시 관련 테스트 추가·실행(GREEN 확인). 버그 발견 시 재현 테스트부터(버그→테스트 규칙).
