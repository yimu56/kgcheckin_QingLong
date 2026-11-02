'use strict';

/**
 * 配置加载器。
 *
 * 优先读取同目录的 config.json；文件缺失或内容损坏时改用内置默认值，
 * 避免使用方只拷贝了 .js 文件（或从旧版本继承的目录）时，
 * 脚本因 MODULE_NOT_FOUND 直接崩溃。
 *
 * 解析失败与文件缺失两种情况都会在控制台留下一行提示，便于排查；
 * 需要自定义参数时，直接修改 config.json 即可，内置默认值只在文件不可用时生效。
 */

const fs = require('fs');
const path = require('path');

/** 内置默认值，与仓库内 config.json 保持一致 */
const DEFAULTS = {
  wx_appid: 'wx79f2c4418704b4f8',
  wx_lite_appid: 'wx72b795aca60ad321',
  wx_secret: '4efcab88b700769e376e3f6087b8abc9',
  wx_lite_secret: '33e486041e5e25729a4e3d2da7502f9a',
  srcappid: 2919,
  appid: 1005,
  apiver: 20,
  clientver: 20489,
  liteAppid: 3116,
  liteClientver: 11436,
};

const CONFIG_PATH = path.join(__dirname, 'config.json');

/**
 * 读取 config.json，失败返回 null。
 * @returns {Record<string, unknown> | null}
 */
function readConfigFile() {
  let raw;
  try {
    raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      console.log('[kgcheckin] 未找到 api/util/config.json，使用内置默认配置');
    } else {
      console.log(`[kgcheckin] 读取 api/util/config.json 失败，使用内置默认配置：${err && err.message}`);
    }
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      console.log('[kgcheckin] api/util/config.json 内容不是对象，使用内置默认配置');
      return null;
    }
    return parsed;
  } catch (err) {
    console.log(`[kgcheckin] api/util/config.json 格式错误，使用内置默认配置：${err.message}`);
    return null;
  }
}

const fileConfig = readConfigFile();

module.exports = Object.assign({}, DEFAULTS, fileConfig || {});
