# OpenHome3D precision floor-plan handoff · 2026-09-05

This update ports the precision floor-plan milestone and the native modal import workflow from Home3D-Cartoon through `f3118af`. It preserves OpenHome3D's storage key, brand, Pages asset paths, installation lifecycle, Companion and community flows. The preceding maintenance record is archived in [maintenance handoff](docs/maintenance-handoff-2026-09-05.md).

## Delivered behavior

- Architectural plans retain real polygons, independent walls, wall-hosted openings, level metadata, voids, ledges and multi-flight stairs. Derived rectangular bounds remain only for selection and furniture coordinates; legacy template editing stays compatible.
- Pixel geometry converts once to meters. A verified distance calibrates scale uniformly; uncertain dimensions and inferred heights remain visible. Structural and furniture validation share the same geometry, and project save/open plus undo/redo preserve the imported structure.
- Furniture matching uses recognized type, dimensions and orientation, validates the usable polygon and obstacles, and reports unmatched or adjusted pieces. Bay ledges and voids are not ordinary furniture floors.
- Recognition and render orchestration explicitly select `gpt-6-astra`; `scripts/ai-config.mjs` sets recognition to `medium` and render orchestration to `high`. Actual image generation still uses `image_gen`. CLI compatibility and login preflight remain in place; the recognition timeout is 600 seconds.
- Choosing an image opens a cancellable native modal. Success automatically opens the source/geometry review; only **Import** atomically replaces the scene and image. Cancel/Escape invalidates late replies. Import failure retains the draft with an in-dialog error. Source-image viewing has Close/Escape, focus isolation and full-image fitting on desktop and mobile.

## Validation and provenance

OpenHome3D must be validated independently after the complete port. Current synchronization checks and their actual results are recorded below by the release maintainer; previous maintenance passes are historical and do not establish this revision's status.

| Check | This synchronization |
| --- | --- |
| `npm run check` | Passed independently in OpenHome3D: build, 205 layout checks, editor/state/camera regressions, 21 mocked AI checks, 23 architectural geometry checks, 37 import checks, architectural state and invalid-input acceptance cases. |
| `npm run check:ui` (including `smoke:precision:ui`) | Release maintainer to record final run |
| `npm run smoke:pages` | Release maintainer to record final run |
| `npm run companion:test` | Release maintainer to record final run |
| `npm run scan:public` | Release maintainer to record final run |

Normal browser regressions use isolated profiles and mock every AI route. Public architecture fixtures are synthetic. The local sibling's nine private floor plans were tested with real GPT-6 Astra before this port; [the sanitized summary](docs/precision-floorplan/results.md) records that separate provenance. This synchronization does not claim a fresh real nine-image run in OpenHome3D. Personal images, filenames, manual ground-truth coordinates, raw model results and generated private projects are excluded from public source.

For deliberate account-consuming validation, `npm run smoke:ai:live -- --run` performs one synthetic recognition and one generated image; it is excluded from normal checks. Start the dev server before browser tests, use its `.port` cache or `APP_URL`, and keep user evidence outside tracked files.

## Release and remaining limits

The complete milestone and interaction fixes are intended for this authorized main release. Main pushes trigger the existing GitHub Pages workflow; successful publication is established by the corresponding Actions deployment, not by a local commit. The release maintainer records the final commit and deployment outcome after pushing.

Pages and preview/build provide no local AI endpoints. Preserve `import.meta.env.BASE_URL` on every public asset URL and independently verify the static deployment. Installation, upgrade, uninstall and Companion runbooks remain the OpenHome3D-specific source of truth.

Architectural levels are currently viewed individually; separate duplex images are not automatically registered into one building. Free wall-node editing, DWG/DXF/IFC exchange and construction-code verification are not implemented. Raster recognition, heights and furniture substitutions require review against measurements. Detailed contracts and usage are in [the module guide](docs/precision-floorplan/README.md), [interaction notes](docs/precision-floorplan/import-interaction.md) and [AGENTS.md](AGENTS.md).
