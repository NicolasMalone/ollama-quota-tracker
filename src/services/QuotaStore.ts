import * as vscode from "vscode";
import type { QuotaSnapshot } from "../types/quota";

export type RefreshState =
  | { kind: "idle"; keyPresent: boolean }
  | { kind: "loading"; keyPresent: boolean }
  | { kind: "ok"; snapshot: QuotaSnapshot }
  | { kind: "error"; snapshot?: QuotaSnapshot; message: string };

/**
 * Holds the latest known quota state and notifies the UI on each change.
 * Errors never erase the last valid snapshot.
 */
export class QuotaStore implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<RefreshState>();
  private current: RefreshState;
  private lastValid: QuotaSnapshot | undefined;

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
    }
    this.emitter.fire(next);
  }

  /** Last known valid snapshot, if any (survives loading and error states). */
  lastSnapshot(): QuotaSnapshot | undefined {
    return this.lastValid;
  }

  dispose(): void {
    this.emitter.dispose();
  }
}