<div align="center">
  <img src="public/brand/logo-static.png" alt="OpenHome3D logo" width="72" />
  <h1>OpenHome3D</h1>
  <p><strong>A cartoon-style 3D home designer that runs entirely in your browser.</strong></p>
  <p><a href="https://yuyou-dev.github.io/OpenHome3D/"><strong>▶ Live demo — yuyou-dev.github.io/OpenHome3D</strong></a></p>
  <p>Type a seed, get a fully furnished home in one click — rendered in flat cel-shaded colors with ink outlines, wrapped in a Neo-Brutalism UI. No backend, no accounts, no API keys. Optional local AI (floor-plan import + photoreal repaint) via your own codex CLI.</p>
  <p>
    <a href="#features">Features</a> ·
    <a href="#quick-start">Quick start</a> ·
    <a href="#scripts">Scripts</a> ·
    <a href="#community--contributing">Community</a> ·
    <a href="#asset-licenses">Asset licenses</a> ·
    <a href="#中文简介">中文简介</a>
  </p>
</div>

---

![OpenHome3D main view](docs/screenshot-main.png)

## What is this?

OpenHome3D is the open-source edition of **家居生成器 Cartoon (Home Generator Cartoon)** — a DIY home-design toy. A procedural engine arranges furniture from a seed you type, for a single room or a whole home (studio / 1-bedroom / 2-bedroom templates); you then swap models, upload your own, drag pieces around on a snap grid, and tune the structure itself (room sizes, wall height, doors and windows, interior openings and balcony parapets) — including a top-down structure editor for dragging and resizing rooms.

