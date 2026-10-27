# Fork contract

- `main` owns directly maintained source, tests, packaging, and CI. No generated source branch, patch queue, replay, automatic upstream synchronization, or history rewriting.
- Preserve upstream README content below the fork introduction and preserve fork behavior tests.
- `.github/workflows/image.yml` validates exact event SHAs. Pull requests remain read-only and never publish.
- Validated `main` pushes publish only this fork's `nightly` channel. Published non-prerelease releases publish exact immutable release tags, `stable`, and `latest`; prereleases never publish.
- Keep multi-architecture `linux/amd64` and `linux/arm64` builds. Isolate package-write credentials from source execution; publisher consumes OCI data only. Reject stale channel promotion.
- CI uses built-in `GITHUB_TOKEN` only. No automatic releases, upstream publishers, deployments, or remote source mutations.
- Narrow exception: manually dispatch `.github/workflows/preserve-stable.yml` on the current `main` commit directly following `b8c413495fd61f7a584e7a2e239a03b5e717ccef` to preserve its already-running production OCI digest as `stable` and `latest`, without rebuilding. Only the hardcoded production digest is eligible; later source commits disable this path. No runtime changes.
- Run `node scripts/test-workflow.mjs` after workflow edits. Application checks retain existing package managers and lint/test stacks.

# Public repository privacy

- Use `example.com` and generic accounts and paths in public docs, tests, issues, comments, and log examples. Keep actual deployment hosts, private identifiers, configuration, and evidence in private infrastructure sources. Never publish secrets; preserve intentional public attribution and repository URLs.

# Development scope

- Development uses only the modern UI and TubeArchivist plus PostgreSQL 18. No classic UI, Elasticsearch, Redis, or Celery service.
- Target is a fresh isolated DEV instance on an isolated development host, with separate database, credentials, cache/media volumes, ports, and container names. Existing production remains unchanged; never reuse its data or treat DEV delivery as production migration authorization.
- Application PostgreSQL role stays restricted; bootstrap administrator preinstalls `pg_trgm`. Administrator credentials are bootstrap/test-only, never app runtime.

# Feature delivery

- Completed features and fixes have standing authorization for required tests and review, a coherent commit of intended files, a normal push to `main`, and deployment to the approved isolated DEV target only. Production deployment requires explicit separate authorization. Explicit user holds or review-only requests override this default.
- Do not move `main` or publish further development until exact production image preservation succeeds and both aliases are independently verified. Isolated integration commits may proceed under an explicit integration-only hold; no push or deployment during that hold.
- Await successful CI for the exact pushed SHA; independently verify immutable image identity and both architectures before deploying only TubeArchivist through the existing documented scoped procedure. Preserve the prior image for rollback; verify health and unrelated-service preservation afterward.
- Stop and report failed checks, concurrent or unrelated changes, failed publication, image validation, or deployment. Never force-push, amend or rewrite history, bypass credentials or hooks, reconcile dependencies, or broaden infrastructure changes as part of routine delivery.
