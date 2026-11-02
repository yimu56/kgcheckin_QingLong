/**
 * 通知模块（青龙版）
 *
 * 两种推送方式可并存（用 KG_NOTIFY 控制：both / ql / custom / none，默认 both）：
 *   1. 青龙自带的 sendNotify（/ql/scripts/sendNotify.js）—— 走面板里配置的推送渠道
 *   2. 本模块自带的多渠道推送（环境变量里单独配置，与原 Actions 版一致）
 *
 * 自带渠道：企业微信 / 钉钉 / 飞书 / 云湖 / Server酱 / PushPlus / Telegram / Bark / Discord / 邮箱 SMTP
 */

const crypto = require('node:crypto');
const net = require('node:net');
const tls = require('node:tls');

const { rawRequest } = require('./http');
const { tryRequireAny } = require('./deps');

async function postJson(url, body, headers = {}) {
  const res = await rawRequest({
    url,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    timeout: 15000,
  });
  return res;
}

async function postForm(url, form) {
  const body = new URLSearchParams(form).toString();
  const res = await rawRequest({
    url,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    timeout: 15000,
  });
  return res;
}

/* ---------------------------- 各渠道实现 ---------------------------- */

async function sendWeCom(title, content, key) {
  const res = await postJson(`https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${key}`, {
    msgtype: 'text',
    text: { content: `${title}\n\n${content}` },
  });
  if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
  const data = JSON.parse(res.text || '{}');
  if (data.errcode !== 0) throw new Error(data.errmsg || `errcode=${data.errcode}`);
  return true;
}

async function sendDingTalk(title, content, key, secret) {
  let url = `https://oapi.dingtalk.com/robot/send?access_token=${key}`;
  if (secret) {
    const timestamp = Date.now();
    const sign = crypto.createHmac('sha256', secret).update(`${timestamp}\n${secret}`).digest('base64');
    url += `&timestamp=${timestamp}&sign=${encodeURIComponent(sign)}`;
  }
  const res = await postJson(url, {
    msgtype: 'markdown',
    markdown: { title, text: `### ${title}\n\n${content}` },
  });
  const data = JSON.parse(res.text || '{}');
  if (data.errcode !== 0) throw new Error(data.errmsg || `errcode=${data.errcode}`);
  return true;
}

async function sendFeishu(title, content, key) {
  const res = await postJson(`https://open.feishu.cn/open-apis/bot/v2/hook/${key}`, {
    msg_type: 'text',
    content: { text: `${title}\n\n${content}` },
  });
  const data = JSON.parse(res.text || '{}');
  if (data.code !== undefined && data.code !== 0) throw new Error(data.msg || `code=${data.code}`);
  return true;
}

/**
 * 云湖机器人（官方开放接口）
 *
 * 旧的 www.yhchat.com/bot/send?key= 接口已失效，这里走
 * chat-go.jwzhd.com/open-apis/v1/bot/send，需要三项配置：
 *   YUNHU_BOT_TOKEN（或兼容旧名 YUNHU_BOT_KEY）— 机器人 token
 *   YUNHU_RECV_ID   — 接收方 ID（发给用户填 userId，发到群填 groupId）
 *   YUNHU_RECV_TYPE — 接收方类型 user / group，默认 user
 */
async function sendYunhu(title, content, token, recvId, recvType) {
  if (!recvId) throw new Error('未配置 YUNHU_RECV_ID（接收方 ID）');
  const type = recvType === 'group' ? 'group' : 'user';
  const res = await postJson(`https://chat-go.jwzhd.com/open-apis/v1/bot/send?token=${encodeURIComponent(token)}`, {
    recvId: String(recvId),
    recvType: type,
    contentType: 'text',
    content: { text: `${title}\n\n${content}` },
  });
  if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
  let data = {};
  try { data = JSON.parse(res.text || '{}'); } catch (e) { /* 非 JSON 响应按 HTTP 状态判断 */ }
  // 云湖成功时返回 {"code":1,"msg":"success"}，这里的 1 是成功而不是错误码，
  // 不能再按「code 不为 0 即失败」判断，否则消息明明已送达也会被记成失败。
  if (data.code !== undefined && data.code !== 1 && data.code !== 0) {
    throw new Error(data.msg || `code=${data.code}`);
  }
  return true;
}

async function sendServerChan(title, content, sendkey) {
  const res = await postForm(`https://sctapi.ftqq.com/${sendkey}.send`, { title, desp: content });
  if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
  return true;
}

async function sendPushPlus(title, content, token, topic) {
  const body = { token, title, content, template: 'txt' };
  if (topic) body.topic = topic;
  const res = await postJson('https://www.pushplus.plus/send', body);
  const data = JSON.parse(res.text || '{}');
  if (data.code !== undefined && data.code !== 200) throw new Error(data.msg || `code=${data.code}`);
  return true;
}

