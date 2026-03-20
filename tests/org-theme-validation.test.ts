import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { safeHexColor } from "@/lib/theming/org-colors";

describe("safeHexColor", () => {
  it("returns valid 6-digit hex colors unchanged", () => {
    assert.equal(safeHexColor("#1e3a5f", "#000000"), "#1e3a5f");
    assert.equal(safeHexColor("#AABBCC", "#000000"), "#AABBCC");
    assert.equal(safeHexColor("#000000", "#ffffff"), "#000000");
    assert.equal(safeHexColor("#ffffff", "#000000"), "#ffffff");
  });

  it("returns fallback for null", () => {
    assert.equal(safeHexColor(null, "#1e3a5f"), "#1e3a5f");
  });

  it("returns fallback for undefined", () => {
    assert.equal(safeHexColor(undefined, "#1e3a5f"), "#1e3a5f");
  });

  it("returns fallback for empty string", () => {
    assert.equal(safeHexColor("", "#1e3a5f"), "#1e3a5f");
  });

  it("rejects 3-digit hex shorthand", () => {
    assert.equal(safeHexColor("#abc", "#1e3a5f"), "#1e3a5f");
  });

  it("rejects hex without # prefix", () => {
    assert.equal(safeHexColor("1e3a5f", "#000000"), "#000000");
  });

  it("rejects CSS injection payloads", () => {
    assert.equal(
      safeHexColor("red; background-image: url(evil)", "#1e3a5f"),
      "#1e3a5f",
    );
    assert.equal(
      safeHexColor("#1e3a5f; content: 'xss'", "#000000"),
      "#000000",
    );
  });

  it("rejects style tag breakout strings", () => {
    assert.equal(
      safeHexColor("</style><script>alert(1)</script>", "#1e3a5f"),
      "#1e3a5f",
    );
  });

  it("rejects 8-digit hex (with alpha)", () => {
    assert.equal(safeHexColor("#1e3a5fff", "#000000"), "#000000");
  });

  it("rejects rgb() notation", () => {
    assert.equal(safeHexColor("rgb(30, 58, 95)", "#1e3a5f"), "#1e3a5f");
  });

  it("rejects non-hex characters after #", () => {
    assert.equal(safeHexColor("#gggggg", "#1e3a5f"), "#1e3a5f");
    assert.equal(safeHexColor("#zzzzzz", "#1e3a5f"), "#1e3a5f");
  });
});
