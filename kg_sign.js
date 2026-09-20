/**
 * 酷狗概念版 VIP 自动签到（青龙面板版）
 *
 * 环境变量：
 *   USERINFO / KG_USERINFO   账号信息 JSON 数组，如 [{"userid":"123","token":"xxx"}]
 *   KG_CLAIM_TIMES           每天最多领取次数，默认 8
 *   KG_CLAIM_INTERVAL        每次领取间隔（秒），默认 30
 *   KG_REFRESH_WEEKDAY       周几刷新 token（0=周日），默认 0，设为 -1 关闭
 *   KG_NOTIFY                通知方式：both / ql / custom / none，默认 both
 *   QL_CLIENT_ID / QL_CLIENT_SECRET   可选，用于自动回写青龙环境变量
 *
 * 说明：青龙拉库后直接新建定时任务指向本文件即可，无需启动任何本地服务。
 */

const { call, cookieOf } = require('./lib/kgapi');
const { readUserInfo, saveUserInfo } = require('./lib/qlenv');
const { sendNotify } = require('./lib/notify');
const { maskDisplayName, maskIdentifier, summarizeResponse } = require('./lib/safelog');

const LOG = {
  info: (m) => console.log(`[信息] ${m}`),
  ok: (m) => console.log(`[成功] ${m}`),
  warn: (m) => console.log(`[警告] ${m}`),
  err: (m) => console.log(`[失败] ${m}`),
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 取北京时间（不依赖容器时区） */
function beijingNow() {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcMs + 8 * 3600 * 1000);
}