async function sendTelegram(title, content, botToken, chatId) {
  const res = await postJson(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    chat_id: chatId,
    text: `*${title}*\n\n${content}`,
    parse_mode: 'Markdown',
  });
  const data = JSON.parse(res.text || '{}');
  if (!data.ok) throw new Error(data.description || 'Telegram 返回失败');
  return true;
}

async function sendBark(title, content, key, group) {
  const base = key.startsWith('http') ? key : `https://api.day.app/${key}`;
  let url = `${base.replace(/\/$/, '')}/${encodeURIComponent(title)}/${encodeURIComponent(content)}`;
  if (group) url += `?group=${encodeURIComponent(group)}`;
  const res = await rawRequest({ url, method: 'GET', timeout: 15000 });
  if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
  return true;
}

async function sendDiscord(title, content, webhookUrl) {
  const res = await postJson(webhookUrl, {
    content: `**${title}**\n\n${content}`.slice(0, 2000),
  });
  if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
  return true;
}

/** 邮箱 SMTP：最小实现，支持 465 隐式 TLS 与 587/25 STARTTLS */
function sendMailSMTP(title, content, cfg) {
  return new Promise((resolve, reject) => {
    const { host, port, user, pass, to } = cfg;
    const from = user;
    const subject = `=?UTF-8?B?${Buffer.from(title).toString('base64')}?=`;
    const date = new Date().toUTCString();
    const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@kgcheckin>`;

    // SMTP dot-stuffing：正文以 "." 开头的行要补一个点，否则会被当作结束符
    const safeContent = String(content).replace(/^\./gm, '..');
    const mailBody = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `Date: ${date}`,
      `Message-ID: ${messageId}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      safeContent,
    ].join('\r\n');

    const smtpPort = Number(port) || 465;
    const useSTARTTLS = smtpPort !== 465;

    let state = 'GREETING';
    let buffer = '';
    let socket;
    let completed = false;
    let settled = false;
    let timer;

    function finish(success, err) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (success) resolve(true);
      else reject(err || new Error('SMTP 会话异常终止'));
    }

    const authCommands = [
      'AUTH LOGIN',
      Buffer.from(user).toString('base64'),
      Buffer.from(pass).toString('base64'),
      `MAIL FROM:<${from}>`,
      `RCPT TO:<${to}>`,
      'DATA',
      mailBody.replace(/\r?\n/g, '\r\n') + '\r\n.',
      'QUIT',
    ];
    let authStep = 0;

    function sendCmd(cmd) {
      socket.write(cmd + '\r\n');
    }

    function processData(line) {
      const code = parseInt(line.slice(0, 3), 10);
      if (code >= 400) {
        socket.destroy();
        finish(false, new Error(`SMTP 错误: ${line}`));
        return;
      }
      if (line[3] === '-') return; // 多行响应未结束

      switch (state) {
        case 'GREETING':
          sendCmd('EHLO kgcheckin');
          state = 'EHLO_SENT';
          break;
        case 'EHLO_SENT':
          if (useSTARTTLS) {
            sendCmd('STARTTLS');
            state = 'STARTTLS_SENT';
          } else {
            state = 'AUTH';
            authStep = 0;
            sendCmd(authCommands[authStep++]);
          }
          break;
        case 'STARTTLS_SENT':
          if (code !== 220) {
            socket.destroy();
            finish(false, new Error(`STARTTLS 失败: ${line}`));
            return;
          }
          socket = tls.connect({ socket, host, rejectUnauthorized: true });
          socket.setEncoding('utf8');
          socket.on('data', handleChunk);
          socket.on('end', () => finish(completed));
          socket.on('close', () => finish(completed));
          socket.on('error', (err) => finish(false, err));
          sendCmd('EHLO kgcheckin');
          state = 'EHLO2_SENT';
          break;
        case 'EHLO2_SENT':
          state = 'AUTH';
          authStep = 0;
          sendCmd(authCommands[authStep++]);
          break;
        case 'AUTH':
          if (authStep < authCommands.length) {
            if (authCommands[authStep] === 'QUIT') completed = true;
            sendCmd(authCommands[authStep++]);
          } else if (code === 221) {
            completed = true;
          }
          break;
      }
    }

    function handleChunk(chunk) {
      buffer += chunk;
      while (true) {
        const idx = buffer.indexOf('\r\n');
        if (idx === -1) break;
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        processData(line);
      }
    }

    timer = setTimeout(() => {
      if (socket) socket.destroy();
      finish(false, new Error('SMTP 超时'));
    }, 15000);

    socket = useSTARTTLS
      ? net.connect(smtpPort, host, () => {})
      : tls.connect({ host, port: smtpPort, rejectUnauthorized: true }, () => {});

    socket.setEncoding('utf8');
    socket.on('data', handleChunk);
    socket.on('end', () => finish(completed));
    socket.on('close', () => finish(completed));
    socket.on('error', (err) => finish(false, err));
  });
}

