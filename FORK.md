# Fork automation

`automation` owns workflows, ordered patch files, and tests. It builds two
unofficial `ghcr.io/felixfoertsch/tubearchivist` channels from official upstream:

- Stable uses upstream GitHub Releases `latest`, then every patch in
  `.automation/series`. It promotes only validated multi-architecture candidates
  to `latest`, `stable`, and version aliases.
- Nightly uses upstream `develop`, then same patches. It promotes only validated
  multi-architecture candidates to `nightly`, `edge`, and `develop`.

Automation rebuilds `main` only from current upstream `develop` plus all patches.
Generated `main` contains no `.github/workflows` or `.automation`; it has no
`upstream-base` dependency. It is source history, not automation control plane.

Candidates publish before aliases move. Before promotion automation verifies its
own branch and upstream ref remain unchanged. GitHub Actions uses only automatic
`GITHUB_TOKEN` credentials. Existing immutable image tags and releases remain
untouched.

Images are unofficial fork images. Do not present them as upstream Tube Archivist
images.
