import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const alumniClientSource = fs.readFileSync(
  path.join(process.cwd(), "src/app/enterprise/[enterpriseSlug]/alumni/AlumniClient.tsx"),
  "utf8"
);

test("alumni drawer retains its selected record while the exit transition runs", () => {
  const drawerUsage = alumniClientSource.match(/<AlumniContactDrawer[\s\S]*?\/>/)?.[0];

  assert.ok(drawerUsage, "expected AlumniClient to render AlumniContactDrawer");
  assert.doesNotMatch(
    drawerUsage,
    /setSelectedAlumni\(null\)/,
    "closing the drawer must not clear its content before the exit transition unmounts it"
  );
});
