# 小钢琴 · 儿童钢琴启蒙网页应用

打开网页就能直接弹的儿童钢琴启蒙工具。孩子通过「触摸 → 听觉 → 视觉 → 完成感」自然认识音高与节奏。

- **静态 Web App + PWA**：零广告、零账号、零内购、打开即玩
- **完全本地**：所有数据留在设备（localStorage），不依赖任何后端
- **横屏优先**：iPad / 手机 / 桌面浏览器通用

产品与开发规划见 [`儿童钢琴启蒙网页应用_开发规划_V3.0.md`](./儿童钢琴启蒙网页应用_开发规划_V3.0.md)，
实现进度与验收情况见 [`docs/开发进度与验收.md`](./docs/开发进度与验收.md)。

---

## ⚠️ 动手之前必读

**1. 任何与前端视觉相关的改动，必须先完整阅读 [`儿童钢琴启蒙网页应用_设计规范_V3.0.md`](./儿童钢琴启蒙网页应用_设计规范_V3.0.md)。**

「视觉相关」包括：CSS / Design Token / 颜色 / 字体 / 字号 / 字重 / 圆角 / 边框 / 阴影 / 间距 /
版式 / 响应式断点 / 页面布局 / 组件结构 / 信息层级 / 文案措辞 / 图标 / 装饰 / 皮肤 / 主题 /
动效 / 过渡 / 空状态 / Loading，以及新增页面、新增组件、调整既有页面外观。

该文档是**设计宪法**（2757 行 / 167 节），包含硬性禁止项（Emoji、紫蓝渐变、玻璃拟态…）
与精确数值（色板、圆角、阴影、动效时长）。**这些无法靠记忆复现**，
不允许「先写出来再对照」，也不允许「凭印象认为符合」。

**2. 其他改动，必须先读开发规划第二十三章《给 AI 编程模型的最高优先级开发规则》。**

完整的执行流程、AI Preflight Checklist 与硬性禁止清单见 **[`AGENTS.md`](./AGENTS.md)**。

> ⚠️ 现有代码的视觉层写于设计规范纳入开发框架之前，**存在已知偏差**
> （最严重的是全项目 Emoji 使用与主色体系偏离）。
> 审计与整改计划见 [`docs/开发进度与验收.md`](./docs/开发进度与验收.md) 的《设计与规范符合性审计》。
> **整改完成前，不要把现有代码当作视觉实现的范例。**

---

## 快速开始

```bash
npm install
npm run dev        # 开发服务器，默认 http://localhost:5173
```

其他命令：

```bash
npm run test       # Vitest 单元测试 + 核心路径冒烟测试
npm run typecheck  # TypeScript 严格模式类型检查
npm run build      # 生产构建（输出到 dist/）
npm run preview    # 预览生产构建
npm run icons      # 重新生成 PWA 图标（纯 Node，无外部依赖）
```

### 真机自检

在 iPad / 手机上打开 `#/tuning`（例如 `http://<你的局域网 IP>:5173/#/tuning`）。

这个隐藏路由不在任何儿童界面里露出入口，它把 Phase 0 需要在真机上观察的量变成可读数字：
AudioContext 状态、baseLatency、`pointerdown → noteOn` 耗时、同时按下的最多手指数、
「没有手指按下但引擎仍有音在响」的卡音告警，以及实时的 pointer 事件轨迹。

---

## 目录结构

```text
src/
├── app/                     App 外壳、路由表、全局样式
│   ├── App.tsx              皮肤 CSS 变量注入 + 音频解锁
│   └── routes.tsx           主干路由打进主包，装扮/小挑战/设置/自检按需加载
│
├── core/
│   ├── audio/
│   │   ├── AudioEngine.ts   唯一音频出口：ensureReady / noteOn / noteOff / allNotesOff
│   │   ├── PianoSynth.ts    轻量合成钢琴音色 + PianoVoice 生命周期
│   │   ├── Reverb.ts        程序生成脉冲响应的极短 room reverb
│   │   └── notes.ts         音名 ↔ MIDI ↔ 频率 ↔ 简谱唱名
│   └── progress/
│       ├── ProgressStore.tsx      单一数据源（React Context）
│       ├── recordPracticeResult.ts 唯一业务入口，事务式结算与解锁
│       ├── migrations.ts          纯函数迁移，绝不覆盖旧数据
│       ├── storage.ts             唯一允许碰 localStorage 的地方
│       └── progressTypes.ts       成长数据模型
│
├── features/
│   ├── piano/               双层键盘布局 + pointer 输入 + 音频接线
│   ├── practice/            状态机 / 评分 / Listen Mode 调度 / 练习页 / 完成页
│   ├── songs/               曲谱数据 + 重拍力度 + KeyboardRangeResolver + 曲目列表
│   ├── skins/               皮肤数据 + 主题注册表 + 解锁解析 + 装扮页
│   ├── achievements/        勋章
│   ├── home/ free/ challenges/ settings/ tuning/
│
├── shared/                  cx、useAudioUnlock
└── test/                    setup + 核心路径冒烟测试
```

