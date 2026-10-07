from django.contrib import admin

from apps.recruitment.models import Application, ApplicationStageHistory, Candidate, CandidateEvaluation, Interview, JobPosting, Offer, RecruitmentStage


@admin.register(JobPosting, Candidate, RecruitmentStage, Application, Interview, CandidateEvaluation, Offer)
class RecruitmentAdmin(admin.ModelAdmin):
    list_display = ("id", "institution", "created_at")
    list_filter = ("institution",)
    search_fields = ("id",)


@admin.register(ApplicationStageHistory)
class ApplicationStageHistoryAdmin(admin.ModelAdmin):
    list_display = ("application", "from_stage", "to_stage", "changed_by", "created_at")
    list_filter = ("institution",)
    readonly_fields = ("institution", "application", "from_stage", "to_stage", "changed_by", "comment", "created_at", "updated_at")
