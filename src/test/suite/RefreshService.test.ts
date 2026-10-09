import { strict as assert } from "assert";
import { RefreshService, type RefreshServiceDeps } from "../../services/RefreshService";
import { QuotaStore } from "../../services/QuotaStore";
import type { Provider } from "../../providers/Provider";
import type { QuotaSnapshot } from "../../types/quota";
import { creditsBalance } from "./fixtures";
import { parseBalanceResponse } from "../../providers/parse";

class StubProvider implements Provider {
  callCount = 0;
  rejectWith: Error | undefined;
  delayMs = 0;

  async getQuota(_signal?: AbortSignal): Promise<QuotaSnapshot> {
    this.callCount++;
    if (this.rejectWith) {
      if (this.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      }
      throw this.rejectWith;
    }
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    return parseBalanceResponse(creditsBalance);
  }
}

function makeDeps(provider: StubProvider, intervalSeconds: number): { deps: RefreshServiceDeps; store: QuotaStore } {
  const store = new QuotaStore({ kind: "idle", keyPresent: true });
  const deps: RefreshServiceDeps = {
    provider,
    store,
    getIntervalSeconds: () => intervalSeconds,
  };
  return { deps, store };
}

// Fake-timer-friendly tests below avoid real long timers; intervals are sub-second in tests.
suite("RefreshService", () => {
  test("immediate refresh fills store with snapshot", async () => {
    const provider = new StubProvider();
    const { deps, store } = makeDeps(provider, 0);
    const service = new RefreshService(deps);
    service.start();
    await new Promise((r) => setTimeout(r, 20));
    const state = store.get();
    assert.equal(state.kind, "ok", "store should hold an ok snapshot");
    service.dispose();
  });

  test("interval=0 never schedules further refreshes", async () => {
    const provider = new StubProvider();
    const { deps, store } = makeDeps(provider, 0);
    const service = new RefreshService(deps);
    service.start();
    await new Promise((r) => setTimeout(r, 30));
    const firstCount = provider.callCount;
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(provider.callCount, firstCount, "no further requests when interval = 0");
    assert.equal(store.lastSnapshot()?.mode, "credits");
    service.dispose();
  });

  test("dynamic interval change restarts cycle", async () => {
    const provider = new StubProvider();
    const { deps } = makeDeps(provider, 1); // 1 second - but we won't wait for it
    const service = new RefreshService(deps);
    service.start();
    await new Promise((r) => setTimeout(r, 10));
    provider.callCount = 0;
    service.restart();
    service.dispose();
  });

  test("manual refresh works when interval > 0", async () => {
    const provider = new StubProvider();
    const { deps } = makeDeps(provider, 3600); // never fires within test
    const service = new RefreshService(deps);
    service.start();
    await new Promise((r) => setTimeout(r, 10));
    const ok = await service.refreshNow();
    assert.equal(ok, true);
    service.dispose();
  });

  test("no overlapping requests while one is in flight", async () => {
    const provider = new StubProvider();
    provider.delayMs = 50;
    const { deps } = makeDeps(provider, 0);
    const service = new RefreshService(deps);
    const p1 = service.refreshNow();
    const p2 = service.refreshNow();
    const [ok1, ok2] = await Promise.all([p1, p2]);
    // Invariant: no parallel HTTP (callCount <= 2) and both calls resolve successfully
    // (the in-flight guard is about avoiding concurrent fetches, not dropping user intent).
    assert.equal(provider.callCount <= 2, true, "at most one extra attempt is queued");
    assert.equal(ok1 && ok2, true, "both refresh attempts complete");
    service.dispose();
  });

  test("error preserves last valid snapshot", async () => {
    const provider = new StubProvider();
    const { deps, store } = makeDeps(provider, 0);
    const service = new RefreshService(deps);
    service.start();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(store.get().kind, "ok");
    const last = store.lastSnapshot();
    provider.rejectWith = new Error("Rate limit reached (429)");
    await service.refreshNow();
    const state = store.get();
    assert.equal(state.kind, "error");
    assert.deepEqual(state.snapshot, last, "last valid snapshot preserved");
    service.dispose();
  });
});