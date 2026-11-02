/**
 * 随机延迟回归测试（离线，零依赖）
 *
 * 背景：定时任务每天在同一时刻发起签到，时间特征过于规整。
 * 触发后先随机等一段时间再签到，这里校验取值范围、边界处理。
 *
 * 延迟以整分钟为单位，所以「打散」的效果是分钟级的——这是刻意的。
 */

const assert = require('node:assert');
const { pickRandomDelayMs } = require('../lib/schedule');

let pass = 0;
let fail = 0;

function check(name, actual, expected) {
  try {
    assert.strictEqual(actual, expected);
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    fail++;
    console.log(`  ✗ ${name}\n      期望 ${expected}\n      实际 ${actual}`);
  }
}

const MIN = 60000;

console.log('随机延迟测试\n');

/* ---------- 1. 关闭与固定值 ---------- */

console.log('1) 关闭 / 固定值');
check('上下限都填 0 → 不等待', pickRandomDelayMs(0, 0), 0);
check('上下限相同 → 固定等待', pickRandomDelayMs(5, 5), 5 * MIN);
check('负数按 0 处理', pickRandomDelayMs(-10, -1), 0);

/* ---------- 2. 区间是闭区间 ---------- */

console.log('\n2) 闭区间 [下限, 上限]');
check('随机数为 0 → 取下限', pickRandomDelayMs(2, 10, () => 0), 2 * MIN);
check('随机数接近 1 → 取上限', pickRandomDelayMs(2, 10, () => 0.999999), 10 * MIN);
check('随机数为 1 → 仍取上限（不越界）', pickRandomDelayMs(2, 10, () => 1), 10 * MIN);
check('随机数越界（负数）→ 取下限', pickRandomDelayMs(2, 10, () => -3), 2 * MIN);

/* ---------- 3. 真的落在区间里，而且真的被打散 ---------- */

console.log('\n3) 取值分布');
{
  const seen = new Set();
  let outOfRange = 0;
  for (let i = 0; i < 400; i++) {
    const ms = pickRandomDelayMs(1, 60);
    const min = ms / MIN;
    if (!Number.isInteger(min) || min < 1 || min > 60) outOfRange++;
    seen.add(min);
  }
  check('400 次抽样全部落在 [1, 60] 分钟的整数分钟上', outOfRange, 0);
  check('抽样值已打散（出现多个不同取值）', seen.size > 20, true);
}

/* ---------- 4. 上下限写反了也能用 ---------- */

console.log('\n4) 上下限颠倒');
{
  let outOfRange = 0;
  for (let i = 0; i < 200; i++) {
    const min = pickRandomDelayMs(30, 10) / MIN;
    if (min < 10 || min > 30) outOfRange++;
  }
  check('下限 30 / 上限 10 → 仍落在 [10, 30]', outOfRange, 0);
}

/* ---------- 5. 非法配置不会造出离谱的等待 ---------- */

console.log('\n5) 非法配置');
check('全部空值 → 0', pickRandomDelayMs(undefined, undefined, () => 0.5), 0);
check('非数字 → 0', pickRandomDelayMs('abc', 'xyz', () => 0.5), 0);
check('上限 NaN、下限 0 → 0', pickRandomDelayMs(0, NaN, () => 0.5), 0);
check('随机数不是数字 → 取下限', pickRandomDelayMs(4, 8, () => NaN), 4 * MIN);
{
  let tooLong = 0;
  for (let i = 0; i < 200; i++) {
    if (pickRandomDelayMs(1, 720) > 720 * MIN) tooLong++;
  }
  check('最长等待不超过配置上限', tooLong, 0);
}

/* ---------- 6. 只填了上限 0 那种写法 ---------- */

console.log('\n6) 边界组合');
check('下限 0 / 上限 0 → 0', pickRandomDelayMs(0, 0, () => 0.7), 0);
check('下限 0 / 上限 1 → 随机数小时不等待', pickRandomDelayMs(0, 1, () => 0), 0);
check('下限 0 / 上限 1 → 随机数大时等 1 分钟', pickRandomDelayMs(0, 1, () => 0.99), MIN);

console.log(`\n随机延迟：${pass} 项通过，${fail} 项失败`);
if (fail) process.exitCode = 1;
