"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileText, Trash2, Upload } from "lucide-react";

import { useAuth } from "@/components/guards/AuthProvider";
import Alert from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { IconTile } from "@/components/ui/Card";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import { Field, Select } from "@/components/ui/Field";
import PageHeader from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/ToastProvider";
import { employeesApi, getApiErrorMessage } from "@/lib/api";
import { MY_DOCUMENT_CATEGORIES, type SelfServiceDocument } from "@/lib/api/employees";
import { formatDate, humanizeEnum } from "@/lib/format";
import DocumentChecklistPanel from "@/components/hr/DocumentChecklistPanel";

function fileSize(bytes: number) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function MyDocumentsPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<SelfServiceDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<string>("Identification");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [removing, setRemoving] = useState<SelfServiceDocument | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const load = useCallback(() => {
    employeesApi.listMyDocuments().then((documents) => { setItems(documents); setError(null); }).catch((caught) => { setItems([]); setError(getApiErrorMessage(caught)); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const upload = async () => {
    if (!file) return;
    setUploadError(null); setProgress(0);
    try {
      const document = await employeesApi.uploadMyDocument(file, category, setProgress);
      setItems((current) => [document, ...(current ?? [])]);
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      showToast({ tone: "success", message: `${document.original_filename} uploaded.` });
    } catch (caught) {
      setUploadError(getApiErrorMessage(caught));
    } finally {
      setProgress(null);
    }
  };

  const download = async (item: SelfServiceDocument) => {
    setDownloading(item.id);
    try {
      const blob = await employeesApi.downloadMyDocument(item.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = item.original_filename; link.click(); URL.revokeObjectURL(url);
    } catch (caught) {
      showToast({ tone: "error", message: getApiErrorMessage(caught) });
    } finally {
      setDownloading(null);
    }
  };

  const remove = async () => {
    if (!removing) return;
    setRemoveBusy(true);
    try {
      await employeesApi.removeMyDocument(removing.id);
      setItems((current) => (current ?? []).filter((item) => item.id !== removing.id));
      showToast({ tone: "success", message: `${removing.original_filename} removed.` });
      setRemoving(null);
    } catch (caught) {
      showToast({ tone: "error", message: getApiErrorMessage(caught) });
    } finally {
      setRemoveBusy(false);
    }
  };

  const uploading = progress !== null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="My documents" description="Upload your own documents, and find the ones HR has shared with you." icon={FileText} accent="brand" />
      <DocumentChecklistPanel mode="self" onChanged={load} />

      <section className="rounded-2xl border border-line bg-surface p-5 shadow-elevation-1" aria-labelledby="upload-heading">
        <h2 id="upload-heading" className="text-card-title font-bold text-headline">Upload a document</h2>
        <p className="text-support text-ink-muted">IDs, certificates, qualifications and similar. What you upload is visible to you and to the people who manage employee records.</p>
        {uploadError && <Alert tone="danger" className="mt-4">{uploadError}</Alert>}
        <div className="mt-4 grid gap-4 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
          <Field label="Type">
            <Select value={category} onChange={(event) => setCategory(event.target.value)} disabled={uploading}>
              {MY_DOCUMENT_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
            </Select>
          </Field>
          <Field label="File" helper="Any file type, up to 25 MB.">
            <input
              ref={fileInput}
              type="file"
              disabled={uploading}
              onChange={(event) => { setFile(event.target.files?.[0] ?? null); setUploadError(null); }}
              className="block w-full rounded-lg border border-line px-3 py-1.5 text-sm text-ink file:mr-3 file:rounded-md file:border-0 file:bg-surface-sunken file:px-3 file:py-1.5 file:text-sm file:text-ink-strong"
            />
          </Field>
          <Button onClick={() => void upload()} disabled={!file} loading={uploading} loadingLabel={`Uploading ${progress ?? 0}%`} leadingIcon={<Upload className="h-4 w-4" />}>Upload</Button>
        </div>
      </section>

      {error && <ErrorState variant="inline" title="Unable to load your documents" message={error} onRetry={load} />}
      <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-elevation-1" aria-label="Documents">
        {items === null ? (
          <div className="space-y-3 p-5">{[0, 1, 2].map((index) => <Skeleton key={index} className="h-12 rounded-xl" />)}</div>
        ) : items.length ? (
          <ul className="divide-y divide-line-soft">
            {items.map((item) => {
              const mine = Boolean(user?.id) && item.uploaded_by === user?.id;
              return (
                <li key={item.id} className="flex flex-wrap items-center gap-4 px-5 py-4 transition-colors hover:bg-surface-hover">
                  <IconTile icon={FileText} accent="brand" size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-ink-strong" title={item.original_filename}>{item.original_filename}</p>
                    <p className="text-caption text-ink-muted">{[item.category || "Employee document", mine ? "Uploaded by you" : "Shared by HR", formatDate(item.created_at), fileSize(item.size_bytes)].filter(Boolean).join(" · ")}</p>
                  </div>
                  <Badge size="sm" tone={item.classification === "RESTRICTED" ? "danger" : item.classification === "CONFIDENTIAL" ? "warning" : "neutral"}>{humanizeEnum(item.classification)}</Badge>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" aria-label={`Download ${item.original_filename}`} loading={downloading === item.id} onClick={() => void download(item)} leadingIcon={<Download className="h-4 w-4" />} />
                    {mine && <Button variant="ghost" size="sm" aria-label={`Remove ${item.original_filename}`} onClick={() => setRemoving(item)} leadingIcon={<Trash2 className="h-4 w-4" />} />}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState size="compact" icon={FileText} title="No documents yet" description="Upload your first document above. Documents HR shares with you also appear here." />
        )}
      </section>

      <ConfirmDialog
        open={removing !== null}
        title="Remove this document?"
        description={`${removing?.original_filename ?? "The document"} will no longer appear in your documents or to HR.`}
        confirmLabel="Remove"
        destructive
        loading={removeBusy}
        onCancel={() => setRemoving(null)}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
