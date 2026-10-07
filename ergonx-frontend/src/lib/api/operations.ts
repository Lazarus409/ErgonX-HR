import { apiAction, apiDelete, apiDownload, apiGet, apiGetList, apiPost, apiPostMultipart } from "./client";
import type { PaginatedData } from "@/types/api";
import type { BackgroundJob, DocumentRecord, ExportJob, ImportJob } from "@/types/operations";
import type { ListParams } from "@/types/api";

export function listDocuments(params?: ListParams): Promise<PaginatedData<DocumentRecord>> { return apiGetList<DocumentRecord>("/documents/", { ordering: "-created_at", ...params }); }
export function getDocument(id: string): Promise<DocumentRecord> { return apiGet<DocumentRecord>(`/documents/${id}/`); }
export function downloadDocument(id: string): Promise<Blob> { return apiDownload(`/documents/${id}/download/`); }
/** Deactivates a document while preserving its historical record. */
export function deactivateDocument(id: string): Promise<void> { return apiDelete(`/documents/${id}/`); }
export function listImportJobs(): Promise<PaginatedData<ImportJob>> { return apiGetList<ImportJob>("/import-jobs/", { ordering: "-created_at" }); }
export function listExportJobs(): Promise<PaginatedData<ExportJob>> { return apiGetList<ExportJob>("/export-jobs/", { ordering: "-created_at" }); }
export function listBackgroundJobs(): Promise<PaginatedData<BackgroundJob>> { return apiGetList<BackgroundJob>("/background-jobs/", { ordering: "-created_at" }); }
export function confirmImportJob(id: string): Promise<ImportJob> { return apiAction<ImportJob>(`/import-jobs/${id}/confirm/`); }
/** Upload cap enforced by the API (DOCUMENT_UPLOAD_MAX_MB, default 25). Any file type is accepted. */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
export interface DocumentCreatePayload { file_reference: string; original_filename: string; content_type: string; size_bytes: number; category?: string; classification?: string; entity_type?: string; entity_id?: string | null; }
export function createDocument(payload: DocumentCreatePayload): Promise<DocumentRecord> { return apiPost<DocumentRecord, DocumentCreatePayload>("/documents/", payload); }
export function uploadDocument(file: File, metadata: Omit<DocumentCreatePayload, "file_reference" | "original_filename" | "content_type" | "size_bytes"> & { category?: string; entity_type?: string; entity_id?: string | null }, onUploadProgress?: (progress: number) => void): Promise<DocumentRecord> {
  const body = new FormData();
  body.append("uploaded_file", file);
  body.append("category", metadata.category ?? "");
  body.append("classification", metadata.classification ?? "CONFIDENTIAL");
  if (metadata.entity_type) body.append("entity_type", metadata.entity_type);
  if (metadata.entity_id) body.append("entity_id", metadata.entity_id);
  return apiPostMultipart<DocumentRecord>("/documents/", body, onUploadProgress);
}
