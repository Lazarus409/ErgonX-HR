import { apiAction, apiDelete, apiDownload, apiGetList, apiGet, apiPatch, apiPost, apiPostMultipart } from "./client";
import type { ListParams, PaginatedData } from "@/types/api";
import type { InterviewSchedulePayload, InterviewSlot, ApplicationOverview, ApplicationScorecard, CandidateDocument, HiringTeamMember, RecruitmentPerson, RequisitionActivity, RequisitionHistoryEntry, ApplicationStageHistory, Candidate, CandidateEvaluation, CandidateEvaluationPayload, CandidatePayload, CandidateScorecard, JobPosting, JobPostingPayload, RecruitmentApplication, RecruitmentApplicationPayload, RecruitmentInterview, RecruitmentInterviewPayload, RecruitmentOffer, RecruitmentOfferPayload, RecruitmentPipelineStage, RecruitmentStage, RecruitmentStagePayload } from "@/types/recruitment";

export function listJobPostings(params?: ListParams): Promise<PaginatedData<JobPosting>> {
  return apiGetList<JobPosting>("/recruitment/job-postings/", params);
}

export function getJobPosting(id: string): Promise<JobPosting> {
  return apiGet<JobPosting>(`/recruitment/job-postings/${id}/`);
}

export function createJobPosting(payload: JobPostingPayload): Promise<JobPosting> {
  return apiPost<JobPosting, JobPostingPayload>("/recruitment/job-postings/", payload);
}

export function publishJobPosting(id: string): Promise<JobPosting> {
  return apiAction<JobPosting>(`/recruitment/job-postings/${id}/publish/`);
}

export function closeJobPosting(id: string, cancelled = false): Promise<JobPosting> {
  return apiAction<JobPosting>(`/recruitment/job-postings/${id}/${cancelled ? "cancel" : "close"}/`);
}

export function updateJobPosting(id: string, payload: Partial<JobPostingPayload>): Promise<JobPosting> {
  return apiPatch<JobPosting, Partial<JobPostingPayload>>(`/recruitment/job-postings/${id}/`, payload);
}

/** Requisition approval workflow. */
export function submitJobPostingForApproval(id: string): Promise<JobPosting> {
  return apiAction<JobPosting>(`/recruitment/job-postings/${id}/submit-approval/`);
}
export function approveJobPosting(id: string, comment = ""): Promise<JobPosting> {
  return apiAction<JobPosting>(`/recruitment/job-postings/${id}/approve/`, { comment });
}
export function returnJobPosting(id: string, comment: string): Promise<JobPosting> {
  return apiAction<JobPosting>(`/recruitment/job-postings/${id}/return/`, { comment });
}

export function listHiringTeam(id: string): Promise<HiringTeamMember[]> {
  return apiGet<HiringTeamMember[]>(`/recruitment/job-postings/${id}/team/`);
}
export function addHiringTeamMember(id: string, user: string, role: string): Promise<HiringTeamMember> {
  return apiPost<HiringTeamMember, { user: string; role: string }>(`/recruitment/job-postings/${id}/team/`, { user, role });
}
export function removeHiringTeamMember(id: string, memberId: string): Promise<void> {
  return apiDelete(`/recruitment/job-postings/${id}/team/${memberId}/`);
}
export function listRecruitmentPeople(): Promise<RecruitmentPerson[]> {
  return apiGet<RecruitmentPerson[]>("/recruitment/job-postings/people/");
}
export function getRequisitionHistory(id: string): Promise<RequisitionHistoryEntry[]> {
  return apiGet<RequisitionHistoryEntry[]>(`/recruitment/job-postings/${id}/history/`);
}
export function getRequisitionActivity(id: string): Promise<RequisitionActivity> {
  return apiGet<RequisitionActivity>(`/recruitment/job-postings/${id}/activity/`);
}

export function listCandidates(params?: ListParams): Promise<PaginatedData<Candidate>> {
  return apiGetList<Candidate>("/recruitment/candidates/", params);
}

export function getCandidate(id: string): Promise<Candidate> {
  return apiGet<Candidate>(`/recruitment/candidates/${id}/`);
}

export function createCandidate(payload: CandidatePayload): Promise<Candidate> {
  return apiPost<Candidate, CandidatePayload>("/recruitment/candidates/", payload);
}

export function updateCandidate(id: string, payload: Partial<CandidatePayload>): Promise<Candidate> {
  return apiPatch<Candidate, Partial<CandidatePayload>>(`/recruitment/candidates/${id}/`, payload);
}

