# Pull request contribution

1. Inspect the current repository, branch, remotes, and `git status --short`. Preserve unrelated user changes.
2. Summarize the actual diff. Do not claim behavior that was not verified.
3. Run `npm run build`; run `npm run smoke` for layout/state/rendering changes; run the relevant UI smoke action for interface changes.
4. Present a contribution review containing changed behavior, affected files, verification results, remaining limitations, proposed branch name, commit message, and PR title/body.
5. Obtain explicit approval before fork/push/PR external writes.
6. Use a `codex/` branch unless the user names another branch. Commit only intended files.
7. Prefer `gh pr create`; GitHub CLI can create a fork when the user lacks push permission. Keep the original repository as upstream and the user's fork as the contribution remote.
8. Return the PR URL and authorship details. Never attribute the contribution to the maintainer when it came from the user.

If there are no source changes, route the idea to a Discussion instead of manufacturing a code commit.
