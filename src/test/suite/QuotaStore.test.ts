import { strict as assert } from "assert";
import { QuotaStore } from "../../services/QuotaStore";
import type { QuotaSnapshot } from "../../types/quota";

function snapshot(label: string): QuotaSnapshot {
  return {
    provider: "ollama",
    mode: "credits",
    credits: {
      used: 1,
      limit: 3,
      remaining: 2,
      percentage: 60,
    },
    fetchedAt: `2026-10-15T14:32:00Z-${label}`,
  };
}

suite("QuotaStore", () => {
  test("set/get round-trip and change events fire per state", () => {
    const store = new QuotaStore();
    const kinds: string[] = [];
    store.onDidChange((s) => kinds.push(s.kind));
    store.set({ kind: "idle", keyPresent: false });
    store.set({ kind: "loading", keyPresent: true });
    assert.equal(store.get().kind, "loading");
    assert.deepEqual(kinds, ["idle", "loading"]);
    store.dispose();
  });

  test("error state preserves the last valid snapshot of the same token", () => {
    const store = new QuotaStore();
    const snap = snapshot("a");
    const activeToken = { id: "t1", name: "Main" };
    store.set({ kind: "ok", snapshot: snap, activeToken });
    store.set({
      kind: "error",
      message: "Rate limit reached (429)",
      snapshot: undefined,
      activeToken,
    });
    const state = store.get();
    assert.equal(state.kind, "error");
    assert.deepEqual(
      state.kind === "error" ? state.snapshot : undefined,
      undefined,
      "error state carries no snapshot itself",
    );
    assert.equal(store.lastSnapshot(), snap, "last valid survives the error");
    store.dispose();
  });

  test("switching tokens discards the stale snapshot of the previous token", () => {
    const store = new QuotaStore();
    const oldSnap = snapshot("old");
    store.set({ kind: "ok", snapshot: oldSnap, activeToken: { id: "t1", name: "Main" } });
    // New token becomes active: the loading cycle reports its own metadata.
    store.set({ kind: "loading", keyPresent: true, activeToken: { id: "t2", name: "Work" } });
    assert.equal(
      store.lastSnapshot(),
      undefined,
      "old token's snapshot must not be served for the new token",
    );
    // A failing refresh right after the switch has nothing stale to show:
    // the RefreshService error state then carries snapshot: undefined.
    store.set({
      kind: "error",
      message: "Invalid API key (401)",
      snapshot: undefined,
      activeToken: { id: "t2", name: "Work" },
    });
    assert.equal(store.get().kind, "error");
    assert.equal(store.lastSnapshot(), undefined);
    store.dispose();
  });

  test("same token loading between cycles keeps the last valid snapshot", () => {
    const store = new QuotaStore();
    const snap = snapshot("same");
    const activeToken = { id: "t1", name: "Main" };
    store.set({ kind: "ok", snapshot: snap, activeToken });
    store.set({ kind: "loading", keyPresent: true, activeToken });
    assert.equal(store.lastSnapshot(), snap, "same token: stale data still valid");
    store.dispose();
  });
});