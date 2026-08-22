# AGENTS.md — 给后续维护者的关键约定

本文件记录改代码前必须知道的契约、惯例和坑。详细产品说明见 `README.md`。

OpenHome3D 是「家居生成器 Cartoon」的开源版:**仅单间**、**彩色 cel-shaded 卡通渲染**、**Neo-Brutalism UI**,**无任何后端/API 服务**(浏览器纯前端)。

## 构建与验证

- 改完必须 `npm run build`(tsc 严格模式,`noUnusedLocals`)零错误
- 布局引擎改动后跑 `npm run smoke`(确定性/越界/碰撞/门洞避让/模板/导入转换/打通与护栏墙段 205 项)
- 界面冒烟:`npm run smoke:ui`(需 dev server 在线,无头 Chrome 截图并打印控制台错误,有错误退出码 1 可作回归门;`APP_URL`/`SHOT`/`ACTIONS`/`CHROME_PATH` 环境变量控制,`ACTIONS=shuffle` 覆盖换一换,`ACTIONS=openings-bounds` 覆盖调整房间尺寸后的门窗越界回归)
- UI 溢出审计:`npm run audit:ui`(10 状态 × 2 视口,有 finding 退出码 1,可作回归门;`SHOT_DIR=dir` 逐状态截图)
- dev server 用随机高端口(`.port` 缓存,`scripts/pick-port.mjs`),不要写死端口
- **GitHub Pages**:推送到 main 即自动部署(`.github/workflows/pages.yml`,构建用 `npm run build:pages` = `vite build --base=/OpenHome3D/`)。**凡是引用静态资源的 URL 必须走 `import.meta.env.BASE_URL` 前缀**(注册表 GLB 路径、品牌图),禁止手写 `/models/...`、`/brand/...` 绝对路径,否则子路径部署会 404

## 核心契约(改动会牵连多处,先读再动)

- **状态**:`src/state/store.ts`(zustand + persist `openhome3d` **v1**)。**单间约束**:`home.rooms` 恒为 1(HomeDef 包装保留,布局引擎/墙体推导/门洞避让与多房间版共用零改动);`FurnitureInstance.roomId` 保留但恒为 rooms[0].id,`position` 是房间局部坐标。dev 下暴露 `window.__store`、`window.__three` 供脚本驱动
- **模型注册表**:`src/models/registry.ts`。`ModelDef{id, name, brand, type, kind: parametric|glb|upload, file?, footprint, height?, mount?, params?}`;GLB 的 id 带 `kenney:`/`kaykit:` 前缀,footprint/height/mount 来自 manifest(size-rules),不要再写类型级估值
- **3D ↔ UI 总线**:`src/three/runtime.ts` — `requestView/subscribeView`、`subscribeZoomPct`、`captureScreenshot()`、`captureFittedScreenshot(ratio?)`、`MODEL_BLOB_KEY`、`subscribeSceneReady/emitSceneReady`(场景就绪一次性信号)。UI 不反向 import three 场景组件,只走这里
- **加载遮罩**:`SceneRoot` 的 `ReadyProbe` 在 GLB 资产加载完 + 稳定渲染数帧后 emit 就绪(90 帧/4s 双兜底),`src/ui/LoadingVeil.tsx` 全屏品牌加载屏淡出。**首次渲染不稳定(画布尺寸未稳定/模型未加载),绝不能让裸画面直接露出**
- **IndexedDB 键**:`model:upload:<uuid>`(上传 GLB Blob)
- **布局确定性**:`generateLayout` 只依赖 `{roomType, seed, salt, width, depth, extras, doors?}`;seed 由 store 拼成 `${seed}@${room.id}`,`salt` 在 `RoomDef` 上(重排计数);引擎产物 id `f1…` 由 store 加 `${roomId}:` 前缀,用户操作产生的 id 用 `uid()`。门洞避让:store 经 `doorZonesFor(room, home)` 传 `LayoutOpts.doors`,placeWall/placeRun 跳过与门区间外扩 `DOOR_CLEAR=0.35` 相交的候选

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
- **侧栏结构**:「方案 Plan」(房型/尺寸/墙高/隔墙/换一换 + 嵌套「门窗 Openings」四面外墙自由加门窗;种子无输入框,状态栏仅展示,脚本仍可用 setSeed)与「家具 Furniture」(装饰密度+添加家具)两个 Section,均可折叠(状态存 uiStore.sectionOpen,仅会话);显示开关(剖切/窗/楼板/门扇/显示家具)在 TopBar「显示 Display」下拉,移动网格在状态栏信息行;「换一换 Shuffle」= `reshuffleFurniture()`(store 另有 `rebuild()` 动作)
- **侧栏滚动条是故意隐藏的**(`scrollbar-width: none`),不要加回
- **移动端(≤720px)**:侧栏变覆盖式抽屉(uiStore `collapsed` 默认 true),画布/浮层全宽,顶栏紧凑可横滑,弹窗近全屏;样式集中在 styles.css 末尾的 `@media (max-width: 720px)` 块

## 测试脚本的注意事项

- `scripts/smoke-ui.mjs`、`audit-ui-overflow.mjs` 需要本机 Chrome,路径用 `CHROME_PATH` 覆盖(默认 macOS 应用路径)
- `scripts/fetch-assets.mjs` 会访问网络下载 Kenney/KayKit 资产包(仅维护资产时需要)

## 已知限制(接受)

- 仅单间:`home.rooms` 长度恒 1(引擎层 gen/walls 已多房间就绪——含打通/阳台护栏推导——store/UI 仍单间,多房间 UI 迭代中)
- front/center/free/ring 布局规则不避门(墙贴/跑道类已避);极端小房间门多时可能摆件失败,靠引擎 24 次 attempt 丢弃机制兜底
- 隔墙永不隐藏,不参与 cutaway
