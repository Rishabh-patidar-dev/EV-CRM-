"use client";

// Staff-side counterpart of DMS's AttachmentUpload.tsx — same generic
// Attachment table, different auth domain (crm_session, not dealer_session),
// so it can't share the dealer-portal endpoints or the DMS component
// directly. `basePath` is the full attachment-collection URL for one parent
// record, e.g. `/api/v1/warranty-claims/${claimId}` — currently only
// warranty claims have a staff detail page to attach this to.
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Paperclip, Upload, X, FileText } from "lucide-react";
import apiClient from "@/lib/api/client";

type Attachment = {
  id: number;
  fileName: string;
  fileUrl: string;
  mimeType: string | null;
  fileSizeBytes: number | null;
  createdAt: string;
};

function resolveUrl(fileUrl: string) {
  if (fileUrl.startsWith("http")) return fileUrl;
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  return `${base}${fileUrl}`;
}

function formatSize(bytes: number | null) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentUpload({ basePath }: { basePath: string }) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.get(`${basePath}/attachments`);
      setAttachments(data.attachments ?? []);
    } finally {
      setLoading(false);
    }
  }, [basePath]);

  useEffect(() => { load(); }, [load]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    for (const file of Array.from(files)) {
      const formData = new FormData();
      formData.append("file", file);
      try {
        await apiClient.post(`${basePath}/attachments`, formData, { headers: { "Content-Type": "multipart/form-data" } });
      } catch (e: any) {
        setError(e?.response?.data?.message ?? `Could not upload ${file.name}`);
        break;
      }
    }
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
    load();
  }

  async function remove(id: number) {
    await apiClient.delete(`${basePath}/attachments/${id}`);
    load();
  }

  return (
    <div className="rounded-[var(--radius)] border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Paperclip className="h-3.5 w-3.5" /> Attachments
      </div>

      {loading ? (
        <div className="py-3 text-center text-muted-foreground"><Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" /></div>
      ) : attachments.length === 0 ? (
        <p className="mb-2 text-xs text-muted-foreground">No files attached yet.</p>
      ) : (
        <div className="mb-2 space-y-1.5">
          {attachments.map((a) => (
            <div key={a.id} className="flex items-center justify-between rounded-[var(--radius)] bg-background px-2.5 py-1.5 text-sm">
              <a href={resolveUrl(a.fileUrl)} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1.5 hover:text-primary">
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{a.fileName}</span>
                {a.fileSizeBytes != null && <span className="shrink-0 text-xs text-muted-foreground">{formatSize(a.fileSizeBytes)}</span>}
              </a>
              <button onClick={() => remove(a.id)} className="shrink-0 text-muted-foreground hover:text-[color:var(--zira-rejected)]" aria-label="Remove attachment">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded-[var(--radius)] border border-dashed border-border py-2 text-xs font-medium text-muted-foreground hover:border-primary hover:text-primary">
        {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
        {uploading ? "Uploading…" : "Upload PDF, JPG, XLS…"}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png,.xls,.xlsx,.csv"
          className="hidden"
          disabled={uploading}
          onChange={(e) => handleFiles(e.target.files)}
        />
      </label>
      {error && <p className="mt-1.5 text-xs text-[color:var(--zira-rejected)]">{error}</p>}
    </div>
  );
}
