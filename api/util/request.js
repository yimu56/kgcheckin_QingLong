const axios = require('axios');
const { cryptoMd5 } = require('./crypto');
const { signKey, signatureAndroidParams, signatureRegisterParams, signatureWebParams } = require('./helper');
const { parseCookieString } = require('./util');
const { appid, clientver, liteAppid, liteClientver } = require('./config');
const { resolveProxy } = require('./runtime');

/**
 * @typedef {{status: number;body: any, cookie: string[], headers?: Record<string, string>}} UseAxiosResponse
 */

/**
 * 请求创建
 * @param {Object} options
 * @param {'get' | 'GET' | 'post' | 'POST'} options.method 请求方法
 * @param {string} options.url 请求 url
 * @param {string?} options.baseURL
 * @param {Record<string, any>?} options.params 请求参数
 * @param {Record<string, any>?} options.data 请求Body
 * @param {Record<string, string | number>?} options.headers 请求headers
 * @param {'android' | 'web' | 'register'} options.encryptType signature加密方式
 * @param {{ [key: string]: string | number }} options.cookie 请求cookie
 * @param {boolean?} options.encryptKey
 * @param {boolean?} options.clearDefaultParams 清除默认请求参数
 * @param {boolean?} options.notSignature
 * @param {string?} options.ip
 * @param {string?} options.realIP
 * @returns {Promise<UseAxiosResponse>}
 */

const createRequest = (options) => {
  return new Promise(async (resolve, reject) => {
    const isLite = process.env.platform === 'lite';
    const dfid = options?.cookie?.dfid || '-'; // 自定义
    const mid = `${cryptoMd5(dfid)}${cryptoMd5(dfid).slice(0, 7)}`; // 可以自定义
    const uuid = cryptoMd5(`${dfid}${mid}`); // 可以自定义
    const token = options?.cookie?.token || '';
    const userid = options?.cookie?.userid || 0;
    const clienttime = Math.floor(Date.now() / 1000);
    const ip = options?.realIP || options?.ip || '';
    const headers = { dfid, clienttime, mid };

    if (ip) {
      headers['X-Real-IP'] = ip;
      headers['X-Forwarded-For'] = ip;
    }

    const defaultParams = {
      dfid,
      mid,
      uuid,
      appid: isLite ? liteAppid : appid,
      // apiver: apiver,
      clientver: isLite ? liteClientver : clientver,
      userid,
      clienttime,
    };

    if (token) defaultParams['token'] = token;
    const params = options?.clearDefaultParams ? options?.params || {} : Object.assign({}, defaultParams, options?.params || {});

    headers['clienttime'] = params.clienttime;

    if (options?.encryptKey) {
      params['key'] = signKey(params['hash'], params['mid'], params['userid'], params['appid']);
    }

    const data = typeof options?.data === 'object' ? JSON.stringify(options.data) : options?.data || '';

    if (!params['signature'] && !options.notSignature) {
      switch (options?.encryptType) {
        case 'register':
          params['signature'] = signatureRegisterParams(params);
          break;
        case 'web':
          params['signature'] = signatureWebParams(params);
          break;
        case 'android':
        default:
          params['signature'] = signatureAndroidParams(params, data);
          break;
      }
    }

    // options.params = params;
    options['params'] = params;
    options['baseURL'] = options?.baseURL || 'https://gateway.kugou.com';
    options['headers'] = Object.assign({ 'User-Agent': 'Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi' }, options?.headers || {}, {
      dfid,
      clienttime: params.clienttime,
      mid,
    });

    const requestOptions = {
      params,
      data: options?.data,
      method: options.method,
      baseURL: options?.baseURL,
      url: options.url,
      headers: Object.assign({}, options?.headers || {}, headers),
      withCredentials: true,
      responseType: options.responseType,
      // 装了真 axios 时也必须有限时；内置的 axios shim 自带 15s 超时，
      // 这里不传 timeout 会让真实 axios 无限挂起，青龙任务可能一直卡着不退出。
      timeout: 15000,
    };

    const proxyConfig = resolveProxy();
    if (proxyConfig) {
      requestOptions.proxy = proxyConfig;
    }

    if (options.data) requestOptions.data = options.data;
    if (params) requestOptions.params = params;

    if (options.baseURL?.includes('openapicdn')) {
      const url = requestOptions.url;
      const _params = Object.keys(params)
        .map((key) => `${key}=${params[key]}`)
        .join('&');
      requestOptions.url = `${url}?${_params}`;
      requestOptions.params = {};
    }

    const answer = { status: 500, body: {}, cookie: [], headers: {} };
    try {
      const response = await axios(requestOptions);

      const body = response.data;

      answer.cookie = (response.headers['set-cookie'] || []).map((x) => parseCookieString(x));

      if (response.headers['ssa-code']) {
        answer.headers['ssa-code'] = response.headers['ssa-code'];
      }

      try {
        answer.body = JSON.parse(body.toString());
      } catch (error) {
        answer.body = body;
      }

      if (response.data?.status === 0 || (response.data?.error_code && response.data.error_code !== 0)) {
        answer.status = 502;
        answer.networkError = false; // 服务端明确返回的业务失败，body 可原样交给上层判断
        reject(answer);
      } else {
        answer.status = 200;
        resolve(answer);
      }
    } catch (e) {
      // 网络错误 / HTTP 4xx / 超时会走到这里。必须打上标记：
      // 否则上层 lib/kgapi.js 会把这个「错误摘要」当成正常业务响应返回，
      // 既不触发重试，又会让签到脚本把 ECONNRESET 误判成 token 过期。
      const responseBody = e?.response?.data;
      const responseSummary = responseBody && typeof responseBody === 'object'
        ? {
            status: responseBody.status,
            code: responseBody.code,
            error_code: responseBody.error_code,
            errcode: responseBody.errcode,
            msg: responseBody.msg || responseBody.message || responseBody.error,
          }
        : {};
      answer.status = 502;
      answer.networkError = true;
      answer.body = {
        status: 0,
        msg: responseSummary.msg || e?.message || 'request failed',
        code: e?.code,
        httpStatus: e?.response?.status,
        ...responseSummary,
      };
      reject(answer);
    }
  });
};

module.exports = { createRequest };
