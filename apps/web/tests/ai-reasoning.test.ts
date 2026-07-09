import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stripModelReasoning } from "../src/lib/ai/reasoning.ts";

describe("stripModelReasoning", () => {
  it("removes a closed <thinking> block that is the entire content", () => {
    const input =
      "<thinking> The user asked for members. I will call list_members. </thinking>";
    assert.equal(stripModelReasoning(input), "");
  });

  it("keeps the answer when reasoning precedes real text", () => {
    const input =
      "<thinking>I should call get_org_stats.</thinking>\n\nYou have 35 active members.";
    assert.equal(stripModelReasoning(input), "You have 35 active members.");
  });

  it("keeps the answer when reasoning follows real text", () => {
    const input = "You have 35 active members.<thinking>done</thinking>";
    assert.equal(stripModelReasoning(input), "You have 35 active members.");
  });

  it("removes multiple reasoning blocks", () => {
    const input = "<thinking>a</thinking>Hello<thinking>b</thinking> world";
    assert.equal(stripModelReasoning(input), "Hello world");
  });

  it("removes a multi-line reasoning block", () => {
    const input = "<thinking>\nline one\nline two\n</thinking>\nAnswer here.";
    assert.equal(stripModelReasoning(input), "Answer here.");
  });

  it("removes an unclosed reasoning block truncated at end of string", () => {
    const input = "Partial answer. <thinking>I was cut off mid reasoning and never";
    assert.equal(stripModelReasoning(input), "Partial answer.");
  });

  it("removes an unclosed reasoning block that is the whole content", () => {
    const input = "<thinking>To answer this I need to use the get_org_stats tool with";
    assert.equal(stripModelReasoning(input), "");
  });

  it("is case-insensitive on the tag", () => {
    const input = "<Thinking>reasoning</THINKING>Answer";
    assert.equal(stripModelReasoning(input), "Answer");
  });

  it("handles the <think> variant", () => {
    const input = "<think>reasoning</think>Answer";
    assert.equal(stripModelReasoning(input), "Answer");
  });

  it("passes through text with no reasoning unchanged", () => {
    const input = "You have 35 active members and 3 upcoming events.";
    assert.equal(stripModelReasoning(input), input);
  });

  it("returns empty string input unchanged", () => {
    assert.equal(stripModelReasoning(""), "");
  });

  it("does not alter a legitimate mention of the word thinking", () => {
    const input = "I'm thinking you have 35 members.";
    assert.equal(stripModelReasoning(input), input);
  });
});
