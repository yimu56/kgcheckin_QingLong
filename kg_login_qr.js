/**
 * 酷狗扫码登录（青龙面板版）
 *
 * 运行后会：
 *   1. 在日志里打印二维码（需青龙已安装 qrcode 依赖，否则只打印链接）
 *   2. 轮询等待扫码确认（默认 150 秒）
 *   3. 登录成功后写入青龙环境变量 USERINFO（或本地快照）
 *
 * 环境变量：
 *   KG_APPEND        是否追加到已有账号列表，默认 是
 *   KG_QR_TIMEOUT    等待扫码的秒数，默认 150
 *   QL_CLIENT_ID / QL_CLIENT_SECRET   可选，用于自动回写青龙环境变量
 */

const { call } = require('./lib/kgapi');
const { readUserInfo, saveUserInfo } = require('./lib/qlenv');
const { maskIdentifier, errorTextOf, summarizeResponse } = require('./lib/safelog');
const { tryRequireAny } = require('./lib/deps');

const QRCode = tryRequireAny([
  'qrcode',
  '../api/node_modules/qrcode',
  '../node_modules/qrcode',
  '/ql/scripts/node_modules/qrcode',
]);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function intEnv(name, fallback) {
  const raw = process.env[name];
  const n = Number(raw);
  return raw !== undefined && raw !== '' && !Number.isNaN(n) ? n : fallback;
}

function upsert(users, loginUser, append) {
  if (append) {
    for (const u of users) {
      if (String(u.userid) === String(loginUser.userid)) {
        console.log(`[信息] userid ${maskIdentifier(u.userid)} 已存在，仅更新登录信息`);
        u.token = loginUser.token;
        return users;
      }
    }
  }
  users.push({ userid: String(loginUser.userid), token: String(loginUser.token) });
  return users;
}

async function main() {
  const timeoutSec = intEnv('KG_QR_TIMEOUT', 150);
  const append = String(process.env.KG_APPEND || '是').trim() !== '否';
  const { users } = readUserInfo();
  const list = append ? users.slice() : [];

  const keyResp = await call('login_qr_key', { cookie: {} });
  if (keyResp?.status !== 1 || !keyResp?.data?.qrcode) {
    const hint = errorTextOf(keyResp);
    console.log(`[失败] 获取二维码失败：${JSON.stringify(summarizeResponse(keyResp))}`);
    throw new Error(`获取二维码密钥失败${hint ? `：${hint}` : ''}`);
  }

  const qrcode = keyResp.data.qrcode;
  const url = `https://h5.kugou.com/apps/loginQRCode/html/index.html?qrcode=${qrcode}`;

  console.log('\n================ 酷狗扫码登录 ================');
  console.log('请使用「酷狗音乐 APP」扫描下方二维码并确认登录\n');

  if (QRCode) {
    const ascii = await QRCode.toString(url, { type: 'terminal', small: true });
    console.log(ascii);
  } else {
    console.log('[警告] 未安装 qrcode 依赖，无法在日志里画二维码');
    console.log('[提示] 青龙「依赖管理 → NodeJs」添加 qrcode 后重新运行即可看到二维码');
  }

  console.log(`\n扫码链接：${url}`);
  console.log(`\n等待扫码确认（最多 ${timeoutSec} 秒）...\n`);

  const deadline = Date.now() + timeoutSec * 1000;
  let loggedIn = false;
  let expired = false;
  let round = 0;

  while (Date.now() < deadline) {
    round++;
    const res = await call('login_qr_check', { cookie: {}, key: qrcode });
    const status = res?.data?.status;

    if (status === 4) {
      upsert(list, { userid: res.data.userid, token: res.data.token }, append);
      loggedIn = true;
      console.log('[成功] 登录成功！');
      break;
    }
    if (status === 0) {
      console.log('[失败] 二维码已过期，请重新运行本脚本');
      expired = true;
      break;
    }
    if (status === 2) {
      console.log('[信息] 已扫码，等待 APP 上点击确认...');
    }
    // 前 10 轮 3 秒问一次（尽快响应扫码），之后放慢到 5 秒，减少无意义的轮询
    await delay(round <= 10 ? 3000 : 5000);
  }

  if (!loggedIn && !expired) {
    throw new Error('等待扫码超时，请重新运行本脚本');
  }

  if (loggedIn) {
    const result = await saveUserInfo(list);
    if (result.api) {
      console.log('[成功] 已写入青龙环境变量 USERINFO');
    } else {
      console.log('[成功] 已写入本地快照 qinglong/userinfo.json（签到脚本会自动读取）');
      console.log('[提示] 如需写入面板环境变量，请配置 QL_CLIENT_ID / QL_CLIENT_SECRET');
      console.log(`[提示] 也可手动把下面内容填到环境变量 USERINFO：\n${JSON.stringify(list)}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
