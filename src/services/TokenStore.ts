import * as vscode from "vscode";

/** A named Ollama API key (Bearer token) persisted in SecretStorage. */
export interface NamedToken {
  id: string;
  name: string;
  /** The secret itself; never exposed by list(). */
  key: string;
}

/** Token entry without the secret, safe for UI lists. */
export type TokenMeta = Pick<NamedToken, "id" | "name">;

/** Minimal surface of SecretStorage used by TokenStore (stub-friendly). */
export type SecretStore = Pick<
  vscode.SecretStorage,
  "get" | "store" | "delete"
>;
/** Minimal surface of Memento used by TokenStore (stub-friendly). */
export type StateStore = Pick<vscode.Memento, "get" | "update">;

export interface TokenStoreDeps {
  secrets: SecretStore;
  globalState: StateStore;
}

const TOKENS_SECRET = "ollamaQuota.keys";
const ACTIVE_KEY = "ollamaQuota.activeTokenId";
const LEGACY_KEY = "ollamaQuota.apiKey";

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class TokenStore implements vscode.Disposable {
  private readonly secrets: SecretStore;
  private readonly globalState: StateStore;
  private readonly activeEmitter = new vscode.EventEmitter<
    string | undefined
  >();

  constructor(deps: TokenStoreDeps) {
    this.secrets = deps.secrets;
    this.globalState = deps.globalState;
  }

  /** Fired with the new active token id (or undefined when none). */
  readonly onDidChangeActive = this.activeEmitter.event;

  dispose(): void {
    this.activeEmitter.dispose();
  }

  /* ---------------------------------------------------------------------- */
  /* Reading                                                                 */
  /* ---------------------------------------------------------------------- */

  /** All tokens WITHOUT their secrets, in stored order. */
  async list(): Promise<TokenMeta[]> {
    const tokens = await this.readTokens();
    return tokens.map(({ id, name }) => ({ id, name }));
  }

  /** The active token id, or undefined when none. */
  getActiveId(): string | undefined {
    return this.globalState.get<string>(ACTIVE_KEY);
  }

  /** The active token metadata (with its key), or undefined when none. */
  async getActive(): Promise<NamedToken | undefined> {
    const tokens = await this.readTokens();
    if (tokens.length === 0) {
      return undefined;
    }
    const activeId = this.getActiveId();
    const found = tokens.find((t) => t.id === activeId);
    // Defensive: the stored active id may be stale (e.g. blob edited
    // elsewhere); fall back to the first token instead of surfacing none.
    return found ?? tokens[0];
  }

  /** True when at least one token exists. */
  async hasAny(): Promise<boolean> {
    return (await this.readTokens()).length > 0;
  }

  /* ---------------------------------------------------------------------- */
  /* Mutation                                                                */
  /* ---------------------------------------------------------------------- */

  /** Adds a token. Empty names become "Token N" (stored order). */
  async add(name: string, key: string): Promise<TokenMeta> {
    const trimmedKey = key.trim();
    if (trimmedKey.length === 0) {
      throw new ValidationError("Empty API key");
    }
    const tokens = await this.readTokens();
    const meta: TokenMeta = {
      id: makeId(),
      name: this.normalizeName(name, tokens),
    };
    tokens.push({ ...meta, key: trimmedKey });
    await this.writeTokens(tokens);
    if (tokens.length === 1) {
      await this.setActive(meta.id);
    }
    return meta;
  }

  /** Renames a token by id. Throws when the id does not exist. */
  async rename(id: string, name: string): Promise<void> {
    const tokens = await this.readTokens();
    const token = tokens.find((t) => t.id === id);
    if (!token) {
      throw new ValidationError("Unknown token id");
    }
    token.name = this.normalizeName(
      name,
      tokens.filter((t) => t.id !== id),
    );
    await this.writeTokens(tokens);
  }

  /**
   * Removes a token by id. When the active token is removed, the first
   * remaining token becomes active; removing the last one clears the
   * selection instead of pointing at a ghost id.
   */
  async remove(id: string): Promise<void> {
    const tokens = await this.readTokens();
    const index = tokens.findIndex((t) => t.id === id);
    if (index === -1) {
      return;
    }
    const wasActive = this.getActiveId() === id;
    tokens.splice(index, 1);
    await this.writeTokens(tokens);
    if (wasActive) {
      await this.assignActive(tokens[0]?.id);
    }
  }

  /** Sets the active token by id; throws on unknown ids. */
  async setActive(id: string): Promise<void> {
    const tokens = await this.readTokens();
    if (!tokens.some((t) => t.id === id)) {
      throw new ValidationError("Unknown token id");
    }
    await this.assignActive(id);
  }

  /** Assigns (or clears) the active id and fires the change event. */
  private async assignActive(id: string | undefined): Promise<void> {
    if (this.getActiveId() === id) {
      return;
    }
    await this.globalState.update(ACTIVE_KEY, id);
    this.activeEmitter.fire(id);
  }

  /* ---------------------------------------------------------------------- */
  /* Migration                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * one-time migration: when no tokens exist and the legacy single key
   * (`ollamaQuota.apiKey`) is present, imports it as token "Default",
   * activates it and deletes the legacy entry.
   */
  async migrateFromLegacy(): Promise<void> {
    const tokens = await this.readTokens();
    if (tokens.length > 0) {
      return;
    }
    const legacy = await this.secrets.get(LEGACY_KEY);
    if (typeof legacy !== "string" || legacy.length === 0) {
      return;
    }
    const meta = await this.add("Default", legacy);
    await this.setActive(meta.id);
    await this.secrets.delete(LEGACY_KEY);
  }

  /* ---------------------------------------------------------------------- */
  /* Internals                                                               */
  /* ---------------------------------------------------------------------- */

  private async readTokens(): Promise<NamedToken[]> {
    const raw = await this.secrets.get(TOKENS_SECRET);
    if (typeof raw !== "string" || raw.length === 0) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.filter(isNamedToken);
    } catch {
      return [];
    }
  }

  private async writeTokens(tokens: NamedToken[]): Promise<void> {
    if (tokens.length === 0) {
      await this.secrets.delete(TOKENS_SECRET);
      return;
    }
    // Tokens without an active selection: the first one becomes active so
    // the UI never shows a selection while tokens exist.
    if (this.getActiveId() === undefined) {
      await this.globalState.update(ACTIVE_KEY, tokens[0].id);
    }
    await this.secrets.store(TOKENS_SECRET, JSON.stringify(tokens));
  }

  private normalizeName(name: string, others: { name: string }[]): string {
    const trimmed = name.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
    // "Token N": smallest number which does not collide with other names.
    const taken = new Set(others.map((o) => o.name));
    let n = 1;
    while (taken.has(`Token ${n}`)) {
      n++;
    }
    return `Token ${n}`;
  }
}

/** Ids are unique enough at human scale; no uuid dependency needed. */
function makeId(): string {
  return `tok_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
}

function isNamedToken(value: unknown): value is NamedToken {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const o = value as Partial<NamedToken>;
  return (
    typeof o.id === "string" &&
    o.id.length > 0 &&
    typeof o.name === "string" &&
    typeof o.key === "string"
  );
}
