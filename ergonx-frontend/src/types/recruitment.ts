export interface JobPosting {
  id: string;
  code: string;
  title: string;
  department: string;
  position: string;
  location: string;
  hiring_manager: string | null;
  description: string;
  employment_type: string;
  openings: number;
  status: string;
  opens_on: string | null;
  closes_on: string | null;
  department_name?: string;
  position_title?: string;
  location_name?: string;
  grade?: string | null;
  grade_name?: string | null;
  reports_to?: string | null;
  reports_to_title?: string | null;
  hiring_manager_name?: string | null;
  hiring_reason?: string;
  target_start_date?: string | null;
  salary_currency?: string;
  salary_min?: string | null;
  salary_max?: string | null;
  interview_plan?: string;
  responsibilities?: string;
  qualifications_essential?: string;
  qualifications_desirable?: string;
  submitted_by?: string | null;
  submitted_by_name?: string | null;
  submitted_at?: string | null;
  approved_by_name?: string | null;
  approved_at?: string | null;
  approval_note?: string;
  application_counts?: Record<string, number>;
  created_at: string;
  updated_at: string;
}

export interface JobPostingPayload {
  /** Omit to have the next JOB-YYYY-##### code generated. */
  code?: string;
  title: string;
  department: string;
  position: string;
  location: string;
  hiring_manager?: string | null;
  description?: string;
  employment_type: string;
  openings?: number;
  closes_on?: string | null;
  hiring_reason?: string;
  grade?: string | null;
  reports_to?: string | null;
  target_start_date?: string | null;
  salary_currency?: string;
  salary_min?: string | null;
  salary_max?: string | null;
  interview_plan?: string;
  responsibilities?: string;
  qualifications_essential?: string;
  qualifications_desirable?: string;
}

export const HIRING_REASONS: Array<[string, string]> = [["NEW_ROLE", "New role"], ["REPLACEMENT", "Replacement"], ["EXPANSION", "Team expansion"], ["TEMPORARY_COVER", "Temporary cover"]];
export const INTERVIEW_PLANS: Array<[string, string]> = [["SINGLE_PANEL", "Single panel interview"], ["TWO_STAGE", "Screening + panel interview"], ["TECHNICAL_PANEL", "Technical assessment + panel"], ["PRESENTATION_PANEL", "Presentation + panel"]];
export const HIRING_TEAM_ROLES: Array<[string, string]> = [["HIRING_MANAGER", "Hiring manager"], ["INTERVIEW_PANEL", "Interview panel"], ["HR_PARTNER", "HR business partner"], ["COORDINATOR", "Recruitment coordinator"]];

export interface HiringTeamMember {
  id: string;
  job_posting: string;
  user: string;
  user_name: string;
  user_email: string;
  role: string;
  created_at: string;
}

export interface RecruitmentPerson {
  id: string;
  name: string;
  role: string;
}

export interface RequisitionActivity {
  by_stage: Array<{ stage: string; count: number }>;
  recent: Array<{ id: string; candidate: string; stage: string | null; status: string; applied_at: string | null }>;
  total: number;
}

export interface RequisitionHistoryEntry {
  id: string;
  action: string;
  actor: string;
  created_at: string;
  metadata: Record<string, unknown>;
}

export interface CandidateProfileFields {
  location?: string;
  employment_status?: string;
  linkedin_url?: string;
  current_employer?: string;
  current_title?: string;
  years_experience?: number | null;
  highest_qualification?: string;
  field_of_study?: string;
  education_institution?: string;
  skills?: string;
  notice_period_weeks?: number | null;
}

