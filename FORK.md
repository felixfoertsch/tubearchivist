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

## Channel rolling window ([0005](https://github.com/felixfoertsch/tubearchivist/blob/patch-queue/.automation/patches/0005-channel-rolling-window.patch))

Set optional channel override `channel_overwrites.rolling_window_size` to a
positive integer N from 1 to 2147483647 to retain the N latest eligible regular
accessible videos by upload date.
Set it to `null` to disable rolling-window management; disabling does not restore
previously deleted videos. Normal-video page size `0` also disables this rolling
scope. Existing watched-age cleanup still applies when rolling is disabled; this
option does not freeze all deletion. Existing subscription and download schedules
stay in control; enabling this option does not create a new schedule. Ignored
videos and channel title filters remain respected. Shorts and streams stay untouched.

**Warning:** Enabling this option lets the channel delete older regular videos,
including watched, unwatched, manually downloaded, and playlist-downloaded videos
already in your library. Keep separate backups for videos you want to preserve.

Rolling discovery scans metadata for the full channel, which can be costly for
large channels. Confirmed unavailable, private, members-only, premium-only and
region-restricted videos are skipped. Unknown access errors, authentication
challenges, network failures and incomplete enumeration pause rolling admission
and cleanup; generic errors are never treated as proof of unavailability.
Replacement downloads must complete before older videos are pruned; failed or
incomplete replacements keep old videos. N is not a
strict cap during incomplete replacements, so the library can temporarily exceed N.
