/**
 * 通知渠道测试（离线，零依赖）
 *
 * 三个回归点（自 ScriptCat 版回移）：
 *   1. 云湖旧接口（www.yhchat.com）已失效，必须走官方开放接口
 *      chat-go.jwzhd.com，且成功码 code:1 不能被当成失败。
 *   2. 推送前要打印「已装载渠道」清单（只列名不列密钥），
 *      空渠道时给出提示，方便区分「没配置」和「发送失败」。
 *   3. 多渠道同时配置时各用各的 key，单渠道失败不影响其它渠道，
 *      且失败日志里保留渠道名。
 *
 * 通过替身 rawRequest 拦截全部出网请求，不发真实请求。
 */

const assert = require('node:assert');

/* 先替换 http 模块的 rawRequest，再加载 notify（加载时解构拿到的是替身） */
const httpPath = require.resolve('../lib/http');
const httpMod = require(httpPath);
const requests = [];
let respondWith = () => ({ status: 200, headers: {}, text: '{}' });
httpMod.rawRequest = async (opts) => {
  requests.push(opts);
  return respondWith(opts);
};

const { sendNotify } = require('../lib/notify');

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

const ENV_KEYS = [
  'KG_NOTIFY', 'YUNHU_BOT_TOKEN', 'YUNHU_BOT_KEY', 'YUNHU_RECV_ID', 'YUNHU_RECV_TYPE',
  'WECOM_BOT_KEY', 'DINGTALK_BOT_KEY', 'DINGTALK_SECRET', 'FEISHU_BOT_KEY',
  'SERVERCHAN_SENDKEY', 'PUSHPLUS_TOKEN', 'PUSHPLUS_TOPIC',
  'TG_BOT_TOKEN', 'TG_CHAT_ID', 'BARK_KEY', 'BARK_GROUP', 'DISCORD_WEBHOOK',
  'MAIL_HOST', 'MAIL_PORT', 'MAIL_USER', 'MAIL_PASS', 'MAIL_TO',
];

function withEnv(env, fn) {
  const saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  Object.assign(process.env, env);
  requests.length = 0;
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => { logs.push(args.join(' ')); };
  return Promise.resolve()
    .then(fn)
    .then(
      (r) => {
        console.log = origLog;
        for (const k of ENV_KEYS) {
          if (saved[k] === undefined) delete process.env[k];
          else process.env[k] = saved[k];
        }
        return { logs, result: r };
      },
      (e) => {
        console.log = origLog;
        for (const k of ENV_KEYS) {
          if (saved[k] === undefined) delete process.env[k];
          else process.env[k] = saved[k];
        }
        throw e;
      }
    );
}

