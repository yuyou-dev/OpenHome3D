# AGENTS.md — 给后续维护者的关键约定

本文件记录改代码前必须知道的契约、惯例和坑。详细产品说明见 `README.md`。

OpenHome3D 是「家居生成器 Cartoon」的开源版:**多房间整宅**、**彩色 cel-shaded 卡通渲染**、**Neo-Brutalism UI**;**无后端/账号/API key**——可选 AI 能力(户型识别+图生图)走用户本机 codex CLI 子进程(仅 dev server,Pages 静态部署不含该端点,入口降级提示)。

## 构建与验证

- 改完必须 `npm run build`(tsc 严格模式,`noUnusedLocals`)零错误
- 布局引擎改动后跑 `npm run smoke`(确定性/越界/碰撞/门洞避让/模板/导入转换/打通与护栏墙段 205 项)
- 界面冒烟:`npm run smoke:ui`(需 dev server 在线,无头 Chrome 截图并打印控制台错误,有错误退出码 1 可作回归门;`APP_URL`/`SHOT`/`ACTIONS`/`CHROME_PATH` 环境变量控制,`ACTIONS=shuffle` 覆盖换一换,`ACTIONS=openings-bounds` 覆盖调整房间尺寸后的门窗越界回归)
- UI 溢出审计:`npm run audit:ui`(10 状态 × 2 视口,有 finding 退出码 1,可作回归门;`SHOT_DIR=dir` 逐状态截图)
- dev server 用随机高端口(`.port` 缓存,`scripts/pick-port.mjs`),不要写死端口
- AI 环境自检:`npm run doctor`(Node≥20/codex CLI/`codex login status`,`--json` 机器可读);泄密扫描 `npm run scan:public`(CI 里跑,见 `.github/workflows/ci.yml`)
- **GitHub Pages**:推送到 main 即自动部署(`.github/workflows/pages.yml`,构建用 `npm run build:pages` = `vite build --base=/OpenHome3D/`)。**凡是引用静态资源的 URL 必须走 `import.meta.env.BASE_URL` 前缀**(注册表 GLB 路径、品牌图),禁止手写 `/models/...`、`/brand/...` 绝对路径,否则子路径部署会 404

## 核心契约(改动会牵连多处,先读再动)

- **状态**:`src/state/store.ts`(zustand + persist `openhome3d` **v2**,migrate 把 v1 数据纯透传升级)。**多房间整宅**:`home{rooms,openings}`(类型与纯函数在 `src/state/home.ts`)+ 整宅级 `seed`;`FurnitureInstance.roomId` 归属,`position` 是房间局部坐标(房间中心为原点);`planTab`/`selectedId`/`activeRoomId`/`selectedOpeningId`/`lastSwapId` 不持久化(activeRoomId 回落 rooms[0]);`planImageKey` 持久化(户型原图字节在 IndexedDB,见 `src/lib/planImage.ts`)。dev 下暴露 `window.__store`、`window.__three` 供脚本驱动
- **模型注册表**:`src/models/registry.ts`。`ModelDef{id, name, brand, type, kind: parametric|glb|upload, file?, footprint, height?, mount?, params?}`;GLB 的 id 带 `kenney:`/`kaykit:` 前缀,footprint/height/mount 来自 manifest(size-rules),不要再写类型级估值
- **3D ↔ UI 总线**:`src/three/runtime.ts` — `requestView/subscribeView`、`subscribeZoomPct`、`captureScreenshot()`、`captureFittedScreenshot(ratio?)`、`MODEL_BLOB_KEY`、`subscribeSceneReady/emitSceneReady`(场景就绪一次性信号)。UI 不反向 import three 场景组件,只走这里
- **加载遮罩**:`SceneRoot` 的 `ReadyProbe` 在 GLB 资产加载完 + 稳定渲染数帧后 emit 就绪(90 帧/4s 双兜底),`src/ui/LoadingVeil.tsx` 全屏品牌加载屏淡出。**首次渲染不稳定(画布尺寸未稳定/模型未加载),绝不能让裸画面直接露出**
- **IndexedDB 键**:`model:upload:<uuid>`(上传 GLB Blob)、`plan:image`(最近导入的户型原图 dataURL;store 只持久化 `planImageKey` 作为"有图"标记,`newHome` 切模板时清除)
- **布局确定性**:`generateLayout` 只依赖 `{roomType, seed, salt, width, depth, extras, doors?}`;seed 由 store 拼成 `${seed}@${room.id}`,`salt` 在 `RoomDef` 上(重排计数);引擎产物 id `f1…` 由 store 加 `${roomId}:` 前缀,用户操作产生的 id 用 `uid()`。门洞避让:store 经 `doorZonesFor(room, home)` 传 `LayoutOpts.doors`,placeWall/placeRun 跳过与门区间外扩 `DOOR_CLEAR=0.35` 相交的候选
- **多房间文件**:`src/gen/templates.ts`(studio/1br/2br 模板,`buildHome(templateId, seed)` 确定性)、`src/three/Home.tsx`(壳体渲染)、`src/three/HomeEditor.tsx`(顶视结构编辑:拖/缩放房间、门窗标记,仅 planTab==='home' 挂载,进入时 requestView('top'))、`src/ui/HomeTab.tsx`(整宅标签页:模板/房间列表/门窗编辑)、`src/gen/importPlan.ts`(PlanJson→HomeDef 纯函数:类型映射/几何修复/门窗落位,测试 fixtures 在 `scripts/fixtures/`;AI 接线随户型导入能力一起落地)

