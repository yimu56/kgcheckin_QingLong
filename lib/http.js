/**
 * 零依赖 HTTP 客户端（基于 Node 内置 http/https）
 *
 * 青龙容器里的 Node 版本可能是 16/18/20，全局 fetch 不保证存在，
 * 因此统一用内置模块实现，避免在低版本 Node 上直接崩溃。
 */

const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');

const DEFAULT_TIMEOUT = 15000;

/**
 * 发起一次 HTTP(S) 请求
 * @param {object} options
 * @param {string} options.url 完整 URL
 * @param {string} [options.method] 请求方法
 * @param {Record<string, string|number>} [options.headers] 请求头
 * @param {string|Buffer|null} [options.body] 请求体（已序列化）
 * @param {number} [options.timeout] 超时毫秒
 * @returns {Promise<{status: number, headers: Record<string, any>, text: string}>}
 */
function rawRequest(options) {
  const { url, method = 'GET', headers = {}, body = null, timeout = DEFAULT_TIMEOUT } = options || {};

  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch (e) {
      reject(new Error(`非法 URL: ${url}`));
      return;
    }

    const lib = target.protocol === 'https:' ? https : http;
    const req = lib.request(
      target,
      {
        method: String(method).toUpperCase(),
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            headers: res.headers || {},
            text: Buffer.concat(chunks).toString('utf8'),
          });
        });
        res.on('error', reject);
      }
    );

    req.setTimeout(timeout, () => {
      req.destroy(new Error(`请求超时（${timeout}ms）: ${url}`));
    });
    req.on('error', reject);

    if (body !== null && body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}

/** 按响应头猜测并解析 JSON */
function parseBody(text, headers) {
  const contentType = String((headers && headers['content-type']) || '');
  if (contentType.includes('json') || /^\s*[[{]/.test(text)) {
    try {
      return JSON.parse(text);
    } catch (e) {
      return text;
    }
  }
  return text;
}

module.exports = { rawRequest, parseBody, DEFAULT_TIMEOUT };
