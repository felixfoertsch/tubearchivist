# Fork contract

- `main` owns directly maintained source, tests, packaging, and CI. No generated source branch, patch queue, replay, automatic upstream synchronization, or history rewriting.
- Preserve upstream README content below the fork introduction and preserve fork behavior tests.
- `.github/workflows/image.yml` validates exact event SHAs. Pull requests remain read-only and never publish.
- Validated `main` pushes publish only this fork's `nightly` channel. Published non-prerelease releases publish exact immutable release tags, `stable`, and `latest`; prereleases never publish.
- Keep multi-architecture `linux/amd64` and `linux/arm64` builds. Isolate package-write credentials from source execution; publisher consumes OCI data only. Reject stale channel promotion.
- CI uses built-in `GITHUB_TOKEN` only. No automatic releases, upstream publishers, deployments, or remote source mutations.
- Run `node scripts/test-workflow.mjs` after workflow edits. Application checks retain existing package managers and lint/test stacks.

# Feature delivery

- Completed features and fixes have standing authorization for required tests and review, a coherent commit of intended files, a normal push to `main`, and deployment. Explicit user holds or review-only requests override this default.
- Await successful CI for the exact pushed SHA; independently verify immutable image identity and both architectures before deploying only TubeArchivist through the existing documented scoped procedure. Preserve the prior image for rollback; verify health and unrelated-service preservation afterward.
- Stop and report failed checks, concurrent or unrelated changes, failed publication, image validation, or deployment. Never force-push, amend or rewrite history, bypass credentials or hooks, reconcile dependencies, or broaden infrastructure changes as part of routine delivery.
