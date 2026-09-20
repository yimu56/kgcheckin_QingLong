# 酷狗签到 · 青龙面板版

在青龙面板（QingLong）上自动领取酷狗概念版 VIP，每天两张。

这是原 [kgcheckin](https://github.com/develop202/kgcheckin)（GitHub Actions 版）的青龙移植版，
两者账号数据格式完全通用，**不需要 GitHub 账号、不需要 Actions、不需要常驻服务**。

## 免责声明

> [!important]
>
> 1. 本项目仅供学习使用，请尊重版权，请勿利用此项目从事商业行为及非法用途！
> 2. 使用本项目的过程中可能会产生版权数据。对于这些版权数据，本项目不拥有它们的所有权。为了避免侵权，使用者务必在 24 小时内清除使用本项目的过程中所产生的版权数据。
> 3. 由于使用本项目产生的包括由于本协议或由于使用或无法使用本项目而引起的任何性质的任何直接、间接、特殊、偶然或结果性损害（包括但不限于因商誉损失、停工、计算机故障或故障引起的损害赔偿，或任何及所有其他商业损害或损失）由使用者负责。
> 4. **禁止在违反当地法律法规的情况下使用本项目。** 对于使用者在明知或不知当地法律法规不允许的情况下使用本项目所造成的任何违法违规行为由使用者承担，本项目不承担由此造成的任何直接、间接、特殊、偶然或结果性责任。
> 5. 音乐平台不易，请尊重版权，支持正版。
> 6. 本项目仅用于对技术可行性的探索及研究，不接受任何商业（包括但不限于广告等）合作及捐赠。
> 7. 如果官方音乐平台觉得本项目不妥，可联系本项目更改或移除。

## 与 Actions 版的区别

| | GitHub Actions 版 | 本青龙版 |
|---|---|---|
| 运行方式 | Actions 定时任务 | 青龙定时任务 |
| 调用方式 | 本机起 Express 服务（3000 端口）再 HTTP 请求 | **进程内直接调用，不起服务、不占端口** |
| 账号存储 | 仓库 Secret | 青龙环境变量 + 本地快照 |
| 外部依赖 | axios / pako / qrcode 全要装 | 签到**零依赖**，扫码登录可选装 qrcode |

## 一、拉库

青龙面板左侧「订阅管理」（老版本叫「拉库」）→ 添加订阅：

| 字段 | 值 |
|------|-----|
| 名称 | 随便填 |
| 链接 | `https://github.com/yimu56/kgcheckin_QingLong.git` |
| 分支 | `main` |
| 白名单 | `kg_` |
| 定时任务 | 留空即可 |

或者命令行：

```bash
ql repo https://github.com/yimu56/kgcheckin_QingLong.git "main" "kg_" "" ""
```

> ⚠️ 仓库里的 `api/` 目录**不能删**，里面是签到要用的酷狗接口（已精简过，只有 66 KB）。

## 二、获取账号

### 方式一：扫码登录（推荐）

1. （可选）青龙「依赖管理 → NodeJs」添加 `qrcode`，装了才能在日志里直接看到二维码图案：
   ```bash
   docker exec -it qinglong bash -c "cd /ql/scripts && npm i qrcode"
   ```
2. 新建任务 → 命令填 `task kgcheckin_QingLong/kg_login_qr.js` → 手动运行
3. 打开任务日志，用酷狗音乐 APP 扫里面的二维码并点确认
4. 登录成功会自动写入环境变量 `USERINFO`

二维码有效期约 2 分钟，脚本默认等 150 秒（`KG_QR_TIMEOUT` 可调）。
没装 `qrcode` 时只打印链接，复制出去自己生成二维码也能用。

### 方式二：手机号登录

1. 添加环境变量 `KG_PHONE` = 手机号，运行 `task kgcheckin_QingLong/kg_login_phone.js`，短信会收到验证码
2. 添加环境变量 `KG_CODE` = 验证码，**再运行一次**同一个脚本完成登录

> 一个手机号绑定了多个酷狗账号时登录会失败，请改用扫码登录。

## 三、环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `USERINFO` | ✅ | 账号数组，登录脚本会自动写入；也可手填 `[{"userid":"xxx","token":"xxx"}]` |
| `KG_CLAIM_TIMES` | | 每天最多领取次数，默认 `8` |
| `KG_CLAIM_INTERVAL` | | 每次领取间隔（秒），默认 `30` |
| `KG_REFRESH_WEEKDAY` | | 周几刷新 token，`0`=周日（默认），`-1` 关闭 |
| `KG_NOTIFY` | | 通知方式：`both`（默认）/ `ql` / `custom` / `none` |
| `KG_APPEND` | | 登录时是否追加到已有账号列表，默认追加，填 `否` 覆盖 |
| `QL_CLIENT_ID` / `QL_CLIENT_SECRET` | | 可选，用于自动回写面板环境变量，见下节 |
| `QL_HOST` / `QL_PORT` | | 可选，青龙面板地址，默认 `127.0.0.1`，端口自动探测 `5700`/`5600` |

多账号直接在 `USERINFO` 里放多个对象，或者多次运行登录脚本（默认追加）。

### 通知渠道（全部可选）

配了就发，支持同时多个：

| 渠道 | 环境变量 |
|------|---------|
| 企业微信机器人 | `WECOM_BOT_KEY` |
| 钉钉机器人 | `DINGTALK_BOT_KEY`（可选加签 `DINGTALK_SECRET`） |
| 飞书机器人 | `FEISHU_BOT_KEY` |
| 云湖机器人 | `YUNHU_BOT_KEY` |
| Server酱 | `SERVERCHAN_SENDKEY` |
| PushPlus | `PUSHPLUS_TOKEN`（可选群组 `PUSHPLUS_TOPIC`） |
| Telegram | `TG_BOT_TOKEN` + `TG_CHAT_ID` |
| Bark | `BARK_KEY`（可选分组 `BARK_GROUP`） |
| Discord | `DISCORD_WEBHOOK` |
| 邮箱 SMTP | `MAIL_HOST` / `MAIL_PORT` / `MAIL_USER` / `MAIL_PASS` / `MAIL_TO` |

`KG_NOTIFY=both`（默认）时会**同时**走青龙自带的 `sendNotify`（面板里配置的推送方式）和上面这些自有渠道；怕刷屏就改成 `ql` 或 `custom`。

## 四、token 自动刷新（可选）

酷狗 token 约两个月过期，脚本默认每周日自动续期。续期后的新 token 需要存下来：

- **配了 OpenAPI**：青龙「系统设置 → 应用设置」创建应用，勾选「环境变量」权限，
  把 `client_id` / `client_secret` 配成环境变量 `QL_CLIENT_ID` / `QL_CLIENT_SECRET`，
  脚本会直接改写面板里的 `USERINFO`。
- **没配 OpenAPI**：新 token 会写到 `userinfo.json`（本地快照），
  下次签到自动与环境变量合并并优先使用新的，**一样能自愈**，只是面板里看不到变化。

## 五、建定时任务

青龙「定时任务 → 新建任务」：

- 名称：酷狗签到
- 命令：`task kgcheckin_QingLong/kg_sign.js`
- 定时规则：`10 1 * * *`（每天北京时间 01:10）

> 脚本自己按北京时间判断日期，容器时区是 UTC 也没关系。
> 建议在凌晨跑，抢在手动领取之前，避免和 APP 里当天名额冲突。

## 目录结构

```
kgcheckin_QingLong/
├── kg_sign.js          签到主脚本
├── kg_login_qr.js      扫码登录
├── kg_login_phone.js   手机号登录
├── lib/                共用模块（http / 依赖兜底 / 环境变量 / 通知 / 脱敏）
└── api/                精简版酷狗接口（from KuGouMusicApi，不可删）
```

## 常见问题

**Q：报「未配置账号」？**
A：先跑一次登录脚本，或手动在 `USERINFO` 里填 `[{"userid":"xxx","token":"xxx"}]`。

**Q：报「未找到酷狗接口目录」？**
A：`api/` 目录丢了，删掉任务重新拉一次库。

**Q：日志里「token过期或账号不存在」？**
A：token 失效，重新跑一次登录脚本即可。

**Q：听歌领取失败？**
A：先到酷狗 APP「活动中心 → 天天签到领 VIP」看看当天是不是已经手动领过（新用户可能没这个活动）。

**Q：签到脚本要装依赖吗？**
A：不用。axios、pako 缺失时会自动用 Node 内置模块顶上（有/无依赖两种情况都测过）。
只有「在日志里显示二维码图案」才需要 `qrcode`。

## 致谢

- [@MakcRe](https://github.com/MakcRe) — [KuGouMusicApi](https://github.com/MakcRe/KuGouMusicApi)，本项目 `api/` 目录来源
- [kgcheckin](https://github.com/develop202/kgcheckin) — GitHub Actions 版原项目

## 许可证

本项目 [MIT](./LICENSE) 开源。`api/` 目录遵循 KuGouMusicApi 的 [MIT](./api/LICENSE) 许可证。
