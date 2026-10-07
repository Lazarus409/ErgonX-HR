import { apiDelete, apiPostMultipart } from "./client";

export type ImageOwnerType = "USER" | "EMPLOYEE" | "INSTITUTION";
export interface ImageAsset { id: string; owner_type: ImageOwnerType; owner_id: string; original_filename: string; content_type: string; size_bytes: number; is_active: boolean; }

export function uploadImage(file: File, owner_type: ImageOwnerType, owner_id: string, onUploadProgress?: (progress: number) => void): Promise<ImageAsset> {
  const body = new FormData();
  body.append("uploaded_file", file);
  body.append("owner_type", owner_type);
  body.append("owner_id", owner_id);
  return apiPostMultipart<ImageAsset>("/images/", body, onUploadProgress);
}

export function removeImage(id: string): Promise<void> { return apiDelete(`/images/${id}/`); }
export function imageContentUrl(id: string): string { return `/api/v1/images/${id}/content/`; }
