import test from "node:test";
import assert from "node:assert/strict";

const { mapBrightDataToFields, isBrightDataConfigured } = await import(
  "@/lib/linkedin/bright-data"
);

test("mapBrightDataToFields extracts current job and school", () => {
  const result = mapBrightDataToFields({
    linkedin_id: "john-doe-123",
    name: "John Doe",
    city: "San Francisco",
    country_code: "US",
    current_company_name: "Acme Corp",
    about: "Building things",
    experience: [
      {
        title: "Senior Engineer",
        company: "Acme Corp",
        company_url: null,
        location: "San Francisco, CA",
        start_date: "2024-03",
        end_date: null,
        description: "Building scalable systems",
      },
      {
        title: "Engineer",
        company: "OldCo",
        company_url: null,
        location: null,
        start_date: "2020-01",
        end_date: "2024-02",
        description: null,
      },
    ],
    education: [
      {
        school: "State University",
        degree: "BS",
        field_of_study: "Computer Science",
        start_date: "2016",
        end_date: "2020",
      },
    ],
    avatar: null,
    followers: 500,
    connections: 300,
  });

  assert.equal(result.job_title, "Senior Engineer");
  assert.equal(result.current_company, "Acme Corp");
  assert.equal(result.current_city, "San Francisco");
  assert.equal(result.school, "State University");
  assert.equal(result.major, "Computer Science");
  assert.equal(result.position_title, "Senior Engineer");
  assert.equal(result.industry, null);
});

test("mapBrightDataToFields falls back when no experiences", () => {
  const result = mapBrightDataToFields({
    linkedin_id: null,
    name: "Jane Doe",
    city: null,
    country_code: null,
    current_company_name: null,
    about: null,
    experience: [],
    education: [],
    avatar: null,
    followers: null,
    connections: null,
  });

  assert.equal(result.job_title, null);
  assert.equal(result.current_company, null);
  assert.equal(result.current_city, null);
  assert.equal(result.school, null);
  assert.equal(result.major, null);
});

test("mapBrightDataToFields uses first experience when all have end dates", () => {
  const result = mapBrightDataToFields({
    linkedin_id: null,
    name: null,
    city: "Austin",
    country_code: null,
    current_company_name: null,
    about: null,
    experience: [
      {
        title: "Consultant",
        company: "MostRecent Inc",
        company_url: null,
        location: null,
        start_date: "2023-01",
        end_date: "2023-12",
        description: null,
      },
    ],
    education: [],
    avatar: null,
    followers: null,
    connections: null,
  });

  assert.equal(result.job_title, "Consultant");
  assert.equal(result.current_company, "MostRecent Inc");
  assert.equal(result.current_city, "Austin");
});

test("isBrightDataConfigured returns false when env var is missing", () => {
  const original = process.env.BRIGHT_DATA_API_KEY;
  delete process.env.BRIGHT_DATA_API_KEY;
  assert.equal(isBrightDataConfigured(), false);
  if (original) process.env.BRIGHT_DATA_API_KEY = original;
});

test("isBrightDataConfigured returns true when env var is set", () => {
  const original = process.env.BRIGHT_DATA_API_KEY;
  process.env.BRIGHT_DATA_API_KEY = "test-key";
  assert.equal(isBrightDataConfigured(), true);
  if (original) {
    process.env.BRIGHT_DATA_API_KEY = original;
  } else {
    delete process.env.BRIGHT_DATA_API_KEY;
  }
});
