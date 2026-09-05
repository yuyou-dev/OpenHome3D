# AGENTS.md — 维护契约

产品使用、启动、脚本与项目关系见 [README.md](README.md)。本文件只记录修改代码必须保持的约定。优先简洁实现，不编写过度防御性代码；可以使用子代理协同执行。

## 项目定位、发布与同步边界

- OpenHome3D（`yuyou-dev/OpenHome3D`）是开源卡通家装编辑器，共享 Home3D-Cartoon 的多房间引擎、状态、卡通渲染和 UI。基础编辑在浏览器内完成；户型识别、重绘和参考照片已包含在本项目，可选 AI 使用用户本机 codex CLI。不要再描述为“无 AI 的简化版”。
- 共享修复逐项移植、独立验证，不整仓覆盖；保留本仓库的 `openhome3d` 存储键、项目身份、社区入口与资源 URL。Home3D 线稿版有独立渲染和 AI 实现，不直接套用。不提交本机凭证、个人绝对路径或私有代理。
- main 的 push 会触发 GitHub Pages（`.github/workflows/pages.yml`）。`npm run build:pages` 使用 `/OpenHome3D/` base；静态资源 URL 必须加 `import.meta.env.BASE_URL` 前缀，禁止硬编码 `/models/`、`/brand/`，否则子路径部署会 404。
- 安装、升级、卸载分别以 `INSTALL.md`、`UPGRADE.md`、`UNINSTALL.md` 为准；Companion 独立能力在 `plugins/openhome3d-companion/`，生命周期见其 `LIFECYCLE.md`。不要用共享代码同步覆盖这些独有内容。
- 社区参与以 `CONTRIBUTING.md` 为准。Companion 的 GitHub Discussion/Issue 必须先 stage 锁定精确预览，展示并取得用户即时明确确认，再用一次性 approvalId 发布。插件 marketplace 清单在 `.agents/plugins/marketplace.json`；Apps UI 的 `ui://` 是 MCP 资源键，不是 HTTP 地址。

## 构建与验证

- 改完必须 `npm run build` 零错误（`tsc` 检查应用，`tsc -p tsconfig.node.json` 检查 Vite 配置，再执行生产构建；严格模式、`noUnusedLocals`）。完整非浏览器回归用 `npm run check`；dev server 在线时 `npm run check:ui` 运行完整浏览器门禁。
- 布局/门窗/墙体改动跑 `npm run smoke`；编辑、图片、相机、搜索改动跑 `npm run smoke:editor`（含 `scripts/test-runtime.mjs` 的截图恢复回归）；AI 中间件改动跑 `npm run smoke:ai`（模拟 codex）。
- UI 与交互改动按范围跑 `npm run smoke:ui`、`npm run smoke:interactions`、`npm run smoke:project`、`npm run smoke:ai-flow`、`npm run audit:ui`。这些脚本需要在线 dev server 和 Chrome，参数见 README/脚本；错误或 finding 必须导致失败退出。测试项数以实际运行输出为准。
- dev server 使用 `scripts/pick-port.mjs` 的随机高端口和 `.port` 缓存，不写死端口；`strictPort:true` 保证缓存与实际端口一致。占用时停止旧服务，或删除 `.port` 后重新选择，禁止默默递增。浏览器测试通过 `APP_URL` 指定其他实例。
- 开源专用检查：`npm run doctor` 检查 AI 环境（`--json` 输出机器可读结果），`npm run scan:public` 扫描工作区私有信息；Companion 改动跑 `npm run companion:test` 和 plugin/skill validator；发布前独立检查 `npm run smoke:pages`（Pages 构建、子路径资产、静态 AI 降级）。
- SSR 状态回归用 `configFile:false`、`optimizeDeps:{noDiscovery:true,include:[]}`，避免加载 AI 插件或改写正在运行的 dev 依赖缓存。
- 浏览器回归通过 `scripts/lib/browser.mjs` 模拟全部 AI 路由（含 status），不需要登录。常规回归不得调用真实 AI。对 `/api/ai/understand`、`/api/ai/render` 的真实端到端测试会消耗账号额度，需按任务范围单独安排。显式入口 `npm run smoke:ai:live -- --run` 使用临时 AI 中间件执行一次识别和一次出图（dev server 仅供隔离浏览器截图）；`--render-only` 可只复测出图，不得加入 `check/check:ui`。

