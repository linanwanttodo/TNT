import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { describe, expect, it } from "vitest";

const cliRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const vendorRoot = path.resolve(cliRoot, "..", "zcode-ui");

// node_modules and dist are install/build outputs, absent from a fresh checkout.
// Counting them would make the frozen number depend on the local machine.
function isVendoredSource(entry: string): boolean {
  if (!/\.(ts|tsx)$/.test(entry)) return false;
  const segments = entry.split(/[\\/]/);
  return !segments.includes("node_modules") && !segments.includes("dist");
}

describe("vendored zcode-ui closure", () => {
  it("keeps every package manifest free of workspace protocol", () => {
    for (const name of fs.readdirSync(vendorRoot)) {
      const manifest = path.join(vendorRoot, name, "package.json");
      if (!fs.existsSync(manifest)) continue;
      expect(fs.readFileSync(manifest, "utf8")).not.toContain("workspace:*");
    }
  });

  it("matches the frozen naming ledger for the vendored area", () => {
    const total = fs
      .readdirSync(vendorRoot, { recursive: true })
      .filter(
        (entry): entry is string =>
          typeof entry === "string" && isVendoredSource(entry),
      )
      .reduce((sum, entry) => {
        const text = fs.readFileSync(path.join(vendorRoot, entry), "utf8");
        return sum + (text.split("Continue").length - 1);
      }, 0);
    expect(total).toBe(138);
  });
});
