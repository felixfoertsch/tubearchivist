# Maintaining this fork

`develop` is an upstream checkout followed by a linear stack of fork commits:

1. Remove AI restrictions and set up the automatic build pipeline.
2. Add channel-title filtering.
3. Add simple, download-only metadata embedding, including its queue tests.

These commits are the patches; there is no second, duplicated set of patch files.
`upstream-base` records the exact upstream commit underneath the stack. Do not
merge upstream into `develop` or move that boundary by hand during normal use.

## Activating the prepared history

The `fork/patch-stack` branch contains the three-commit replacement history.
Its workflow runs validation only: it cannot publish images or update branches.
After reviewing that branch, replace `develop` with it using an explicit
`--force-with-lease`. The `upstream-base` branch must point at the parent of the
first fork commit before the first release run. The preserved history is on
`backup/develop-before-patch-stack-20261002`.

## Automatic upstream updates

The **Fork release** workflow runs on pushes to `develop`, manual dispatch, and
hourly at minute 17 (GitHub can delay scheduled runs). It fetches upstream
`tubearchivist/tubearchivist:develop` and rebases every fork commit on top.

Replay explicitly stops on conflicts or patches that become empty, even when
upstream has already implemented one of our changes. It never silently drops a
patch, reuses a recorded conflict resolution, or chooses our/their version to
hide a conflict. Upstream history rewrites and merge commits in the fork stack
also stop the run for manual review.

After replay, the workflow runs its Git integration tests, all pre-commit
checks, backend tests, and the frontend production build. It builds both
`linux/amd64` and `linux/arm64` images using candidate tags first. Only after
success does it update `develop` and `upstream-base` together, with an atomic
push and explicit force-with-lease checks on both branches. A concurrent push
therefore cannot be overwritten by the job.

The validated image is then promoted to:

```text
ghcr.io/felixfoertsch/tubearchivist:latest
ghcr.io/felixfoertsch/tubearchivist:develop
```

Here `latest` means upstream **develop plus our patches**, not an official
stable release. Each build also has `sha-<full-commit>` and `fork-<run>-<attempt>`
tags and a GitHub prerelease that records the upstream, patch stack, and image
digest. Existing releases/tags are not rewritten when the branch is rebased.

Unchanged, already released commits are skipped on scheduled runs. Unpublished
commits are retried. Publishing uses the same workflow as the rebase because
pushes authenticated with `GITHUB_TOKEN` do not start another push workflow.

## Failures and recovery

A replay failure names the failing patch in the Actions log and run summary.
No remote branch or deployment tag changes on patch, validation, or candidate
build failure. Candidate images can exist if a later lease/promotion step
fails; they do not by themselves update `latest`. A failure after promotion
(such as creating release notes) may leave a successfully validated image
published: check which step failed rather than assuming every red run rolled
back the release.

Use GitHub's failed-workflow notifications for alerts; delivery depends on your
GitHub notification settings. Issues are disabled on this fork, so the workflow
does not attempt to create failure issues.

Resolve conflicting changes locally, fold the fix into the appropriate fork
commit, and push the linear stack with `--force-with-lease`. Keep the recorded
upstream base unchanged when just repairing a patch; the next workflow replays
it. Do not use a forceful upstream sync that discards the fork commits. Changes
to the workflow itself belong in the first commit; feature fixes belong with
the feature, rather than accumulating separate CI/WIP commits.

## Updating a local checkout after an automatic rebase

A rebase changes commit IDs. Save or commit local work before realigning your
checkout. For a clean checkout with no unpublished work:

```bash
git fetch origin
git switch develop
git reset --hard origin/develop
```

Do not run the reset on unsaved/unpublished work; rebase or cherry-pick that
work onto the new stack instead.

## Updating the deployed container

Keep your existing volumes, environment, and service dependencies. The Compose
file points at the fork image and pulls it when deploying. To update only the
TubeArchivist service:

```bash
docker compose pull tubearchivist
docker compose up -d --no-deps tubearchivist
```

Select **Embed metadata -> Simple (download only)** in the application to keep
refreshes from rewriting existing media files. Existing Full settings are
preserved until changed explicitly.