## 状态、历史与存储

- `src/state/store.ts` 使用 zustand + persist，键为 `openhome3d`、版本 2。v1 已是多房间，迁移保留原数据并补 `planImageKey: null`；不要误用 Home3D 的旧单间迁移。
- `home{rooms,openings}` 的类型与纯函数在 `src/state/home.ts`。整宅共享 `seed`，`FurnitureInstance.roomId` 标记归属，家具 `position` 是以房间中心为原点的局部坐标。选中、活动房间、标签页、`lastSwapId` 等会话状态不持久化，活动房间回落到 `rooms[0]`。
- `src/state/history.ts` 最多保留 50 步会话历史；store 对整宅、家具、壳体、户型原图记录不可变快照，选中和相机操作不入栈。`beginEdit/endEdit` 将一次拖拽或连续按键合并；同值编辑不要新建快照或清空 redo。上传文件/参考照片管理不入栈；删除上传模型清空历史，避免恢复失效资产。完整工程导入的快照携带专用 `importSettings` 恢复投影/网格，该元信息不进入 store；普通编辑历史仍不回滚其后的用户视图操作。
- `planImageUrl` 是会话内图像数据，**不得加入 localStorage partialize**；只有 `planImageKey` 持久化。`importHome(home, imageUrl)` 原子更新布局与原图。异步 IndexedDB 水合必须补全等待期间的 past/future 快照；撤销恢复的原图也必须写回 IndexedDB。
- 「新建方案」的 UI 必须有覆盖确认（store 动作仍名为 `newRoom`）；模板使用 `newHome`，增量新增使用 `addRoom`，最终位置必须无重叠。`newRoom/newHome` 清除原图；`importHome` 使用本次图片，JSON 导入清除无关原图。
- `exportProject/importProject` 保留轻量布局 JSON v1 兼容，UI「仅布局」明确省略范围；工程保存/打开通过 `src/lib/projectPackage.ts`，不要混用两个格式。
- `.home3d` 为自包含 JSON：`format:'home3d-cartoon',version:1,scene,models,photos`。scene 保存全部当前布局和壳体/投影/网格/原图，models/photos 只打包实际引用资源；不包含 AI 历史、未用上传库、相机姿态或撤销栈。
- 完整包先校验几何、引用和全部资源，再用一个 IDB `setMany` 事务写入。导入上传模型和家具 ID 全部重分配；上传模型级照片保留在新 modelId，公共模型级照片转为实例照片，避免覆盖其他方案。`restoreCompleteProject` 单次更新场景并合并上传库，保留原资源以支持撤销。文件字段要白名单选择，不能让任意 JSON 属性覆盖 store 方法。

IndexedDB 键约定：

| 键 | 内容 |
| --- | --- |
| `model:upload:<uuid>` | 上传 GLB Blob，键函数在 `src/three/runtime.ts` |
| `refphoto:<instanceId|modelId>:<n>` | 家具参考照片 |
| `render:index`、`render:<id>` | AI 历史索引与 RenderRecord（结果/输入/提示词/参考图）；兼容旧字符串图片 |
| `plan:image` | 最近导入的户型原图 dataURL，存取在 `src/lib/planImage.ts` |

## 布局与结构