export function listCandidateDocuments(id: string): Promise<CandidateDocument[]> {
  return apiGet<CandidateDocument[]>(`/recruitment/candidates/${id}/documents/`);
}

export function uploadCandidateDocument(id: string, file: File, category: string, onProgress?: (progress: number) => void): Promise<CandidateDocument> {
  const body = new FormData();
  body.append("uploaded_file", file);
  body.append("category", category);
  return apiPostMultipart<CandidateDocument>(`/recruitment/candidates/${id}/documents/`, body, onProgress);
}

export function downloadCandidateDocument(id: string, documentId: string): Promise<Blob> {
  return apiDownload(`/recruitment/candidates/${id}/documents/${documentId}/download/`);
}

export function removeCandidateDocument(id: string, documentId: string): Promise<void> {
  return apiDelete(`/recruitment/candidates/${id}/documents/${documentId}/`);
}

export function getApplicationOverview(id: string): Promise<ApplicationOverview> {
  return apiGet<ApplicationOverview>(`/recruitment/applications/${id}/overview/`);
}

export function getApplicationScorecard(id: string): Promise<ApplicationScorecard> {
  return apiGet<ApplicationScorecard>(`/recruitment/applications/${id}/scorecard/`);
}

export function saveApplicationScorecard(id: string, ratings: Array<{ competency: string; rating: string; comment: string }>, submit: boolean): Promise<ApplicationScorecard> {
  return apiPost<ApplicationScorecard, { ratings: typeof ratings; submit: boolean }>(`/recruitment/applications/${id}/scorecard/`, { ratings, submit });
}

export function getCandidateScorecard(id: string): Promise<CandidateScorecard> {
  return apiGet<CandidateScorecard>(`/recruitment/candidates/${id}/scorecard/`);
}

export function getPipeline(): Promise<RecruitmentPipelineStage[]> {
  return apiGet<RecruitmentPipelineStage[]>("/recruitment/applications/pipeline/");
}

export function listApplications(params?: ListParams): Promise<PaginatedData<RecruitmentApplication>> {
  return apiGetList<RecruitmentApplication>("/recruitment/applications/", params);
}

export function createApplication(payload: RecruitmentApplicationPayload): Promise<RecruitmentApplication> {
  return apiPost<RecruitmentApplication, RecruitmentApplicationPayload>("/recruitment/applications/", payload);
}

export function submitApplication(id: string): Promise<RecruitmentApplication> {
  return apiAction<RecruitmentApplication>(`/recruitment/applications/${id}/submit/`);
}

export function getApplication(id: string): Promise<RecruitmentApplication> {
  return apiGet<RecruitmentApplication>(`/recruitment/applications/${id}/`);
}

export function moveApplicationStage(id: string, stage: string, comment = ""): Promise<RecruitmentApplication> {
  return apiAction<RecruitmentApplication, { stage: string; comment: string }>(`/recruitment/applications/${id}/move-stage/`, { stage, comment });
}

/** Withdraws a draft, active, or offered application through its workflow action. */
export function withdrawApplication(id: string): Promise<RecruitmentApplication> {
  return apiAction<RecruitmentApplication>(`/recruitment/applications/${id}/withdraw/`);
}

/** Rejects an active or offered application and records the optional reason. */
export function rejectApplication(
  id: string,
  reason = "",
): Promise<RecruitmentApplication> {
  return apiAction<RecruitmentApplication, { reason: string }>(
    `/recruitment/applications/${id}/reject/`,
    { reason },
  );
}

export function getApplicationStageHistory(id: string): Promise<ApplicationStageHistory[]> {
  return apiGet<ApplicationStageHistory[]>(`/recruitment/applications/${id}/stage-history/`);
}

export function listInterviews(params?: ListParams): Promise<PaginatedData<RecruitmentInterview>> {
  return apiGetList<RecruitmentInterview>("/recruitment/interviews/", params);
}

export function createInterview(payload: RecruitmentInterviewPayload): Promise<RecruitmentInterview> {
  return apiPost<RecruitmentInterview, RecruitmentInterviewPayload>("/recruitment/interviews/", payload);
}

export function getInterview(id: string): Promise<RecruitmentInterview> {
  return apiGet<RecruitmentInterview>(`/recruitment/interviews/${id}/`);
}

export function getInterviewAvailability(params: { date: string; interviewers: string[]; duration: number; time_zone: string; exclude?: string }): Promise<{ date: string; time_zone: string; slots: InterviewSlot[] }> {
  const query = new URLSearchParams({ date: params.date, interviewers: params.interviewers.join(","), duration: String(params.duration), time_zone: params.time_zone });
  if (params.exclude) query.set("exclude", params.exclude);
  return apiGet(`/recruitment/interviews/availability/?${query.toString()}`);
}