## 渲染风格(全项目统一,勿破例)

- **cel-shaded 卡通**:所有网格用 `MeshToonMaterial` + 共享 4 阶 `gradientMap`(`src/lib/toon.ts` 的 `toonGradientMap()`),castShadow+receiveShadow
- **GLB 上色**:`applyToon(root)` 保留资产自带色(Kenney 平涂 baseColorFactor / KayKit 调色板贴图,贴图全部内嵌 GLB),按源材质 uuid 缓存共享,**禁止 dispose**(`userData.shared` 标记,thumbnails.ts 的清理循环会跳过);DoubleSide(源模型有镜像负缩放)
- **参数化/壳体上色**:只用 `src/models/palette.ts` 的 PALETTE/SHELL 键,**禁止散落 hex**;`parametric/shared.tsx` 的 `Edged`/`Rounded`/`Mat` 接受 `color` prop(默认 cream)
- **轮廓**:硬边件 `drei <Edges>`(lineWidth 1,ink `#2E2A26`,选中 `#2f6bff`);圆滑件回落 `drei <Outlines thickness={1}>`。判定逻辑在 `src/three/EdgedModel.tsx` 的 `edgeModeFor`(GLB 按几何体缓存)与 `src/models/parametric/shared.tsx`(RoundedBox 恒用 Outlines)
- **灯光/后期**:半球光暖白天光 + 淡紫地面反照(粉紫阴影的来源),平行光微暖;N8AO 淡紫 `color`;画布背景是 styles.css 的奶油径向渐变
- **壳体**:墙体不写数据,由 `src/gen/walls.ts` 的 `deriveWalls(home, wallHeight)` 推导——共边 → 内墙居中只渲染一次(**先减去 `fullHeight` 打通区间**,剩余切为多段,key `int:a:b:i`;整段打通 = 零墙段),否则外墙内皮贴房间边、向外鼓 `WALL_T=0.12`;外墙 fullHeight 开口(阳台)渲染 `PARAPET_H=1.05` 护栏半墙(仍注册 cutaway);cutaway 只注册外墙 normal(内墙/隔墙永不隐藏);`floorSlab` 开 = 按 `homeAABB` 一整块(关 = 每房间薄板);配色在 `src/models/palette.ts` 的 SHELL(墙 cream/地板暖木/门扇木色/玻璃浅蓝)
- **相机**:正交轴测默认;orbit target 跟随 `homeAABB` 中心(y=0.8),但**用户平移绝不拉回**——AABB 移动(拖/增删房间)只按 delta 平移相机+target(`lastCenter` 机制);视角预设/reset 才重置平移参考。`setViewOffset` 提供 -10% 取景下移。**平移交互**:右键拖动 / Shift+左键拖动 / TopBar 平移模式开关(uiStore `panMode`,会话态;开 = 左键/单指拖动平移,关 = 旋转)。**不要**加回 `zoomToCursor`

