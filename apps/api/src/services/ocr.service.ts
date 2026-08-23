// Plain-text OCR only — no structured extraction, no paid vision API. Runs
// fully offline via tesseract.js against a raw image buffer; a worker is
// created and terminated per call rather than kept warm, since this codebase
// has no background-job infra to own a long-lived worker pool and invoice
// scans are infrequent, one-off requests.
import { createWorker } from "tesseract.js";

export async function extractText(buffer: Buffer): Promise<string> {
  const worker = await createWorker("eng");
  try {
    const {
      data: { text },
    } = await worker.recognize(buffer);
    return text.trim();
  } finally {
    await worker.terminate();
  }
}
