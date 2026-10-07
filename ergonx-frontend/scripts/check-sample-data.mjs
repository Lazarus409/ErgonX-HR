// Fails when Stitch design-reference sample data leaks into the app source.
// Stitch screens are visual references only; their names and claims are not
// facts about any institution (Wave 0 discrepancy D2-024).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SAMPLES = [
  "Rivermere",
  "Academic Affairs",
  "Acme University",
  "Aris Thorne",
  "Elena Vance",
  "us-east-1",
  "SOC 2 Type",
  "256-bit SSL",
  "Higher Education #9041",
];

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(tsx?|css|json|md)$/.test(name)) yield path;
  }
}

const hits = [];
for (const path of files("src")) {
  const text = readFileSync(path, "utf8");
  for (const sample of SAMPLES) if (text.includes(sample)) hits.push(`${path}: "${sample}"`);
}
if (hits.length) {
  console.error("Stitch sample data found in source:\n" + hits.join("\n"));
  process.exit(1);
}
console.log("No Stitch sample data in src/.");
