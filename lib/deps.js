/**
 * 依赖兜底加载器
 *
 * 目标：让这套脚本在青龙里「装了依赖用真依赖，没装也能跑」。
 *
 *   axios  → 缺失时用内置 http/https 实现的同名 shim
 *   pako   → 缺失时用内置 zlib 实现的同名 shim（api 仅歌词解码用到）
 *
 * 实现方式：包一层 Module._resolveFilename，仅在上述两个包解析失败时
 * 把请求重定向到本地 shim，不影响其它任何模块。
 */

const Module = require('node:module');
const path = require('node:path');

const FALLBACKS = {
  axios: 'stub-axios.js',
  pako: 'stub-pako.js',
};

let installed = false;

function installFallbacks() {
  if (installed) return;
  installed = true;

  const original = Module._resolveFilename;

  Module._resolveFilename = function (request, parent, isMain, options) {
    const fallback = FALLBACKS[request];
    if (!fallback) {
      return original.call(this, request, parent, isMain, options);
    }
    try {
      return original.call(this, request, parent, isMain, options);
    } catch (e) {
      // 真实依赖不存在 → 使用内置实现的同名 shim
      return path.join(__dirname, fallback);
    }
  };
}

/**
 * 尝试加载可选依赖，失败返回 null（不抛错）
 * @param {string} id 模块名或路径
 */
function tryRequire(id) {
  try {
    return require(id);
  } catch (e) {
    return null;
  }
}

/**
 * 加载可选依赖，依次尝试多个候选路径
 * @param {string[]} candidates
 */
function tryRequireAny(candidates) {
  for (const id of candidates) {
    const mod = tryRequire(id);
    if (mod) return mod;
  }
  return null;
}

// 本模块被 require 时即自动生效，避免调用方忘记执行导致解析到不存在的依赖
installFallbacks();

module.exports = { installFallbacks, tryRequire, tryRequireAny };
