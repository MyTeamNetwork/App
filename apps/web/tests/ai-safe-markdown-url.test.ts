/**
 * Unit tests for the assistant markdown URL sanitizer.
 *
 * Guards the zero-click exfiltration surface: prompt-injected assistant output
 * must not be able to emit an auto-loading image or a dangerous-scheme link.
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { safeUrl } from "../src/lib/ai/safe-markdown-url.ts";

describe("safeUrl", () => {
  it("allows http(s) and mailto absolute URLs", () => {
    assert.equal(safeUrl("https://example.com/x"), "https://example.com/x");
    assert.equal(safeUrl("http://example.com"), "http://example.com");
    assert.equal(safeUrl("HTTPS://Example.com"), "HTTPS://Example.com");
    assert.equal(safeUrl("mailto:a@b.com"), "mailto:a@b.com");
  });

  it("allows relative and anchor URLs", () => {
    assert.equal(safeUrl("/relative/path"), "/relative/path");
    assert.equal(safeUrl("#anchor"), "#anchor");
    assert.equal(safeUrl("./x"), "./x");
    assert.equal(safeUrl("?q=1"), "?q=1");
    assert.equal(safeUrl("/path:with:colon"), "/path:with:colon");
  });

  it("neutralizes dangerous schemes", () => {
    assert.equal(safeUrl("javascript:alert(1)"), "");
    assert.equal(safeUrl("JavaScript:alert(1)"), "");
    assert.equal(safeUrl("data:text/html,<script>"), "");
    assert.equal(safeUrl("vbscript:msgbox"), "");
    assert.equal(safeUrl("file:///etc/passwd"), "");
  });

  it("rejects protocol-relative URLs (would resolve to https and exfiltrate)", () => {
    assert.equal(safeUrl("//attacker.com/x"), "");
    assert.equal(safeUrl("//attacker.com"), "");
    assert.equal(safeUrl("\\\\attacker.com/x"), "");
    assert.equal(safeUrl("\\attacker.com/x"), "");
    assert.equal(safeUrl(" \t//attacker.com/x"), "");
    assert.equal(safeUrl("\u0000\\\\attacker.com/x"), "");
  });
});
