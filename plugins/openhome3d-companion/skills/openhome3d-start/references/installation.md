# Installation details

Canonical repository: `https://github.com/yuyou-dev/OpenHome3D.git`

The repository also hosts the `openhome3d` Codex marketplace. To install the Companion from GitHub:

```bash
codex plugin marketplace add yuyou-dev/OpenHome3D --ref main
codex plugin add openhome3d-companion@openhome3d
```

When the marketplace already exists, use `codex plugin marketplace upgrade openhome3d` before reinstalling or updating the plugin.

After installing or updating:

1. Completely quit and reopen the Codex desktop app so its plugin and MCP tool catalog is rebuilt.
2. Create a new task.
3. Open `Sources`, choose `Use plugins`, and select **OpenHome3D Companion**.
4. Ask: `Open the OpenHome3D community hub.`

Typing the plugin name as ordinary prompt text does not attach it to a task. Do not test an updated MCP server in a task that existed before the desktop restart.

Project commands:

```bash
git clone https://github.com/yuyou-dev/OpenHome3D.git
cd OpenHome3D
npm install
npm run doctor
npm run build
npm run dev
```

`npm run doctor` may report a missing Codex CLI or login. The app itself remains usable without optional local AI; explain that distinction instead of treating it as a total installation failure.
