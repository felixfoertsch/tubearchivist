# Authentik OIDC and shared app operators

OIDC is opt-in. Existing local, LDAP and forward-auth selection remains unchanged.
Configure `TA_LOGIN_AUTH_MODE=local` on the isolated DEV deployment to retain local
recovery alongside OIDC. Keep the existing recovery username/password and Django
secret stable. OIDC accounts have unusable passwords and no staff/superuser flags.

## Environment contract

| Variable | Value |
| --- | --- |
| `TA_OIDC_ISSUER` | Exact issuer from reviewed provider discovery; no guessed slug or origin |
| `TA_OIDC_CLIENT_ID` | `example-client` |
| `TA_OIDC_CLIENT_SECRET_FILE` | Dedicated mounted client-secret file |
| `TA_OIDC_CLIENT_SECRET` | Optional direct-secret alternative; takes precedence over `_FILE` |
| `TA_OIDC_REDIRECT_URI` | `https://example.com/api/user/oidc/callback/` |
| `TA_APP_OPERATOR_ACCESS` | `true` for approved shared-operator DEV policy; default `false` |

Issuer absent disables OIDC. Partial configuration cannot authenticate.
Enable flag is independent of OIDC: shared operator policy also applies to local,
LDAP and proxy-authenticated accounts on this deployment. Do not set it on existing
production unless separately approved. Issuer,
discovered endpoints and callback require HTTPS; callback path must match exactly.
Discovered authorization/token/JWKS endpoints must share configured issuer origin.
Issuer metadata must match configured issuer exactly. Signing algorithm is RS256.
Provider requests use a 10-second timeout and reject redirects. Do not expose
client secrets through app settings or public auth-options responses.
OIDC mode marks session and CSRF cookies Secure; serve app through HTTPS.
Backend Uvicorn access logs stay disabled, including with `DJANGO_DEBUG`, to keep
authorization codes and state out of callback query logs. Other startup logging
levels remain unchanged. Configure proxy access logs to omit callback query strings
(authorization codes); verify live proxy logging before deployment.
Do not enable Authlib/requests debug logging, which can contain protocol secrets.

Register one confidential authorization-code client, strict callback above, scopes
`openid profile email`, S256 PKCE, and dedicated `example-access` group.
Initially admit only approved test account. No `offline_access`, refresh-token
storage or implicit roles from profile/email/group claims. Provider tokens remain
transient. Identity key is `(issuer, subject)`; names and email never link accounts.

Routes:

- `GET /api/user/auth-options/`: nonsecret enabled modes/login URL.
- `GET /api/user/oidc/login/?next=/relative/path`: starts login.
- `GET /api/user/oidc/callback/`: registered callback, five-minute single-use state
  bound to browser session, nonce and S256 PKCE.
- Existing `POST /api/user/logout/`: CSRF-protected local session logout only.

Logout does not invalidate Authentik or unrelated applications. Existing Authentik
session can sign in again without a password prompt. No IdP logout callback needed.

## Authorization and revocation

`TA_APP_OPERATOR_ACCESS=true` grants all authenticated accounts normal app-operator
capabilities independently of Django staff. Keep identity/account/role management,
credentials and full database backups/restores administrator-only, including task
and scheduler paths. Default false preserves existing content-write restrictions.
The account API exposes server-computed `can_manage_app` and `can_administer`;
frontend flags are presentation, never authorization.

Preferences and playback progress remain per-account. Library, subscriptions and
watched flags remain shared. OIDC does not migrate these semantics.

Authentik group removal prevents new provider authorizations, not existing Django
sessions or separately issued API tokens. App sessions last two days; no refresh or
periodic IdP revalidation runs. Recovery administrator must explicitly invalidate
existing Django sessions and revoke API tokens when immediate app revocation is
needed. No automatic email/name relinking or identity-management UI exists.

## Dependency evidence and checks

Authlib 1.9.1 is pinned in `backend/requirements.txt`; its official PyPI metadata
requires Python >=3.10. Official Django client integration uses Django session and
Authlib's OIDC claim validation/JWKS implementation:

- https://pypi.org/project/Authlib/1.9.1/
- https://github.com/authlib/authlib/tree/v1.9.1/authlib/integrations/django_client
- https://github.com/authlib/authlib/blob/v1.9.1/authlib/integrations/base_client/sync_openid.py

`backend/user/tests/test_oidc.py` exercises real Authlib exchanges and signed ID
validation with simulated provider HTTP. Run with project PostgreSQL test harness,
then full backend suite, pre-commit hooks, frontend build and Node contract tests.
Actual new-provider discovery/login and isolated DEV delivery remain separate,
reviewed operational gates. Never apply all Authentik blueprints for this change.
