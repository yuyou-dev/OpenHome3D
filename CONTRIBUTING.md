# Contributing to OpenHome3D

Thank you for helping improve OpenHome3D. You can participate with an idea, a question, a bug report, a design you made, documentation, or code.

## Choose the right channel

- [GitHub Discussions](https://github.com/yuyou-dev/OpenHome3D/discussions): questions, product ideas, feedback, and showcases.
- [GitHub Issues](https://github.com/yuyou-dev/OpenHome3D/issues): reproducible bugs with clear steps and environment details.
- Pull Requests: completed source or documentation changes.

If you use Codex, install the OpenHome3D Companion and ask it to open the community hub. It can guide GitHub signup, draft a post, summarize local changes, run checks, and prepare a PR. It always shows the final public text before publishing.

## Pull request workflow

1. Fork the repository and create a focused branch.
2. Keep unrelated changes out of the PR.
3. Follow the technical contracts in `AGENTS.md`.
4. Run `npm run build` for every change.
5. Run `npm run smoke` for layout, state, rendering, template, door/window, or import changes.
6. Run the relevant UI smoke/audit for visible interface changes.
7. Explain what changed, why, how it was verified, and any remaining limitation.

Small, focused PRs are easier to review. Maintainers may ask for changes or reproduce the behavior in an isolated worktree before merging. Squash merges preserve the contributor as commit author.

## Project contracts

- Rendering remains cel-shaded and uses the shared toon gradient and palette.
- General UI remains bilingual Chinese-first/English-second and follows the Neo-Brutalism design system.
- Do not add credentials, personal filesystem paths, private hosts, or private-only services.
- Do not hand-edit generated model manifests; follow the asset workflow in `AGENTS.md`.
- New external dependencies need a concrete benefit and should remain minimal.

## Community conduct and security

Participating means following [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Do not disclose vulnerabilities or secrets in a public Issue or Discussion; follow [SECURITY.md](SECURITY.md) instead.
