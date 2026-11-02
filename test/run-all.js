/**
 * 跑全部离线测试（不需要联网、不需要 npm 安装任何包）
 *
 *   npm test
 *   或直接：node test/run-all.js
 */

require('./schedule.test.js');
console.log('');
require('./safelog.test.js');
console.log('');
require('./notify.test.js');
