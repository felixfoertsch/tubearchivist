"""all user API urls"""

from django.urls import path
from user import oidc, views

urlpatterns = [
    path("auth-options/", oidc.auth_options, name="api-auth-options"),
    path("oidc/login/", oidc.start, name="api-oidc-login"),
    path("oidc/callback/", oidc.callback, name="api-oidc-callback"),
    path("login/", views.LoginApiView.as_view(), name="api-user-login"),
    path("logout/", views.LogoutApiView.as_view(), name="api-user-logout"),
    path("account/", views.UserAccountView.as_view(), name="api-user-account"),
    path("me/", views.UserConfigView.as_view(), name="api-user-me"),
]