## 资产与尺寸

- 加/改模型只动 `public/models/` 后跑 `npm run assets`(幂等);`src/assets/manifest.json` 是生成物,**勿手改**
- 比例问题:在 `scripts/size-rules.mjs` 加一条 `[idRegex, axis, target]`,重跑 `npm run assets`;调规则前用 `node scripts/audit-bbox.mjs` 看真实包围盒
- 新增吊顶件:在 size-rules 的 `CEILING` 正则里加 id(manifest 会标 `mount:'ceiling'`,渲染自动悬挂)

## UI 惯例(Neo-Brutalism)

- **配色**:奶油纸底 `--paper` + ink 粗描边(2px)+ 硬阴影(`4px 4px 0 ink`)+ 糖果色块,令牌集中在 `styles.css` `:root`;按钮 hover 上浮/active 压下的手感全项目统一
- **按钮**:`btn-primary`(**黄底**)只用于最终确认/提交(添加模型),其他一律 `btn-ghost`;链接用 `.link-btn`(ink 字、hover 才下划线);选中语义蓝 `#2f6bff` 只留给"选中"(3D 选中、卡片 current)
- **图标**:内联 SVG,`strokeWidth: 2`、圆角线帽;字符 glyph(▾⌄×✓↻↺)加粗使用
- **中英双语**:中文在前 English 在后,新增文案照此惯例;类型/品牌/参数标签分别集中在 `src/ui/labels.ts` 与 `src/models/registry.ts` 的映射表,不要散落硬编码
- 弹窗根节点必须带 `data-modal` 属性(3D 层的快捷键据此忽略输入)
- **侧栏结构**:「方案 Plan」(SegmentedTabs 分「整宅 Home」= HomeTab:模板/墙高/房间列表/门窗编辑(内墙打通、外墙阳台)与「房间 Room」= RoomTab:当前房间的房型/尺寸/隔墙/换一换/新建房间;种子无输入框,状态栏仅展示,脚本仍可用 setSeed)与「家具 Furniture」(装饰密度+添加家具)两个 Section,均可折叠(状态存 uiStore.sectionOpen,仅会话);侧栏底部是「导出 Export / 导入 Import」项目文件工具行(`exportProject`/`importProject`,轻量 JSON,version=1,多房间兼容,不含上传 GLB)+ GitHub 仓库与反馈链接;显示开关(剖切/窗/楼板/门扇/显示家具)在 TopBar「显示 Display」下拉,移动网格在状态栏信息行;「换一换 Shuffle」= `reshuffleFurniture()`(store 另有 `rebuild()` 动作)
- **侧栏滚动条是故意隐藏的**(`scrollbar-width: none`),不要加回
- **移动端(≤720px)**:侧栏变覆盖式抽屉(uiStore `collapsed` 默认 true),画布/浮层全宽,顶栏紧凑可横滑,弹窗近全屏;样式集中在 styles.css 末尾的 `@media (max-width: 720px)` 块

## AI 能力(codex CLI 子进程,仅 dev server)

