// Minimal viewer server: serves the frontend and exposes the pipeline results.
//   GET /api/samples       -> list of bundled samples
//   GET /api/result/:name  -> OCR + validation + service lines + total (JSON)
//   GET /api/image/:name   -> the rendered claim page (PNG) for display
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { process as processClaim } from "./src/pipeline.js";
import { buildClaimModel } from "./src/claim.js";
import { rasterizePdf } from "./src/rasterize.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES = ["good_scan", "small_scan", "digital"];

const app = express();
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/samples", (_req, res) => res.json(SAMPLES));

app.get("/api/result/:name", async (req, res) => {
  const { name } = req.params;
  if (!SAMPLES.includes(name)) return res.status(404).json({ error: "unknown sample" });
  try {
    const ocr = await processClaim(`samples/${name}.pdf`);
    res.json(buildClaimModel(name, ocr));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/image/:name", async (req, res) => {
  const { name } = req.params;
  if (!SAMPLES.includes(name)) return res.status(404).end();
  try {
    const png = await rasterizePdf(`samples/${name}.pdf`, 2.0);
    res.type("png").send(png);
  } catch {
    res.status(500).end();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Claim viewer running on http://localhost:${PORT}`));