- `generateLayout` 只依赖传入的 `LayoutOpts`（房型、种子、salt、尺寸、密度、模型集，以及可选的 `doors/preserved/decorOnly`），相同输入必须产生相同输出。store 传入的房间 seed 为 `${seed}@${room.id}`，`RoomDef.salt` 为单房间重排计数。引擎 id `f1…` 由 store 加 `${roomId}:` 前缀，合并保留件时保证唯一，用户操作 id 用 `uid()`。
- `FurnitureInstance.source` 为 generated/manual，`decor` 标识可随密度更新的装饰，`locked` 显式保留；旧数据缺 source 时保守保留。手工添加/复制/移动/旋转/换模/参数修改标 manual。取消「换一换时保留」可重新参加生成。
- 尺寸编辑保留家具，仅夹取位置；房型编辑保留家具和门窗。密度仅重建未保护的 generated+decor（含附属件）；shuffle/rebuild/seed 操作保留 manual/locked/旧数据，并将保留件作为生成碰撞障碍。引擎新增保留件参数后仍须保证确定性、唯一 ID。
- `openingIntervals/fitOpening/reconcileOpenings` 是真实合法墙段的统一来源：内开口必须落在对应共享段，外开口避共享段。房间增删/移动/缩放、门窗编辑与水合后规范化；断开的开口移除，`structureNotice` 经常驻 Sidebar 展示并清除，不在 store 内依赖 UI toast。
- 门区由 `doorZonesFor(room, home)` 传到 `LayoutOpts.doors`，包含邻居门镜像。placeWall/placeRun 避开门区外扩 `DOOR_CLEAR=0.35`；front/center/free/ring 未避门。极小房间允许达到尝试上限后丢弃无法放置的家具。
- `src/gen/templates.ts` 的 `buildHome(templateId, seed)` 提供 studio/1br/2br 确定性模板；`src/gen/importPlan.ts` 的 `planJsonToHome` 将识别 JSON 转为 HomeDef，fixtures 在 `scripts/fixtures/`。
- 户型转换保持类型映射（garage/office/other → office、原名保留，balcony 直通）、重叠修复、近邻共边吸附且不撞第三房、内墙窗丢弃和 applied/dropped 报告。门窗支持 `at/widthM`、入户门 `wall`、打通 `open:true`；非法提示回落到默认位置和尺寸。识别 prompt/schema 调整时评估 Home3D 的识别部分，勿假定三个仓库完全一致。
- `src/three/HomeEditor.tsx` 只在 `planTab === 'home'` 时挂载，进入时 `requestView('top')`。房间必须是不重叠矩形，L 形用两个矩形拼。家具不允许跨房间拖动，越界夹取回所属房间。房间小于家具时仅归中，不能暗中缩模。
- 新增/编辑门窗不自动重排家具，避让在下次重排生效；UI「换一换」调用 `reshuffleFurniture()`。`rebuild()` 仍是 store 动作，移除前检查脚本调用。

## 渲染、相机与截图

