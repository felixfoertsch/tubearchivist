# Control refresh

`downstream.yml` first reconstructs `patch-queue` on the discovered upstream
HEAD. All accepted patches apply before a narrow trusted overlay is restored:
`.automation/`, `.gitattributes`, `FORK.md`, and the three explicitly named
workflow files. The entire workflow tree must match the old control, including
paths, modes and blob IDs. No generated code runs in the write-capable job.
The promoter independently reconstructs using old-control scripts and compares
metadata from the read-only job. Application validation remains in the existing
read-only stable/nightly build jobs after continuation.

`.automation/upstream.json` records upstream repository, default ref and selected
commit, never the control's own SHA. Later refreshes reject ref/repository changes,
non-descendant upstream history and unqueued application edits. Initial migration
alone permits the reviewed historical layout at `920b550ef8aa0606682d4fd8a216c44c5bd60c8e`,
provided the accepted `2ad21b79676b9ec8579845c937dcf01a4bbbf89a` is an ancestor and
all subsequent changes belong to the trusted overlay. Equal trees are no-ops
only when the selected upstream is already an ancestor; an empty upstream commit
therefore refreshes once.

Before each rewrite, the old HEAD receives a self-contained bundle. Both local
and downloaded copies must restore the exact commit into an empty repository
and pass full connectivity checks. Uploaded bytes must match the local digest.
Retention requests 90 days, verified against repository policy during migration
preflight. Upload or download failure stops promotion; no administration API is
called by the job token. The permanent lightweight tag
`archive/patch-queue/<full-old-control-SHA>` preserves history after artifact expiry.
Existing archive tags must point directly to that exact commit. Missing archive
tag creation and branch replacement share one atomic push, with explicit empty
and old-SHA leases. No non-atomic or alternative-credential fallback exists. Git may omit an already
up-to-date archive ref from its transaction, so its lease cannot prevent a
concurrent administrator changing that existing tag. Precheck and post-push
readback enforce the immutable archive policy; mismatch fails without dispatch,
retagging or rollback, retaining the bundle for recovery.

A successful rewrite explicitly dispatches this workflow with `expected_control`
and original `rebuild` intent. Refresh alone does not force a rebuild. Old runs
never reach container build/publication after a rewrite. Dispatch failure fails
the old run; the next schedule sees the refreshed tree as a no-op and builds it.
No job waits for its continuation while holding the concurrency group.

Built-in token capability remains unverified until the first reviewed real atomic
push. Workflow tree identity is enforced, not assumed to confer authorization.
GitHub rejection must leave both refs unchanged and be reported as a blocker.
Hosted runners isolate candidate and promoter jobs; runner administrators remain
outside this boundary.

Archive tags do not match stable/nightly release identity patterns. `deploy.sh` tag listings and changelog selection explicitly exclude the archive
namespace through accepted runtime/infrastructure patch 0002. Published version tags and images are never moved by refresh.
