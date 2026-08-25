import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const componentDir = join(process.cwd(), "src", "components");
const componentFiles = readdirSync(componentDir).filter((name) => name.endsWith(".tsx"));

function componentSource(name: string) {
  return readFileSync(join(componentDir, name), "utf8");
}

describe("production UI copy", () => {
  it("contains no common UTF-8 mojibake markers", () => {
    const forbidden = ["Â·", "â†’", "â€¦", "Ã", "�", "ðŸ", "â€"];
    for (const file of componentFiles) {
      const source = componentSource(file);
      for (const marker of forbidden) expect(source, `${file} contains ${marker}`).not.toContain(marker);
    }
  });

  it("does not expose internal task or migration labels in user-facing copy", () => {
    const evaluation = componentSource("evaluation-workspace.tsx");
    const jira = componentSource("jira-workspace.tsx");
    const insights = componentSource("insights-workspace.tsx");
    expect(evaluation).not.toContain("Until T08");
    expect(jira).not.toContain("Integration · T08");
    expect(jira).not.toContain("T08-B snapshots");
    expect(insights).not.toContain("migration 0012");
  });

  it("keeps corrected administration table labels", () => {
    const administration = componentSource("administration-workspace.tsx");
    expect(administration).toContain('["User","Role","User status","Access status"]');
    expect(administration).not.toContain('["User","Role","User","Access"]');
  });
});
