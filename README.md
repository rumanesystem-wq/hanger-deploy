# hanger-deploy

시스템 행거 부품/자재 **발주 관리 앱** — 이카운트 ERP와 연동되는 모바일 PWA입니다.

---

## 프로젝트 개요

| 항목 | 내용 |
|------|------|
| 플랫폼 | 모바일 우선 PWA (Progressive Web App) |
| 프론트엔드 | Vanilla HTML / CSS / JavaScript |
| 백엔드 | Firebase Cloud Functions (Node.js 20) |
| 데이터베이스 | Firestore (NoSQL) |
| 호스팅 | Firebase Hosting |
| ERP 연동 | 이카운트 OAPI v2 |

---

## 아키텍처

```
[모바일/웹 PWA]
      ↓
[Firebase Hosting] — 발주앱 정적 파일 서빙
      ↓
[Firestore] — 발주 데이터, 재고 데이터 저장
      ↓
[Cloud Functions]
      ├── 이카운트 ERP 연동 (판매전표, 품목조회, 단가수정)
      └── Firestore 자동 백업 (매일 자정)
      ↓
[이카운트 OAPI v2] — 외부 ERP 시스템
```

---

## 프론트엔드 구조

```
public/발주앱/
├── index.html              # 앱 진입점
├── print.html              # 모바일 인쇄 전용 페이지
├── style.css               # 전역 스타일
├── manifest.json           # PWA 설정 (아이콘, 앱 이름 등)
├── service-worker.js       # PWA 오프라인/캐시 제어
├── sw.js                   # Service Worker (자동 업데이트)
└── js/
    ├── core/
    │   └── firebase.js     # Firebase 초기화
    ├── price.js            # 단가 관리
    ├── inventory.js        # 재고 관리
    ├── utils.js            # 공통 유틸
    └── utils/
        ├── dateUtils.js    # 날짜 유틸
        └── uiUtils.js      # UI 유틸
```

---

## 백엔드 — Cloud Functions

### 이카운트 ERP 연동

이카운트 OAPI v2를 통해 ERP와 연동합니다.

**연동 방식**
1. 이카운트 로그인 → `SESSION_ID` 발급
2. `SESSION_ID` 파라미터로 API 호출
3. 결과를 앱으로 반환

**ERP 설정**
| 항목 | 값 |
|------|-----|
| 회사코드 | 670811 |
| Zone | AA |
| 서버 | `oapiaa.ecount.com` (실서버) |
| 리전 | `asia-northeast3` (서울) |

**창고 코드**
| 코드 | 위치 |
|------|------|
| 101 | 시흥 |
| 102 | 평택 |
| 103 | 오산 |

### Functions 목록

| 함수명 | 종류 | 역할 |
|--------|------|------|
| `testEcountConnection` | onCall | 이카운트 API 연결 테스트 |
| `getEcountProducts` | onCall | 이카운트 품목 목록 조회 |
| `createEcountSaleOrder` | onCall | 판매 전표 생성 (출고 처리) |
| `updateEcountPrice` | onCall | 이카운트 품목 단가 수정 |
| `dailyFirestoreBackup` | onSchedule | 매일 KST 00:00 Firestore 자동 백업 (7일치 보관) |

---

## PWA 기능

| 기능 | 설명 |
|------|------|
| 오프라인 지원 | Service Worker가 리소스 캐싱 |
| 자동 업데이트 | 새 버전 배포 시 백그라운드 다운로드 후 자동 새로고침 |
| 홈 화면 설치 | 모바일에서 앱처럼 설치 가능 |
| 모바일 인쇄 | `print.html` 전용 페이지로 Android 인쇄 지원 |

---

## 배포

```bash
# Cloud Functions 배포
cd functions
npm run deploy

# 전체 배포 (Hosting + Functions)
firebase deploy
```

---

## 개발 환경

```bash
# Functions 로컬 에뮬레이터 실행
cd functions
npm run serve

# Functions 로그 확인
npm run logs
```