export function scheduleInterview(payload: InterviewSchedulePayload, interviewId?: string): Promise<RecruitmentInterview> {
  return apiPost<RecruitmentInterview, InterviewSchedulePayload>(interviewId ? `/recruitment/interviews/${interviewId}/reschedule/` : "/recruitment/interviews/schedule/", payload);
}

export function setInterviewStatus(id: string, status: "COMPLETED" | "CANCELLED" | "NO_SHOW"): Promise<RecruitmentInterview> {
  return apiAction<RecruitmentInterview, { status: string }>(`/recruitment/interviews/${id}/set-status/`, { status });
}

export function listOffers(params?: ListParams): Promise<PaginatedData<RecruitmentOffer>> {
  return apiGetList<RecruitmentOffer>("/recruitment/offers/", params);
}

export function updateOffer(id: string, payload: Partial<RecruitmentOfferPayload>): Promise<RecruitmentOffer> {
  return apiPatch<RecruitmentOffer, Partial<RecruitmentOfferPayload>>(`/recruitment/offers/${id}/`, payload);
}

export function submitOfferForApproval(id: string): Promise<RecruitmentOffer> {
  return apiPost<RecruitmentOffer, Record<string, never>>(`/recruitment/offers/${id}/submit-approval/`, {});
}

export function approveOffer(id: string, comment = ""): Promise<RecruitmentOffer> {
  return apiPost<RecruitmentOffer, { comment: string }>(`/recruitment/offers/${id}/approve/`, { comment });
}

export function returnOffer(id: string, comment: string): Promise<RecruitmentOffer> {
  return apiPost<RecruitmentOffer, { comment: string }>(`/recruitment/offers/${id}/return/`, { comment });
}

export function generateOfferLetter(id: string): Promise<RecruitmentOffer> {
  return apiPost<RecruitmentOffer, Record<string, never>>(`/recruitment/offers/${id}/generate-letter/`, {});
}

export function recordOfferResponse(id: string, accepted: boolean, note: string): Promise<RecruitmentOffer> {
  return apiPost<RecruitmentOffer, { note: string }>(`/recruitment/offers/${id}/${accepted ? "accept" : "decline"}/`, { note });
}

export function getOfferActivity(id: string): Promise<RequisitionHistoryEntry[]> {
  return apiGet<RequisitionHistoryEntry[]>(`/recruitment/offers/${id}/activity/`);
}

export function getOffer(id: string): Promise<RecruitmentOffer> {
  return apiGet<RecruitmentOffer>(`/recruitment/offers/${id}/`);
}

export function createOffer(payload: RecruitmentOfferPayload): Promise<RecruitmentOffer> {
  return apiPost<RecruitmentOffer, RecruitmentOfferPayload>("/recruitment/offers/", payload);
}

export function offerAction(id: string, action: "extend" | "accept" | "decline" | "withdraw"): Promise<RecruitmentOffer> {
  return apiAction<RecruitmentOffer>(`/recruitment/offers/${id}/${action}/`);
}

export function hireOfferCandidate(id: string): Promise<{ employee_id: string; employee_number: string }> {
  return apiAction<{ employee_id: string; employee_number: string }, Record<string, never>>(`/recruitment/offers/${id}/hire/`, {});
}

export function listRecruitmentStages(params?: ListParams): Promise<PaginatedData<RecruitmentStage>> {
  return apiGetList<RecruitmentStage>("/recruitment/stages/", params);
}

export function createRecruitmentStage(payload: RecruitmentStagePayload): Promise<RecruitmentStage> {
  return apiPost<RecruitmentStage, RecruitmentStagePayload>("/recruitment/stages/", payload);
}

export function updateRecruitmentStage(id: string, payload: Partial<RecruitmentStagePayload>): Promise<RecruitmentStage> {
  return apiPatch<RecruitmentStage, Partial<RecruitmentStagePayload>>(`/recruitment/stages/${id}/`, payload);
}

export function listCandidateEvaluations(params?: ListParams): Promise<PaginatedData<CandidateEvaluation>> {
  return apiGetList<CandidateEvaluation>("/recruitment/evaluations/", params);
}

export function createCandidateEvaluation(payload: CandidateEvaluationPayload): Promise<CandidateEvaluation> {
  return apiPost<CandidateEvaluation, CandidateEvaluationPayload>("/recruitment/evaluations/", payload);
}
