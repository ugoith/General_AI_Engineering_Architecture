/**
 * {{projectTitle}} — 游戏入口（boot → scene → systems）
 *
 * 结构说明（照着这个骨架扩展，不要把业务写进本文件）：
 *   1. boot     ：加载首屏资源、初始化画布与引擎、注册系统。此阶段允许分配与等待。
 *   2. scene    ：把「当前场景」的构造与销毁交给场景注册表；场景只提供数据与系统装配，不写帧逻辑。
 *   3. systems  ：输入、渲染、音频、存档、关卡等各自独立的系统，统一由帧循环按固定顺序调度。
 *
 * 引擎接入点（当前为引擎无关骨架，选定 {{engine}} 后在此处接）：
 *   - 把 `createRenderer()` 换成引擎的渲染对象初始化；
 *   - 把 `presentFrame()` 换成引擎的渲染提交（或在引擎自己的循环里回调 step()）；
 *   - 系统内部再使用引擎 API，本文件保持无引擎依赖，便于测试与替换。
 *
 * 硬约束（详见 .ai/constitution.md 与 AGENTS.md）：
 *   - step()/render() 内禁止分配对象、数组、闭包与字符串；
 *   - 资源必须走 assets 加载器并有失败回退；
 *   - 输入必须同时支持键鼠与触摸。
 */

/** 逻辑帧固定步长（秒）。物理与游戏逻辑用它，表现插值用真实 delta。 */
const FIXED_STEP_SECONDS = 1 / 60;

/** 单帧最大时间跨度（秒）：标签页切回时浏览器会给出巨大的 delta，必须钳制，否则物理会"瞬移"。 */
const MAX_FRAME_DELTA_SECONDS = 0.25;

/** 一帧的上下文对象：**必须复用同一个实例**，避免每帧分配。 */
export interface FrameContext {
  /** 真实帧间隔（秒，已钳制） */
  deltaSeconds: number;
  /** 累计运行时间（秒） */
  elapsedSeconds: number;
  /** 本帧要推进的固定步数（可能为 0，也可能 >1） */
  fixedSteps: number;
}

/** 系统接口：每个系统只做一件事，顺序由注册顺序决定（见 docs/architecture/runtime-loop.md）。 */
export interface GameSystem {
  readonly name: string;
  /** 初始化：允许分配、允许异步（异步请自行 await 后再返回） */
  init?(): void | Promise<void>;
  /** 固定步长逻辑：物理、状态机、玩法规则 */
  fixedUpdate?(ctx: FrameContext): void;
  /** 每帧逻辑：输入采样、动画推进、音频参数 */
  update?(ctx: FrameContext): void;
  /** 渲染提交：只读状态，不改玩法状态 */
  render?(ctx: FrameContext): void;
  /** 释放：取消监听、停止音频、断开 Worker */
  dispose?(): void;
}

/** 场景：只负责"提供内容与装配系统"，不含帧逻辑。 */
export interface Scene {
  readonly name: string;
  /** 构造场景所需的系统（返回值会被注册进帧循环） */
  createSystems(): GameSystem[];
  dispose?(): void;
}

export class Game {
  private readonly systems: GameSystem[] = [];
  private readonly ctx: FrameContext = { deltaSeconds: 0, elapsedSeconds: 0, fixedSteps: 0 };
  private readonly sceneFactories = new Map<string, () => Scene>();
  private currentScene: Scene | undefined;
  private accumulatorSeconds = 0;
  private running = false;

  /** 注册场景工厂（延迟构造：切场景时才真正创建） */
  registerScene(name: string, factory: () => Scene): void {
    this.sceneFactories.set(name, factory);
  }

  /** 注册系统：顺序即调度顺序 */
  addSystem(system: GameSystem): void {
    this.systems.push(system);
  }

  /** 切换场景：先销毁旧场景的系统，再构造新场景 */
  switchScene(name: string): void {
    const factory = this.sceneFactories.get(name);
    if (factory === undefined) {
      throw new Error(`scene not registered: ${name}`);
    }
    this.disposeScene();
    this.currentScene = factory();
    for (const system of this.currentScene.createSystems()) {
      this.addSystem(system);
    }
  }

  /** 启动：初始化所有系统后进入帧循环（由外部驱动，见 docs/architecture/runtime-loop.md） */
  async start(): Promise<void> {
    for (const system of this.systems) {
      await system.init?.();
    }
    this.running = true;
  }

  /**
   * 推进一帧。由引擎的主循环（requestAnimationFrame / engine tick）调用。
   * 注意：本方法内部**不分配**——所有临时值都在字段或调用方复用。
   */
  step(frameDeltaSeconds: number): void {
    if (!this.running) {
      return;
    }

    // 1) 钳制 delta：切标签页回来时 delta 可能是几十秒
    this.ctx.deltaSeconds =
      frameDeltaSeconds > MAX_FRAME_DELTA_SECONDS ? MAX_FRAME_DELTA_SECONDS : frameDeltaSeconds;
    this.ctx.elapsedSeconds += this.ctx.deltaSeconds;

    // 2) 固定步长累加：逻辑步数上限用于防止"追帧雪崩"
    this.accumulatorSeconds += this.ctx.deltaSeconds;
    let steps = 0;
    while (this.accumulatorSeconds >= FIXED_STEP_SECONDS && steps < 5) {
      this.accumulatorSeconds -= FIXED_STEP_SECONDS;
      steps += 1;
    }
    this.ctx.fixedSteps = steps;

    // 3) 调度顺序：固定步长 → 每帧 → 渲染（顺序变更需要 ADR）
    for (let i = 0; i < this.systems.length; i += 1) {
      const system = this.systems[i];
      if (system.fixedUpdate !== undefined) {
        for (let s = 0; s < steps; s += 1) {
          system.fixedUpdate(this.ctx);
        }
      }
    }
    for (let i = 0; i < this.systems.length; i += 1) {
      this.systems[i].update?.(this.ctx);
    }
    for (let i = 0; i < this.systems.length; i += 1) {
      this.systems[i].render?.(this.ctx);
    }
  }

  /** 停止并释放：页面隐藏、卸载、测试结束都必须调用 */
  async stop(): Promise<void> {
    this.running = false;
    this.disposeScene();
  }

  private disposeScene(): void {
    for (let i = this.systems.length - 1; i >= 0; i -= 1) {
      this.systems[i].dispose?.();
    }
    this.systems.length = 0;
    this.currentScene?.dispose?.();
    this.currentScene = undefined;
  }
}

/** 入口：boot 阶段（加载首屏资源、创建引擎实例、注册场景），然后启动。 */
export async function boot(): Promise<Game> {
  const game = new Game();

  // TODO(项目初始化)：在此处接入资产加载器（见 docs/architecture/asset-loading.md）
  //   await loadManifest('/assets/manifest.json');

  // TODO(项目初始化)：在此处接入 {{engine}} 的渲染初始化，并替换下面的引擎无关占位。
  const canvas = document.getElementById('game-canvas');
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('missing canvas element with id="game-canvas"');
  }
  // 引擎接入时把 canvas 交给渲染初始化：createRenderer(canvas, {...})
  void canvas;

  // TODO(项目初始化)：注册真实场景，例如：
  //   game.registerScene('main-menu', () => new MainMenuScene());
  //   game.registerScene('level-01', () => new Level01Scene());
  game.registerScene('boot-placeholder', () => ({
    name: 'boot-placeholder',
    createSystems: () => [],
  }));
  game.switchScene('boot-placeholder');

  await game.start();
  return game;
}
