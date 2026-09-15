/**
 * 项目类型自动识别：让 agent 与用户不必知道模板包 id 就能接入。
 *
 * 依据是"该类型必然存在的标记文件"（见 docs/system/02-scales.md 与各 pack 的说明）。
 * 只做可确证的判断，不做猜测：无法判断时返回 candidates 让用户选，而不是默认猜一个。
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  isFile, isDir, exists, readJsonSafe, stripBom,
} from './fsx.mjs';

/** 每种标记文件的权重：越"独有"权重越高。 */
const SIGNALS = [
  // UE
  { test: (f) => f.endsWith('.uproject'), pack: 'game-unreal', weight: 100, label: 'Unreal 项目文件 (*.uproject)' },
  { test: (f) => /(^|\/)Source\/[^/]+\/[^/]+\.Build\.cs$/.test(f), pack: 'game-unreal', weight: 40, label: 'UE 模块 (*.Build.cs)' },
  { test: (f) => f.endsWith('.uplugin'), pack: 'game-unreal', weight: 20, label: 'UE 插件 (*.uplugin)' },
  // Unity
  { test: (f) => f === 'ProjectSettings/ProjectVersion.txt', pack: 'game-unity', weight: 100, label: 'Unity 工程设置' },
  { test: (f) => f.endsWith('.asmdef'), pack: 'game-unity', weight: 30, label: 'Unity 程序集 (*.asmdef)' },
  { test: (f) => f.endsWith('.unity'), pack: 'game-unity', weight: 30, label: 'Unity 场景 (*.unity)' },
  // Godot
  { test: (f) => f === 'project.godot', pack: 'game-godot', weight: 100, label: 'Godot 工程文件 (project.godot)' },
  { test: (f) => f.endsWith('.tscn') || f.endsWith('.tres'), pack: 'game-godot', weight: 30, label: 'Godot 场景/资源' },
  // Web 游戏（package.json + 画布/引擎依赖）
  { test: (f, ctx) => f === 'package.json' && ctx.packageHasGameEngine, pack: 'game-web', weight: 80, label: 'package.json 含游戏引擎依赖' },
  { test: (f) => f === 'index.html', pack: 'game-web', weight: 15, label: 'index.html' },
  // 通用软件
  { test: (f) => f === 'package.json', pack: 'software-app-medium', weight: 25, label: 'package.json' },
  { test: (f) => f === 'pyproject.toml' || f === 'requirements.txt', pack: 'software-app-medium', weight: 25, label: 'Python 工程' },
  { test: (f) => f === 'go.mod' || f === 'Cargo.toml', pack: 'software-app-medium', weight: 25, label: 'Go/Rust 工程' },
  { test: (f) => f.endsWith('.sln'), pack: 'software-app-medium', weight: 20, label: 'Visual Studio 解决方案' },
];

const GAME_ENGINE_DEPS = ['phaser', 'pixi.js', 'pixi', 'three', 'babylonjs', '@babylonjs/core', 'excalibur', 'melonjs', 'kaboom', 'playcanvas'];

/**
 * 推断模板包。
 * @param {string} root 项目根
 * @param {string[]} fileList 项目内的文件清单（相对路径，POSIX）
 * @param {{deps?: Record<string, string>}} [extra] 额外上下文
 */
export function detectPack(root, fileList = [], extra = {}) {
  const ctx = { packageHasGameEngine: detectGameEngineDeps(root, extra) };
  const scores = new Map();
  const evidence = [];

  for (const file of fileList) {
    for (const sig of SIGNALS) {
      if (!sig.test(file, ctx)) continue;
      scores.set(sig.pack, (scores.get(sig.pack) ?? 0) + sig.weight);
      evidence.push(`${sig.label} → ${sig.pack}`);
    }
  }

  const dirSignals = [
    { dir: 'Content', pack: 'game-unreal', weight: 25, label: 'Content/ 目录（UE 资产）' },
    { dir: 'Plugins', pack: 'game-unreal', weight: 15, label: 'Plugins/ 目录（UE 插件）' },
    { dir: 'Assets', pack: 'game-unity', weight: 20, label: 'Assets/ 目录（Unity 资产）' },
    { dir: 'scenes', pack: 'game-godot', weight: 15, label: 'scenes/ 目录（Godot 场景）' },
  ];
  for (const sig of dirSignals) {
    if (!isDir(path.join(root, sig.dir))) continue;
    scores.set(sig.pack, (scores.get(sig.pack) ?? 0) + sig.weight);
    evidence.push(`${sig.label} → ${sig.pack}`);
  }

  const candidates = [...scores.entries()]
    .map(([packId, score]) => ({ packId, score }))
    .sort((a, b) => b.score - a.score);

  // 冲突消解：多个引擎标记同时命中且接近 → 不猜，交给人
  const enginePacks = ['game-unreal', 'game-unity', 'game-godot'];
  const engineHit = candidates.filter((c) => enginePacks.includes(c.packId));
  if (engineHit.length > 1 && engineHit[0].score - engineHit[1].score < 20) {
    return { packId: null, confidence: 'low', evidence, candidates, conflict: engineHit.map((c) => c.packId) };
  }
  if (candidates.length === 0) {
    return { packId: null, confidence: 'low', evidence, candidates: [] };
  }
  const top = candidates[0];
  const runnerUp = candidates[1]?.score ?? 0;
  const confidence = top.score >= 100 && top.score - runnerUp >= 40 ? 'high'
    : top.score - runnerUp >= 20 ? 'medium' : 'low';
  return { packId: top.packId, confidence, evidence, candidates };
}

function detectGameEngineDeps(root, extra) {
  const deps = extra.deps ?? readPackageDeps(root);
  if (!deps) return false;
  return Object.keys(deps).some((d) => GAME_ENGINE_DEPS.includes(d.toLowerCase()));
}

function readPackageDeps(root) {
  const file = path.join(root, 'package.json');
  if (!isFile(file)) return null;
  // 必须走 readJsonSafe：package.json 常由 Windows 工具（记事本、部分脚手架）写成带 BOM 的形式，
  // 直接 JSON.parse 会抛错，导致"含游戏引擎依赖"这一信号被静默丢弃（真实缺陷）。
  const pkg = readJsonSafe(file, null);
  if (!pkg || typeof pkg !== 'object') return null;
  return { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
}

/** 建议的项目名（用于 --name）：取项目里最能代表它的标识。 */
export function suggestProjectName(root, fileList = []) {
  const uproject = fileList.find((f) => f.endsWith('.uproject'));
  if (uproject) return path.basename(uproject, '.uproject');
  const sln = fileList.find((f) => f.endsWith('.sln'));
  if (sln) return path.basename(sln, '.sln');
  const pkgFile = path.join(root, 'package.json');
  if (fileList.includes('package.json') && isFile(pkgFile)) {
    const parsed = readJsonSafe(pkgFile, null);
    if (parsed?.name) return String(parsed.name).replace(/^@[^/]+\//, '');
  }
  return path.basename(path.resolve(root));
}

/** 建议的引擎版本（UE：读 .uproject 的 EngineAssociation）。 */
export function suggestEngineVersion(root, fileList = []) {
  const uproject = fileList.find((f) => f.endsWith('.uproject'));
  if (!uproject) return null;
  const abs = path.join(root, uproject);
  if (!isFile(abs)) return null;
  const data = readJsonSafe(abs, null);
  if (data?.EngineAssociation) return { key: 'ueVersion', value: String(data.EngineAssociation) };
  return null;
}

export { exists, stripBom };
