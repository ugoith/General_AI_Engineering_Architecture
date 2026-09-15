# Runbook：构建、验证与发布（Web 游戏）

> 用途：把"怎么构建、怎么验证、怎么发布、失败了怎么查"写成可照着执行的步骤。
> 每条命令都带判定标准——**没有判定标准的命令等于没跑**。本机与 CI 必须跑同一组命令。

## 0. 前置（只做一次）

1. Node 版本 ≥ 20（写进 `.nvmrc`/`package.json` 的 `engines`，避免 CI 与本机不一致）。
2. 包管理器使用 **{{packageManager}}**；lockfile 必须入库，**不要在提交里换包管理器**。
3. 依赖安装：`{{packageManager}} install`（CI 上用 `ci`/`frozen-lockfile` 模式，禁止自动改 lockfile）。
4. `package.json` 的 scripts 必须包含：`dev`、`build`、`preview`、`typecheck`、`test`。
   缺哪个就补哪个——本文件与 `AGENTS.md` 的提交前检查都依赖这五个名字。

## 1. 验证阶梯

| 层 | 命令 | 判定 | 耗时量级 |
|---|---|---|---|
| L0 类型检查 | `{{packageManager}} run typecheck` | 零错误（`any`/`@ts-ignore` 需有理由） | 5–30 s |
| L1 单元测试 | `{{packageManager}} run test` | 零失败 | 5–60 s |
| L2 构建 | `{{packageManager}} run build` | 退出码 0；首屏 JS 体积在预算内 | 10–90 s |
| L3 预览冒烟 | `{{packageManager}} run preview` + 手动主流程 | 首屏 → 开始 → 玩 30 s → 结束；控制台无报错 | 3–5 min |
| L4 真机/触摸 | 目标手机或 `localhost` 局域网访问 + 触摸操作 | 触摸可用、无卡顿、无布局错位 | 5–10 min |

选择规则：

- 只改纯逻辑 → L0 + L1。
- 改渲染/输入/资源 → L0 + L1 + L2 + L3（涉及触摸必加 L4）。
- 改依赖、构建配置、资源清单 → 全部跑，并记录体积变化。

## 2. 构建产物与体积核对

```bash
{{packageManager}} run build      # 产物在 dist/
{{packageManager}} run preview    # 本地预览 dist/
```

- 构建输出里的**每个 chunk 的体积**是权威数字，用它核对 `.ai/constitution.md` 第 5 节的预算。
- 首屏 JS 体积变化 >5% 时，任务包必须解释原因（新依赖？新系统？误把开发资源打进去？）。
- `dist/`、`node_modules/` 不入库；只把体积与结果摘要写进任务包。
- 发布时静态资源用内容 hash 命名 + 长缓存；`index.html` 短缓存（确保更新能生效）。

## 3. 失败分诊表

| 现象 | 先看 | 常见根因 | 处理 |
|---|---|---|---|
| `typecheck` 报错 | 第一条错误 | 隐式 `any`、类型不匹配、可选链缺失 | 补类型；**不要用 `as any` 掩盖** |
| 构建通过、预览白屏 | 浏览器控制台第一条错误 | 资源路径错（`/assets` vs `assets`）、画布 id 不匹配、异步启动未 catch | 按控制台报错定位；检查 `index.html` 的挂载点 |
| 预览时资源 404 | Network 面板 | 资源没放 `public/assets/`、清单 `url` 与磁盘不一致 | 对齐清单与磁盘路径 |
| 移动端触摸无效 | 是否绑定了 touch/pointer 事件 | 只实现了键鼠；或 `touch-action` 被浏览器默认行为吞掉 | 补触摸路径；设置合适的 `touch-action` 与指针事件 |
| 手机上文字/布局错位 | 视觉视口与画布尺寸 | 未处理 DPR 与 resize、用了固定像素 | 按 DPR 缩放并在 resize 时重算 |
| 帧率明显下降 | Performance 面板 | 帧内分配导致 GC、绘制调用暴涨、帧内读布局 | 按 `performance-budget.md` 第 3 节逐项排查 |
| 切后台回来"跳一大段" | 帧循环 delta 处理 | 未钳制 delta、未在 `visibilitychange` 暂停 | 见 `runtime-loop.md` 第 6 节 |
| 存档读不出来 | 存档版本字段 | 格式变更未迁移、写入被隐私模式拦截 | 加版本与迁移函数；捕获写入异常并降级为"仅本次会话有效" |
| CI 上测试偶发失败 | 失败用例是否依赖时间/随机 | 真实计时器、未固定随机种子 | 注入时间源与随机源（见 `{{testsDir}}/README.md`） |

## 4. 记录要求（任务包必须包含）

```markdown
### 结果
- 改动：<一句话>
- 验证层级：L0 / L1 / L2 / L3 / L4（列出实际跑的命令）
- 证据：<类型错误数、测试通过/失败数、首屏 JS 体积与 Δ、手动流程结论>
- 未验证项与原因：<例如"未测 Safari/iOS：本机无设备">
- 遗留风险：<例如"触摸输入仅在模拟器验证">
```

**只跑 L0 却声称"已验证完成"属于伪造验证**，评审直接退回。

## 5. 索引与漂移

```bash
node .ai/bin/ai-arch.mjs review --drift
```

- hash 漂移 → 更新 `{{aiDir}}/index/files.json`。
- 报"决策缺失"（加了运行时依赖/改了调度结构但无 ADR）→ 补 ADR。
- 漂移未清零不算完成（DoD 第 5 条）。

## 6. 发布检查清单

- [ ] L0–L3 全绿；涉及移动端时 L4 通过。
- [ ] 首屏体积与帧时间在预算内，或已有 ADR 说明。
- [ ] 资源清单与磁盘一致；无 404。
- [ ] 存档版本兼容（老档可读或已提示重置）。
- [ ] 缓存策略正确（`index.html` 短缓存，静态资源长缓存）。
- [ ] 已更新 `{{aiDir}}/index/files.json` 与相关文档。
