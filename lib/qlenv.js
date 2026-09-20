/**
 * 青龙环境变量读写
 *
 * 账号信息（USERINFO）存在青龙环境变量里：
 *   读：环境变量 KG_USERINFO / USERINFO → 本地快照文件（取并集，快照里的 token 更新）
 *   写：优先走青龙 OpenAPI 直接改环境变量；没配置 OpenAPI 就只写本地快照文件
 *
 * 本地快照是「自愈」关键：即使拿不到 OpenAPI 权限，脚本也能记住刷新后的 token，
 * 下次运行时优先用快照里的新 token，不会因为环境变量里的旧 token 而签到失败。
 */

const fs = require('node:fs');
const path = require('node:path');

const { rawRequest } = require('./http');

const ENV_NAMES = ['KG_USERINFO', 'USERINFO'];
const SNAPSHOT_FILE = path.resolve(__dirname, '..', 'userinfo.json');

/* ------------------------------------------------------------------ */
/*  读取                                                                */
/* ------------------------------------------------------------------ */

function parseUserinfo(raw, source) {
  if (!raw || !String(raw).trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') return [parsed];
    return [];
  } catch (e) {
    console.log(`[配置] ${source} 不是合法 JSON，已忽略：${e.message}`);
    return [];
  }
}

function readSnapshot() {
  try {
    if (!fs.existsSync(SNAPSHOT_FILE)) return [];
    return parseUserinfo(fs.readFileSync(SNAPSHOT_FILE, 'utf8'), '本地快照');
  } catch (e) {
    console.log(`[配置] 读取本地快照失败：${e.message}`);
    return [];
  }
}

/**
 * 读取账号列表
 * @returns {{ users: Array, source: string }}
 */
function readUserInfo() {
  let users = [];
  let source = '';

  for (const name of ENV_NAMES) {
    const raw = process.env[name];
    if (raw && String(raw).trim()) {
      const parsed = parseUserinfo(raw, `环境变量 ${name}`);
      // 解析失败（非法 JSON）时不占用 source，继续尝试下一个变量名
      if (parsed.length) {
        users = parsed;
        source = name;
        break;
      }
    }
  }

  const snapshot = readSnapshot();
  if (snapshot.length) {
    // 快照是脚本自己维护的最新 token，按 userid 覆盖环境变量里的旧值
    const merged = users.slice();
    for (const snapUser of snapshot) {
      const idx = merged.findIndex((u) => String(u.userid) === String(snapUser.userid));
      if (idx >= 0) merged[idx] = { ...merged[idx], ...snapUser };
      else merged.push(snapUser);
    }
    users = merged;
    source = source ? `${source} + 本地快照` : '本地快照';
  }

  return { users, source };
}

/* ------------------------------------------------------------------ */
/*  写入                                                                */
/* ------------------------------------------------------------------ */

function writeSnapshot(users) {
  try {
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(users), 'utf8');
    return true;
  } catch (e) {
    console.log(`[配置] 写入本地快照失败：${e.message}`);
    return false;
  }
}

/** 探测青龙面板端口（默认 5700，部分镜像用 5600） */
function candidatePorts() {
  const configured = String(process.env.QL_PORT || '').trim();
  const list = configured ? [configured] : [];
  for (const p of ['5700', '5600']) {
    if (!list.includes(p)) list.push(p);
  }
  return list;
}

function baseUrlOf(port) {
  const host = String(process.env.QL_HOST || '127.0.0.1').trim();
  return `http://${host}:${port}`;
}

async function qlRequest(method, apiPath, { token, body } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let lastError;
  for (const port of candidatePorts()) {
    try {
      const res = await rawRequest({
        url: `${baseUrlOf(port)}${apiPath}`,
        method,
        headers,
        body: body === undefined ? null : JSON.stringify(body),
        timeout: 8000,
      });
      const data = JSON.parse(res.text);
      return { port, data };
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('青龙 OpenAPI 请求失败');
}

async function getQlToken() {
  const clientId = String(process.env.QL_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.QL_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) return null;

  const { data } = await qlRequest(
    'GET',
    `/open/auth/token?client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`
  );
  const token = data && data.data && data.data.token;
  if (!token) {
    throw new Error(`获取青龙 token 失败：${(data && data.message) || JSON.stringify(data).slice(0, 200)}`);
  }
  return token;
}

/**
 * 保存账号信息
 * @param {Array} users
 * @returns {Promise<{ api: boolean, snapshot: boolean }>} 各自的写入结果
 */
async function saveUserInfo(users) {
  const value = JSON.stringify(users);
  let apiOk = false;

  const clientId = String(process.env.QL_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.QL_CLIENT_SECRET || '').trim();

  if (clientId && clientSecret) {
    try {
      const token = await getQlToken();
      // 用主用的环境变量名（读的时候优先用的那个）
      const targetName = process.env.KG_USERINFO ? 'KG_USERINFO' : 'USERINFO';

      const search = await qlRequest('GET', `/open/envs?searchValue=${encodeURIComponent(targetName)}`, { token });
      const list = (search.data && search.data.data) || [];
      const existing = list.find((item) => item && item.name === targetName);

      if (existing && existing.id !== undefined) {
        await qlRequest('PUT', '/open/envs', {
          token,
          body: { id: existing.id, name: targetName, value },
        });
      } else {
        await qlRequest('POST', '/open/envs', {
          token,
          body: [{ name: targetName, value }],
        });
      }
      apiOk = true;
      console.log(`[配置] 已通过青龙 OpenAPI 更新环境变量 ${targetName}`);
    } catch (e) {
      console.log(`[配置] 写入青龙环境变量失败：${e.message}`);
      console.log('[配置] 已回退到本地快照，token 仍然会被记住，只是面板里看不到更新');
    }
  }

  const snapshotOk = writeSnapshot(users);

  if (!apiOk && (!clientId || !clientSecret)) {
    console.log('[配置] 未配置 QL_CLIENT_ID / QL_CLIENT_SECRET，只写入本地快照');
    console.log('[配置] 如需自动更新面板环境变量：青龙「系统设置 → 应用设置」创建应用（勾选环境变量权限），');
    console.log('[配置] 把 client_id / client_secret 配成环境变量 QL_CLIENT_ID / QL_CLIENT_SECRET');
  }

  return { api: apiOk, snapshot: snapshotOk };
}

module.exports = { readUserInfo, saveUserInfo, SNAPSHOT_FILE, ENV_NAMES };
