"use client";
import { useCallback, useState } from "react";
import { Download } from "lucide-react";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import LoadingState from "@/components/ui/LoadingState";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import { FileInput } from "@/components/ui/Field";
import { getApiErrorMessage, operationsApi } from "@/lib/api";
import { useApiResource } from "@/lib/useApiResource";
import { buttonClasses } from "@/components/ui/Button";
import type { DocumentRecord } from "@/types/operations";

function formatSize(bytes: number): string { return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }

const controlClasses = "h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong shadow-elevation-1 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15";
const emptyForm = { category: "", classification: "CONFIDENTIAL" };

export default function DocumentsPage() {
  const load = useCallback(() => operationsApi.listDocuments(), []);
  const { data, loading, error, reload } = useApiResource(load);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [progress, setProgress] = useState<number | null>(null);
  const [formError, setFormError] = useState("");
  const [downloadError, setDownloadError] = useState("");

  const close = () => { setOpen(false); setFile(null); setForm(emptyForm); setFormError(""); };

  const selectFile = (selected: File | undefined) => {
    setFormError("");
    if (selected && selected.size > operationsApi.MAX_DOCUMENT_BYTES) {
      setFormError("Documents must be 25 MB or smaller.");
      setFile(null);
      return;
    }
    setFile(selected ?? null);
  };

  const upload = async () => {
    if (!file) return;
    setProgress(0);
    setFormError("");
    try {
      await operationsApi.uploadDocument(file, { category: form.category.trim(), classification: form.classification }, setProgress);
      close();
      await reload();
    } catch (caught) {
      setFormError(getApiErrorMessage(caught));
    } finally {
      setProgress(null);
    }
  };

  const download = async (document: DocumentRecord) => {
    setDownloadError("");
    try {
      const blob = await operationsApi.downloadDocument(document.id);
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = document.original_filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setDownloadError(getApiErrorMessage(caught));
    }
  };

  if (loading) return <LoadingState />;
  if (error || !data) return <ErrorState message={error ?? "You may not have permission to view documents."} onRetry={reload} />;
  const uploading = progress !== null;

  return (
    <div className="space-y-6">
      <PageHeader title="Documents" description="Upload and keep protected documents for the active institution. Any file type, up to 25 MB." actions={<button type="button" onClick={() => setOpen(true)} className={buttonClasses({ variant: "primary" })}>Upload document</button>} />
      {downloadError && <p className="rounded-lg bg-danger-soft p-3 text-sm text-danger-ink">{downloadError}</p>}
      <div className="rounded-2xl border border-line bg-surface">
        {data.results.length === 0 ? <EmptyState title="No documents yet" description="Uploaded documents and files attached through ERP workflows will appear here." /> : (
          <div className="divide-y divide-line-soft">
            {data.results.map((document) => (
              <div key={document.id} className="flex items-center gap-4 p-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink-strong">{document.original_filename}</p>
                  <p className="mt-1 text-sm text-ink-muted">{document.category || "Uncategorised"} · {formatSize(document.size_bytes)} · {new Date(document.created_at).toLocaleString()}</p>
                </div>
                <StatusBadge status={document.is_active ? "ACTIVE" : "INACTIVE"} />
                {document.file_reference?.startsWith("managed:") && <button type="button" onClick={() => void download(document)} className={buttonClasses({ variant: "secondary", size: "sm" })} aria-label={`Download ${document.original_filename}`}><Download className="h-4 w-4" /></button>}
              </div>
            ))}
          </div>
        )}
      </div>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4">
          <div className="w-full max-w-lg rounded-2xl bg-surface p-6 shadow-2xl">
            <h2 className="text-lg font-semibold">Upload document</h2>
            <p className="mt-1 text-sm text-ink-muted">Any file type, up to 25 MB. Files are stored in your institution&apos;s protected document area.</p>
            {formError && <p className="mt-3 rounded-lg bg-danger-soft p-3 text-sm text-danger-ink">{formError}</p>}
            <div className="mt-5 grid gap-4">
              <FileInput disabled={uploading} onChange={(event) => selectFile(event.target.files?.[0])} fileName={uploading ? `Uploading… ${progress}%` : file?.name} hint={file ? formatSize(file.size) : "Drop a file here or click to browse"} />
              <label className="grid gap-1 text-sm font-medium">Category<input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} placeholder="e.g. Contract, Policy" className={controlClasses} /></label>
              <label className="grid gap-1 text-sm font-medium">Classification<select value={form.classification} onChange={(event) => setForm({ ...form, classification: event.target.value })} className={controlClasses}><option value="INTERNAL">Internal</option><option value="CONFIDENTIAL">Confidential</option><option value="RESTRICTED">Restricted</option></select></label>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={close} disabled={uploading} className={buttonClasses({ variant: "secondary" })}>Cancel</button>
              <button type="button" onClick={() => void upload()} disabled={uploading || !file} className={buttonClasses({ variant: "primary" })}>{uploading ? `Uploading… ${progress}%` : "Upload"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
