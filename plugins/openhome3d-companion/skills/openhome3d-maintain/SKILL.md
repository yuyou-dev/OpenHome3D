---
name: openhome3d-maintain
description: Triage and maintain the OpenHome3D GitHub community across Discussions, Issues, and Pull Requests. Use for inbox summaries, unanswered threads, requirement analysis, review preparation, contributor follow-up, or release-facing maintenance.
---

# OpenHome3D Maintain

Treat Discussions, Issues, and PRs as one community inbox while respecting the different lifecycle of each item.

## Read and analyze

Use `open_openhome3d_hub` for the visual Discussion view. Use `gh` read commands or GitHub GraphQL for full bodies, comments, Issues, and PR diffs.

Open the visual hub only through that MCP tool. Its `ui://openhome3d/community-hub/v2.html` resource is not a browser URL. If the tool is deferred, discover its exact registered name through the host's tool-search mechanism before using any fallback. Only a confirmed absence justifies restart-and-attach guidance or a temporary ordinary HTTPS Discussions fallback.

For an inbox report, separate:

- questions needing an answer;
- ideas needing product discussion;
- reproducible bugs needing triage;
- showcases needing acknowledgement;
- PRs needing review or verification;
- repeated signals that may represent one underlying need.

Distinguish evidence from inference. Link each summarized need back to its source item.

## Act safely

Draft public responses in English and show them before publishing. Obtain explicit confirmation immediately before each comment, close, review, merge, push, or other external mutation. A broad request to “review the inbox” authorizes read-only inspection, not replies or merges.

For PR verification, use an isolated worktree and run the checks appropriate to the touched code. Bug fixes require evidence that the problem existed before the fix when practical. Preserve contributor attribution when merging.

After an accepted change, check whether the corresponding behavior or shared code must be synchronized with the private Home3D-Cartoon sibling, but do not copy credentials, private paths, or private-only services into OpenHome3D.

Use [triage rules](references/triage.md) for classification and closure criteria.
