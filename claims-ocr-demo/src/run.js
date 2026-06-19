// Entry point: run the pipeline on each sample and print the field table.
// In CI this output lands in the GitHub Actions log.
import { process as processClaim } from "./pipeline.js";

const samples = [
  "samples/good_scan.pdf",
  "samples/small_scan.pdf",
  "samples/digital.pdf",
];

for (const s of samples) {
  try {
    const result = await processClaim(s);
    console.log("\n=== " + s + " ===");
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error("FAILED on " + s + ":", e);
    process.exitCode = 1; // Node global
  }
}
