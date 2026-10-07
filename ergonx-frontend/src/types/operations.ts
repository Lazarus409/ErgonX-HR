export interface DocumentRecord {
  id: string;
  file_reference: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  category: string;
  classification: string;
  entity_type: string;
  entity_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ImportJob { id: string; import_type: string; file_reference: string; status: string; total_rows: number; valid_rows: number; invalid_rows: number; error_summary: string; created_at: string; completed_at: string | null; }
export interface ExportJob { id: string; export_type: string; status: string; result_reference: string; error_summary: string; created_at: string; completed_at: string | null; }
export interface BackgroundJob { id: string; job_type: string; status: string; progress: number; result_reference: string; error_summary: string; created_at: string; completed_at: string | null; }
