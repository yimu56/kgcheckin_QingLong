/**
 * 酷狗手机号登录（青龙面板版）
 *
 * 两步走，都用同一个脚本：
 *   第一次：只填 KG_PHONE，运行后酷狗会给手机发验证码
 *   第二次：把验证码填到 KG_CODE，再次运行即可完成登录
 *
 * 环境变量：
 *   KG_PHONE / PHONE    手机号
 *   KG_CODE / CODE      验证码（第一次运行时留空）
 *   KG_APPEND           是否追加到已有账号列表，默认 是
 *
 * 注意：一个手机号绑定多个账号时无法登录（接口限制），请用扫码登录。
 */

const { call } = require('./lib/kgapi');
const { readUserInfo, saveUserInfo } = require('./lib/qlenv');

async function main() {
  const phone = String(process.env.KG_PHONE || process.env.PHONE || '').trim();
  const code = String(process.env.KG_CODE || process.env.CODE || '').trim();

  if (!phone) {
    throw new Error('未配置手机号：请在青龙环境变量里添加 KG_PHONE');
  }

  // 步骤一：没有验证码 → 只发验证码
  if (!code) {
    const sent = await call('captcha_sent', { mobile: phone });
    if (sent?.status === 1) {
      console.log('[成功] 验证码已发送，请查收短信');
      console.log('[提示] 把验证码填到环境变量 KG_CODE 后，再次运行本脚本即可完成登录');
    } else {
      console.log('[失败] 验证码发送失败：');
      console.dir(sent, { depth: null });
      throw new Error('验证码发送失败');
    }
    return;
  }

  // 步骤二：有验证码 → 登录
  const result = await call('login_cellphone', { mobile: phone, code });

  if (result?.status === 1) {
    const append = String(process.env.KG_APPEND || '是').trim() !== '否';
    const { users } = readUserInfo();
    const list = append ? users.slice() : [];

    const idx = list.findIndex((u) => String(u.userid) === String(result.data.userid));
    const user = { userid: String(result.data.userid), token: String(result.data.token) };
    if (idx >= 0) list[idx] = user;
    else list.push(user);

    console.log('[成功] 登录成功！');
    const saved = await saveUserInfo(list);
    if (saved.api) {
      console.log('[成功] 已写入青龙环境变量 USERINFO');
    } else {
      console.log('[成功] 已写入本地快照 qinglong/userinfo.json');
      console.log(`[提示] 如需写入面板环境变量，请配置 QL_CLIENT_ID / QL_CLIENT_SECRET；也可手动填写：\n${JSON.stringify(list)}`);
    }
    return;
  }

  if (result?.error_code === 34175) {
    throw new Error('该手机号绑定了多个账号，暂不支持手机登录，请改用扫码登录（kg_login_qr.js）');
  }

  console.log('[失败] 登录失败，接口响应：');
  console.dir(result, { depth: null });
  throw new Error('登录失败，请检查手机号与验证码');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
