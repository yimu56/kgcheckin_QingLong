/**
 * api 配置加载回归测试（离线，零依赖）
 *
 * 背景：青龙订阅的文件扩展名过滤默认只同步 .js 文件，
 * api/util/config.json 不会被拉到面板机上，导致
 * require('./config.json') 直接 MODULE_NOT_FOUND、登录脚本起不来。
 * 现在 api/util/config.js 内置默认值兜底，config.json 缺失也能跑。
 *
 * 三个回归点：
 *   1. config.json 缺失时整条加载链（lib/kgapi → api/util/request）不崩，
 *      且明确提示「使用内置默认配置」。
 *   2. 内置默认值与仓库里的 config.json 保持一致，防止两处漂移。
 *   3. api/ 下不再出现 require('./config.json')，全部走 require('./config')。
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

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

/** 递归复制目录，可按文件名过滤 */
function copyDir(src, dst, filter) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (filter && !filter(from)) continue;
    if (entry.isDirectory()) copyDir(from, to, filter);
    else fs.copyFileSync(from, to);
  }
}

console.log('api 配置加载测试\n');

/* ---------- 1. 模拟青龙盒子：只有 .js，缺 config.json ---------- */

console.log('1) config.json 缺失时整条加载链');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kgapi-'));
  try {
    // 只拷 .js，复现青龙「extensions 默认 js」的同步结果
    copyDir(path.join(ROOT, 'api'), path.join(tmp, 'api'), (p) => !p.endsWith('.json'));
    copyDir(path.join(ROOT, 'lib'), path.join(tmp, 'lib'), (p) => !p.endsWith('.json'));
    check('测试环境里确实没有 config.json', fs.existsSync(path.join(tmp, 'api/util/config.json')), false);

    const r = cp.spawnSync(process.execPath, ['-e', "require('./lib/kgapi'); console.log('LOAD_OK');"], {
      cwd: tmp,
      encoding: 'utf8',
    });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    check('整条加载链（lib/kgapi → api/util/request）不崩', r.status, 0);
    checkTrue('加载链走到结尾', /LOAD_OK/.test(out));
    checkTrue('日志提示使用内置默认配置', /使用内置默认配置/.test(out));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/* ---------- 2. 内置默认值与 config.json 一致 ---------- */

console.log('\n2) 内置默认值与 config.json 一致性');
{
  const fileConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'api/util/config.json'), 'utf8'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kgcfg-'));
  try {
    // 单独拷 config.js（无 config.json），require 出来的就是纯内置默认值
    fs.copyFileSync(path.join(ROOT, 'api/util/config.js'), path.join(tmp, 'config.js'));
    const defaults = require(path.join(tmp, 'config.js'));
    try {
      assert.deepStrictEqual(defaults, fileConfig);
      check('DEFAULTS 与 config.json 逐字段一致', true, true);
    } catch (e) {
      check('DEFAULTS 与 config.json 逐字段一致', e.message.split('\n')[0], '');
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // 真实 config.js（带 config.json）应合并出完整配置
  const merged = require(path.join(ROOT, 'api/util/config.js'));
  check('合并后 appid 正确', merged.appid, 1005);
  check('合并后 clientver 正确', merged.clientver, 20489);
  checkTrue('合并后含 wx_secret 等完整字段', Boolean(merged.wx_secret && merged.wx_appid && merged.liteAppid));
}

/* ---------- 3. 源码级：不再硬依赖 config.json ---------- */

console.log('\n3) 源码引用检查');
{
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (p.endsWith('.js') && /require\(['"]\.\/config\.json['"]\)/.test(fs.readFileSync(p, 'utf8'))) {
        offenders.push(path.relative(ROOT, p));
      }
    }
  };
  walk(path.join(ROOT, 'api'));
  check('api/ 下没有 require(\'./config.json\') 残留', offenders.join(','), '');

  for (const f of ['helper.js', 'index.js', 'request.js']) {
    const src = fs.readFileSync(path.join(ROOT, 'api/util', f), 'utf8');
    checkTrue(`api/util/${f} 走 require('./config')`, /require\(['"]\.\/config['"]\)/.test(src));
  }
}

console.log(`\napi 配置加载：${pass} 项通过，${fail} 项失败`);
if (fail) process.exitCode = 1;
