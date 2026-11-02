/**
 * 跑全部离线测试（不需要联网、不需要 npm 安装任何包）
 *
 *   npm test
 *   或直接：node test/run-all.js
 *
 * 每个测试文件各起一个独立进程跑，互不干扰
 * （个别测试会临时接管 console.log，同进程串跑会互相吞输出）。
 */

const path = require('node:path');
const cp = require('node:child_process');

const FILES = ['schedule.test.js', 'safelog.test.js', 'notify.test.js', 'api_config.test.js', 'api_retry.test.js'];

let failed = 0;
for (const file of FILES) {
  const r = cp.spawnSync(process.execPath, [path.join(__dirname, file)], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
  });
  if (r.status !== 0) failed++;
  console.log('');
}

if (failed) {
  console.log(`${failed} 个测试文件有失败项`);
  process.exit(1);
}
console.log('全部测试文件通过');
