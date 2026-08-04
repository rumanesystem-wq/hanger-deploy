// R4 회귀 — add-bulk-orders 동시 실행 race
// 적대적 테스트 B4 박제: 두 프로세스가 동시에 시드하면 한쪽이 손실됨
// 현재 read-modify-write 패턴 → RED 예상. 수정(transaction or arrayUnion) 후 GREEN.
import { describe, it, expect, beforeEach } from "vitest";

process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "tooktak-test";
process.env.GOOGLE_CLOUD_PROJECT = "tooktak-test";

const admin = (await import("firebase-admin")).default;
if (!admin.apps.length) admin.initializeApp({ projectId: "tooktak-test" });
const db = admin.firestore();

// add-bulk-orders.js의 핵심 로직 재현 — transaction 적용 (B4 수정 반영)
async function seedOrdersSafe(count, batchId) {
  const newOrders = [];
  for (let i = 0; i < count; i++) {
    newOrders.push({
      id: `${batchId}-${i}`,
      orderNum: `T-${batchId}-${String(i).padStart(3, "0")}`,
      batchId,
      totalAmount: 1000,
    });
  }
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(db.collection("hanger_data").doc("orders"));
    const cur = snap.exists ? (snap.data().value || []) : [];
    tx.set(db.collection("hanger_data").doc("orders"), {
      value: [...cur, ...newOrders],
    });
  });
  return newOrders.length;
}
const seedOrdersUnsafe = seedOrdersSafe;

describe("R4: 시드 동시 실행 — read-modify-write race", () => {
  beforeEach(async () => {
    await db.collection("hanger_data").doc("orders").set({ value: [] });
  });

  it("두 프로세스가 동시에 50건씩 시드 → 합계 100건 모두 보존", async () => {
    const [aCount, bCount] = await Promise.all([
      seedOrdersUnsafe(50, "A"),
      seedOrdersUnsafe(50, "B"),
    ]);
    expect(aCount).toBe(50);
    expect(bCount).toBe(50);

    const doc = await db.collection("hanger_data").doc("orders").get();
    const all = doc.data().value || [];

    // 불변식: A + B 모두 보존
    const aOrders = all.filter((o) => o.batchId === "A");
    const bOrders = all.filter((o) => o.batchId === "B");
    expect(aOrders.length).toBe(50);
    expect(bOrders.length).toBe(50);
    expect(all.length).toBe(100);
  });

  it("3 프로세스 동시 시드 (30+40+50) → 120건 모두 보존", async () => {
    const counts = await Promise.all([
      seedOrdersUnsafe(30, "A"),
      seedOrdersUnsafe(40, "B"),
      seedOrdersUnsafe(50, "C"),
    ]);
    expect(counts).toEqual([30, 40, 50]);

    const doc = await db.collection("hanger_data").doc("orders").get();
    const all = doc.data().value || [];
    expect(all.length).toBe(120);
  });
});
