import fs from "fs";
import path from "path";

/**
 * Hook fixtures that run on every supported operating system.
 *
 * `hookRunner` picks `cmd.exe` on Windows and `/bin/sh` elsewhere, so a test
 * whose command string is `printf '...'`, `sh -c '...'` or `$((n+1))` does not
 * test the hook engine there - it tests whether cmd.exe understands POSIX, and
 * every case reports a plain `false`/`0` instead of an assertion about hooks.
 * Twelve cases failed that way on the first `windows-latest` run.
 *
 * Node is the one interpreter both shells can be relied on to launch, and the
 * CLI already ships it, so each behavior is a script and the command is two
 * double-quoted words - the one quoting style `cmd.exe` and `/bin/sh` agree on.
 */
export class HookFixtures {
  private counter = 0;
  private readonly root: string;
  private readonly printScript: string;

  constructor(dir: string) {
    this.root = path.join(dir, "hook-fixtures");
    fs.mkdirSync(this.root, { recursive: true });
    this.printScript = this.write(
      "print.mjs",
      `import fs from "node:fs";
const [payloadFile, token] = process.argv.slice(2);
let text = fs.readFileSync(payloadFile, "utf8");
if (token) text = text.split(token).join(process.env.CLAUDE_PROJECT_DIR ?? "");
process.stdout.write(text);
`,
    );
    this.write(
      "bump.mjs",
      `import fs from "node:fs";
const file = process.argv[2];
const next = (fs.existsSync(file) ? Number(fs.readFileSync(file, "utf8")) || 0 : 0) + 1;
fs.writeFileSync(file, String(next));
`,
    );
    this.write(
      "spawnTree.mjs",
      `import fs from "node:fs";
import { spawn } from "node:child_process";
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  stdio: "ignore",
});
fs.writeFileSync(process.argv[2], String(child.pid));
// The hook must stay running until the engine kills the tree, the way
// \`sh -c 'sleep 30 & ...; wait'\` did.
setTimeout(() => {}, 60_000).unref?.();
setInterval(() => {}, 1000);
`,
    );
  }

  private write(name: string, contents: string): string {
    const file = path.join(this.root, name);
    fs.writeFileSync(file, contents);
    return file;
  }

  private payload(text: string): string {
    return this.write(`payload-${this.counter++}.txt`, text);
  }

  /** A command printing exactly `text` on stdout. */
  echo(text: string): string {
    return quoted(process.execPath, this.printScript, this.payload(text));
  }

  /**
   * A command printing `text` with every `{{projectDir}}` replaced by the
   * `CLAUDE_PROJECT_DIR` the engine exports for the hook.
   */
  echoWithProjectDir(text: string): string {
    return quoted(
      process.execPath,
      this.printScript,
      this.payload(text),
      "{{projectDir}}",
    );
  }

  /** A command writing `1`, then `2`, ... into `file` - the counter `once` uses. */
  bump(file: string): string {
    return quoted(process.execPath, path.join(this.root, "bump.mjs"), file);
  }

  /**
   * A long-running command that records a *child* pid in `pidFile`, so killing
   * the hook alone leaves the grandchild alive and the test can tell the
   * difference.
   */
  spawnTree(pidFile: string): string {
    return quoted(
      process.execPath,
      path.join(this.root, "spawnTree.mjs"),
      pidFile,
    );
  }
}

function quoted(...parts: string[]): string {
  return parts.map((part) => `"${part}"`).join(" ");
}