---

## 关键设计决策

### 键盘：双层布局，而不是全 flex

白键层正常流式排布，黑键层绝对定位覆盖。黑键的水平位置用「白键宽度的百分比」表达
（`left = (白键序号 + 1) × 白键宽度 − 黑键宽度 / 2`），因此屏幕宽度变化不会破坏相对关系，
25 键也能直接扩展。8 键按文档要求**只出现白键**。

### 输入：容器级 pointer capture + 命中测试

事件只挂在键盘容器上，用 `document.elementFromPoint(...).closest('[data-note]')` 判断手指落在哪个键上，
容器调用 `setPointerCapture()`。这样同时得到三件事：

- 任意多指（`Map<pointerId, note>`，而不是单个 `activeKey`）
- 手指滑过琴键的连奏（glissando）
- 手指划出键盘边界后仍能收到 `pointerup`，不会出现「手指抬起了音还卡着」

释放路径有三重：`pointerup` / `pointercancel` / `lostpointercapture`，
外加 `visibilitychange`、`window.blur` 与组件卸载时的兜底 `releaseAll()`。

### 音频：一条时间轴 + 击弦物理模型

Listen Mode **不使用**「每个音符一个 `setTimeout`」。整首歌的音一次性排程到
`AudioContext.currentTime` 时间轴上，视觉高亮用 `requestAnimationFrame` 读同一个
`currentTime` 反算当前拍。两者永远对齐，长曲不累积误差，切后台也不会失步。

音色是「谐波列 + 双段衰减 + 同音多弦拍频 + 击弦噪声 + 指数制音」的轻量击弦模型，
程序生成，没有任何音频资源文件。几个关键点：

- **谐波列带非谐性**：第 k 次谐波略高于 k 倍基频（高音弦短，非谐性更强）
- **双段衰减**：每根弦先快速衰减（明亮结实），再进入很慢的余音 —— 这是钢琴最容易被忽略的特征
- **同音多弦拍频**：低三个分音用两根差 1.4 音分的弦，产生缓慢的音量起伏
- **击弦点凹坑**：振幅按 k^-1.6 滚降，并在 7 的倍数处抑制（击弦点在弦长 1/7 处）
- **按住期间持续衰减**：制音器抬起时琴弦一直在衰减，包络**不做平台化**
- **松开 = 制音器落下**：`setTargetAtTime` 指数衰减（低音时间常数更大），而不是线性切断

> 这里有两个曾经真实踩过的坑，现在都有回归测试钉住：
> 用 `linearRampToValueAtTime` 释放会让人耳（对数感知）听起来像「掉下悬崖」；
> 用 `setTargetAtTime` 把包络停在某个中间电平则会让按住不放的音变成电子琴。

### 曲谱：一份数据，两种键盘，带表现力

曲谱只保存**一份**原始旋律，「8 键 / 15 键 / 25 键版本」由 `KeyboardRangeResolver` 在运行时推导：
先选「落入音域音数最多」的整体移调方案（并列时位移最小优先），仍越界的音再按八度吸附 ——
按八度吸附比吸附到最近的键更保唱名，听感自然得多。

力度不在曲谱里逐音手写（400 多个音容易出错，改速度或换拍号就全废），而是由 `dynamics.ts`
按小节位置推导：4/4 第 1 拍最强、第 3 拍次强；3/4 第 1 拍最强、第 3 拍次强。
动态范围刻意压在 ±20% 以内 —— 既能听出「有人在弹」，又不会让重拍显得做作；
即使个别曲子小节对齐不完美，落错的「重拍」也只像人的自然起伏。曲谱里显式写的 `velocity` 优先。

加一首新曲只需在 `songData.ts` 写一段 `seq([[音名, 时值(拍)], ...])`（起始拍自动累加），
数据完整性测试会兜住记谱错误：时间重叠、总拍数与拍号不对齐、音域跨度过大、
`defaultKeyboard` 标注与实际情况不符等。

### 结算：事务式，同步返回

