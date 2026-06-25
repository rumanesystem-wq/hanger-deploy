// functions 에뮬레이터 통합 테스트.
// - 안전: 테스트 전용 프로젝트(tooktak-test)에서만 돌아 운영 시드(tooktakproject)와 격리.
// - 전제: Firestore 에뮬레이터(127.0.0.1:8080)가 떠 있어야 함 (docker hanger-emu).
import { describe, it, expect, beforeEach } from "vitest";

// index.js의 admin.initializeApp()이 에뮬레이터·테스트 프로젝트를 쓰도록 import 전에 env 설정
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
const fft = (await import("firebase-functions-test")).default({ projectId: "tooktak-test" });
process.env.GCLOUD_PROJECT = "tooktak-test";
process.env.GOOGLE_CLOUD_PROJECT = "tooktak-test";

const fns = await import("../index.js"); // admin.initializeApp() 실행 → tooktak-test/에뮬레이터
const admin = (await import("firebase-admin")).default;
const db = admin.firestore();

const getNextIds = fft.wrap(fns.getNextIds);
const getEmailById = fft.wrap(fns.getEmailById);

describe("getNextIds — 서버 채번(동시 저장 시 번호 충돌 방지)", () => {
  beforeEach(async () => {
    await db.doc("hanger_data/_seq_orders").set({ value: 10 });
  });

  it("연속 ID를 순서대로 발급하고 카운터를 그만큼 올린다", async () => {
    const res = await getNextIds({ data: { counts: { orders: 3 } }, auth: { uid: "tester" } });
    expect(res).toEqual({ success: true, ids: { orders: [11, 12, 13] } });
    const snap = await db.doc("hanger_data/_seq_orders").get();
    expect(snap.data().value).toBe(13); // 다음 호출은 14부터 → 겹치지 않음
  });

  it("로그인 안 하면 거부한다", async () => {
    await expect(
      getNextIds({ data: { counts: { orders: 1 } } }),
    ).rejects.toThrow();
  });

  it("허용되지 않은 컬렉션은 거부한다", async () => {
    await expect(
      getNextIds({ data: { counts: { hackers: 1 } }, auth: { uid: "t" } }),
    ).rejects.toThrow();
  });

  it("개수 한도(100) 초과는 거부한다", async () => {
    await expect(
      getNextIds({ data: { counts: { orders: 101 } }, auth: { uid: "t" } }),
    ).rejects.toThrow();
  });
});

describe("getEmailById — 보안 경계(이메일만 노출)", () => {
  beforeEach(async () => {
    await db.doc("hanger_data/accounts").set({
      value: [
        { id: "kim", email: "kim@test.com", role: "admin", password: "secret", name: "김길동" },
      ],
    });
  });

  it("이메일만 반환하고 role·password·name은 새지 않는다", async () => {
    const res = await getEmailById({ data: { id: "kim" } });
    expect(res).toEqual({ success: true, email: "kim@test.com" });
    const dump = JSON.stringify(res);
    expect(dump).not.toContain("secret"); // 비번 안 샘
    expect(dump).not.toContain("admin"); // 권한 안 샘
    expect(dump).not.toContain("김길동"); // 이름 안 샘
  });

  it("없는 아이디는 거부한다", async () => {
    await expect(getEmailById({ data: { id: "nobody" } })).rejects.toThrow();
  });

  it("아이디가 없으면 거부한다", async () => {
    await expect(getEmailById({ data: {} })).rejects.toThrow();
  });
});
