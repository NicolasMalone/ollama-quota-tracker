import { strict as assert } from "assert";
import { TokenStore, type TokenStoreDeps } from "../../services/TokenStore";

/** In-memory SecretStorage/Memento doubles matching the TokenStore deps. */
function makeDeps(): TokenStoreDeps & {
  secretBlob: Map<string, string>;
  state: Map<string, unknown>;
} {
  const secretBlob = new Map<string, string>();
  const state = new Map<string, unknown>();
  return {
    secretBlob,
    state,
    secrets: {
      get: async (k) => secretBlob.get(k),
      store: async (k, v) => void secretBlob.set(k, v),
      delete: async (k) => void secretBlob.delete(k),
    },
    globalState: {
      get: (k) => state.get(k),
      update: async (k, v) => void state.set(k, v),
    },
  };
}

const LEGACY_SECRET = "ollamaQuota.apiKey";

suite("TokenStore", () => {
  test("add/list: keys never leak through list", async () => {
    const deps = makeDeps();
    const store = new TokenStore(deps);
    const meta = await store.add("Personal", "sk-aaa");
    assert.equal(meta.name, "Personal");
    const all = await store.list();
    assert.equal(all.length, 1);
    assert.deepEqual(all[0], { id: meta.id, name: "Personal" });
    // The secret blob holds the key, list() does not expose it.
    assert.ok(JSON.stringify(all).includes("sk-aaa") === false);
    assert.equal((await store.getActive())?.key, "sk-aaa");
    store.dispose();
  });

  test("add: empty key rejected with validation error", async () => {
    const deps = makeDeps();
    const store = new TokenStore(deps);
    await assert.rejects(() => store.add("X", "   "), /Empty API key/);
    store.dispose();
  });

  test("add: empty name falls back to a non-colliding Token N", async () => {
    const deps = makeDeps();
    const store = new TokenStore(deps);
    const t1 = await store.add("", "sk-1");
    assert.equal(t1.name, "Token 1");
    const t2 = await store.add("  ", "sk-2");
    assert.equal(t2.name, "Token 2");
    const t3 = await store.add("Token 2", "sk-3");
    assert.equal(t3.name, "Token 2");
    const t4 = await store.add("", "sk-4");
    assert.equal(t4.name, "Token 3" /* 1,2 taken; 3 free */);
    store.dispose();
  });

  test("first added token becomes active automatically", async () => {
    const deps = makeDeps();
    const store = new TokenStore(deps);
    const t1 = await store.add("A", "sk-1");
    assert.equal(store.getActiveId(), t1.id);
    const active = await store.getActive();
    assert.equal(active?.key, "sk-1");
    store.dispose();
  });

  test("setActive switches and fires onDidChangeActive", async () => {
    const deps = makeDeps();
    const store = new TokenStore(deps);
    await store.add("A", "sk-1");
    const t2 = await store.add("B", "sk-2");
    const fired: (string | undefined)[] = [];
    store.onDidChangeActive((id) => fired.push(id));
    await store.setActive(t2.id);
    assert.deepEqual(fired, [t2.id]);
    assert.equal((await store.getActive())?.name, "B");
    // Unknown ids throw and do not fire.
    await assert.rejects(() => store.setActive("nope"), /Unknown token id/);
    assert.equal(fired.length, 1);
    store.dispose();
  });

  test("remove: active token removed → first remaining becomes active", async () => {
    const deps = makeDeps();
    const store = new TokenStore(deps);
    const t1 = await store.add("A", "sk-1");
    const t2 = await store.add("B", "sk-2");
    await store.setActive(t2.id);
    await store.remove(t2.id);
    assert.equal(store.getActiveId(), t1.id);
    assert.equal((await store.getActive())?.key, "sk-1");
    // Removing the last one leaves no active id.
    await store.remove(t1.id);
    assert.equal(store.getActiveId(), undefined);
    assert.equal(await store.hasAny(), false);
    store.dispose();
  });

  test("rename works and unknown id throws", async () => {
    const deps = makeDeps();
    const store = new TokenStore(deps);
    const t1 = await store.add("A", "sk-1");
    await store.rename(t1.id, "Renamed");
    const all = await store.list();
    assert.equal(all[0]!.name, "Renamed");
    await assert.rejects(() => store.rename("nope", "X"), /Unknown token id/);
    store.dispose();
  });

  test("migrateFromLegacy imports the legacy key as Default and deletes it", async () => {
    const deps = makeDeps();
    await deps.secrets.store(LEGACY_SECRET, "sk-legacy");
    const store = new TokenStore(deps);
    await store.migrateFromLegacy();
    const all = await store.list();
    assert.equal(all.length, 1);
    assert.equal(all[0]!.name, "Default");
    assert.equal((await store.getActive())?.key, "sk-legacy");
    // Legacy entry removed after migration.
    const legacyGone = (await deps.secrets.get(LEGACY_SECRET)) === undefined;
    assert.equal(legacyGone, true);
    // Active token points at the migrated one.
    assert.equal((await store.getActive())?.name, "Default");
    store.dispose();
  });

  test("migrateFromLegacy is a no-op when tokens already exist", async () => {
    const deps = makeDeps();
    await deps.secrets.store(LEGACY_SECRET, "sk-legacy");
    const store = new TokenStore(deps);
    await store.add("Existing", "sk-1");
    await store.migrateFromLegacy();
    assert.equal(await store.list().then((l) => l.length), 1);
    assert.equal((await store.getActive())?.key, "sk-1");
    store.dispose();
  });

  test("migrateFromLegacy no-op without legacy key", async () => {
    const deps = makeDeps();
    const store = new TokenStore(deps);
    await store.migrateFromLegacy();
    assert.equal(await store.hasAny(), false);
    store.dispose();
  });

  test("corrupted blob is tolerated as empty", async () => {
    const deps = makeDeps();
    await deps.secrets.store("ollamaQuota.keys", "not-json{");
    const store = new TokenStore(deps);
    assert.deepEqual(await store.list(), []);
    assert.equal(await store.hasAny(), false);
    store.dispose();
  });
});
