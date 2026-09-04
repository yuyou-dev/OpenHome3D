<div align="center">
  <img src="public/brand/logo-static.png" alt="OpenHome3D logo" width="72" />
  <h1>OpenHome3D</h1>
  <p><strong>Design a playful 3D home in the browser — then let local Codex AI understand or repaint it.</strong></p>
  <p>
    <a href="https://yuyou-dev.github.io/OpenHome3D/"><strong>▶ Try the browser demo</strong></a>
    · <a href="#install-with-codex-recommended">Install with Codex</a>
    · <a href="#community--pull-requests">Contribute</a>
    · <a href="#中文使用指南">中文</a>
  </p>
  <p><sub>Open source · MIT · No OpenHome3D account · No API key · Optional AI runs through your own local Codex CLI</sub></p>
</div>

---

OpenHome3D is the open-source edition of **家居生成器 Cartoon (Home Generator Cartoon)**. Start from a studio, one-bedroom, or two-bedroom home; let the seeded layout engine furnish it; then edit rooms, openings, structure, and furniture in a cel-shaded 3D diorama.

The [online demo](https://yuyou-dev.github.io/OpenHome3D/) runs entirely in the browser. Install the project locally to unlock the new Codex AI workflow.

## ✨ AI milestone: floor plan in, finished room out

The latest milestone adds a real AI layer to OpenHome3D, not just another editor control. Your own local [Codex CLI](https://github.com/openai/codex) gives the app two optional superpowers:

1. **Understand a floor plan** — import a PNG or JPEG; Codex recognizes rooms, doors, windows, connected openings, and balconies, then OpenHome3D builds an editable multi-room home.
2. **Repaint the 3D scene** — turn the current cartoon composition into a photorealistic, cinematic, anime, cyberpunk, watercolor, clay, or cel-style image, while keeping the room layout and camera framing as the guide.

| Editable OpenHome3D scene | Example local AI repaint |
| --- | --- |
| ![Editable cartoon room in OpenHome3D](docs/screenshot-main.png) | ![Photorealistic AI repaint of the same room](docs/ai-repaint-photoreal.webp) |

The image on the right is an example repaint from the scene on the left. Generative images can reinterpret small details; the editable 3D scene always remains your source of truth.

### Why local Codex?

- OpenHome3D never asks for an API key or reads your Codex credential files.
- Codex manages its own ChatGPT login and runs only when you request floor-plan understanding or a repaint.
- The static GitHub Pages demo stays backend-free. AI buttons explain that local installation is required instead of silently failing.

## What you can make

- **A furnished whole home in one click** — 8 room types and 3 home templates; the same seed recreates the same layout.
- **An editable floor plan in 3D** — drag and resize rooms from the top view; add doors, windows, full-height openings, balcony parapets, and cutaway walls.
- **A room that feels like yours** — browse 337 bundled CC0 models, tune 18 parametric pieces, upload your own model, then move, rotate, duplicate, resize, or swap furniture.
- **A stylized presentation** — flat cel-shaded colors, ink outlines, soft shadows, isometric and perspective cameras, plus exportable project files.
- **An AI-assisted concept image** — import a plan or repaint the designed room locally through Codex.

## Use OpenHome3D

### Try it now — no installation

Open the [live browser demo](https://yuyou-dev.github.io/OpenHome3D/). It includes the complete manual designer; local AI features are intentionally unavailable on the static site.

### Install with Codex (recommended)

These are instructions **for the Codex desktop app**, not terminal commands:

1. Open Codex Desktop and create a new task.
2. Copy only the sentence inside the code block for the outcome you want.
3. Paste it into the Codex chat box and send it. Codex will follow the linked runbook, preserve existing work, verify the result, and ask before destructive or system-level actions.

#### App + GitHub/Community Companion

Best for most contributors: installs the designer and the guided community/PR tools.

```text
Read and complete https://raw.githubusercontent.com/yuyou-dev/OpenHome3D/main/INSTALL.md to set up and run OpenHome3D, set up its Companion, verify both, and open the app in the built-in browser.
```

#### OpenHome3D app only

```text
Read https://raw.githubusercontent.com/yuyou-dev/OpenHome3D/main/INSTALL.md and set up, verify, run, and open only the OpenHome3D app; skip the Companion.
```

#### Update an existing installation

```text
Read https://raw.githubusercontent.com/yuyou-dev/OpenHome3D/main/UPGRADE.md and safely update my existing OpenHome3D app, preserve local work, verify it, restart it, and open it.
```

#### Remove the app

```text
Read https://raw.githubusercontent.com/yuyou-dev/OpenHome3D/main/UNINSTALL.md and prepare to remove only the OpenHome3D app; preview the exact files and preserve my work before asking me to confirm removal.
```

#### Set up the Companion only

```text
Read https://raw.githubusercontent.com/yuyou-dev/OpenHome3D/main/plugins/openhome3d-companion/LIFECYCLE.md and set up and verify the OpenHome3D Companion only, then explain how to activate it in a new Codex task.
```

#### Update the Companion only

```text
Read https://raw.githubusercontent.com/yuyou-dev/OpenHome3D/main/plugins/openhome3d-companion/LIFECYCLE.md and safely update and verify only my OpenHome3D Companion, then explain how to reload it in Codex.
```

#### Remove the Companion only

```text
Read https://raw.githubusercontent.com/yuyou-dev/OpenHome3D/main/plugins/openhome3d-companion/LIFECYCLE.md and prepare to remove only the OpenHome3D Companion; show me what will change and ask before removing its marketplace.
```

The app and Companion are independent; removing one never removes the other.

After installing or updating the Companion, fully restart Codex Desktop, create a new task, then attach **OpenHome3D Companion** from **Sources → Use plugins**. Ordinary prompt text alone does not attach a plugin.

### Install manually

Requires [Node.js 20 or newer](https://nodejs.org/).

```bash
git clone https://github.com/yuyou-dev/OpenHome3D.git
cd OpenHome3D
npm install
npm run dev
```

Open the local URL printed by the terminal. No configuration is required for the 3D designer.

To use the optional AI features, also install and sign in to Codex CLI, then run the project check:

```bash
npm install -g @openai/codex
codex login
npm run doctor
```

`npm run doctor` checks Node, Codex CLI, and `codex login status`; it never reads credential files. If Codex is unavailable, the browser designer still works.

## A five-minute first project

1. Choose **Home** and start with Studio, 1BR, or 2BR — or import a floor-plan image when running locally with Codex.
2. Open **Room** to change the active room type, dimensions, or partition height.
3. Press **Shuffle** until the seeded furnishing feels close, then drag and edit individual pieces.
4. Use the top toolbar to switch view, projection, pan mode, cutaway walls, windows, floor slab, and furniture visibility.
5. Save with **Export**. When local AI is available, open **AI Render** to make and compare a concept image.

Helpful controls: arrow keys nudge the selected item; `A` / `E` rotate it; `Alt` temporarily disables grid snap; right-drag or `Shift` + left-drag pans the camera.

## Community & Pull Requests

You do not need to know Git to participate.

### Use the Companion

The optional **OpenHome3D Companion** turns community participation into a guided Codex workflow. Ask it to open the community hub to:

- browse and summarize GitHub Discussions;
- draft a question, idea, showcase, or bug report in plain language;
- inspect your local changes, run the right checks, and prepare a Pull Request;
- preview every public post or PR before anything is published.

After attaching the plugin in a new Codex task, say:

```text
Open the OpenHome3D community hub.
```

Already changed the project? Ask:

```text
Check my current OpenHome3D changes, run the appropriate verification, and show me a contribution summary and Pull Request draft. Do not publish anything until I confirm.
```

### Use the traditional GitHub flow

1. Fork the repository and create a focused branch.
2. Make one coherent change and preserve the cel-shaded rendering and Neo-Brutalism UI conventions.
3. Run `npm run build`; run `npm run smoke` for layout changes and `npm run companion:test` for Companion changes.
4. Open a Pull Request that explains the user-visible outcome and how you verified it.

Use [Discussions](https://github.com/yuyou-dev/OpenHome3D/discussions) for questions, ideas, and showcases; use [Issues](https://github.com/yuyou-dev/OpenHome3D/issues) for reproducible bugs. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full routing, verification, and authorship guide.

## More screenshots

| Furniture browser | Editing a selected piece |
| --- | --- |
| ![OpenHome3D furniture browser](docs/screenshot-browser.png) | ![Editing a selected furniture piece](docs/screenshot-select.png) |

## Maintainer commands

Most users only need `npm run dev`. Maintainers may also use:

| Command | Purpose |
| --- | --- |
| `npm run build` | Strict type-check and production build |
| `npm run smoke` | Layout, collision, opening, template, and import regression checks |
| `npm run smoke:ui` | Browser screenshot and console-error smoke test |
| `npm run audit:ui` | Desktop/mobile overflow audit |
| `npm run doctor` | Local AI environment check |
| `npm run companion:test` | Companion manifest, skills, MCP, and Apps UI checks |
| `npm run scan:public` | Scan tracked files for accidental private data |

Implementation contracts live in [AGENTS.md](AGENTS.md). The app uses React, TypeScript, three.js / React Three Fiber, Zustand, and Vite; those details are intentionally kept out of the getting-started path.

## Assets, brand & license

The 337 bundled furniture models come from **Kenney Furniture Kit** and **KayKit Furniture / Restaurant Bits**. Both are CC0 and may be used freely; license copies are included under `public/models/*/LICENSE.txt`.

The in-app **家居生成器 Cartoon** brand remains intact in this open-source edition. OpenHome3D itself is released under the [MIT License](LICENSE) © 2026 yuyou-dev; third-party assets remain under their own licenses.

---

## 中文使用指南

**OpenHome3D** 是「家居生成器 Cartoon」的开源版：一个可以在浏览器里搭整宅、改户型、摆家具的卡通风 3D 家装工具。在线 Demo 无需安装、没有账号体系；本地安装后，还可以通过你自己的 Codex CLI 使用 AI 户型识别和效果图重绘，不需要 API key。

### ✨ 这次的重要里程碑：Codex AI

这次更新不是在编辑器里再加一个小按钮，而是为 OpenHome3D 补上了一条完整的 AI 工作流：

1. **看懂户型图**：上传 PNG/JPEG 户型图，Codex 会识别房间、门窗、内墙打通和阳台；OpenHome3D 再把结果修复并转换成可以继续拖拽、改尺寸、摆家具的 3D 整宅。
2. **把卡通方案重绘成效果图**：完成 3D 布局后，可以生成写实、电影感、动画、赛博霓虹、水彩、粘土或赛璐璐风格的图片，并用滑动对比查看 3D 原图与生成结果。

AI 只在本机开发服务器中运行。OpenHome3D 不读取 Codex 登录文件，也不要求你填写 API key；在线 Demo 仍然保持纯静态、纯浏览器运行。

### 三种开始方式

- **只想体验设计器**：直接打开[在线 Demo](https://yuyou-dev.github.io/OpenHome3D/)，不需要安装。
- **希望使用 AI 功能**：在本机安装项目，并确保 Codex CLI 已登录。
- **希望参与社区或提交 PR**：同时安装 OpenHome3D Companion，让 Codex 带你浏览讨论、整理改动和准备 PR。

### 在 Codex 里一句话安装（推荐）

下面代码框里的内容不是终端命令，而是要发给 **Codex Desktop** 的任务说明：

1. 打开 Codex Desktop，新建一个任务。
2. 选择你需要的场景，只复制代码框里面的一整句话。
3. 粘贴到 Codex 对话输入框并发送。Codex 会读取对应操作手册、保护已有修改、执行验证，并在删除或系统级安装前向你确认。

#### 完整安装：主程序 + Companion

```text
请阅读并完整执行 https://raw.githubusercontent.com/yuyou-dev/OpenHome3D/main/INSTALL.md，安装并运行 OpenHome3D，同时安装 Companion，完成两者的验证，并在内置浏览器中打开程序。
```

#### 只安装主程序

```text
请阅读 https://raw.githubusercontent.com/yuyou-dev/OpenHome3D/main/INSTALL.md，只安装、验证、运行并打开 OpenHome3D 主程序，跳过 Companion。
```

#### 升级已有主程序

```text
请阅读 https://raw.githubusercontent.com/yuyou-dev/OpenHome3D/main/UPGRADE.md，安全升级我现有的 OpenHome3D，保留本地修改，完成验证后重新运行并打开。
```

#### 准备卸载主程序

```text
请阅读 https://raw.githubusercontent.com/yuyou-dev/OpenHome3D/main/UNINSTALL.md，准备只卸载 OpenHome3D 主程序；先展示准确目录和待处理文件、保护我的修改，再向我确认是否移除。
```

#### 只安装 Companion

```text
请阅读 https://raw.githubusercontent.com/yuyou-dev/OpenHome3D/main/plugins/openhome3d-companion/LIFECYCLE.md，只安装并验证 OpenHome3D Companion，然后说明如何在新的 Codex 任务中启用它。
```

#### 只升级 Companion

```text
请阅读 https://raw.githubusercontent.com/yuyou-dev/OpenHome3D/main/plugins/openhome3d-companion/LIFECYCLE.md，只安全升级并验证我现有的 OpenHome3D Companion，然后说明如何让 Codex 重新加载它。
```

#### 只卸载 Companion

```text
请阅读 https://raw.githubusercontent.com/yuyou-dev/OpenHome3D/main/plugins/openhome3d-companion/LIFECYCLE.md，准备只卸载 OpenHome3D Companion；先展示会发生的变化，并在移除 marketplace 前向我确认。
```

安装或升级 Companion 后，需要完全退出并重新打开 Codex Desktop；新建任务后，从 **Sources → Use plugins** 选择 **OpenHome3D Companion**。仅在输入框里写插件名字并不会自动加载插件。

### 手动安装

需要 Node.js 20 或更高版本：

```bash
git clone https://github.com/yuyou-dev/OpenHome3D.git
cd OpenHome3D
npm install
npm run dev
```

终端会打印一个本地地址，打开它即可使用完整 3D 设计器。要启用可选 AI 功能，再执行：

```bash
npm install -g @openai/codex
codex login
npm run doctor
```

如果 Codex CLI 暂时不可用，只会影响 AI 户型识别和 AI 重绘，不影响普通 3D 编辑。

### 第一次使用

1. 在「整宅 Home」里选择单间、一居或两居模板；本机 AI 可用时也可以直接导入户型图。
2. 在「房间 Room」里调整当前房间类型、面宽、进深和隔墙高度。
3. 点击「换一换 Shuffle」重新布置整间房，再选中单件家具进行移动、旋转、缩放、复制或换模。
4. 在顶栏切换视角、轴测/透视、平移模式，以及墙体剖切、门窗、楼板和家具显示。
5. 用「导出 Export」保存项目；需要概念效果图时，打开「AI 渲染」生成并对比结果。

### 不会 Git，也可以参与和提交 PR

OpenHome3D Companion 是本项目配套的 Codex 插件。它可以打开可视化社区中心，帮你阅读 Discussions、把中文想法整理成英文草稿、检查本地修改、运行合适的验证，并准备标准 Pull Request。任何公开发布都会先给你看最终预览，并等待你的明确确认。

启用 Companion 后，可以直接对 Codex 说：

```text
打开 OpenHome3D 社区中心。
```

如果你已经改好了代码，可以说：

```text
请检查我当前对 OpenHome3D 的修改，运行合适的验证，先向我展示贡献摘要和 PR 草稿；不要发布，等我确认。
```

传统 GitHub 流程也完全支持：Fork 仓库 → 新建分支 → 完成一个聚焦的改动 → 运行 `npm run build` 和相关测试 → 提交 Pull Request。问题、想法和作品展示请优先发到 [Discussions](https://github.com/yuyou-dev/OpenHome3D/discussions)，可复现 Bug 请发到 [Issues](https://github.com/yuyou-dev/OpenHome3D/issues)。详细规范见 [CONTRIBUTING.md](CONTRIBUTING.md)。

本项目以 [MIT 协议](LICENSE)开源；Kenney / KayKit 家具资产为 CC0。