export interface Candidate extends CandidateProfileFields {
  id: string;
  first_name: string;
  middle_name: string;
  last_name: string;
  full_name?: string;
  email: string;
  phone: string;
  source: string;
  status: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface CandidatePayload extends CandidateProfileFields {
  first_name: string;
  middle_name?: string;
  last_name: string;
  email: string;
  phone?: string;
  source?: string;
  notes?: string;
}

export const EMPLOYMENT_STATUSES: Array<[string, string]> = [["EMPLOYED", "Employed"], ["SELF_EMPLOYED", "Self-employed"], ["UNEMPLOYED", "Not currently employed"], ["STUDENT", "Student or graduate"], ["OTHER", "Other"]];
export const QUALIFICATIONS: Array<[string, string]> = [["SECONDARY", "Secondary school"], ["DIPLOMA", "Diploma or certificate"], ["BACHELORS", "Bachelor's degree"], ["MASTERS", "Master's degree"], ["DOCTORATE", "Doctorate"], ["PROFESSIONAL", "Professional qualification"], ["OTHER", "Other"]];
export const CANDIDATE_DOCUMENT_TYPES: Array<[string, string]> = [["CV", "CV / résumé"], ["COVER_LETTER", "Cover letter"], ["CERTIFICATE", "Certificate or transcript"], ["PORTFOLIO", "Portfolio or work sample"], ["REFERENCE", "Reference"], ["OTHER", "Other"]];
export const COMPETENCY_RATINGS: Array<[string, string]> = [["NOT_ASSESSED", "Not yet assessed"], ["DOES_NOT_MEET", "Does not meet"], ["PARTIALLY_MEETS", "Partially meets"], ["MEETS", "Meets"], ["EXCEEDS", "Exceeds"]];

export interface CandidateDocument {
  id: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  category: string;
  created_at: string;
}

export interface ApplicationScorecard {
  competencies: Array<{ id: string; name: string; description: string }>;
  mine: Record<string, { rating: string; comment: string }>;
  my_submitted_at: string | null;
  can_evaluate: boolean;
  locked: boolean;
  evaluator_count: number;
  summary: Array<{ competency: string; counts: Record<string, number> }>;
}

export interface InterviewFeedback {
  id: string;
  interviewer_name: string | null;
  score: string | number;
  recommendation: string;
  comments: string;
  created_at: string;
}

export interface ApplicationOverview {
  application: { id: string; status: string; applied_at: string | null; created_at: string; notes: string; rejection_reason: string; current_stage: string | null; current_stage_name: string | null };
  candidate: Candidate;
  job: { id: string; code: string; title: string; status: string; department_name: string; location_name: string; employment_type: string };
  stages: Array<{ id: string; name: string; sequence: number }>;
  next_stage: { id: string; name: string } | null;
  interviews: Array<{ id: string; scheduled_at: string; duration_minutes: number; interview_type: string; location_or_link: string; status: string; interviewer_name: string | null; feedback: InterviewFeedback[] }>;
  general_feedback: InterviewFeedback[];
  documents: CandidateDocument[];
  other_applications: Array<{ id: string; job_title: string; status: string; stage: string | null }>;
  offer: { id: string; status: string } | null;
  activity: RequisitionHistoryEntry[];
  actions: { can_move: boolean; can_reject: boolean; can_schedule_interview: boolean; can_create_offer: boolean; can_upload_documents: boolean };
}

export interface CandidateScorecard {
  candidate_id: string;
  average_score: string | number | null;
  application_count: number;
}

export interface RecruitmentApplication {
  id: string;
  job_posting: string;
  candidate: string;
  current_stage: string | null;
  status: string;
  applied_at: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface RecruitmentApplicationPayload {
  job_posting: string;
  candidate: string;
  notes?: string;
}

export interface ApplicationStageHistory {
  id: string;
  application: string;
  from_stage: string | null;
  to_stage: string;
  changed_by: string | null;
  comment: string;
  created_at: string;
}

export interface RecruitmentInterview {
  id: string;
  application: string;
  candidate_id?: string;
  candidate_name?: string;
  job_title?: string;
  scheduled_at: string;
  duration_minutes: number;
  interview_type: string;
  interview_stage?: string;
  mode?: string;
  time_zone?: string;
  agenda?: string;
  location_or_link: string;
  interviewer: string | null;
  interviewer_name?: string | null;
  panel_members?: Array<{ id: string; name: string }>;
  candidate_message?: string;
  invitation_sent_at?: string | null;
  invitation_status?: string;
  status: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface RecruitmentInterviewPayload {
  application: string;
  scheduled_at: string;
  duration_minutes?: number;
  interview_type?: string;
  location_or_link?: string;
  notes?: string;
}

export interface RecruitmentOffer {
  id: string;
  application: string;
  candidate_id?: string;
  candidate_name?: string;
  job_posting_id?: string;
  job_title?: string;
  job_code?: string;
  department_name?: string;
  position_title?: string;
  grade_name?: string;
  location_name?: string;
  reports_to?: string | null;
  reports_to_title?: string | null;
  salary_structure_name?: string | null;
  contract_length_months?: number | null;
  working_pattern?: string;
  letter_body?: string;
  letter_generated_at?: string | null;
  submitted_by?: string | null;
  submitted_by_name?: string | null;
  submitted_at?: string | null;
  approved_by_name?: string | null;
  approved_at?: string | null;
  approval_note?: string;
  response_note?: string;
  response_recorded_by_name?: string | null;
  extended_at?: string | null;
  accepted_at?: string | null;
  declined_at?: string | null;
  status: string;
  proposed_start_date: string;
  expires_on: string | null;
  employment_type: string;
  department: string;
  position: string;
  grade: string;
  location: string;
  staff_category: string;
  salary_structure: string | null;
  base_salary: string | null;
  currency: string;
  hired_employee: string | null;
  terms: string;
  created_at: string;
  updated_at: string;
}

export const INTERVIEW_STAGES: Array<[string, string]> = [["SCREENING", "Screening call"], ["FIRST_ROUND", "First round interview"], ["SECOND_ROUND", "Second round interview"], ["TECHNICAL", "Technical assessment"], ["FINAL", "Final interview"]];
export const INTERVIEW_MODES: Array<[string, string]> = [["VIDEO", "Video call"], ["PHONE", "Phone call"], ["IN_PERSON", "In person"], ["OTHER", "Other"]];
export const WORKING_PATTERNS: Array<[string, string]> = [["FULL_TIME", "Full-time"], ["PART_TIME", "Part-time"], ["SHIFT", "Shift-based"]];

export interface InterviewSlot {
  time: string;
  start: string;
  state: "available" | "conflict" | "unavailable";
  reason: string;
}

export interface InterviewSchedulePayload {
  application: string;
  scheduled_at: string;
  duration_minutes: number;
  interview_stage: string;
  mode: string;
  time_zone: string;
  location_or_link?: string;
  agenda?: string;
  panel: string[];
  candidate_message?: string;
  draft?: boolean;
  send_invitation?: boolean;
}

export interface RecruitmentOfferPayload {
  contract_length_months?: number | null;
  working_pattern?: string;
  reports_to?: string | null;
  salary_structure?: string | null;
  base_salary?: string | null;
  currency?: string;
  letter_body?: string;
  application: string;
  proposed_start_date: string;
  employment_type: string;
  department: string;
  position: string;
  grade: string;
  location: string;
  staff_category?: string;
  expires_on?: string | null;
  terms?: string;
}

export interface RecruitmentStage {
  id: string;
  name: string;
  sequence: number;
  is_terminal: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface RecruitmentStagePayload {
  name: string;
  sequence: number;
  is_terminal?: boolean;
  is_active?: boolean;
}

export interface CandidateEvaluation {
  id: string;
  application: string;
  interviewer: string;
  interview: string | null;
  score: string | number;
  recommendation: string;
  comments: string;
  created_at: string;
  updated_at: string;
}

export interface CandidateEvaluationPayload {
  application: string;
  interview?: string | null;
  score: number;
  recommendation: "STRONG_YES" | "YES" | "NO" | "STRONG_NO";
  comments?: string;
}

export interface RecruitmentPipelineStage {
  stage_id: string;
  stage_name: string;
  sequence: number;
  application_count: number;
}
