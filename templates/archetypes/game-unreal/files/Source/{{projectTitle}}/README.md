# Source/{{projectTitle}} — C++ 模块结构

本文件说明 C++ 代码放哪里、模块之间怎么依赖、头文件改动的连锁反应。**它不解释 UE API 用法**，
反射/GC/内置类型等约定见 `{{aiDir}}/skills/` 中的 `game-engine-conventions`。

## 1. 目录结构

```
Source/
  {{projectTitle}}.Target.cs          游戏（Standalone）目标
  {{projectTitle}}Editor.Target.cs    编辑器目标
  {{projectTitle}}/
    {{projectTitle}}.Build.cs         模块依赖声明（改它必须重新生成项目文件）
    Public/                           对外可见：其它模块只允许 include 这里的头文件
      Combat/                         UCombatComponent.h、UCombatSettings.h ...
    Private/                          实现细节，不出模块
      Combat/                         UCombatComponent.cpp ...
```

`Public/` 与 `Private/` 的划分是**模块边界的具体实现**：

- 其它模块需要用到的东西（类型、接口、枚举）才放 `Public/`。
- 只在本模块内使用的助手类放 `Private/`，并加 `UCLASS()` 之外的可见性控制。
- 需要跨模块访问但不想暴露实现时，用 `UINTERFACE`（接口）而不是把实现类放进 `Public/`。

## 2. 模块拆分与依赖方向

- **按玩法域拆模块**（`Game`、`Combat`、`Inventory`、`UI`…），不按"技术层"拆（不要 `Utils`、`Common` 大杂烩）。
- 依赖必须**单向且无环**：`UI → Game → 各玩法模块 → Core`。
- 在 `.Build.cs` 的 `PublicDependencyModuleNames`（暴露给依赖者）与 `PrivateDependencyModuleNames`（仅自己用）之间**必须刻意选择**：
  放进 `Public` 的依赖会传染给所有依赖你的模块，能放 `Private` 就放 `Private`。
- 新增模块 = 模块边界变更 → **写 ADR**（记录为什么需要新模块、依赖谁、谁依赖它）。
- 循环依赖是设计错误，不要用"延迟加载/前置声明"绕过；把共享契约下沉到更低层模块。

## 3. 头文件与反射规则

| 规则 | 原因 |
|---|---|
| 任何要被蓝图访问或被 GC 追踪的成员加 `UPROPERTY()`；蓝图可调函数加 `UFUNCTION(BlueprintCallable)` | 没有反射宏 = 蓝图不可见 + 不被 GC 追踪 |
| 持有 `UObject` 的成员用 `TObjectPtr<T>`（UE5）且必须有 `UPROPERTY()` | 裸指针会被 GC 静默回收 → 野指针崩溃 |
| 非拥有引用用 `TWeakObjectPtr<T>` 并在使用前 `IsValid()` | 表达"可能失效"的语义 |
| 结构体成员要序列化用 `UPROPERTY()`；纯 POD 用普通 `struct` | 减少反射开销 |
| 枚举用 `UENUM(BlueprintType)` + `uint8` 底层类型 | 蓝图可用 + 序列化稳定 |
| 头文件里避免 `#include` 具体实现类，用前置声明 | 编译时间与耦合 |
| 改 `Public/` 下任何头文件 = 触发大量模块重编译 | 因此**先定好接口再动手**，不要反复改签名 |

## 4. 生命周期与内存

- `UObject` 创建：`NewObject<T>()`（运行时）、`CreateDefaultSubobject<T>()`（构造函数里建组件）、`SpawnActor<T>()`（Actor）。
- 禁止 `new`/`delete` UObject；释放靠置空引用交给 GC，或 `MarkAsGarbage()`。
- `BeginPlay` 只做初始化接线；`Tick` 里不做分配、不做 `GetWorld()->FindActor`（用 `TActorIterator` 也只在初始化时用一次）。
- 定时逻辑优先用 `FTimerHandle` + `GetWorldTimerManager()`，不要自己累积 delta 做计时（会被暂停/时间膨胀影响）。
- 委托绑定后必须在 `EndPlay`/析构处解绑，避免打到已销毁对象（`AddDynamic` 的宏已含弱引用保护，但 `AddLambda`/原生委托没有）。

## 5. 反模式清单

| 反模式 | 后果 | 改成 |
|---|---|---|
| 裸指针存 `UObject` 且无 `UPROPERTY` | 随机崩溃，难复现 | `TObjectPtr<>` + `UPROPERTY()` |
| `Tick` 里 `GetAllActorsOfClass` / `FindComponentByClass` | 每帧 O(n) | 初始化时缓存 |
| 在 `Public/` 里 include 具体玩法实现头 | 编译时间爆炸、模块边界失效 | 接口下沉或用前置声明 |
| `.Build.cs` 里无脑加 `PublicDependencyModuleNames` | 依赖传染、循环依赖 | 优先 `PrivateDependencyModuleNames` |
| 用 `FString` 拼接做每帧日志/UI 文本 | 每帧堆分配 | 缓存结果或按需刷新 |
| 把数值写死在 C++ 里 | 策划无法调、每次改数值都要重编译 | 放 DataAsset / DataTable，C++ 只读不写死 |
| 蓝图里重写一遍 C++ 已有逻辑 | 两处真相，必然漂移 | 见 `{{docsDir}}/architecture/bp-vs-cpp.md` |

## 6. 与索引的关系

- 新增/删除 `.h`/`.cpp`，或改了类的公开职责 → 更新 `{{aiDir}}/index/files.json` 的 `path`/`digest`/`imports`/`module`。
- 摘要写法：**1–3 句，写"它负责什么 + 谁调用它"**。
  好例子：`"UCombatComponent：维护连招队列与冷却，接收 UCombatSettings；由 ACombatCharacter 驱动，对外暴露 TryAttack()。"`
  坏例子：`"战斗组件。"`（无信息量）
