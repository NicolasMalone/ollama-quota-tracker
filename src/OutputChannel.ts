import * as vscode from "vscode";

/**
 * Tiny wrapper over an OutputChannel for technical logging.
 * Never log API keys or full response bodies here.
 */
export class OutputChannel implements vscode.Disposable {
  private readonly channel: vscode.LogOutputChannel;

  constructor(name: string) {
    this.channel = vscode.window.createOutputChannel(name, { log: true });
  }

  info(message: string): void {
    this.channel.info(message);
  }

  error(message: string): void {
    this.channel.error(message);
  }

  show(): void {
    this.channel.show();
  }

  dispose(): void {
    this.channel.dispose();
  }
}