(async function main() {
  console.log('通知渠道测试\n');

  /* ---------- 1. 云湖成功码语义 ---------- */

  console.log('1) 云湖：code:1 是成功语义');
  {
    respondWith = () => ({ status: 200, headers: {}, text: '{"code":1,"msg":"success"}' });
    const { logs } = await withEnv(
      { KG_NOTIFY: 'custom', YUNHU_BOT_TOKEN: 'tok-1', YUNHU_RECV_ID: '42' },
      () => sendNotify('标题', '正文')
    );
    check('code:1 判为发送成功', logs.some((l) => /✓ 云湖 发送成功/.test(l)), true);
    const req = requests.find((r) => /jwzhd/.test(r.url));
    checkTrue('走的是官方开放接口 chat-go.jwzhd.com', req && /chat-go\.jwzhd\.com\/open-apis\/v1\/bot\/send/.test(req.url));
    checkTrue('token 拼在 URL 上', req && /token=tok-1/.test(req.url));
    const body = req ? JSON.parse(req.body) : {};
    check('接收方 ID 写进请求体', body.recvId, '42');
    check('接收方类型默认 user', body.recvType, 'user');
    check('正文含标题与内容', body.content && /标题/.test(body.content.text) && /正文/.test(body.content.text), true);
  }

  {
    respondWith = () => ({ status: 200, headers: {}, text: '{"code":0,"msg":"ok"}' });
    const { logs } = await withEnv(
      { KG_NOTIFY: 'custom', YUNHU_BOT_TOKEN: 'tok-1', YUNHU_RECV_ID: '42' },
      () => sendNotify('t', 'c')
    );
    check('code:0 同样判为成功', logs.some((l) => /✓ 云湖 发送成功/.test(l)), true);
  }

  {
    respondWith = () => ({ status: 200, headers: {}, text: '{"code":2,"msg":"无效的 token"}' });
    const { logs } = await withEnv(
      { KG_NOTIFY: 'custom', YUNHU_BOT_TOKEN: 'tok-1', YUNHU_RECV_ID: '42' },
      () => sendNotify('t', 'c')
    );
    check('其它 code 判为失败', logs.some((l) => /✗ 云湖 发送失败/.test(l)), true);
    checkTrue('失败原因带上服务端 msg', logs.some((l) => /无效的 token/.test(l)));
  }

  {
    respondWith = () => ({ status: 200, headers: {}, text: '{"code":1,"msg":"success"}' });
    const { logs } = await withEnv(
      { KG_NOTIFY: 'custom', YUNHU_BOT_TOKEN: 'tok-1', YUNHU_RECV_ID: '42', YUNHU_RECV_TYPE: 'group' },
      () => sendNotify('t', 'c')
    );
    const req = requests.find((r) => /jwzhd/.test(r.url));
    const body = req ? JSON.parse(req.body) : {};
    check('接收方类型可指定 group', body.recvType, 'group');
  }

  {
    const { logs } = await withEnv(
      { KG_NOTIFY: 'custom', YUNHU_BOT_TOKEN: 'tok-1' },
      () => sendNotify('t', 'c')
    );
    checkTrue('缺接收方 ID 时报可读错误', logs.some((l) => /✗ 云湖 发送失败/.test(l) && /YUNHU_RECV_ID/.test(l)));
    check('缺接收方 ID 时不发请求', requests.length, 0);
  }

  {
    respondWith = () => ({ status: 200, headers: {}, text: '{"code":1,"msg":"success"}' });
    const { logs } = await withEnv(
      { KG_NOTIFY: 'custom', YUNHU_BOT_KEY: 'legacy-key', YUNHU_RECV_ID: '42' },
      () => sendNotify('t', 'c')
    );
    checkTrue('旧变量名 YUNHU_BOT_KEY 仍可用', logs.some((l) => /✓ 云湖 发送成功/.test(l)));
  }

  /* ---------- 2. 已装载渠道清单 ---------- */

  console.log('\n2) 已装载渠道清单');
  {
    respondWith = () => ({ status: 200, headers: {}, text: '{"errcode":0}' });
    const { logs } = await withEnv({ KG_NOTIFY: 'custom', WECOM_BOT_KEY: 'k1' }, () => sendNotify('t', 'c'));
    checkTrue('配置了渠道时列出渠道名', logs.some((l) => /已装载渠道：企业微信/.test(l)));
    checkTrue('清单里不出现密钥', !logs.some((l) => /k1/.test(l)));
  }
  {
    const { logs } = await withEnv({ KG_NOTIFY: 'custom' }, () => sendNotify('t', 'c'));
    checkTrue('没配渠道时显示（无）', logs.some((l) => /已装载渠道：（无）/.test(l)));
    checkTrue('没配渠道时给出配置提示', logs.some((l) => /环境变量里填写并保存/.test(l)));
  }

  /* ---------- 3. 渠道 key 不串号、单渠道失败不影响其它 ---------- */

  console.log('\n3) 多渠道隔离');
  {
    respondWith = (opts) => {
      if (/qyapi\.weixin/.test(opts.url)) return { status: 200, headers: {}, text: '{"errcode":1,"errmsg":"bad key"}' };
      return { status: 200, headers: {}, text: 'ok' };
    };
    const { logs } = await withEnv(
      { KG_NOTIFY: 'custom', WECOM_BOT_KEY: 'wecom-key-1', BARK_KEY: 'bark-key-2' },
      () => sendNotify('t', 'c')
    );
    const wecomReq = requests.find((r) => /qyapi\.weixin/.test(r.url));
    const barkReq = requests.find((r) => /day\.app/.test(r.url));
    checkTrue('企业微信请求带着自己的 key', wecomReq && wecomReq.url.includes('wecom-key-1'));
    checkTrue('Bark 请求带着自己的 key', barkReq && barkReq.url.includes('bark-key-2'));
    checkTrue('失败渠道保留渠道名', logs.some((l) => /✗ 企业微信 发送失败/.test(l)));
    checkTrue('失败渠道带服务端原因', logs.some((l) => /bad key/.test(l)));
    checkTrue('另一个渠道不受影响', logs.some((l) => /✓ Bark 发送成功/.test(l)));
    checkTrue('两个渠道都尝试发送', requests.length >= 2);
  }

  {
    respondWith = () => ({ status: 200, headers: {}, text: '{"errcode":0}' });
    const { logs } = await withEnv(
      {
        KG_NOTIFY: 'custom',
        WECOM_BOT_KEY: 'a1', FEISHU_BOT_KEY: 'a2', DISCORD_WEBHOOK: 'https://discord.example/hook-a3',
      },
      () => sendNotify('t', 'c')
    );
    const wecomReq = requests.find((r) => /qyapi\.weixin/.test(r.url));
    const feishuReq = requests.find((r) => /feishu/.test(r.url));
    const discordReq = requests.find((r) => /discord\.example/.test(r.url));
    check('企业微信用自己的 key', wecomReq && wecomReq.url.includes('a1'), true);
    check('飞书用自己的 key', feishuReq && feishuReq.url.includes('a2'), true);
    check('Discord 用自己的 webhook', discordReq && discordReq.url.includes('hook-a3'), true);
  }

  /* ---------- 4. 其余渠道的基础形状 ---------- */

  console.log('\n4) 其余渠道');
  {
    respondWith = () => ({ status: 200, headers: {}, text: '{"errcode":0}' });
    const { logs } = await withEnv({ KG_NOTIFY: 'custom', DINGTALK_BOT_KEY: 'dk' }, () => sendNotify('t', 'c'));
    const req = requests.find((r) => /dingtalk/.test(r.url));
    checkTrue('钉钉走 oapi 地址', req && /oapi\.dingtalk\.com/.test(req.url));
    checkTrue('钉钉发送成功', logs.some((l) => /✓ 钉钉 发送成功/.test(l)));
  }
  {
    respondWith = () => ({ status: 200, headers: {}, text: '{"ok":false,"description":"chat not found"}' });
    const { logs } = await withEnv(
      { KG_NOTIFY: 'custom', TG_BOT_TOKEN: 'tt', TG_CHAT_ID: '9' },
      () => sendNotify('t', 'c')
    );
    checkTrue('Telegram 失败带上 description', logs.some((l) => /✗ Telegram 发送失败/.test(l) && /chat not found/.test(l)));
  }

  console.log(`\n通知渠道：${pass} 项通过，${fail} 项失败`);
  if (fail) process.exitCode = 1;
})().catch((e) => {
  console.error('测试异常：', (e && e.message) || e);
  process.exitCode = 1;
});