/* ---------------------------- 统一入口 ---------------------------- */

function customChannels(title, content) {
  const list = [];
  if (process.env.WECOM_BOT_KEY) list.push(['企业微信', () => sendWeCom(title, content, process.env.WECOM_BOT_KEY)]);
  if (process.env.DINGTALK_BOT_KEY) list.push(['钉钉', () => sendDingTalk(title, content, process.env.DINGTALK_BOT_KEY, process.env.DINGTALK_SECRET)]);
  if (process.env.FEISHU_BOT_KEY) list.push(['飞书', () => sendFeishu(title, content, process.env.FEISHU_BOT_KEY)]);
  const yunhuToken = process.env.YUNHU_BOT_TOKEN || process.env.YUNHU_BOT_KEY;
  if (yunhuToken) {
    list.push(['云湖', () => sendYunhu(title, content, yunhuToken, process.env.YUNHU_RECV_ID, process.env.YUNHU_RECV_TYPE)]);
  }
  if (process.env.SERVERCHAN_SENDKEY) list.push(['Server酱', () => sendServerChan(title, content, process.env.SERVERCHAN_SENDKEY)]);
  if (process.env.PUSHPLUS_TOKEN) list.push(['PushPlus', () => sendPushPlus(title, content, process.env.PUSHPLUS_TOKEN, process.env.PUSHPLUS_TOPIC)]);
  if (process.env.TG_BOT_TOKEN && process.env.TG_CHAT_ID) list.push(['Telegram', () => sendTelegram(title, content, process.env.TG_BOT_TOKEN, process.env.TG_CHAT_ID)]);
  if (process.env.BARK_KEY) list.push(['Bark', () => sendBark(title, content, process.env.BARK_KEY, process.env.BARK_GROUP)]);
  if (process.env.DISCORD_WEBHOOK) list.push(['Discord', () => sendDiscord(title, content, process.env.DISCORD_WEBHOOK)]);
  if (process.env.MAIL_HOST && process.env.MAIL_USER && process.env.MAIL_PASS && process.env.MAIL_TO) {
    list.push(['邮箱', () => sendMailSMTP(title, content, {
      host: process.env.MAIL_HOST,
      port: process.env.MAIL_PORT || 465,
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS,
      to: process.env.MAIL_TO,
    })]);
  }
  return list;
}

async function sendNotify(title, content) {
  const mode = String(process.env.KG_NOTIFY || 'both').trim().toLowerCase();

  if (mode === 'ql' || mode === 'both') {
    const qlNotify = tryRequireAny([
      '/ql/scripts/sendNotify.js',
      '/ql/scripts/sendNotify',
      '/ql/scripts/utils/sendNotify.js',
    ]);
    if (qlNotify) {
      try {
        const fn = typeof qlNotify === 'function' ? qlNotify : qlNotify.sendNotify;
        if (typeof fn === 'function') {
          await fn(title, content);
          console.log('[通知] 已交给青龙自带 sendNotify 推送');
        }
      } catch (e) {
        console.log(`[通知] 青龙自带 sendNotify 调用失败：${e.message}`);
      }
    }
  }

  if (mode === 'custom' || mode === 'both') {
    const channels = customChannels(title, content);

    // 配置回显：只打印「填没填」，不打印密钥本身，方便定位是没配置还是发送失败
    const channelNames = channels.map(([name]) => name);
    console.log(`[通知] 已装载渠道：${channelNames.length ? channelNames.join('、') : '（无）'}`);
    if (!channelNames.length) {
      console.log('[通知] 提示：渠道开关由 WECOM_BOT_KEY 等环境变量是否配置决定，请确认已在青龙环境变量里填写并保存');
      return;
    }

    console.log(`[通知] 正在推送到 ${channels.length} 个自有渠道...`);
    // 每个渠道独立结算成功/失败，单渠道挂掉不影响其它渠道，且失败时保留渠道名
    const results = await Promise.all(channels.map(async ([name, fn]) => {
      try {
        await fn();
        return { name, ok: true };
      } catch (e) {
        return { name, ok: false, reason: (e && e.message) || String(e) };
      }
    }));
    let ok = 0;
    let fail = 0;
    for (const r of results) {
      if (r.ok) {
        console.log(`  ✓ ${r.name} 发送成功`);
        ok++;
      } else {
        console.log(`  ✗ ${r.name} 发送失败: ${r.reason}`);
        fail++;
      }
    }
    console.log(`[通知] 自有渠道完成：${ok} 成功，${fail} 失败`);
  }
}

module.exports = { sendNotify };
