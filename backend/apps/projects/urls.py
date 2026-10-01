from rest_framework.routers import DefaultRouter

from apps.projects import views

app_name = "projects"

router = DefaultRouter()
router.register("projects", views.ProjectViewSet, basename="project")
router.register("my-allocations", views.MyAllocationViewSet, basename="my-allocation")

urlpatterns = router.urls
