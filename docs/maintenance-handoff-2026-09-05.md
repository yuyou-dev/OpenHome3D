# OpenHome3D maintenance handoff · 2026-09-05

> Historical maintenance record before the precision milestone. Current capabilities and verification are recorded in [HANDOFF.md](../HANDOFF.md).

This handoff records the shared maintenance update from Home3D-Cartoon and the explicit GPT-6 Astra selection for local AI. Usage is in [README.md](../README.md); implementation contracts are in [AGENTS.md](../AGENTS.md).

## Scope and repository state

- Work is based on `main` at `8ec8d1e`, with existing local modifications preserved. The user has authorized committing and publishing the complete maintenance update. Publication follows the existing main-push → GitHub Pages workflow; GitHub Actions records the deployment outcome.
- OpenHome3D keeps its own `openhome3d` browser-storage key, Pages base URL, GitHub community links, installation/upgrade/uninstall runbooks, Companion plugin and MIT/CC0 licensing.
- Shared changes are ported by responsibility rather than by replacing the repository. No local credentials, personal paths or private AI proxies belong in the public source.

## Delivered behavior

| Area | Result and implementation entry |
| --- | --- |
| Local Codex model | Recognition and render orchestration explicitly use `gpt-6-astra` via `--model`. Image generation remains a call to `image_gen`; GPT-6 Astra names the orchestrator, not the image tool's underlying model. Both routes share `scripts/ai-config.mjs`, fixing the model to `gpt-6-astra` and reasoning effort to `high`. CLI 0.153.1 is the minimum; status, request preflight and doctor check compatibility. |
| Preservation during editing | Hand-added/edited, locked and legacy pieces survive regeneration. Decoration density rebuilds only unprotected automatic decor; room resizing clamps positions without regenerating furniture. `src/state/store.ts`, `src/gen/layout.ts`, `src/ui/SelectionPanel.tsx`. |
| Opening consistency | A shared set of legal wall intervals validates and repairs openings after room changes; disconnected openings are removed with a notice. Room-type changes preserve furniture and openings. `src/state/home.ts`. |
| Portable project files | `.home3d` saves the current scene with referenced uploaded GLBs, reference photos, floor-plan image and settings. Open validates before writing, remaps model/instance IDs, preserves old resources and supports undo. Legacy JSON stays compatible with explicit omission guidance. `src/lib/projectPackage.ts`, `src/ui/ProjectFiles.tsx`. |
| Recovery, search and camera | Session history, no-op redo preservation, imported-image recovery, bilingual search and adaptive whole-home framing; screenshots use the live camera and restore its state. `src/state/history.ts`, `src/models/search.ts`, `src/three/cameraFit.ts`, `src/three/runtime.ts`. |
| AI continuity and history | Login/busy status refreshes; closing the panel keeps rendering in the page; cancellation isolates late responses. Each new history item retains its own input, prompt, reference images and result. Storage failure leaves a downloadable result. `src/state/aiTask.ts`, `src/lib/ai.ts`, `src/lib/useAiStatus.ts`. |
| Middleware and regression workflow | Single-flight ownership survives login races and cancellation. Image extraction and cleanup only touch the current task's rollout. Browser helpers mock all AI routes, report errors and isolate SSR optimizer state. New package, editor-invariant, runtime and AI-flow regressions complement the existing tests. |
| Documentation | README describes actual file formats, background-task limits and local-versus-Pages behavior. AGENTS consolidates the shared contracts while retaining public deployment and Companion rules. |

Model reference: [GPT-6 Astra official documentation](https://developers.openai.com/api/docs/models/gpt-6-astra). Codex 0.153.1 first added Astra support ([official changelog](https://learn.chatgpt.com/docs/changelog)); use `npm i -g @openai/codex@latest` to upgrade. An initial live recognition attempt using CLI 0.144.5 was rejected by the service; the CLI has been upgraded to 0.153.4. Post-upgrade recognition passed, and a second compatibility issue was fixed: paginated rollouts store images under `item_completed → item{type:"Extension",kind:"image_gen.generation"}`. Both editions now extract that inline result while retaining old formats and ownership checks.

## Validation

Validation was performed independently in this repository on macOS, Node 20.20.0 and system Chrome. Normal browser and middleware regressions used simulated AI; the live results are listed separately.

| Command | Status |
| --- | --- |
| `npm run check` | Passed: build, 205 layout checks, editor/search/camera/runtime checks; final AI middleware regression has 21 offline checks. |
| `npm run check:ui` | Passed: UI, interactions, portable projects, AI flow and two-viewport overflow audit. Updated CLI-warning flow retested successfully. Mobile AI panel at 390×844: zero console errors. |
| `npm run smoke:pages` | Passed: Pages build, subpath assets, loaded scene, local-only AI message, disabled render; no API requests or console/HTTP errors. |
| `npm run companion:test` | All 12 checks passed. |
| `npm run scan:public` | Passed. |
| Live Codex/model check | Passed: GPT-6 recognition in the local sibling (5 rooms, 57.105 s); repaired OpenHome3D render endpoint returned PNG in 65.221 s. Middleware/configuration/extraction are identical in both editions. |
| `npm run doctor -- --json` | Ready: CLI 0.153.4, gpt-6-astra, high, logged in. |

Start the dev server before browser checks:

```bash
npm run dev
```

Then run in another terminal:

```bash
npm run check
npm run check:ui
npm run smoke:pages
npm run companion:test
npm run scan:public
```

Browser tests read `.port`; `APP_URL` selects another instance and `CHROME_PATH` selects Chrome. Regular AI tests are mocked and consume no credits. `npm run doctor` checks the local CLI version/login environment but does not generate an image. For deliberate live validation, `npm run smoke:ai:live -- --run` performs one recognition and one image-generation request through temporary middleware (the dev server supplies only the isolated default scene screenshot); it consumes account credits and is excluded from `check/check:ui`. Add `--render-only` to skip already-verified recognition. The sample confirms connectivity and extraction, not future account access or guaranteed rendering fidelity. Production builds retain the existing large-chunk warning (about 1.80 MB JS, gzip 544 KB).

## Boundaries for the next maintainer

- `.home3d` packages only current referenced resources. AI render history, unused uploads, the undo stack and camera pose remain outside the package. Binary resources are embedded in JSON without compression.
- Render tasks survive panel closure within the current page only. Refreshing or closing the page terminates the request; old image-only history must never borrow the current screenshot for comparison.
- Furniture smaller-room handling, rectangular rooms, no cross-room furniture drag, partial door avoidance and AI geometry/composition limits remain intentional; see README.
- Static Pages cannot run local AI. Preserve `import.meta.env.BASE_URL` for assets when porting future changes, and validate the Pages build separately.
- A release requires reviewing the complete working-tree diff, including modifications that predate this task. Main pushes publish Pages; do not treat a local sync as a published release.
