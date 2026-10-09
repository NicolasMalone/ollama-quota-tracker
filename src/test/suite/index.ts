import * as path from "path";
import * as fs from "fs";
import Mocha from "mocha";

/**
 * Modern test entry point: VS Code's extension host requires this module and
 * calls run() without arguments; the suite locates its own compiled folder via __dirname.
 */
export async function run(): Promise<void> {
  const mocha = new Mocha({
    ui: "tdd",
    color: true,
  });

  const dir = path.join(__dirname);
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".test.js")) {
      files.push(path.join(entry.parentPath ?? (entry as unknown as { path: string }).path, entry.name));
    }
  }

  files.forEach((f) => mocha.addFile(f));
  await new Promise<void>((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} test(s) failed`));
      } else {
        resolve();
      }
    });
  });
}