```ts
recordPracticeResult(progress, result) → { progress, reward }
```

一次算完：星星 → 歌曲记录 → 最佳成绩 → 连续练习 → 成就 → 皮肤解锁 → 一次性提交。
完成页直接用**返回值**渲染「新解锁」，不依赖 React state 是否已经刷新
（这正是 V2 里 `addStars(); updateStats(); checkUnlocks();` 的 stale state 问题）。

### 皮肤：只覆盖语义变量

皮肤数据里只有 `themeId`，颜色由 `skinThemes.ts` 的注册表提供，再转成受控的
CSS 变量写到 App 根节点。皮肤只能覆盖 `--skin-*` 这 9 个变量（琴键 / 引导 / 氛围三层），
基础 UI 的颜色永远来自 `tokens.css`。有单测保证没有任何一套皮肤越界。

---

## 开发规则的自检对照

| 规则 | 落地方式 |
| --- | --- |
| 组件不直接改 localStorage | 只有 `core/progress/storage.ts` 读写，且只被 `ProgressStore` 调用 |
| 所有成长数据经 ProgressStore | `recordPracticeResult` 是唯一业务入口，纯函数 + 单测覆盖 |
| React 不持有 AudioNode | 组件只调 `audioEngine.noteOn/noteOff/...` |
| 键盘不负责评分 | `PianoKeyboard` 只报告「哪个音按下/松开」 |
| 皮肤只能通过 Progress 事件解锁 | `skinResolver` 只读 progress，挑战模块完全不碰成长数据 |
| 非核心模块不阻塞首次弹琴 | 装扮/小挑战/设置/自检全部 `React.lazy` 分包 |
| 支持 `prefers-reduced-motion` | 全局降级 + 设置页手动开关 |
| 儿童红线 | 无广告 / 无付费 / 无抽卡 / 无排行榜 / 无倒计时压力 |

---

## 部署

`npm run build` 产出 `dist/`，是纯静态站点（`base: './'`，可直接放到任意子路径）。
Cloudflare Pages / Netlify / GitHub Pages 均可，构建命令 `npm run build`，输出目录 `dist`。

**推荐 Cloudflare Pages**：连上 GitHub 仓库后每次推送自动重建，并自带免费 HTTPS 域名
（`<项目名>.pages.dev`）。完整步骤（含构建配置、上线后要验的七件事、响应头与缓存的说明）
见 [`docs/部署与发布.md`](./docs/部署与发布.md)。

仓库里已为它准备好：

- `.nvmrc` —— 构建用 Node 20（Cloudflare Pages 会读它，不用手设 `NODE_VERSION`）
- `public/_headers` —— 带哈希的 `/assets/*` 长缓存、`sw.js` 与 `index.html` 不缓存、几条安全头
- **路由是 hash 路由**（`#/settings`），所以**不需要** SPA 回退规则，也不存在深链 404

Service Worker 只在生产构建中注册（`main.tsx` 里判断 `import.meta.env.PROD`），
开发环境不注册，避免缓存干扰调试。

---

## 已知限制

- **iOS 静音开关**：Web Audio 在 iOS 上遵守物理静音开关。若孩子把 iPad 调成静音，琴键会没有声音。
  这是浏览器行为，不是缺陷；如需绕过需要额外的静音音频元素 hack，目前未采用。
- **音色**：V1 是自研轻量合成（击弦物理模型，见上文）。按文档 6.4 的升级路线，只有当
  「音色质量」成为真实反馈中的核心问题时，才升级到 Tone.js 或采样钢琴。
  自检页 `#/tuning` 里有「音色试听」按钮，可以按住 2 秒听自然衰减、也可以轻点一下听制音余音。
- **真机验证**：所有 pointer / 多点触控 / 音频延迟结论都必须在真实 iPad Safari 上确认，
  自动化测试只能覆盖逻辑与流程（见 `docs/开发进度与验收.md` 的验收清单）。
- **外挂曲目 / PDF 导入**：目前曲库是编译进构建产物的静态数据，没有内容包机制。
  「导入教材 PDF 自动生成练习」这条需求已完成技术评估并暂缓 —— **PDF 里没有音乐语义层，
  必须做 OMR，而 Web 端没有可用的开源 OMR**，扫描件准确率只有 40–70%，教错音比没有更糟。
  可行路径是「PDF 当参考图 + 键盘人工录入」或直接导入 MusicXML/MIDI，
  完整分析与工作量拆解见 `docs/开发进度与验收.md` 的《外挂曲目与 PDF 导入评估》。
