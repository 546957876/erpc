import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

describe("application shell layout", () => {
  it("keeps the workspace on one full-height surface", () => {
    expect(styles).toMatch(/html, body, #root\s*\{[^}]*min-height:\s*100%/);
    expect(styles).toMatch(/\.app-shell\s*\{[^}]*min-height:\s*100vh/);
    expect(styles).toMatch(/\.workspace\s*\{[^}]*min-height:\s*calc\(100vh - 64px\)/);
  });
});
