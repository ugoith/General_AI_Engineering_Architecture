/**
 * 项目事实与能力探测。
 *
 * 动机：新能力（引擎版本、编辑器插件、外部工具）会**改变"什么做法可行"**。
 * 例如 UE 5.8 的 Unreal MCP 让 agent 能在编辑器运行时查询场景/材质/Slate；
 * 5.7 及更早则没有这条路——同一句"不要整读资产"的指导，在两个版本下的正确做法是不同的。
 *
 * 因此把这些事实做成**可查询、可入库、可随探测更新**的数据（`.ai/project-facts.json`），
 * 而不是散落在文档正文里靠人记。
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  isFile, isDir, exists, readJsonSafe, writeJson, walk, normalizeRel, stripBom,
} from './fsx.mjs';

/**
 * 已知能力清单：每条声明"它需要什么"。
 * 探测只看**可确证的事实**（版本号、插件是否启用、配置文件是否存在），不猜。
 */
export const CAPABILITIES = [
  {
    id: 'unreal-mcp',
    label: 'Unreal MCP（编辑器内 MCP 服务器）',
    engines: ['unreal'],
    requires: { minVersion: '5.8', note: 'UE 5.8 起内置于编辑器，状态 Experimental；需同时启用 AllToolsets 插件' },
    enabledBy: [{ type: 'uprojectPlugin', name: 'ModelContextProtocol' }],
    optionalCfg: ['.mcp.json', '.cursor/mcp.json', '.vscode/mcp.json'],
    docs: 'https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-mcp-in-unreal-editor',
    whatItEnables:
      'agent 可在编辑器运行时调用工具：spawn/检查 actor、配置灯光、创建材质实例、检查 Slate 控件、跑自动化测试（工具集由 AllToolsets/ToolsetRegistry 提供，可自写）',
    whatItDoesNot:
      '**不是**读取 .uasset 文件的通道：它驱动编辑器，不提供资产文件的结构化读取；必须编辑器在运行；Experimental，API 可能变；产出不入库。资产的可共享知识仍应写进 .ai/index/asset-index.md',
  },
  {
    id: 'third-party-unreal-mcp',
    label: '第三方 unreal-mcp（含蓝图读取与项目索引）',
    engines: ['unreal'],
    requires: { note: '社区项目，非 Epic 官方；声明支持 UE 5.6/5.8。使用前先写 ADR 评估维护风险' },
    enabledBy: [],
    docs: 'https://github.com/ZiggyMar/unreal-mcp',
    whatItEnables: '宣称提供低 token 的蓝图读取与持久项目索引，可减少人工维护资产索引的工作量',
    whatItDoesNot: '非官方、需评估可持续性；索引产物的可信度与格式由该工具决定，不能替代本项目的资产索引约定',
  },
];

/** 从 .uproject 读取引擎版本与已启用插件。 */
export function readUnrealProject(root, fileList = null) {
  const files = fileList ?? walk(root, {}).files.map((f) => normalizeRel(f));
  const uproject = files.find((f) => f.endsWith('.uproject'));
  if (!uproject) return null;
  const abs = path.join(root, uproject);
  if (!isFile(abs)) return null;
  const data = readJsonSafe(abs, null);
  if (!data) return null;
  const enabled = new Set();
  // Plugins 段里 Enabled 为 true（或未写 Enabled 但有 Name 时按 false 处理，保守）
  for (const p of data.Plugins ?? []) {
    if (p?.Name && p.Enabled === true) enabled.add(String(p.Name));
  }
  // 引擎内置插件也可能通过 .uproject 之外的方式启用，这里只记录可确证的
  return {
    file: uproject,
    engineAssociation: data.EngineAssociation ? String(data.EngineAssociation) : null,
    enabledPlugins: [...enabled].sort(),
    modules: (data.Modules ?? []).map((m) => m.Name).filter(Boolean),
  };
}

/** 比较点分版本号；返回 -1/0/1。无法解析时返回 null。 */
export function compareVersion(a, b) {
  const pa = String(a).match(/\d+(\.\d+)*/);
  const pb = String(b).match(/\d+(\.\d+)*/);
  if (!pa || !pb) return null;
  const na = pa[0].split('.').map(Number);
  const nb = pb[0].split('.').map(Number);
  for (let i = 0; i < Math.max(na.length, nb.length); i += 1) {
    const x = na[i] ?? 0;
    const y = nb[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/** 探测项目事实与可用能力。 */
export function detectFacts(root, { fileList = null } = {}) {
  const unreal = readUnrealProject(root, fileList);
  const facts = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    root: '.',
    engine: null,
    capabilities: [],
  };

  if (unreal) {
    facts.engine = {
      kind: 'unreal',
      version: unreal.engineAssociation,
      uproject: unreal.file,
      enabledPlugins: unreal.enabledPlugins,
      modules: unreal.modules,
    };
  }

  for (const cap of CAPABILITIES) {
    if (facts.engine && !cap.engines.includes(facts.engine.kind)) continue;
    if (!facts.engine) continue;

    const reasons = [];
    let available = true;

    if (cap.requires.minVersion) {
      const cmp = compareVersion(facts.engine.version ?? '0', cap.requires.minVersion);
      if (cmp === null) {
        available = false;
        reasons.push(`无法解析引擎版本 "${facts.engine.version}"，无法确认是否满足 >= ${cap.requires.minVersion}`);
      } else if (cmp < 0) {
        available = false;
        reasons.push(`需要引擎 >= ${cap.requires.minVersion}，本项目为 ${facts.engine.version}`);
      } else {
        reasons.push(`引擎版本满足（>= ${cap.requires.minVersion}）`);
      }
    }

    // 启用条件：任一满足即可（这里只有一个条件类型，先做 uprojectPlugin）
    if (available && Array.isArray(cap.enabledBy) && cap.enabledBy.length > 0) {
      const pluginHit = cap.enabledBy
        .filter((c) => c.type === 'uprojectPlugin')
        .some((c) => facts.engine.enabledPlugins.includes(c.name));
      if (pluginHit) {
        reasons.push('插件已在 .uproject 中启用');
      } else {
        available = false;
        reasons.push(`插件未在 .uproject 中启用（需启用：${cap.enabledBy.map((c) => c.name).join('、')}）`);
      }
    }

    // 配置文件是否已生成（只作提示，不作为可用性判定）
    const cfgFound = (cap.optionalCfg ?? []).filter((f) => exists(path.join(root, f)));

    facts.capabilities.push({
      id: cap.id,
      label: cap.label,
      available,
      reasons,
      requires: cap.requires,
      docs: cap.docs ?? null,
      configPresent: cfgFound,
      whatItEnables: cap.whatItEnables,
      whatItDoesNot: cap.whatItDoesNot,
    });
  }

  return { facts, capabilities: CAPABILITIES };
}

export function loadFacts(root) {
  return readJsonSafe(path.join(root, '.ai', 'project-facts.json'), null);
}

export function saveFacts(root, facts) {
  writeJson(path.join(root, '.ai', 'project-facts.json'), facts);
  return path.join(root, '.ai', 'project-facts.json');
}

/** 项目事实里可用的能力 id。 */
export function availableCapabilityIds(facts) {
  return (facts?.capabilities ?? []).filter((c) => c.available).map((c) => c.id);
}

export { stripBom, isDir };
