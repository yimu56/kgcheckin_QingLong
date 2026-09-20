/**
 * pako 兜底实现（基于 Node 内置 zlib）
 *
 * KuGouMusicApi 的 util/util.js 顶层 require('pako') 只是为了解码歌词（krc），
 * 签到流程完全用不到。这里用内置 zlib 提供同名 API，
 * 这样在青龙里不装 pako 也能正常加载 api 模块。
 */

const zlib = require('node:zlib');

function toBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return Buffer.from(String(data));
}

function wrap(fn) {
  return (data) => new Uint8Array(fn(toBuffer(data)));
}

module.exports = {
  inflate: wrap((b) => zlib.inflateSync(b)),
  inflateRaw: wrap((b) => zlib.inflateRawSync(b)),
  deflate: wrap((b) => zlib.deflateSync(b)),
  deflateRaw: wrap((b) => zlib.deflateRawSync(b)),
  gzip: wrap((b) => zlib.gzipSync(b)),
  ungzip: wrap((b) => zlib.gunzipSync(b)),
  gunzip: wrap((b) => zlib.gunzipSync(b)),
};