- 家具与壳体使用 `MeshToonMaterial`、共享四阶 `toonGradientMap()`、castShadow/receiveShadow。`src/lib/toon.ts` 的 `applyToon` 保留源资产颜色和贴图，按源材质 uuid 共享缓存；`userData.shared` 材质禁止 dispose，缩略图清理必须跳过。源资产有负缩放，使用 DoubleSide。
- 参数化/壳体颜色来自 `src/models/palette.ts` 的 PALETTE/SHELL，不散落 hex。`parametric/shared.tsx` 的 `Edged/Rounded/Mat` 接受 color。硬边用 `drei <Edges lineWidth={1}>`，圆滑件用 `<Outlines thickness={1}>`；`EdgedModel.edgeModeFor` 按几何体缓存，RoundedBox 恒用 Outlines。
- 灯光保持暖白半球天光、淡紫地面反照、微暖平行光、淡紫 N8AO；画布背景为 `src/styles.css` 奶油径向渐变。
- 壳体由 `src/gen/walls.ts` 的 `deriveWalls(home, wallHeight)` 推导，不另存墙体状态。共边内墙只渲染一次，先减 `fullHeight` 打通区间再切段，完全打通为零墙段。外墙内皮贴房间边，向外鼓 `WALL_T=0.12`；阳台外缘通高开口渲染 `PARAPET_H=1.05` 护栏半墙。cutaway 仅注册外墙 normal（含护栏），内墙/隔墙永不隐藏。floorSlab 开为 homeAABB 整块楼板，关为逐房间薄板。
- 正交轴测为默认。orbit target 基准为 homeAABB 中心、y=0.8；AABB 位移只按 delta 平移相机和 target，不拉回用户平移。初始/reset/投影切换由 `src/three/cameraFit.ts` 适配整宅尺寸；`camera.userData.fitZoom/fitDistance` 是状态栏 100% 基准，普通编辑不得持续重置视角。
- 右键、Shift+左键和 `src/ui/uiStore.ts` 的会话态 panMode 控制平移；不要加回 `zoomToCursor`。
- `src/three/runtime.ts` 是 UI ↔ 3D 总线，负责视角请求、缩放通知、场景就绪和截图；UI 不反向 import 场景组件。dev 的 `window.__store`、`window.__three` 用于测试；Canvas onCreated 的 root state 是快照，读实时 camera/controls/size 用 `__three.get()`。
- `setViewOffset` 提供编辑器取景下移，AI 输入必须由 `captureUnbiasedScreenshot/captureFittedScreenshot` 临时清除偏移后截图，再恢复用户相机。最佳取景依据整宅边界计算，不能假定整宅位于世界原点。
- `SceneRoot.ReadyProbe` 等资产加载和数帧渲染后发出就绪信号（帧数/超时兜底），`LoadingVeil` 随后淡出；不要让用户直接看到尺寸未稳定或模型未加载的首帧。
- `ModelBrowser.ParamThumbWorker` 使用单 canvas 队列，避免参数化缩略图耗尽 WebGL 上下文。主画布保持 `preserveDrawingBuffer: true`，截图才能读取最终画面。

## 模型与资产

- 注册表在 `src/models/registry.ts`：`ModelDef{id,name,brand,type,kind,file?,footprint,height?,mount?,params?}`。GLB id 使用 `kenney:`/`kaykit:` 前缀，footprint/height/mount 来自 manifest；不要增加类型级尺寸估值。
- `public/models/` 是模型输入，`src/assets/manifest.json` 是生成物，勿手改。`npm run assets` 补齐来源并重建 manifest；仅需重扫已有资产时可运行 `node scripts/build-manifest.mjs`。
- 比例问题先用 `node scripts/audit-bbox.mjs` 检查真实包围盒，再修改 `scripts/size-rules.mjs` 的 `[idRegex, axis, target]` 并重建。新增吊顶件在 size-rules 的 CEILING 正则加入 id，manifest 标记 `mount:'ceiling'`，渲染自动悬挂。

## UI 惯例

- 颜色令牌集中在 `src/styles.css :root`：奶油纸底、2 px ink 描边、硬阴影、糖果色块。按钮 hover 上浮、active 压下；模型/房间/门窗卡片统一直角白底、粗描边与 hover 硬阴影。
- 语义蓝 `--select` 只用于 3D 描边/卡片 outline；实心选中填充使用糖果色（房间 active 为 `--blue`）。黄色 `btn-primary` 只用于最终确认/提交，其他按钮用 `btn-ghost`，链接用 `.link-btn`。
- 图标使用内联 SVG、strokeWidth 2、圆角线帽；字符图标加粗。文案中文在前、English 在后，类型/品牌/参数标签集中在 `src/ui/labels.ts` 和 `src/models/registry.ts`，搜索别名在 `src/models/search.ts`。
- 弹窗根节点带 `data-modal`，3D 和编辑历史快捷键据此忽略输入。输入控件保留原生文本编辑快捷键。
- 侧栏为「方案 Plan」（整宅 Home / 房间 Room）与「家具 Furniture」两个可折叠 Section；RoomTab 定义在 `src/ui/Sidebar.tsx`。显示开关在 TopBar 下拉，工程保存/打开与轻量布局导出、GitHub 仓库和反馈入口在侧栏底部，网格和种子在状态栏；种子不设输入框，store 的 setSeed 供脚本调用。
- ≤720 px 使用默认关闭的覆盖式抽屉，顶栏可横滑、弹窗近全屏、AI 面板上下堆叠；移动样式集中在 `src/styles.css` 的媒体查询。桌面/移动侧栏滚动条有意隐藏，不加回。