function formatDate(d) {
  const MM = String(d.getMonth() + 1).padStart(2, '0');
  const DD = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${MM}-${DD}`;
}

function intEnv(name, fallback) {
  const raw = process.env[name];
  const n = Number(raw);
  return raw !== undefined && raw !== '' && !Number.isNaN(n) ? n : fallback;
}

async function main() {
  const { users, source } = readUserInfo();

  if (!users.length) {
    throw new Error('未配置账号：请在青龙环境变量 USERINFO 中填入 [{"userid":"xxx","token":"xxx"}]，或先运行 kg_login_qr.js 登录');
  }
  LOG.info(`共读取到 ${users.length} 个账号（来源：${source || '未知'}）`);

  const today = beijingNow();
  const date = formatDate(today);
  const claimTimes = intEnv('KG_CLAIM_TIMES', 8);
  const claimInterval = intEnv('KG_CLAIM_INTERVAL', 30);
  const refreshWeekday = intEnv('KG_REFRESH_WEEKDAY', 0);

  const results = [];
  const errorMsg = {};
  let needRefresh = false;
  let hasError = false;

  for (const user of users) {
    try {
      const cookie = cookieOf(user);
      const detail = await call('user_detail', { cookie });

      if (detail?.data?.nickname == null) {
        const safeUserId = maskIdentifier(user.userid);
        LOG.err(`token 过期或账号不存在，userid: ${safeUserId}`);
        errorMsg[safeUserId] = { msg: `token过期或账号不存在, userid: ${safeUserId}`, data: summarizeResponse(detail) };
        results.push({ nickname: safeUserId, status: '失败', listen: '账号不存在', vipClaim: `0/${claimTimes}`, vipExpiry: '未知', error: 'token过期或账号不存在' });
        hasError = true;
        continue;
      }

      const nickname = maskDisplayName(detail.data.nickname);
      LOG.info(`账号 ${nickname} 开始签到...`);

      // 定期刷新 token（默认每周日），刷新后本次请求也用新 token
      if (refreshWeekday >= 0 && today.getDay() === refreshWeekday) {
        const refreshed = await call('login_token', { cookie, token: user.token, userid: user.userid });
        if (refreshed?.status === 1 && refreshed?.data?.token && refreshed.data.token !== user.token) {
          user.token = refreshed.data.token;
          cookie.token = String(user.token);
          needRefresh = true;
          LOG.warn(`账号 ${nickname} 已刷新 token`);
        }
      }

      // 听歌领 VIP
      const listen = await call('youth_listen_song', { cookie });
      let listenStatus = '未知';
      if (listen.status === 1) {
        LOG.ok('听歌领取成功');
        listenStatus = '成功';
      } else if (listen.error_code === 130012) {
        LOG.ok('今日已领取');
        listenStatus = '今日已领取';
      } else {
        LOG.err('听歌领取失败');
        errorMsg[`${nickname} listen`] = summarizeResponse(listen);
        listenStatus = '失败';
        hasError = true;
      }

      // 看广告领 VIP
      LOG.info('开始领取 VIP...');
      let claimCount = 0;
      let claimTotal = 0;
      for (let i = 1; i <= claimTimes; i++) {
        const ad = await call('youth_vip', { cookie });
        claimTotal = i;
        if (ad.status === 1) {
          LOG.ok(`第 ${i} 次领取成功`);
          claimCount++;
          if (i !== claimTimes) await delay(claimInterval * 1000);
        } else if (ad.error_code === 30002) {
          LOG.ok('今天次数已用光');
          break;
        } else {
          LOG.err(`第 ${i} 次领取失败`);
          errorMsg[`${nickname} ad`] = summarizeResponse(ad);
          hasError = true;
          break;
        }
      }

      // VIP 到期时间
      let vipExpiry = '未知';
      const vipDetail = await call('user_vip_detail', { cookie });
      if (vipDetail.status === 1 && Array.isArray(vipDetail.data?.busi_vip) && vipDetail.data.busi_vip.length > 0) {
        vipExpiry = vipDetail.data.busi_vip[0].vip_end_time;
        LOG.info(`今天是：${date}`);
        LOG.info(`VIP 到期时间：${vipExpiry}`);
      } else {
        LOG.err('获取 VIP 信息失败');
        errorMsg[`${nickname} vip_detail`] = summarizeResponse(vipDetail);
        hasError = true;
      }

      results.push({
        nickname,
        status: listenStatus === '失败' || claimCount === 0 ? '部分失败' : '成功',
        listen: listenStatus,
        vipClaim: `${claimCount}/${claimTotal}`,
        vipExpiry,
        error: '',
      });
    } catch (err) {
      const safeUserId = maskIdentifier(user.userid || '未知');
      const msg = err && err.message ? err.message : String(err);
      LOG.err(`账号 ${safeUserId} 处理异常：${msg}`);
      errorMsg[safeUserId] = { msg: '处理异常', error: msg };
      results.push({ nickname: safeUserId, status: '失败', listen: '异常', vipClaim: `0/${claimTimes}`, vipExpiry: '未知', error: msg });
      hasError = true;
    }
  }

  // 账号信息有变化才回写（避免每次运行都改环境变量）
  if (needRefresh) {
    LOG.info('检测到 token 刷新，正在回写账号信息...');
    await saveUserInfo(users);
  }

  // 通知
  const title = `酷狗签到${hasError ? '异常' : '成功'} ${date}`;
  let content = `📅 日期: ${date}\n📊 账号数: ${results.length}\n`;
  const successCount = results.filter((r) => r.status === '成功').length;
  content += `✅ 成功: ${successCount}  ❌ 失败: ${results.length - successCount}\n`;
  for (const r of results) {
    content += `\n【${r.nickname}】\n  🎵 听歌领取: ${r.listen}\n  🎁 VIP领取: ${r.vipClaim} 次\n  ⏰ VIP到期: ${r.vipExpiry}\n`;
    if (r.error) content += `  ⚠️ 错误: ${r.error}\n`;
  }

  try {
    await sendNotify(title, content);
  } catch (e) {
    LOG.warn(`通知发送异常: ${e && e.message ? e.message : e}`);
  }

  if (Object.keys(errorMsg).length > 0) {
    LOG.err('异常信息如下：');
    console.dir(errorMsg, { depth: null });
    throw new Error('领取异常');
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
