// Minimal viewer server: serves the frontend and exposes the pipeline results.
//   GET /api/samples       -> list of bundled samples
//   GET /api/result/:name  -> OCR + validation + service lines + total (JSON)
//   GET /api/image/:name   -> the rendered claim page (PNG) for display
import express from "express";
import multer from "multer";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { process as processClaim } from "./src/pipeline.js";
import { buildClaimModel } from "./src/claim.js";
import { processBundle, processUploadedFiles } from "./src/bundle.js";
import { rasterizePdf } from "./src/rasterize.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 50, fileSize: 25 * 1024 * 1024 },
});

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

// --- Transplant bundle roll-up ---
app.get("/api/bundle", async (_req, res) => {
  try {
    res.json(await processBundle("bundle"));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/bundle/image/:doc", async (req, res) => {
  const { doc } = req.params;
  if (!/^[a-z0-9-]+$/i.test(doc)) return res.status(400).end();
  try {
    res.type("png").send(await rasterizePdf(`bundle/${doc}.pdf`, 1.6));
  } catch {
    res.status(404).end();
  }
});

// Upload a transplant bundle (many PDFs, or one combined multi-page PDF) and process it.
app.post("/api/bundle/upload", upload.array("files", 50), async (req, res) => {
  try {
    const pdfs = (req.files || []).filter(
      (f) => f.mimetype === "application/pdf" || f.originalname.toLowerCase().endsWith(".pdf")
    );
    if (!pdfs.length) return res.status(400).json({ error: "Upload one or more PDF files." });
    const id = Date.now().toString(36) + "-" + crypto.randomBytes(3).toString("hex");
    res.json(await processUploadedFiles(id, pdfs));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/upload/image/:id/:doc", async (req, res) => {
  const { id, doc } = req.params;
  if (!/^[a-z0-9-]+$/i.test(id) || !/^[a-z0-9-]+$/i.test(doc)) return res.status(400).end();
  try {
    res.type("png").send(await rasterizePdf(`uploads/${id}/${doc}.pdf`, 1.6));
  } catch {
    res.status(404).end();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Claim viewer running on http://localhost:${PORT}`));
