/**
 * 日志脱敏（青龙版）
 *
 * 青龙的日志会完整保留在面板里，也可能被通知渠道推送出去，
 * 因此昵称 / userid / token 一律做脱敏处理，避免泄露登录凭证。
 */

const SENSITIVE_KEYS = new Set([
  'token', 'vip_token', 'viptoken', 'cookie', 'authorization', 'pat',
  'gh_token', 'userinfo', 'password', 'code', 'mobile', 'phone',
  'qrcode', 'qrcode_img', 'qrcode_txt', 'qrimg', 'key', 'secu_params',
]);

const DISPLAY_NAME_KEYS = new Set(['nickname', 'username', 'display_name', 'displayname']);
const IDENTIFIER_KEYS = new Set(['userid', 'user_id', 'uid', 'kguid', 'kugouid', 't_userid']);

function maskDisplayName(value) {
  const chars = Array.from(String(value ?? ''));
  if (chars.length === 0) return '';
  if (chars.length === 1) return `${chars[0]}********`;
  if (chars.length === 2) return `${chars[0]}********${chars[1]}`;
  return `${chars.slice(0, 2).join('')}********${chars[chars.length - 1]}`;
}

function maskIdentifier(value) {
  const chars = Array.from(String(value ?? ''));
  if (chars.length === 0) return '';
  if (chars.length <= 2) return '*'.repeat(chars.length);
  if (chars.length <= 6) return `${chars[0]}***${chars[chars.length - 1]}`;
  return `${chars.slice(0, 3).join('')}***${chars.slice(-2).join('')}`;
}

function sanitizeString(value) {
  return String(value)
    .replace(/(github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9]{20,})/g, '[REDACTED]')
    .replace(/(?<!\d)(1[3-9]\d{9})(?!\d)/g, (phone) => `${phone.slice(0, 2)}*******${phone.slice(-2)}`);
}

function redactValue(key, value) {
  const k = String(key).toLowerCase();
  if (DISPLAY_NAME_KEYS.has(k)) return maskDisplayName(value);
  if (IDENTIFIER_KEYS.has(k)) return maskIdentifier(value);
  if (SENSITIVE_KEYS.has(k)) return '[REDACTED]';
  return typeof value === 'string' ? sanitizeString(value) : value;
}

function sanitizeForLog(value, depth = 0) {
  if (value == null) return value;
  if (typeof value !== 'object') {
    return typeof value === 'string' ? sanitizeString(value) : value;
  }
  if (depth >= 4) return '[Object]';
  if (Array.isArray(value)) return value.slice(0, 20).map((i) => sanitizeForLog(i, depth + 1));

  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, sanitizeForLog(redactValue(k, v), depth + 1)])
  );
}

/** 只保留排查问题需要的字段，避免把整包响打印进日志 */
function summarizeResponse(response) {
  const safe = sanitizeForLog(response);
  if (!safe || typeof safe !== 'object') return safe;

  const summary = {};
  for (const key of ['status', 'code', 'error_code', 'errcode', 'error', 'msg', 'message', 'httpStatus']) {
    if (safe[key] !== undefined) summary[key] = safe[key];
  }
  if (safe.data && typeof safe.data === 'object') {
    summary.data = {};
    for (const key of ['status', 'code', 'error_code', 'errcode', 'msg', 'message', 'nickname', 'userid']) {
      if (safe.data[key] !== undefined) summary.data[key] = safe.data[key];
    }
  }
  return Object.keys(summary).length > 0 ? summary : safe;
}

module.exports = { maskDisplayName, maskIdentifier, sanitizeForLog, summarizeResponse };
