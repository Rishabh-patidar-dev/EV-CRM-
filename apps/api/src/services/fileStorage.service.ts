// Single upload entry point for every new file-attachment feature (generic
// Attachment rows, purchase-invoice OCR uploads). Branches at call time on
// whether real Supabase Storage credentials are configured:
//   - Configured: uploads to the Supabase Storage bucket, returns its public
//     URL. This is what a real deployment must use — local disk doesn't
//     survive on an ephemeral/read-only filesystem (Vercel, most serverless
//     hosts, some Render plans).
//   - Not configured: falls back to local disk under apps/api/uploads/**,
//     served by the existing express.static("/uploads") mount in index.ts —
//     the same convention the warranty/dealer-application uploaders already
//     use. This is what local dev runs on with zero Supabase Storage setup.
// Every caller only ever sees uploadFile() — nothing above this layer knows
// or cares which branch actually ran.
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_UPLOAD_ROOT = path.join(__dirname, "..", "..", "uploads");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "attachments";

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) : null;

export interface UploadedFile {
  url: string;
  path: string;
}

// `key` is a storage path, e.g. "attachments/customer-bill/42/1699999999_invoice.pdf"
// — the caller builds it; this function doesn't invent naming schemes.
export async function uploadFile(buffer: Buffer, key: string, mimeType?: string): Promise<UploadedFile> {
  if (supabase) {
    const { error } = await supabase.storage.from(SUPABASE_STORAGE_BUCKET).upload(key, buffer, {
      contentType: mimeType,
      upsert: false,
    });
    if (error) throw new Error(`Supabase Storage upload failed: ${error.message}`);
    const { data } = supabase.storage.from(SUPABASE_STORAGE_BUCKET).getPublicUrl(key);
    return { url: data.publicUrl, path: key };
  }

  // Local-disk fallback — dev/demo only, does not survive most deployed hosts.
  const destPath = path.join(LOCAL_UPLOAD_ROOT, key);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buffer);
  return { url: `/uploads/${key}`, path: key };
}

export async function deleteFile(key: string): Promise<void> {
  if (supabase) {
    await supabase.storage.from(SUPABASE_STORAGE_BUCKET).remove([key]);
    return;
  }
  const destPath = path.join(LOCAL_UPLOAD_ROOT, key);
  fs.rm(destPath, { force: true }, () => {});
}

export function isUsingRealStorage(): boolean {
  return supabase !== null;
}
