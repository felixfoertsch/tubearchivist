"""OIDC creates Django sessions; provider tokens never persist."""

import hashlib
import logging
import secrets
from datetime import timedelta
from urllib.parse import unquote, urlsplit

from authlib.integrations.base_client.errors import OAuthError
from authlib.integrations.django_client import OAuth
from authlib.integrations.requests_client import OAuth2Session
from django.conf import settings
from django.contrib.auth import login
from django.core.exceptions import ImproperlyConfigured
from django.db import IntegrityError, transaction
from django.http import HttpResponseRedirect, JsonResponse
from django.utils import timezone
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET
from joserfc.errors import JoseError
from requests.exceptions import RequestException
from user.models import Account, FederatedIdentity, OIDCTransaction

CALLBACK_PATH = "/api/user/oidc/callback/"
TRANSACTION_SECONDS = 300
LOGGER = logging.getLogger(__name__)


def enabled():
    return bool(settings.TA_OIDC_ISSUER)


def https_url(value):
    parts = urlsplit(value)
    if (
        parts.scheme != "https"
        or not parts.hostname
        or parts.username
        or parts.password
        or parts.fragment
        or parts.query
    ):
        raise ValueError("Invalid OIDC configuration")
    return parts


class ProviderSession(OAuth2Session):
    """Bound HTTP calls; redirects must not move credential requests."""

    def request(self, method, url, **kwargs):
        kwargs.setdefault("timeout", 10)
        kwargs["allow_redirects"] = False
        response = super().request(method, url, **kwargs)
        if 300 <= response.status_code < 400:
            raise ValueError("Provider redirect rejected")
        return response


def client():
    issuer = settings.TA_OIDC_ISSUER
    issuer_url = https_url(issuer)
    if len(issuer) > 512:
        raise ValueError("Invalid issuer")
    callback = https_url(settings.TA_OIDC_REDIRECT_URI)
    if (
        callback.path != CALLBACK_PATH
        or not settings.TA_OIDC_CLIENT_ID
        or not settings.TA_OIDC_CLIENT_SECRET
    ):
        raise ValueError("Invalid OIDC configuration")
    oauth = OAuth()
    remote = oauth.register(
        "authentik",
        client_id=settings.TA_OIDC_CLIENT_ID,
        client_secret=settings.TA_OIDC_CLIENT_SECRET,
        server_metadata_url=issuer.rstrip("/")
        + "/.well-known/openid-configuration",
        client_kwargs={
            "scope": "openid profile email",
            "code_challenge_method": "S256",
            "default_timeout": 10,
        },
    )
    remote.client_cls = ProviderSession
    remote.framework.expires_in = TRANSACTION_SECONDS
    metadata = remote.load_server_metadata()
    if metadata.get("issuer") != issuer:
        raise ValueError("Issuer mismatch")
    for field in ("authorization_endpoint", "token_endpoint", "jwks_uri"):
        endpoint = https_url(metadata.get(field, ""))
        if (endpoint.hostname, endpoint.port) != (
            issuer_url.hostname,
            issuer_url.port,
        ):
            raise ValueError("Provider endpoint origin mismatch")
    # Do not let remote metadata expand the accepted signing algorithms.
    if "RS256" not in metadata.get(
        "id_token_signing_alg_values_supported", []
    ):
        raise ValueError("Unsupported signing algorithm")
    remote.server_metadata.update(
        {
            "id_token_signing_alg_values_supported": ["RS256"],
            "code_challenge_method": "S256",
            "scope": "openid profile email",
            "default_timeout": 10,
            "token_endpoint_auth_method": "client_secret_basic",
        }
    )
    return remote


def safe_next(value):
    decoded = unquote(value or "")
    if (
        not value
        or not value.startswith("/")
        or decoded.startswith("//")
        or "\\" in decoded
        or any(ord(char) <= 32 or ord(char) == 127 for char in decoded)
    ):
        return "/"
    return value


def clear_protocol_state(request):
    for key in list(request.session.keys()):
        if key.startswith("_state_authentik_"):
            request.session.pop(key)


def failure():
    # Never echo provider error descriptions, codes, configuration or tokens.
    response = HttpResponseRedirect("/login/?oidc_error=1")
    response["Referrer-Policy"] = "no-referrer"
    return response


@never_cache
@require_GET
def auth_options(request):
    return JsonResponse(
        {
            "oidc_enabled": enabled(),
            "oidc_login_url": "/api/user/oidc/login/" if enabled() else None,
            "local_login_enabled": True,
        }
    )