Two **optional AI superpowers** run through your own local [codex CLI](https://github.com/openai/codex) (ChatGPT login — no API key): import a floor-plan photo and get the whole home back, and repaint the cartoon scene into a photorealistic interior shot. They only exist when the app runs on your machine — the live demo stays purely client-side and simply badges those entries as local-only.

Everything renders in a **stylized cel-shaded look**: flat toon colors, 4-step light bands, 1 px ink outlines, and soft lavender-tinted shadows — like a playable toy diorama.

## Features

- **Seeded whole-home generation** — 8 room types (studio, living room, bedroom, kitchen, bathroom, office, dining, balcony) × 3 home templates (studio / 1br / 2br). Same seed + same template ⇒ same layout, every time.
- **Cel-shaded 3D** — `MeshToonMaterial` with a shared 4-step gradient map, edge outlines (`EdgesGeometry` with an inverted-hull fallback for smooth meshes), PCF soft shadows and purple-tinted ambient occlusion. Isometric & perspective cameras, 4 iso corner presets + top view.
- **337 furniture models, all local** — Kenney Furniture Kit + KayKit Bits (CC0), plus 18 built-in parametric pieces (resize seats/arms/radius live). Models ship in `public/models/`; nothing is fetched from the network at runtime.
- **A coherent candy palette** — GLB assets keep their original flat colors; parametric furniture is colored from one curated palette (`src/models/palette.ts`), so everything looks like one toy set.
- **Real editing** — click to select, drag with 5 cm grid snap (Alt = off-grid), arrow-key nudge, A/E rotate ±15°, right-drag / Shift+left-drag / pan-mode toggle for camera panning, duplicate / delete / swap model / scale.
- **Upload your own models** — `.glb .gltf .obj .stl .ply .dae`, converted to GLB in the browser and stored in IndexedDB.
- **Home structure control** — Home/Room sidebar tabs: per-room type/size/partition, a room list with add/remove, doors & windows on exterior walls, interior doors and full-height openings (打通) on shared walls, balcony parapets, wall height, and cutaway walls that follow the camera. The HomeEditor overlay (Home tab) drags and resizes rooms in a top-down view.
- **Floor-plan import (local AI)** — drop a floor-plan image on the Home tab; the local codex CLI recognizes rooms/doors/windows/open-ups/balconies and builds the whole multi-room home (geometry auto-repaired). The original plan stays as a corner minimap.
- **AI repaint (local AI)** — one click repaints the cartoon scene into a photorealistic interior photo (or cinematic / anime / cyberpunk / watercolor / claymation / cel presets) via codex `image_gen`, with swipe compare, history and furniture reference photos.
- **Neo-Brutalism UI** — cream paper, thick ink borders, hard shadows, candy buttons; bilingual labels (中文 + English).

## Quick start

Requires **Node.js ≥ 20**.

```bash
npm install
npm run dev        # prints a local URL (random high port, cached in .port)
```

Open the printed URL — that's it. No configuration needed.

### One-sentence setup for codex players

Paste this into a codex session and let it do everything:

```text
Read https://raw.githubusercontent.com/yuyou-dev/OpenHome3D/main/INSTALL.md and complete it: install OpenHome3D plus its Companion plugin, verify everything, start the app, and open it in the built-in browser.
```

中文版本：

```text
请阅读并完整执行 https://raw.githubusercontent.com/yuyou-dev/OpenHome3D/main/INSTALL.md：安装 OpenHome3D 和 Companion 插件、完成验证、启动程序，并在内置浏览器中打开。
```

This keeps the traditional clone/Fork workflow intact. The Companion adds guided installation, a visual GitHub newcomer guide, Discussion browsing and drafting, change summaries, and PR preparation inside Codex.

Install only the Companion plugin:

```bash
codex plugin marketplace add yuyou-dev/OpenHome3D --ref main
codex plugin add openhome3d-companion@openhome3d
```

Start a new Codex task after plugin installation, then ask: `Open the OpenHome3D community hub.`

Manual check anytime: `npm run doctor` (Node ≥ 20 · codex CLI · `codex login status`).

```bash
npm run build      # type-check (strict) + production build → dist/
npm run preview    # serve the production build locally
```

## Screenshots

| Model browser | Editing (selected piece) |
| --- | --- |
| ![Model browser](docs/screenshot-browser.png) | ![Selection](docs/screenshot-select.png) |

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on a random high port |
| `npm run build` | `tsc` (strict, `noUnusedLocals`) + `vite build` |
| `npm run preview` | Serve `dist/` |
| `npm run smoke` | 205 layout-engine checks: determinism, in-bounds, collisions, door-zone avoidance, templates, plan-import conversion, gap/parapet wall segments |
| `npm run smoke:ui` | Headless-Chrome screenshot + console-error check (needs `APP_URL`; `CHROME_PATH` to override Chrome location) |
| `npm run audit:ui` | UI overflow audit: 14 states × 2 viewports, exits 1 on any finding (regression gate) |
| `npm run assets` | Re-download Kenney/KayKit packs and rebuild `src/assets/manifest.json` (only needed when changing models) |
| `npm run doctor` | Environment preflight for the AI features (Node, codex CLI, login status); `--json` for machines |
| `npm run companion:test` | Validate the Companion MCP protocol, Apps UI resource, and plugin manifest |
| `npm run scan:public` | Leak scan of tracked files (home paths, credential shapes, private hosts) — runs in CI |

## Project structure

```
index.html              # entry (title / favicon)
brand/                  # brand source assets (public/brand is the served copy)
public/
  brand/                # logos (sidebar logo, favicon)
  models/               # 337 CC0 GLBs + per-pack LICENSE.txt
scripts/
  fetch-assets.mjs      # download Kenney/KayKit packs & convert to GLB (idempotent)
  build-manifest.mjs    # scan GLBs → src/assets/manifest.json (category + measured size)
  size-rules.mjs        # per-model real-world size rules (single source of truth)
  audit-bbox.mjs        # bounding-box audit (used when tuning size rules)
  pick-port.mjs         # random high dev port
  ai-api.mjs            # dev-server middleware: /api/ai/status + understand (plan recognition) + render (image_gen) via the local codex CLI
  doctor.mjs            # AI environment preflight (npm run doctor)
  public-scan.mjs       # leak scan for tracked files (npm run scan:public, runs in CI)
  smoke-gen.ts          # layout engine smoke tests (npm run smoke; fixtures in fixtures/)
  smoke-ui.mjs          # headless screenshot smoke (npm run smoke:ui)
  audit-ui-overflow.mjs # UI overflow audit (npm run audit:ui)
src/
  assets/manifest.json  # generated, do not edit by hand
  state/store.ts        # zustand store: multi-room home/furniture/selection/uploads (persist openhome3d v2)
  state/home.ts         # room & opening data model + pure helpers (AABB / shared spans / door zones / shell)
  models/palette.ts     # the curated palette — the only place colors may come from
  models/registry.ts    # unified model registry (parametric + manifest GLBs + uploads)
  models/parametric/    # 18 parametric furniture components
  lib/toon.ts           # cel shading: shared gradient map + GLB material conversion
  gen/                  # room types / layout engine / wall derivation / home templates / plan-import converter
  three/                # scene, shell, HomeEditor top-down editor, camera, lights, effects, interaction, runtime bus
  ui/                   # sidebar (Home/Room tabs) / HomeTab / PlanMinimap / selection panel / top bar / status bar / modals (incl. AI render) / labels
  lib/                  # prng / geometry / thumbnails / AI client + style presets / plan-image store
```

## Tech stack

React 19 · three.js (`@react-three/fiber` + `drei` + `postprocessing`) · zustand (with persist) · Vite 7 · TypeScript (strict) · idb-keyval (IndexedDB for uploads).

## Asset licenses

- **Kenney — Furniture Kit** (CC0): `public/models/kenney/LICENSE.txt`
- **KayKit — Furniture & Restaurant Bits** (CC0): `public/models/kaykit-furniture/LICENSE.txt`, `public/models/kaykit-restaurant/LICENSE.txt`

Both packs are CC0 — free for any use, attribution appreciated but not required. Brand labels in the UI name the real asset sources (BUILT-IN / KENNEY / KAYKIT / MY UPLOADS); no furniture-vendor trademarks are used.

## Brand

The in-app brand **家居生成器 Cartoon** (logo in `brand/` and `public/brand/`) is kept intact in this open-source edition. OpenHome3D is the open-source sibling of the original Home3D / Home3D-Cartoon projects — same multi-room engine and cartoon rendering; the AI features are identical too, running through your own local codex CLI.

## Community & contributing

You do not need to know Git to participate. With the Companion installed, ask Codex to open the community hub: browse and summarize Discussions, follow a visual GitHub signup guide, draft a question or idea, or turn local changes into a reviewed Pull Request. Nothing is published without a final preview and your explicit confirmation.

Traditional GitHub participation remains fully supported: [Discussions](https://github.com/yuyou-dev/OpenHome3D/discussions) for questions, ideas and showcases; Issues for reproducible bugs; Fork + Pull Request for code. Read [CONTRIBUTING.md](CONTRIBUTING.md) for routing, verification and authorship rules.

Please keep the two style contracts intact: **cel-shaded rendering** (toon materials + palette colors only, 1 px ink edges) and **Neo-Brutalism UI** (cream paper, 2 px ink borders, hard shadows, candy accents) — see `AGENTS.md` for the full conventions.

## License

[MIT](LICENSE) © 2026 yuyou-dev. Third-party assets remain under their own licenses (CC0, see above).

---

## 中文简介

**OpenHome3D** 是「家居生成器 Cartoon」的开源版：一个完全跑在浏览器里的卡通风 3D 家装小工具。输入种子即可一键生成带全套家具的整宅（8 种房型 × 单间/一居/两居 3 档模板）， cel-shaded 平涂卡通渲染 + Neo-Brutalism 界面；支持换模、上传自己的模型（.glb/.gltf/.obj/.stl/.ply/.dae）、5cm 网格拖拽、方向键微调、A/E 旋转、右键/Shift+左键/平移模式平移，面宽/进深/墙高/隔墙/门窗编辑（含内墙打通、阳台护栏）与 HomeEditor 顶视拖拽改房间。**无任何后端、账号或 API key**;可选本机 AI(户型图导入 + 写实重绘)走你自己的 codex CLI(ChatGPT 登录态)。

快速开始（需要 Node.js ≥ 20）：

```bash
npm install
npm run dev        # 终端会打印本地地址（随机高端口）
```

其他命令：`npm run build`（严格类型检查 + 构建）、`npm run smoke`（布局引擎 205 项测试）、`npm run smoke:ui` / `npm run audit:ui`（无头 UI 回归）。家具资产为 Kenney / KayKit 的 CC0 模型，许可见 `public/models/*/LICENSE.txt`。本项目以 MIT 协议开源。
