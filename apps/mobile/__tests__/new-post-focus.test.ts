import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("New Post input focus", () => {
  it("does not focus until the native-stack transition finishes", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "app/(app)/(drawer)/[orgSlug]/feed/new.tsx",
      ),
      "utf8",
    );

    expect(source).not.toMatch(/\bautoFocus\b/);
    expect(source).toContain("ref={bodyInputRef}");
    expect(source).toContain('navigation.addListener("transitionEnd"');
    expect(source).toContain("if (!event.data.closing && active)");
    expect(source).toContain("bodyInputRef.current?.focus()");
    expect(source).toContain("unsubscribe()");
  });
});
