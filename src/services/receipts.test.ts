import AsyncStorage from "@react-native-async-storage/async-storage";

import { clearReceipts, getReceipt, listReceipts, MAX_RECEIPTS, RECEIPTS_STORAGE_KEY, saveReceipt, type PaymentReceipt } from "./receipts";

function receipt(index = 0): PaymentReceipt {
  return {
    resourceId: `r${index}`, title: "Handbook", amount: "12500000", asset: "USDC-contract",
    network: "stellar:testnet", txHash: `tx-${index}`, payer: "public-address",
    paidAt: new Date(Date.UTC(2026, 9, 1, 0, 0, index)).toISOString(),
  };
}

beforeEach(async () => {
  jest.restoreAllMocks();
  await AsyncStorage.clear();
});

it("persists public fields, lists newest first and gets by transaction hash", async () => {
  await saveReceipt(receipt(2));
  await saveReceipt({ ...receipt(1), secret: "must-not-persist", transaction: "signed-xdr" } as PaymentReceipt);
  expect(await listReceipts()).toEqual([receipt(2), receipt(1)]);
  expect(await getReceipt("tx-1")).toEqual(receipt(1));
  expect(await getReceipt("missing")).toBeNull();
  const stored = await AsyncStorage.getItem(RECEIPTS_STORAGE_KEY);
  expect(stored).not.toContain("must-not-persist");
  expect(stored).not.toContain("signed-xdr");
});

it("caps at the newest 200 receipts without losing simultaneous saves", async () => {
  await Promise.all(Array.from({ length: MAX_RECEIPTS + 2 }, (_, index) => saveReceipt(receipt(index))));
  const saved = await listReceipts();
  expect(saved).toHaveLength(MAX_RECEIPTS);
  expect(saved[0]).toEqual(receipt(MAX_RECEIPTS + 1));
  expect(saved[saved.length - 1]).toEqual(receipt(2));
});

it("deduplicates by transaction hash", async () => {
  await saveReceipt(receipt());
  await saveReceipt({ ...receipt(), title: "Updated title" });
  expect(await listReceipts()).toEqual([{ ...receipt(), title: "Updated title" }]);
});

it("clears receipts in order even with pending saves", async () => {
  const saved = saveReceipt(receipt());
  const cleared = clearReceipts();
  await Promise.all([saved, cleared]);
  expect(await listReceipts()).toEqual([]);
});

it.each([null, "[]", JSON.stringify({ version: 0, receipts: [] }), "bad json"])("migrates an empty or unreadable store (%s)", async (raw) => {
  if (raw !== null) await AsyncStorage.setItem(RECEIPTS_STORAGE_KEY, raw);
  expect(await listReceipts()).toEqual([]);
  expect(JSON.parse((await AsyncStorage.getItem(RECEIPTS_STORAGE_KEY))!)).toEqual({ version: 1, receipts: [] });
});

it.each([
  () => [receipt(1), receipt(2), { nonsense: true }],
  () => ({ version: 0, receipts: [receipt(1), receipt(2)] }),
  () => ({ receipts: [receipt(1), receipt(2)] }),
])("migrates old receipts without discarding valid public data", async (oldData) => {
  await AsyncStorage.setItem(RECEIPTS_STORAGE_KEY, JSON.stringify(oldData()));
  expect(await listReceipts()).toEqual([receipt(2), receipt(1)]);
  expect(JSON.parse((await AsyncStorage.getItem(RECEIPTS_STORAGE_KEY))!).version).toBe(1);
});

it("does not overwrite a future version", async () => {
  const raw = JSON.stringify({ version: 2, receipts: [receipt()] });
  await AsyncStorage.setItem(RECEIPTS_STORAGE_KEY, raw);
  await expect(saveReceipt(receipt(1))).rejects.toThrow("newer app version");
  expect(await AsyncStorage.getItem(RECEIPTS_STORAGE_KEY)).toBe(raw);
});

it("recovers the queue after a failed write", async () => {
  await listReceipts();
  jest.spyOn(AsyncStorage, "setItem").mockRejectedValueOnce(new Error("Storage full"));
  await expect(saveReceipt(receipt(1))).rejects.toThrow("Storage full");
  await saveReceipt(receipt(2));
  expect(await listReceipts()).toEqual([receipt(2)]);
});
