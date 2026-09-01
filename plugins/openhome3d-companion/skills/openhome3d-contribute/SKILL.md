---
name: openhome3d-contribute
description: Help non-coders and developers contribute to OpenHome3D through GitHub Discussions, Issues, or Pull Requests. Use when a user wants to suggest, ask, report, reply, share, submit changes, or participate without learning Git commands.
---

# OpenHome3D Contribute

Turn a user's intent or local changes into a clear, correctly routed OpenHome3D contribution while preserving their authorship and control.

## Choose the route

- Question or open-ended conversation → GitHub Discussion, category `Q&A`.
- Product idea → GitHub Discussion, category `Ideas`.
- Work showcase → GitHub Discussion, category `Show and tell`.
- Reproducible defect → GitHub Issue using the bug template when practical.
- Completed source change → Fork + branch + Pull Request.

Open `open_openhome3d_hub` when a visual community browser, newcomer onboarding, or form is useful. A form submission is a draft, not publication approval.

The hub must be opened by calling that MCP tool. `ui://openhome3d/community-hub/v2.html` is an internal Apps resource identifier, not a browser URL. If the tool is deferred, discover its exact registered name through the host's tool-search mechanism before using any fallback. Only a confirmed absence justifies the restart-and-attach guidance or an explicitly labeled normal HTTPS Discussions fallback.

## GitHub onboarding

Check `check_openhome3d_github` before a write workflow. Installation, local use, and drafting remain available without an account.

For a new account, use the hub's neutral five-step guide. Recommend GitHub's native email signup as the primary path because it is consistent and keeps the tutorial linear. Mention Google or Apple only when the user asks for an alternative. The user must personally complete password entry, CAPTCHA, email verification, and 2FA.

Connect an existing account with `gh auth login --web`, then verify using `gh auth status`. Never request a password, one-time code, recovery code, or token in the conversation.

## Draft and publish

1. Read relevant existing Discussions/Issues to avoid obvious duplicates.
2. Preserve the user's meaning while producing concise public English. Ask only for missing information that materially changes accuracy.
3. Call `stage_openhome3d_community_draft` to lock the exact final destination, title, category, and body. Staging does not publish.
4. Show the returned staged preview and approval ID verbatim.
5. Obtain explicit confirmation immediately after that preview and before the external write.
6. Call `publish_openhome3d_community_draft` using only that single-use approval ID. Report the resulting URL.

For PR contributions, read [pull requests](references/pull-requests.md).

## Boundaries

- Do not treat “looks good” given before the staged final preview as publication approval.
- Do not publish from the Apps UI form itself.
- Do not add generated claims, reproduction results, screenshots, or test results that were not observed.
- Keep public GitHub writing in English unless the user explicitly requests another language.
- Never navigate a browser to a `ui://` URI or report the hub as open without a completed `open_openhome3d_hub` call.
