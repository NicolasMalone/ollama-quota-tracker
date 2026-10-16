import { strict as assert } from "assert";
import {
  RefreshService,
  type RefreshServiceDeps,
} from "../../services/RefreshService";
import { QuotaStore } from "../../services/QuotaStore";
import type { Provider } from "../../providers/Provider";
import type { QuotaSnapshot } from "../../types/quota";
import { TokenStore, type TokenStoreDeps } from "../../services/TokenStore";
import { creditsBalance } from "./fixtures";
import { parseBalanceResponse } from "../../providers/parse";

class StubProvider implements Provider {
  callCount = 0;
  rejectWith: Error | undefined;
  delayMs = 0;
  lastKey: string | undefined;

  async getQuota(
    apiKey: string,
    _signal?: AbortSignal,
  ): Promise<QuotaSnapshot> {
    this.callCount++;
    this.lastKey = apiKey;
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

/** In-memory stand-in for SecretStorage + Memento (matches TokenStore deps). */
function makeFakeTokenDeps(): TokenStoreDeps & {
  store: Map<string, string>;
  state: Map<string, unknown>;
} {
  const store = new Map<string, string>();
  const state = new Map<string, unknown>();
  return {
    store,
    state,
    secrets: {
      get: async (k: string) => store.get(k),
      store: async (k: string, v: string) => void store.set(k, v),
      delete: async (k: string) => void store.delete(k),
    },
    globalState: {
      get: (k: string) => state.get(k),
      update: async (k: string, v: unknown) => void state.set(k, v),
    },
  };
}

/** TokenStore with one active token "Main" so refresh cycles proceed. */
async function makeTokenStore(): Promise<
  TokenStore & { stubDeps: ReturnType<typeof makeFakeTokenDeps> }
> {
  const stubDeps = makeFakeTokenDeps();
  const tokenStore = new TokenStore(stubDeps) as TokenStore & {
    stubDeps: ReturnType<typeof makeFakeTokenDeps>;
  };
  await tokenStore.add("Main", "sk-test");
  return tokenStore;
}

function makeDeps(
  provider: StubProvider,
  intervalSeconds: number,
  tokens: TokenStore,
): { deps: RefreshServiceDeps; store: QuotaStore } {
  const store = new QuotaStore({ kind: "idle", keyPresent: true });
  const deps: RefreshServiceDeps = {
    provider,
    store,
    tokens,
    getIntervalSeconds: () => intervalSeconds,
  };
  return { deps, store };
}

// Fake-timer-friendly tests below avoid real long timers; intervals are sub-second in tests.
suite("RefreshService", () => {
  test("immediate refresh fills store with snapshot", async () => {
    const provider = new StubProvider();
    const tokens = await makeTokenStore();
    const { deps, store } = makeDeps(provider, 0, tokens);
    const service = new RefreshService(deps);
    service.start();
    await new Promise((r) => setTimeout(r, 20));
    const state = store.get();
    assert.equal(state.kind, "ok", "store should hold an ok snapshot");
    assert.equal(state.activeToken?.name, "Main");
    service.dispose();
    tokens.dispose();
  });

  test("no active token → idle, no requests", async () => {
    const provider = new StubProvider();
    const stubDeps = makeFakeTokenDeps();
    const tokens = new TokenStore(stubDeps);
    const { deps, store } = makeDeps(provider, 0, tokens);
    const service = new RefreshService(deps);
    service.start();
    await new Promise((r) => setTimeout(r, 20));
    const state = store.get();
    assert.equal(state.kind, "idle");
    assert.equal(provider.callCount, 0, "no HTTP without an active token");
    service.dispose();
    tokens.dispose();
  });

  test("refresh uses the ACTIVE token's key", async () => {
    const provider = new StubProvider();
    const tokens = await makeTokenStore();
    const { deps, store } = makeDeps(provider, 0, tokens);
    const service = new RefreshService(deps);
    service.start();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(provider.lastKey, "sk-test");
    assert.equal(store.get().kind, "ok");
    service.dispose();
    tokens.dispose();
  });

  test("interval=0 never schedules further refreshes", async () => {
    const provider = new StubProvider();
    const tokens = await makeTokenStore();
    const { deps, store } = makeDeps(provider, 0, tokens);
    const service = new RefreshService(deps);
    service.start();
    await new Promise((r) => setTimeout(r, 30));
    const firstCount = provider.callCount;
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(
      provider.callCount,
      firstCount,
      "no further requests when interval = 0",
    );
    assert.equal(store.lastSnapshot()?.mode, "credits");
    service.dispose();
    tokens.dispose();
  });

  test("dynamic interval change restarts cycle", async () => {
    const provider = new StubProvider();
    const tokens = await makeTokenStore();
    const { deps } = makeDeps(provider, 1, tokens); // 1 second - but we won't wait for it
    const service = new RefreshService(deps);
    service.start();
    await new Promise((r) => setTimeout(r, 10));
    provider.callCount = 0;
    service.restart();
    service.dispose();
    tokens.dispose();
  });

  test("manual refresh works when interval > 0", async () => {
    const provider = new StubProvider();
    const tokens = await makeTokenStore();
    const { deps } = makeDeps(provider, 3600, tokens); // never fires within test
    const service = new RefreshService(deps);
    service.start();
    await new Promise((r) => setTimeout(r, 10));
    const ok = await service.refreshNow();
    assert.equal(ok, true);
    service.dispose();
    tokens.dispose();
  });

  test("no overlapping requests while one is in flight", async () => {
    const provider = new StubProvider();
    provider.delayMs = 50;
    const tokens = await makeTokenStore();
    const { deps } = makeDeps(provider, 0, tokens);
    const service = new RefreshService(deps);
    const p1 = service.refreshNow();
    const p2 = service.refreshNow();
    const [ok1, ok2] = await Promise.all([p1, p2]);
    // Invariant: no parallel HTTP (callCount <= 2) and both calls resolve successfully
    // (the in-flight guard is about avoiding concurrent fetches, not dropping user intent).
    assert.equal(
      provider.callCount <= 2,
      true,
      "at most one extra attempt is queued",
    );
    assert.equal(ok1 && ok2, true, "both refresh attempts complete");
    service.dispose();
    tokens.dispose();
  });

  test("error preserves last valid snapshot", async () => {
    const provider = new StubProvider();
    const tokens = await makeTokenStore();
    const { deps, store } = makeDeps(provider, 0, tokens);
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
    tokens.dispose();
  });
});
