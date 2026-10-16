import * as vscode from "vscode";

/**
 * Shared "add token" flow used by both entry points (QuickPick command and
 * the dashboard webview): collects name + key through two input boxes and
 * returns the created token metadata, or undefined when cancelled/failed.
 * Single place to evolve validation or copy.
 */
export async function promptAddToken(
  add: (name: string, key: string) => Promise<{ id: string; name: string }>,
  logError?: (message: string) => void,
): Promise<{ id: string; name: string } | undefined> {
  const name = await vscode.window.showInputBox({
    prompt: "Token name (e.g. Personal, Work)",
    placeHolder: "Personal",
    ignoreFocusOut: true,
  });
  if (name === undefined) {
    return undefined; // cancelled
  }
  const key = await vscode.window.showInputBox({
    prompt:
      "API key for this token (created at https://ollama.com/settings/keys)",
    password: true,
    ignoreFocusOut: true,
    placeHolder: "sk-...",
    validateInput: (v) =>
      v.trim().length === 0 ? "Empty API key" : undefined,
  });
  if (!key || key.trim().length === 0) {
    return undefined;
  }
  try {
    return await add(name, key);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`Ollama Quota: ${message}`);
    logError?.(message);
    return undefined;
  }
}