import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  mapBrightDataToFields,
  isBrightDataConfigured,
  type BrightDataProfileResult,
} from "../src/lib/linkedin/bright-data";

describe("Bright Data LinkedIn client", () => {
  let savedKey: string | undefined;

  beforeEach(() => {
    savedKey = process.env.BRIGHT_DATA_API_KEY;
  });

  afterEach(() => {
    if (savedKey === undefined) {
      delete process.env.BRIGHT_DATA_API_KEY;
    } else {
      process.env.BRIGHT_DATA_API_KEY = savedKey;
    }
  });

  describe("isBrightDataConfigured", () => {
    it("returns true when API key is set", () => {
      process.env.BRIGHT_DATA_API_KEY = "test-key-123";
      assert.equal(isBrightDataConfigured(), true);
    });

    it("returns false when API key is missing", () => {
      delete process.env.BRIGHT_DATA_API_KEY;
      assert.equal(isBrightDataConfigured(), false);
    });

    it("returns false when API key is empty string", () => {
      process.env.BRIGHT_DATA_API_KEY = "";
      assert.equal(isBrightDataConfigured(), false);
    });

    it("returns false when API key is whitespace", () => {
      process.env.BRIGHT_DATA_API_KEY = "   ";
      assert.equal(isBrightDataConfigured(), false);
    });
  });

  describe("mapBrightDataToFields", () => {
    it("extracts current job from experience with no end_date", () => {
      const profile: BrightDataProfileResult = {
        name: "Jane Doe",
        city: "San Francisco",
        current_company_name: "Acme Corp",
        experience: [
          { title: "CEO", company: "Acme Corp", location: "SF", end_date: null },
          { title: "CTO", company: "Old Co", location: "NY", end_date: "2022-12" },
        ],
        education: [
          { school: "MIT", field_of_study: "Computer Science" },
        ],
      };

      const fields = mapBrightDataToFields(profile);

      assert.equal(fields.job_title, "CEO");
      assert.equal(fields.current_company, "Acme Corp");
      assert.equal(fields.current_city, "San Francisco");
      assert.equal(fields.school, "MIT");
      assert.equal(fields.major, "Computer Science");
      assert.equal(fields.position_title, "CEO");
      assert.equal(fields.industry, null);
    });

    it("falls back to first experience when none has null end_date", () => {
      const profile: BrightDataProfileResult = {
        name: "Bob",
        city: null,
        current_company_name: null,
        experience: [
          { title: "Engineer", company: "OldCo", location: "LA", end_date: "2023" },
        ],
        education: [],
      };

      const fields = mapBrightDataToFields(profile);

      assert.equal(fields.job_title, "Engineer");
      assert.equal(fields.current_company, "OldCo");
      assert.equal(fields.current_city, "LA");
      assert.equal(fields.school, null);
      assert.equal(fields.major, null);
    });

    it("handles empty profile gracefully", () => {
      const profile: BrightDataProfileResult = {
        name: null,
        city: null,
        current_company_name: null,
        experience: [],
        education: [],
      };

      const fields = mapBrightDataToFields(profile);

      assert.equal(fields.job_title, null);
      assert.equal(fields.current_company, null);
      assert.equal(fields.current_city, null);
      assert.equal(fields.school, null);
      assert.equal(fields.major, null);
      assert.equal(fields.position_title, null);
    });

    it("uses current_company_name over experience company", () => {
      const profile: BrightDataProfileResult = {
        name: null,
        city: null,
        current_company_name: "Top-Level Company",
        experience: [
          { title: "Dev", company: "Experience Co", location: null, end_date: null },
        ],
        education: [],
      };

      const fields = mapBrightDataToFields(profile);
      assert.equal(fields.current_company, "Top-Level Company");
    });

    it("handles non-array experience/education gracefully", () => {
      const profile = {
        name: null,
        city: null,
        current_company_name: null,
        experience: null as unknown as BrightDataProfileResult["experience"],
        education: "invalid" as unknown as BrightDataProfileResult["education"],
      };

      const fields = mapBrightDataToFields(profile);
      assert.equal(fields.job_title, null);
      assert.equal(fields.school, null);
    });
  });
});
