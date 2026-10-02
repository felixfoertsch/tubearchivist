#!/usr/bin/env bash
# Replay the fork's commit stack; never push or publish from this script.
set -euo pipefail
export GIT_TERMINAL_PROMPT=0 GIT_EDITOR=true

fail() {
    printf '::error::%s\n' "$*" >&2
    if [[ -n ${GITHUB_STEP_SUMMARY:-} ]]; then
        printf '\n## Upstream replay failed\n\n%s\n' "$*" >> "$GITHUB_STEP_SUMMARY"
    fi
    exit 1
}

[[ -z $(git status --porcelain) ]] || fail 'Refusing to replay a dirty checkout.'
git fetch --no-tags origin \
    '+refs/heads/develop:refs/remotes/origin/develop' \
    '+refs/heads/upstream-base:refs/remotes/origin/upstream-base'
original_sha=$(git rev-parse refs/remotes/origin/develop)
original_base=$(git rev-parse refs/remotes/origin/upstream-base)
[[ $(git rev-parse HEAD) == "$original_sha" ]] || \
    fail 'develop changed after checkout. Retry against the latest branch.'
git merge-base --is-ancestor "$original_base" HEAD || \
    fail 'upstream-base is not an ancestor of develop; repair the patch boundary manually.'
[[ -z $(git rev-list --min-parents=2 "$original_base..HEAD") ]] || \
    fail 'The fork patch stack contains merge commits. Rebase/squash it before retrying.'
mapfile -t patches < <(git rev-list --reverse "$original_base..HEAD")
[[ ${#patches[@]} -gt 0 ]] || fail 'The fork patch stack is empty.'
for patch in "${patches[@]}"; do
    if git diff-tree --quiet "$patch^" "$patch"; then
        fail "Empty fork patch $patch; resolve it explicitly instead of silently skipping it."
    fi
done

git fetch --no-tags "${UPSTREAM_URL:-https://github.com/tubearchivist/tubearchivist.git}" \
    '+refs/heads/develop:refs/remotes/upstream/develop'
upstream_sha=$(git rev-parse refs/remotes/upstream/develop)
git merge-base --is-ancestor "$original_base" "$upstream_sha" || \
    fail 'Upstream history was rewritten. Refusing to guess a new patch boundary.'

if [[ -n ${GITHUB_STEP_SUMMARY:-} ]]; then
    {
        printf '## Fork patch stack\n\n'
        printf 'Previous upstream: `%s`\n\nNew upstream: `%s`\n\n' "$original_base" "$upstream_sha"
        git log --reverse --format='- `%h` %s' "$original_base..HEAD"
    } >> "$GITHUB_STEP_SUMMARY"
fi

if [[ "$original_base" != "$upstream_sha" ]]; then
    git config user.name 'github-actions[bot]'
    git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
    # No skipped cherry-picks, empty patches, saved conflict resolutions, or merge commits.
    if ! git -c rerere.enabled=false -c rerere.autoupdate=false rebase \
        --no-fork-point --reapply-cherry-picks --empty=stop \
        --committer-date-is-author-date --onto "$upstream_sha" "$original_base"; then
        failed_patch=$(git show -s --format='%h %s' REBASE_HEAD 2>/dev/null || printf 'unknown patch')
        git diff --name-only --diff-filter=U >&2
        git rebase --abort
        fail "Cannot replay $failed_patch (conflict or empty patch). No remote branches or image aliases were updated."
    fi
fi

git merge-base --is-ancestor "$upstream_sha" HEAD || fail 'Replayed stack is not on upstream.'
[[ $(git rev-list --count "$upstream_sha..HEAD") -eq ${#patches[@]} ]] || \
    fail 'The replay changed the number of fork patches.'
[[ -z $(git status --porcelain) ]] || fail 'Replay left uncommitted changes.'
sha=$(git rev-parse HEAD)
publish=true
if [[ ${GITHUB_EVENT_NAME:-} == schedule ]] && \
    [[ -n $(git tag --points-at HEAD --list 'fork-*') ]]; then
    publish=false
fi
{
    printf 'sha=%s\nupstream_sha=%s\n' "$sha" "$upstream_sha"
    printf 'original_sha=%s\noriginal_base=%s\n' "$original_sha" "$original_base"
    printf 'publish=%s\n' "$publish"
} >> "${GITHUB_OUTPUT:-/dev/stdout}"
if [[ "$publish" == false && -n ${GITHUB_STEP_SUMMARY:-} ]]; then
    printf '\nThis exact patched commit is already released; nothing to build.\n' >> "$GITHUB_STEP_SUMMARY"
fi
