/**
 * 定时触发后的随机延迟（自 ScriptCat 版回移）
 *
 * 定时任务每天在同一时刻发起签到，时间特征过于规整。
 * 触发后先随机等一段时间，把签到时刻打散。
 *
 * 延迟以整分钟为单位（不做秒级抖动）：
 * 秒级抖动没有意义，反而更像脚本。
 */

/**
 * 抽一个「触发后先等多久再签到」的随机延迟。
 *
 * @param {number} minMinutes 延迟下限（分钟），非法值按 0 处理
 * @param {number} maxMinutes 延迟上限（分钟），非法值按 0 处理；小于下限时互换
 * @param {Function} [rand] 随机数发生器，默认 Math.random（测试时注入固定值）
 * @returns {number} 延迟毫秒数；参数无效或上下限都为 0 时返回 0
 */
function pickRandomDelayMs(minMinutes, maxMinutes, rand) {
  let lo = Math.floor(Number(minMinutes));
  let hi = Math.floor(Number(maxMinutes));
  if (!Number.isFinite(lo) || lo < 0) lo = 0;
  if (!Number.isFinite(hi) || hi < 0) hi = 0;
  if (hi < lo) [lo, hi] = [hi, lo];
  if (hi <= 0) return 0;

  let r = typeof rand === 'function' ? Number(rand()) : Math.random();
  if (!Number.isFinite(r) || r < 0) r = 0;
  if (r >= 1) r = 0.999999999;

  // 在闭区间 [lo, hi] 里取整数分钟
  const minutes = Math.min(hi, lo + Math.floor(r * (hi - lo + 1)));
  return minutes * 60000;
}

module.exports = { pickRandomDelayMs };
