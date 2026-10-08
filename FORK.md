# Fork automation

`patch-queue` owns workflows, ordered patch files, and tests. It builds two
unofficial `ghcr.io/felixfoertsch/tubearchivist` channels from official upstream:

- Stable uses upstream GitHub Releases `latest`, then every patch in
  `.automation/series`. It promotes only validated multi-architecture candidates
  to `latest`, `stable`, and immutable `<upstream-tag>-YYYY.MM.DD.N` identities.
  Dates use Europe/Berlin; suffixes advance past existing source tags.
- Nightly uses upstream `develop`, then same patches. It promotes only validated
  multi-architecture candidates to `nightly`, `edge`, `develop`, and isolated
  `nightly-<latest-stable-tag>-YYYY.MM.DD.N` identities. Version-only image tags stay untouched.

Build tooling pins Node.js 24.21.0 LTS; GitHub Actions use native Node.js 24 runtimes.
Packaged upstream application runtimes remain unchanged.

Read-only build jobs export OCI archives without persisted Git credentials.
Separate publication jobs check out exact workflow revision, reconstruct source
independently, verify artifact provenance and both image revisions, then publish.
Downloaded artifacts contain data only; publication never executes their code.

Automation rebuilds `main` only from current upstream `develop` plus all patches.
Generated `main` contains no `.github/workflows` or `.automation`; it has no
`upstream-base` dependency. It is source history, not automation control plane.

Candidates publish before aliases move. Before promotion automation verifies its
own branch and upstream ref remain unchanged. GitHub Actions uses only automatic
`GITHUB_TOKEN` credentials. Existing immutable image tags and releases remain
untouched.

Images are unofficial fork images. Do not present them as upstream Tube Archivist
images.