OIDC_ERRORS = (
    OAuthError,
    JoseError,
    RequestException,
    ValueError,
    KeyError,
    TypeError,
    ImproperlyConfigured,
)


@never_cache
@require_GET
def start(request):
    if not enabled():
        return JsonResponse({"error": "OIDC unavailable"}, status=404)
    try:
        remote = client()
        if not request.session.session_key:
            request.session.create()
        # One in-flight transaction per browser; newest login supersedes old.
        OIDCTransaction.objects.filter(
            session_key=request.session.session_key
        ).delete()
        OIDCTransaction.objects.filter(
            created_at__lt=timezone.now()
            - timedelta(seconds=TRANSACTION_SECONDS)
        ).delete()
        clear_protocol_state(request)
        state = secrets.token_urlsafe(32)
        request.session["oidc_next"] = safe_next(request.GET.get("next"))
        response = remote.authorize_redirect(
            request,
            settings.TA_OIDC_REDIRECT_URI,
            state=state,
        )
        OIDCTransaction.objects.create(
            state_hash=hashlib.sha256(state.encode()).hexdigest(),
            session_key=request.session.session_key,
        )
        return response
    except OIDC_ERRORS:
        clear_protocol_state(request)
        LOGGER.warning("OIDC authentication failed")
        return failure()


def resolve_account(issuer, subject):
    if not isinstance(subject, str) or not subject or len(subject) > 255:
        raise ValueError("Invalid subject")
    identity = FederatedIdentity.objects.filter(
        issuer=issuer, subject=subject
    ).first()
    if identity:
        return identity.account
    try:
        with transaction.atomic():
            account = new_account()
            FederatedIdentity.objects.create(
                issuer=issuer,
                subject=subject,
                account=account,
            )
            return account
    except IntegrityError:
        # A competing insertion wins; rollback includes the losing account.
        return FederatedIdentity.objects.get(
            issuer=issuer, subject=subject
        ).account


def new_account():
    for _ in range(3):
        account = Account(name="oidc-" + secrets.token_hex(24))
        account.set_unusable_password()
        try:
            with transaction.atomic():
                account.save()
            return account
        except IntegrityError:
            if not Account.objects.filter(name=account.name).exists():
                raise
    raise ValueError("Unable to allocate account name")


@never_cache
@require_GET
def callback(request):
    if not enabled():
        return JsonResponse({"error": "OIDC unavailable"}, status=404)
    state = request.GET.get("state", "")
    if any(
        len(request.GET.getlist(key)) > 1 for key in ("state", "code", "error")
    ):
        return failure()
    if not state or len(state) > 256 or not request.session.session_key:
        return failure()
    with transaction.atomic():
        fence = (
            OIDCTransaction.objects.select_for_update()
            .filter(
                state_hash=hashlib.sha256(state.encode()).hexdigest(),
                session_key=request.session.session_key,
            )
            .first()
        )
        if fence is None:
            return failure()
        fresh = fence.created_at > timezone.now() - timedelta(
            seconds=TRANSACTION_SECONDS
        )
        fence.delete()
    if not fresh:
        clear_protocol_state(request)
        return failure()
    try:
        remote = client()
        if not request.GET.get("error") and not request.GET.get("code"):
            raise ValueError("Missing authorization code")
        token = remote.authorize_access_token(
            request,
            leeway=0,
            claims_options={
                "iss": {"essential": True, "value": settings.TA_OIDC_ISSUER},
                "aud": {
                    "essential": True,
                    "value": settings.TA_OIDC_CLIENT_ID,
                },
            },
        )
        claims = token.get("userinfo")
        if not claims or claims.get("iss") != settings.TA_OIDC_ISSUER:
            raise ValueError("Invalid ID token")
        account = resolve_account(settings.TA_OIDC_ISSUER, claims["sub"])
        target = safe_next(request.session.pop("oidc_next", "/"))
        # Provider errors skip Authlib cleanup; remove abandoned transactions
        # before entering an authenticated session.
        clear_protocol_state(request)
        login(
            request,
            account,
            backend="django.contrib.auth.backends.ModelBackend",
        )
        request.session.set_expiry(60 * 60 * 24 * 2)
        response = HttpResponseRedirect(target)
        response["Referrer-Policy"] = "no-referrer"
        return response
    except OIDC_ERRORS:
        clear_protocol_state(request)
        LOGGER.warning("OIDC authentication failed")
        return failure()
