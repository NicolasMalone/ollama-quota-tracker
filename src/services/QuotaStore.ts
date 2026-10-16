import * as vscode from "vscode";
import type { QuotaSnapshot } from "../types/quota";
import type { TokenMeta } from "./TokenStore";

/** Metadata of the token a refresh cycle (or state) refers to. */
export type ActiveTokenMeta = TokenMeta;

export type RefreshState =
  | { kind: "idle"; keyPresent: boolean; activeToken?: ActiveTokenMeta }
  | { kind: "loading"; keyPresent: boolean; activeToken?: ActiveTokenMeta }
  | { kind: "ok"; snapshot: QuotaSnapshot; activeToken?: ActiveTokenMeta }
  | {
      kind: "error";
      snapshot?: QuotaSnapshot;
      message: string;
      activeToken?: ActiveTokenMeta;
    };

/**
 * Holds the latest known quota state and notifies the UI on each change.
 * Errors never erase the last valid snapshot.
 */
export class QuotaStore implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<RefreshState>();
  private current: RefreshState;
  private lastValid: QuotaSnapshot | undefined;
  private lastValidTokenId: string | undefined;

  constructor(initial: RefreshState = { kind: "idle", keyPresent: false }) {
    this.current = initial;
  }

  readonly onDidChange = this.emitter.event;

  get(): RefreshState {
    return this.current;
  }

  set(next: RefreshState): void {
    this.current = next;
    if (next.kind === "ok") {
      this.lastValid = next.snapshot;
      this.lastValidTokenId = next.activeToken?.id;
    } else if (
      next.kind === "loading" &&
      next.activeToken !== undefined &&
      this.lastValidTokenId !== undefined &&
      next.activeToken.id !== this.lastValidTokenId
    ) {
      // The active token changed while the previous snapshot was still
      // stored: the stale data belongs to a DIFFERENT token, so it must not
      // be presented as if it were the new one's quota.
      this.lastValid = undefined;
      this.lastValidTokenId = undefined;
    }
    this.emitter.fire(next);
  }

  /** Last known valid snapshot of the CURRENT token, if any. */
  lastSnapshot(): QuotaSnapshot | undefined {
    return this.lastValid;
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
