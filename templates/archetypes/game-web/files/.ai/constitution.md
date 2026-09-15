# 项目宪法 — {{projectTitle}}

> L1 层：每会话必读，必须 ≤120 行。只写**本项目专属**的红线与可执行验证命令；
> 通用规范来自框架（`packId: {{packId}}`，`frameworkVersion {{frameworkVersion}}`），不在本文件重复。
> 最后更新：{{date}}，负责人：{{owner}}。

## 1. 项目事实

| 项 | 值 |
|---|---|
| 引擎 | **{{engine}}**（升级引擎大版本必须先写 ADR） |
| 语言 / 构建 | TypeScript（strict）+ Vite；包管理器 **{{packageManager}}**（锁定 lockfile，不在提交里换包管理器） |
| 源码根 / 测试根 | `{{srcDir}}` / `{{testsDir}}` |
| 目标浏览器 | 待填写：例如 `Chrome/Edge 最近两个大版本 + Safari iOS 16+`（列出必测项，写清最低版本） |
| 目标设备档 | 待填写：例如 `中端 Android 手机（4 核 / 4GB）+ 桌面 1080p` |
| 规模等级 | {{scaleLevel}} / {{scaleName}} |

## 2. 红线（违反即拒绝合并）

1. **帧循环内零分配**：不 `new`、不字符串拼接、不产生中间数组、不闭包捕获、不 `console.log` 拼串。
2. **资源必须走加载器**：禁止散落的 `new Image()`/`fetch`/`import '*.png'`；必须有清单与失败回退。
3. **键鼠 + 触摸双输入**：任一缺失视为功能未完成。
4. **运行时依赖必须在第 3 节表中**；否则先写 ADR（含体积与替代方案评估）。
5. **不在帧内读写布局**（`offsetWidth`/`getBoundingClientRect`/样式写入触发重排）。
6. **不阻塞主线程**：超过约 16 ms 的同步工作必须分帧或放 Worker。
7. **禁止伪造验证结果**：没跑过的类型检查/测试/构建不许写成通过；不能验证的写明"未验证 + 原因 + 人工步骤"。
8. **禁止越规模引入架构**：DI 容器、事件总线框架、ECS 重架构、CQRS 分层在 {{scaleLevel}} 级一律不做；要做得先升级规模等级并写 ADR。
9. **禁止 `any` 与 `@ts-ignore` 掩盖类型问题**（确有需要时在代码里写明理由并登记到本文件第 7 节的风险项）。

## 3. 已批准依赖（运行时）

| 依赖 | 版本 | 用途 | 体积影响 | 批准方式 |
|---|---|---|---|---|
| `{{engine}}` | 待填写 | 渲染 / 帧循环 / 输入 | 主要体积项 | 项目初始化时确定 |
| 待填写 | | | | ADR-000 |

**开发依赖**（构建、类型、测试、格式化）不占首屏预算，但仍需说明用途；引入测试框架请按 `{{testsDir}}/README.md` 选型并写 ADR。

## 4. 验证命令（DoD 的唯一依据）

```bash
# L0 类型检查（必须零错误）
{{packageManager}} run typecheck

# L1 单元测试（纯逻辑：数值、状态机、存档序列化；时间与随机数必须可注入）
{{packageManager}} run test

# L2 生产构建（读输出体积，与第 5 节预算比对）
{{packageManager}} run build

# L3 本地预览 + 手动主流程（首屏 → 开始 → 玩 30 秒 → 结束）
{{packageManager}} run preview

# L4 索引漂移检查（每次提交前）
node .ai/bin/ai-arch.mjs review --drift
```

- 判定标准：L0 零错误；L1 零失败；L2 退出码 0 且首屏 JS 体积在预算内；L3 手动过一遍且无控制台报错。
- `dist/`、`node_modules/` 是生成物，不入库；只把体积与结果摘要写进任务包。
- **必须至少在一个目标移动设备/模拟器上验证触摸输入**；只测桌面键鼠的改动要写明"未验证触摸"。

## 5. 性能与体积预算

| 指标 | 预算 | 超标处理 |
|---|---|---|
| 帧时间（主循环，中端机） | `≤16.6 ms`（60 FPS）；抖动 P95 `≤20 ms` | Performance 面板抓帧 → 定位到系统 → 改 → 前后数据写进任务包 |
| 首屏 JS（gzip 后） | 待填写：例如 `≤ 1.5 MB`（引擎本身占大头，其余按系统分配） | 拆包/延迟加载非首屏模块；禁止"打包时删功能"了事 |
| 单帧绘制调用 | 待填写：例如 `≤ 150` | 合批、合并纹理图集、减少材质切换 |
| 内存占用（中端机） | 待填写：例如 `≤ 300 MB` | 检查纹理尺寸与音频解码方式；释放不再使用的关卡资源 |
| 首屏可交互时间 | 待填写：例如 `≤ 3 s`（4G 中端机） | 减少首屏资源量，加载进度用真实进度而非假动画 |
| 单帧内堆分配 | `0`（稳态） | 对象池 + 复用容器；用 Performance 的 Allocation 采样验证 |

预算数字必须来自实测过一次的基线；**预算不能凭感觉填**。

## 6. 规模门槛

{{> SHARED:scale-gate}}

## 7. 决策记录与已知风险

- 目录：`{{aiDir}}/decisions/`，模板：`{{aiDir}}/templates/adr.md`，命名：`ADR-0001-<kebab-title>.md`。
- 何时必须写：

{{> SHARED:decision-trigger}}

- 已知风险登记（写清"风险 + 缓解 + 复查时机"）：当前无；新增风险时在下方补一行，例如 `类型逃逸 | 在 X 处集中断言 | 下次类型检查失败时`。

## 8. 变更影响（改 A 必须同步 B）

| 改了 | 必须同步 |
|---|---|
| `{{srcDir}}/**` 任何文件 | `{{aiDir}}/index/files.json` 的 `hash` 与 `digest` |
| 系统划分或调度顺序 | `{{docsDir}}/architecture/runtime-loop.md` + `{{srcDir}}/systems/README.md` + ADR |
| 资源清单或加载流程 | `{{docsDir}}/architecture/asset-loading.md` + 体积增量记录 |
| 性能相关实现 | `{{docsDir}}/architecture/performance-budget.md` 的基线与实测值 |
| 依赖（运行时） | 本文件第 3 节 + ADR + 构建体积变化 |
| 构建/发布脚本（`package.json` scripts） | `{{docsDir}}/runbooks/build-and-verify.md` |
