/**
 * 日志脱敏与失败原因识别测试（离线，零依赖）
 *
 * 两个回归点（自 ScriptCat 版回移）：
 *   1. 酷狗失败时经常把原因直接放在 data 字段（如 "验证码过期"），
 *      summarizeResponse 只处理对象类型的 data 会把纯文本原因丢掉。
 *   2. 登录失败只显示错误码没有可读原因，errorTextOf 把常见错误码翻译成人话。
 */

const assert = require('node:assert');
const { maskPhone, errorTextOf, summarizeResponse, KG_ERROR_TEXT } = require('../lib/safelog');

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

console.log('脱敏与失败原因测试\n');

/* ---------- 1. 手机号脱敏 ---------- */

console.log('1) maskPhone');
check('11 位手机号只露前 2 后 2', maskPhone('13812345678'), '13*******78');
check('带非数字字符先清掉再脱敏', maskPhone('138-1234-5678'), '13*******78');
check('过短输入回落到 maskIdentifier', maskPhone('123'), '1***3');
check('空值不报错', maskPhone(''), '');

/* ---------- 2. 错误码 → 人话 ---------- */

console.log('\n2) errorTextOf');
check('20020 → 验证码相关提示', errorTextOf({ error_code: 20020 }), KG_ERROR_TEXT[20020]);
check('20021 → 验证码相关提示', errorTextOf({ error_code: 20021 }), KG_ERROR_TEXT[20021]);
check('34175 → 多账号提示', errorTextOf({ error_code: 34175 }), KG_ERROR_TEXT[34175]);
check('20006 → 参数错误提示', errorTextOf({ error_code: 20006 }), KG_ERROR_TEXT[20006]);
checkTrue('34175 提示里点名了扫码登录', /扫码登录/.test(errorTextOf({ error_code: 34175 })));
check('errcode 也能识别', errorTextOf({ errcode: 20020 }), KG_ERROR_TEXT[20020]);

/* ---------- 3. 未收录错误码的回落 ---------- */

console.log('\n3) errorTextOf 回落');
check('data 是字符串 → 原样作为原因', errorTextOf({ data: '验证码过期' }), '验证码过期');
check('data 是字符串优先于 msg', errorTextOf({ data: '验证码过期', msg: 'bad' }), '验证码过期');
check('没有 data 时回落 msg', errorTextOf({ msg: '系统繁忙' }), '系统繁忙');
check('没有 msg 时回落 message', errorTextOf({ message: 'oops' }), 'oops');
check('未知错误码且无文本 → 空串', errorTextOf({ error_code: 99999 }), '');
check('空对象 → 空串', errorTextOf({}), '');
check('null → 空串', errorTextOf(null), '');

/* ---------- 4. summarizeResponse 保留字符串 data ---------- */

console.log('\n4) summarizeResponse');
{
  const s = summarizeResponse({ status: 0, error_code: 20020, data: '验证码过期' });
  check('字符串 data 不被丢弃', s.data, '验证码过期');
  check('错误码保留', s.error_code, 20020);
}
{
  const s = summarizeResponse({ status: 0, data: { msg: 'x', token: 'secret' } });
  check('对象 data 只保留白名单字段', s.data.msg, 'x');
  check('对象 data 里的 token 被脱敏', s.data.token === undefined || s.data.token === '[REDACTED]', true);
}
{
  const s = summarizeResponse({ status: 1, data: 'ok', extra: 'ignore-me-if-possible' });
  check('数字/字符串 data 同样保留', s.data, 'ok');
}

/* ---------- 5. 网络错误码要可读 ---------- */

console.log('\n5) 网络错误码可读性');
{
  const s = summarizeResponse({ status: 0, code: 'ECONNRESET', msg: 'read ECONNRESET' });
  check('ECONNRESET 不再被打码', s.code, 'ECONNRESET');
  check('网络错误原因保留', s.msg, 'read ECONNRESET');
}
{
  const s = summarizeResponse({ status: 0, code: 'abcdefghijklmnopqrstuvwxyz0123456789', msg: 'x' });
  check('长串疑似凭证仍然打码', s.code, '[REDACTED]');
}

console.log(`\n脱敏与失败原因：${pass} 项通过，${fail} 项失败`);
if (fail) process.exitCode = 1;
