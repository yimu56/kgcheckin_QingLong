/**
 * 酷狗 API 直连封装
 *
 * 与 GitHub Actions 版的区别：那版会在本机 3000 端口起一个 Express 服务，
 * 再用 HTTP 请求它；青龙里常驻端口既麻烦又容易冲突，
 * 这里直接在同进程内调用 api/module 下的模块（KuGouMusicApi 原生写法），
 * 不需要起服务、不需要占用端口。
 */

const path = require('node:path');
const fs = require('node:fs');

const { installFallbacks } = require('./deps');
installFallbacks();

const API_DIR = path.resolve(__dirname, '..', 'api');

// api 目录缺失时给出明确提示，避免变成看不懂的 MODULE_NOT_FOUND
if (!fs.existsSync(path.join(API_DIR, 'util', 'request.js'))) {
  throw new Error(
    `未找到酷狗接口目录：${API_DIR}\n请确认仓库完整拉取（api/ 目录不能缺失），删掉任务重新拉一次库即可。`
  );
}

const { createRequest } = require(path.join(API_DIR, 'util', 'request.js'));

/**
 * 只读接口：网络抖动时重试是安全的。
 * 领取类接口（听歌 / 看广告 / 发短信 / 刷新 token）一律不重试——
 * 请求可能已经到达服务端，重试会重复领取、重复发短信或让 token 互相顶掉。
 */
const RETRYABLE_APIS = new Set(['user_detail', 'user_vip_detail', 'login_qr_key', 'login_qr_check']);
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 1000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callOnce(name, params) {
  const modulePath = path.join(API_DIR, 'module', `${name}.js`);
  const mod = require(modulePath);

  try {
    const res = await mod(params, createRequest);
    return (res && res.body) || {};
  } catch (e) {
    // KuGouMusicApi 在业务失败（status=0 / error_code≠0 / HTTP 4xx）时会 reject，
    // 与原版一样把 body 当作结果返回，由调用方根据 status/error_code 判断。
    if (e && e.body) return e.body;
    throw e;
  }
}

/**
 * 调用 api/module 下的某个接口
 * @param {string} name 模块文件名（不含 .js），如 'youth_vip'
 * @param {object} [params] 传给模块的参数，通常只需 { cookie: { token, userid } }
 * @returns {Promise<object>} 业务响应体（原 HTTP 版拿到的 body）
 */
async function call(name, params = {}) {
  const attempts = RETRYABLE_APIS.has(name) ? MAX_ATTEMPTS : 1;
  let lastError;

  for (let i = 1; i <= attempts; i++) {
    try {
      return await callOnce(name, params);
    } catch (e) {
      lastError = e;
      if (i < attempts) {
        const wait = RETRY_BASE_MS * Math.pow(2, i - 1);
        console.log(`[网络] ${name} 第 ${i} 次请求失败，${wait}ms 后重试：${(e && e.message) || e}`);
        await delay(wait);
      }
    }
  }

  throw lastError;
}

/** 构造模块需要的 cookie 对象 */
function cookieOf(user) {
  return { token: String(user.token || ''), userid: String(user.userid || '') };
}

module.exports = { call, cookieOf, API_DIR, RETRYABLE_APIS };
