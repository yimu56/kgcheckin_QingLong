/**
 * 网络重试测试（离线，零依赖）
 *
 * 原项目（Actions 版）在请求层做了失败重试；移植版之前一次网络抖动就把
 * 整个账号判成失败。现在对「只读接口」加 3 次退避重试，领取类接口保持不重试
 * （请求可能已到达服务端，重试会重复领取 / 重复发短信）。
 *
 * 通过替换 api/util/request.js 的 createRequest 拦截全部请求，不发真实流量。
 */

const assert = require('node:assert');
const path = require('node:path');

const reqPath = require.resolve('../api/util/request.js');
let mode = 'ok';
let calls = 0;

const fakeCreateRequest = async () => {
  calls++;
  if (mode === 'fail2' && calls <= 2) throw new Error('socket hang up');
  if (mode === 'always') throw new Error('socket hang up');
  if (mode === 'biz') throw { body: { status: 0, error_code: 30002, error: '次数已用光' } };
  return {
    status: 200,
    body: { status: 1, data: { nickname: '测试', userid: 1, busi_vip: [] } },
    cookie: [],
    headers: {},
  };
};

// 必须在加载 lib/kgapi 之前替换：kgapi 在 require 时解构了 createRequest
require.cache[reqPath] = {
  id: reqPath,
  filename: reqPath,
  loaded: true,
  exports: { createRequest: fakeCreateRequest },
};

const { call, RETRYABLE_APIS } = require('../lib/kgapi');

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

async function main() {
  console.log('网络重试测试\n');

  /* ---------- 1. 只读接口失败后重试并成功 ---------- */

  console.log('1) 只读接口重试');
  {
    mode = 'fail2';
    calls = 0;
    const body = await call('user_detail', { cookie: { token: 't', userid: 1 } });
    check('前两次网络失败、第三次成功', body.status, 1);
    check('一共请求了 3 次', calls, 3);
  }

  /* ---------- 2. 领取类接口不重试 ---------- */

  console.log('\n2) 领取类接口不重试');
  {
    mode = 'always';
    calls = 0;
    let error = null;
    try {
      await call('youth_vip', { cookie: { token: 't', userid: 1 } });
    } catch (e) {
      error = e;
    }
    check('网络失败只有 1 次请求', calls, 1);
    check('错误照常抛出', Boolean(error), true);
  }

  /* ---------- 3. 业务失败不重试 ---------- */

  console.log('\n3) 业务失败不重试');
  {
    mode = 'biz';
    calls = 0;
    const body = await call('user_detail', { cookie: { token: 't', userid: 1 } });
    check('只请求 1 次', calls, 1);
    check('业务错误码原样交回', body.error_code, 30002);
  }

  /* ---------- 4. 重试用尽 ---------- */

  console.log('\n4) 重试用尽');
  {
    mode = 'always';
    calls = 0;
    let error = null;
    try {
      await call('login_qr_check', { cookie: {}, key: 'k' });
    } catch (e) {
      error = e;
    }
    check('只读接口试满 3 次', calls, 3);
    check('最终把错误抛出', /socket hang up/.test(String(error && error.message)), true);
  }

  /* ---------- 5. 重试名单 ---------- */

  console.log('\n5) 重试名单');
  check('user_detail 在名单里', RETRYABLE_APIS.has('user_detail'), true);
  check('user_vip_detail 在名单里', RETRYABLE_APIS.has('user_vip_detail'), true);
  check('login_qr_key 在名单里', RETRYABLE_APIS.has('login_qr_key'), true);
  check('login_qr_check 在名单里', RETRYABLE_APIS.has('login_qr_check'), true);
  check('youth_vip 不在名单里', RETRYABLE_APIS.has('youth_vip'), false);
  check('youth_listen_song 不在名单里', RETRYABLE_APIS.has('youth_listen_song'), false);
  check('captcha_sent 不在名单里', RETRYABLE_APIS.has('captcha_sent'), false);

  console.log(`\n网络重试：${pass} 项通过，${fail} 项失败`);
  if (fail) process.exitCode = 1;
}

main().catch((e) => {
  console.error('测试异常：', (e && e.message) || e);
  process.exitCode = 1;
});
