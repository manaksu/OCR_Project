// CLI: process the sample transplant bundle and print the roll-up.
import { processBundle } from "./src/bundle.js";

const b = await processBundle("bundle");
const money = (n) => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2 });

console.log(`\nTransplant bundle — ${b.documentCount} documents, ${b.reviewCount} need review, ${b.tokenTotal} tokens\n`);
console.log("Per document:");
for (const d of b.documents) {
  console.log(`  ${d.formType.padEnd(9)} ${d.provider.padEnd(34)} ${d.category.padEnd(18)} ${money(d.charge)}`);
}
console.log("\nPer category:");
for (const c of b.byCategory) console.log(`  ${c.key.padEnd(20)} ${money(c.charge)}`);
console.log("\nReconciliation:");
console.log(`  Grand total billed : ${money(b.grandTotal)}`);
console.log(`  Contracted case rate: ${money(b.caseRate)}`);
console.log(`  Variance           : ${(b.variance >= 0 ? "+" : "") + money(b.variance)} (${b.variance >= 0 ? "over" : "under"} case rate)`);