- 两个端点都跑本机 codex CLI(`scripts/ai-api.mjs`),**脚本不读任何凭证**:codex 登录态由 codex 自管(`codex login`,auth.json 只有 codex 自己读写);status 用 `codex login status` 探测(3s 超时,30s 缓存);codex 路径用 `HOME3D_CODEX_BIN` 覆盖
- **共享单飞槽** `codexCurrent{kind,startedAt,kill}`:understand/render 互斥,busy 响应带 startedAt+kind;两个 `/cancel` 端点是逃生口;client 断连经 `res.on('close')` 杀子进程立即释放槽位
- **runCodex 的坑**:codex 会拉起 MCP server 孙进程继承 stdio 管道,只杀直接子进程时 `close` 事件等管道会拖几秒甚至不落 → 必须 `detached:true` + 进程组 SIGKILL(`process.kill(-pid)`),被杀/超时的运行用 `exit` 事件收尾(正常完成仍走 `close` 保 stdout 完整)
- **户型识别 understand**:`codex exec --ephemeral -s read-only --output-schema`(严格 JSON,`-o` 落盘再解析),180s;识别产物经 `src/gen/importPlan.ts` 的 `planJsonToHome` 转 HomeDef(类型映射/几何修复/门窗落位,report 带 applied/dropped 计数);store 动作 `importHome` 整体替换并重排所有房间;原图经 `setPlanImage` 存 IndexedDB,`PlanMinimap` 在整宅 tab 右下角常驻。已知限制:识别 30~70s;无尺寸标注的图比例是估值(±15%),靠改房间尺寸校准
- **3D 重绘 render**:让 codex 调 image_gen 工具恰好一次,240s 超时(实测 ~80s)。三个硬要求:`-s workspace-write`(read-only 下 image_gen 不注册,silent 失败)、**禁 `--ephemeral`**(rollout 必须落盘才能提取)、prompt 前加 `--`(`-i` 是变参,会把位置参数 prompt 吞成图片路径)。出图在 `$CODEX_HOME/sessions/**/rollout-*<sid>.jsonl` 的内联 base64(v0.140 形状 `image_generation_call.result`;v0.144+ 形状 `image_generation_end.result`);sid 从 stdout/stderr 的 `session id:` 解析,失败回落"最新 mtime rollout";**不信 saved_path 和响应文本里的路径**(幻觉面),提取后删 rollout + `generated_images/<sid>` 恢复清洁
- **demo 降级**:`/api/ai/*` 只挂在 dev server;线上(Pages)探测失败 → AI 面板/导入行显示"本机运行可用"提示并禁用,不报 404 错误
- 渲染比例只有 1:1/3:2/2:3 三档(prompt 措辞近似控制);**画布截图带 alpha** 会诱导模型裁切重构 → `AIRender.tsx` 的 `cropToAspect` 先铺 `--paper` 底色再裁剪发送;编辑器的 -10% 取景偏移同理必须在捕获期清掉(`captureFittedScreenshot`/`captureUnbiasedScreenshot` 自动处理)
- 发给图像模型的 prompt 保持英文(`AIRender.tsx` 的 `DEFAULT_PROMPT` 默认写实摄影方向;`aiPresets.ts` 的 fragment 同)
- AI 接口只挂在 dev server(`vite preview`/build 无 `/api/ai/*`)

## 测试脚本的注意事项

- `scripts/smoke-ui.mjs`、`audit-ui-overflow.mjs` 需要本机 Chrome,路径用 `CHROME_PATH` 覆盖(默认 macOS 应用路径)
- `scripts/fetch-assets.mjs` 会访问网络下载 Kenney/KayKit 资产包(仅维护资产时需要)
- `scripts/smoke-ui.mjs`、`audit-ui-overflow.mjs` 不起 codex 任务,零额度消耗;`/api/ai/understand` 与 `/api/ai/render` 的端到端都会起真实 codex 调用(render 消耗 ChatGPT 图像额度,80s 量级),写这类脚本前先确认必要

## 已知限制(多房间,接受)

- 房间必须矩形且不重叠(允许共边);L 形房间用两个矩形拼
- front/center/free/ring 布局规则不避门(墙贴/跑道类已避);极端小房间门多时可能摆件失败,靠引擎 24 次 attempt 丢弃机制兜底
- 不允许跨房间拖家具(拖出边界即 clamp 回本房间);换房间 = 删除 + 重新添加
- 内墙不参与 cutaway;完全被包围的房间靠外墙剖切 + 门洞可见
- 新增/编辑门窗不触发家具重排(门洞避让在下次重排/换一换时生效);AI 能力(户型导入/图生渲染)仅本机 dev server 可用,线上 demo 降级提示
