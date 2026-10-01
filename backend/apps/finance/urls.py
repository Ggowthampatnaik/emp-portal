from rest_framework.routers import DefaultRouter

from apps.finance import views

app_name = "finance"

router = DefaultRouter()
router.register("finance/approvals", views.PayslipApprovalViewSet, basename="finance-approval")

urlpatterns = router.urls