## 本机 AI 中间件

- `scripts/ai-api.mjs` 仅通过 Vite `configureServer` 挂载 `/api/ai/*`，preview/build 没有这些端点。两个能力都运行本机 codex CLI；脚本不读取凭证，登录由 `codex login` 自管，status 用 `codex login status` 探测并缓存，路径由 `HOME3D_CODEX_BIN` 覆盖。
- `src/state/aiTask.ts` 持有页面会话级渲染任务、表单和结果；面板卸载不取消，顶栏显示状态，用户显式取消或关闭/刷新页面终止请求。AbortController 所有权隔离晚响应，准备/请求/存储失败必须恢复可用状态。`useAiStatus` 刷新登录/忙闲状态，组件卸载清理订阅。
- 新历史记录为 `RenderRecord{version,image,source,prompt,referenceImages}`，索引和记录一起写入；旧字符串记录只展示结果，不拿当前截图冒充历史输入。历史写入失败保留可下载的结果；效果图与源图/提示词/参考图始终属于同一任务。
- understand/render 共用单飞槽，登录预检后须再次核验并原子占槽，保证只有一个请求进入 exec。busy 响应带时间与任务种类；对应 cancel 端点和客户端断连都要中止任务并释放槽位。
- codex 的 MCP 孙进程可能继承 stdio 管道，因此 `runCodex` 使用 `detached:true` + 进程组 SIGKILL；被杀/超时通过 exit 收尾，正常完成通过 close 保全 stdout。
- 两个 exec 路径显式传 `--model gpt-6-astra` 和 `model_reasoning_effort="high"`，共用 `scripts/ai-config.mjs` 的配置，不能依赖全局 Codex 默认配置；模型/推理档位断言应进入模拟回归。CLI 最低版本为 0.153.1（官方首次加入 Astra），status、请求预检和 doctor 应共用版本要求，过旧时提示 `npm i -g @openai/codex@latest` 并阻止任务。GPT-6 Astra 负责识别/编排，效果图仍由 `image_gen` 工具提供，不把两者模型版本混称。
- understand 使用 `codex exec --model gpt-6-astra --ephemeral -s read-only --output-schema`，`-o` 落盘后解析，超时由脚本常量定义。应用结果时调用 `importHome(home, imageUrl)`，不要把布局与原图拆成两次编辑。
- Pages/preview/build 没有本机 AI 端点：界面显示“本机运行可用”并禁用执行入口，不把静态演示当成服务故障。
- render 要求恰好一次 image_gen。当前适配依赖 `-s workspace-write` 和保留 rollout（不能加 `--ephemeral`）；prompt 前加 `--`，避免 `-i` 变参吞掉 prompt。
- 图片只从**本次任务所属**的 rollout 内联 base64 提取，不相信 saved_path 或模型文本路径。兼容旧平铺事件与 Codex 0.153 的 `item_completed → item{type:"Extension",kind:"image_gen.generation"}` 嵌套结果；形状以提取函数和 mock 测试为准；清理只能删除本次任务产物，不能以全局“最新会话”猜所有权。本服务单飞不代表其它 Codex 任务不存在。
- 图像 prompt 保持英文：默认写实摄影在 `src/ui/modals/AIRender.tsx`，风格 fragment 在 `src/lib/aiPresets.ts`。参考照片经 `-i` 附带，视图在前；比例通过 prompt 请求，不能承诺输出精确尺寸。
- `AIRender.cropToAspect` 先铺 `--paper` 底色再裁剪，避免透明像素变黑影响模型构图；对比滑块使用同一输入。保留 same margins/no cropping/zooming 提示，但不承诺图生图完全保留构图。
