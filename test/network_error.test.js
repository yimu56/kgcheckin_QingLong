/**
 * 网络错误回归测试（离线，零依赖）
 *
 * 1.1.2 的只读接口重试曾失效：api/util/request.js 把网络错误也
 * reject 成「带 body 的 answer」，lib/kgapi.js 的 callOnce 一律
 * return e.body，于是 call() 的 catch 永远进不去，签到脚本还会把
 * read ECONNRESET 误判成「token 过期或账号不存在」。
 *
 * 与 api_retry.test.js 不同：这里不替换 createRequest，而是替换最底层的
 * axios，让 request.js → kgapi.call → 重试层整条真实链路都跑到。
 */

const assert = require('node:assert');
const Module = require('node:module');

let mode = 'network';
let attempts = 0;
let lastConfig = null;

const fakeAxios = async (config) => {
  attempts++;
  lastConfig = config;
  if (mode === 'network' || (mode === 'recover' && attempts <= 2)) {
    const err = new Error('read ECONNRESET');
    err.code = 'ECONNRESET';
    throw err;
  }
  if (mode === 'business') {
    return { data: { status: 0, error_code: 30002, msg: '次数已用光' }, headers: {} };
  }
  return { data: { status: 1, data: { nickname: '测试' } }, headers: {} };
};

// 必须在 require lib/kgapi 之前接管 axios 解析
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'axios') return fakeAxios;
  return originalLoad.apply(this, arguments);
};

const { call } = require('../lib/kgapi');

let pass = 0;
let fail = 0;

function check(name, actual, expected) {
  try {
    assert.strictEqual(actual, expected);
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    fail++;
    console.log(`  ✗ ${name}\n      期望 ${JSON.stringify(expected)}\n      实际 ${JSON.stringify(actual)}`);
  }
}

function checkTrue(name, cond) {
  check(name, Boolean(cond), true);
}

const cookie = { token: 't', userid: '1' };

async function main() {
  console.log('网络错误回归测试（穿透真实 createRequest）\n');

  /* ---------- 1. 网络错误必须抛出并触发重试 ---------- */

  console.log('1) 网络错误不再被当成业务结果');
  {
    mode = 'network';
    attempts = 0;
    let err = null;
    try {
      await call('user_detail', { cookie });
    } catch (e) {
      err = e;
    }
    check('只读接口重试满 3 次', attempts, 3);
    checkTrue('抛出的是网络错误', err && err.networkError);
    check('错误码可读', err && err.code, 'ECONNRESET');
    checkTrue('错误信息含 ECONNRESET', /ECONNRESET/.test(String(err && err.message)));
    checkTrue('不再返回 {status:0} 伪装的业务结果', Boolean(err));
    check('真实 axios 也带 15s 超时', lastConfig && lastConfig.timeout, 15000);
  }

  /* ---------- 2. 领取类接口不重试 ---------- */

  console.log('\n2) 领取类接口不重试');
  {
    mode = 'network';
    attempts = 0;
    let err = null;
    try {
      await call('youth_vip', { cookie });
    } catch (e) {
      err = e;
    }
    check('只请求 1 次', attempts, 1);
    checkTrue('错误照常抛出', Boolean(err));
  }

  /* ---------- 3. 业务失败不重试、body 原样交回 ---------- */

  console.log('\n3) 业务失败保持原样');
  {
    mode = 'business';
    attempts = 0;
    const body = await call('user_detail', { cookie });
    check('只请求 1 次', attempts, 1);
    check('error_code 原样交回', body.error_code, 30002);
    check('业务 body 没有网络错误标记', body.networkError, undefined);
  }

  /* ---------- 4. 抖动后恢复 ---------- */

  console.log('\n4) 网络抖动后恢复');
  {
    mode = 'recover';
    attempts = 0;
    const body = await call('user_detail', { cookie });
    check('第三次成功返回正常结果', body.status, 1);
    check('一共请求 3 次', attempts, 3);
  }

  console.log(`\n网络错误回归：${pass} 项通过，${fail} 项失败`);
  if (fail) process.exitCode = 1;
}

main().catch((e) => {
  console.error('测试异常：', (e && e.message) || e);
  process.exitCode = 1;
});
