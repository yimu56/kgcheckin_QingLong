/**
 * axios 兜底实现（基于 Node 内置 http/https）
 *
 * KuGouMusicApi 底层用 axios 发请求。青龙里如果没装 axios，
 * 就用这个同名实现顶上，保证签到脚本零外部依赖也能跑。
 * 已安装 axios 时优先使用真正的 axios（在 lib/deps.js 里判断）。
 */

const { URL } = require('node:url');
const { rawRequest, parseBody } = require('./http');

function appendParams(target, params) {
  if (!params || typeof params !== 'object') return;
  for (const key of Object.keys(params)) {
    const value = params[key];
    if (value === undefined || value === null) continue;
    if (typeof value === 'object') {
      target.searchParams.append(key, JSON.stringify(value));
    } else {
      target.searchParams.append(key, String(value));
    }
  }
}

/**
 * 模拟 axios(config)
 * @param {object} config axios 风格配置
 * @returns {Promise<{status: number, data: any, headers: Record<string, any>, config: object}>}
 */
async function axiosShim(config) {
  const { baseURL, url = '', params, data, method = 'get', headers = {}, timeout } = config || {};

  const target = baseURL ? new URL(url, baseURL) : new URL(url);
  appendParams(target, params);

  const finalHeaders = { ...headers };
  // Node 的 http 模块不会自动解压，明确要求服务端返回未压缩内容
  finalHeaders['accept-encoding'] = finalHeaders['accept-encoding'] || 'identity';

  let body = null;
  if (data !== undefined && data !== null) {
    if (typeof data === 'object' && !Buffer.isBuffer(data)) {
      body = JSON.stringify(data);
      if (!hasHeader(finalHeaders, 'content-type')) {
        finalHeaders['content-type'] = 'application/json';
      }
    } else {
      body = Buffer.isBuffer(data) ? data : String(data);
    }
  }

  const res = await rawRequest({
    url: target.toString(),
    method,
    headers: finalHeaders,
    body,
    timeout: timeout || 15000,
  });

  const out = {
    status: res.status,
    statusText: '',
    headers: res.headers,
    data: parseBody(res.text, res.headers),
    config: config || {},
  };

  // 对齐 axios 行为：4xx/5xx 抛错，并挂上 response 供业务层读取
  if (res.status >= 400) {
    const err = new Error(`Request failed with status code ${res.status}`);
    err.code = res.status === 404 ? 'ERR_BAD_REQUEST' : 'ERR_BAD_RESPONSE';
    err.response = out;
    throw err;
  }

  return out;
}

function hasHeader(headers, name) {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === lower);
}

axiosShim.request = axiosShim;
axiosShim.get = (url, config) => axiosShim({ ...config, url, method: 'get' });
axiosShim.post = (url, data, config) => axiosShim({ ...config, url, data, method: 'post' });
axiosShim.defaults = { headers: {} };
axiosShim.isAxiosError = (e) => Boolean(e && e.response);

module.exports = axiosShim;
