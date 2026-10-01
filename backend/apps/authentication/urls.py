from django.urls import path

from apps.authentication import views

app_name = "authentication"

urlpatterns = [
    path("login/", views.LoginView.as_view(), name="login"),
    path("logout/", views.LogoutView.as_view(), name="logout"),
    path("password/change/", views.PasswordChangeView.as_view(), name="password-change"),
    path("password/forgot/", views.PasswordForgotView.as_view(), name="password-forgot"),
    path("token/refresh/", views.PortalTokenRefreshView.as_view(), name="token-refresh"),
    path("me/", views.CurrentUserView.as_view(), name="current-user"),
    path("entra/exchange/", views.EntraTokenExchangeView.as_view(), name="entra-exchange"),
]
