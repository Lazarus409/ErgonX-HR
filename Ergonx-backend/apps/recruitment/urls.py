from rest_framework.routers import DefaultRouter

from apps.recruitment.views import ApplicationViewSet, CandidateEvaluationViewSet, CandidateViewSet, InterviewViewSet, JobPostingViewSet, OfferViewSet, RecruitmentStageViewSet

router = DefaultRouter()
router.register("recruitment/job-postings", JobPostingViewSet, basename="recruitment-job-posting")
router.register("recruitment/candidates", CandidateViewSet, basename="recruitment-candidate")
router.register("recruitment/stages", RecruitmentStageViewSet, basename="recruitment-stage")
router.register("recruitment/applications", ApplicationViewSet, basename="recruitment-application")
router.register("recruitment/interviews", InterviewViewSet, basename="recruitment-interview")
router.register("recruitment/evaluations", CandidateEvaluationViewSet, basename="recruitment-evaluation")
router.register("recruitment/offers", OfferViewSet, basename="recruitment-offer")

urlpatterns = router.urls
