# DSH 每日简报 · Daily Brief v2

为 DeepSeek Harness 打造的“少而准”的每日简报：每天定时把**你关注的 X 账号**、**你在玩的几款 Steam 游戏**和**你的 Minecraft 服务器**整理成一张窄卡片，并以桌面小窗口弹出——像记事本那样出现，而不是发一条系统通知。

- 最多 5 条：AI 动态 3 条、游戏 2 条，服务器状态单独一条底栏，不占名额。
- 只抓你列出的账号和游戏；不再聚合 Hacker News、arXiv、IGN 这类大范围信息流。
- 五种人设卡片：鲸鱼娘、助手、管家、军官，以及一个可自定义名字、主色和语气的「自定义」。
- 弹窗是独立的 Edge / Chrome `--app` 窗口，无地址栏、无标签页、记住独立配置，默认停在右下角。
- 控制面板只有一页：今天、关注范围、节奏、往期；改完即时保存，没有“保存”按钮。
- 即使 DSH 没在运行，Windows 计划任务也会在后台生成并弹出窗口。

## 快速开始

1. 安装插件（在 DSH 对话里让 agent 用 `plugin_manager` 的 `install_bundle` 指向本目录），完成后重载页面。
2. 打开左侧边栏的「每日简报」。
3. 在「关注范围」里调整：
   - **X 账号**：默认 OpenAI、Anthropic、DeepMind、Sam Altman，可增删。
   - **Steam 游戏**：默认 ACE COMBAT 7、ACE COMBAT ZERO、World of Tanks Blitz，可增删。
   - **Minecraft 服务器**：默认 `play.simpfun.cn:11848`，可改成自己的地址。
4. 在「人设卡片」里挑一张：鲸鱼娘 / 助手 / 管家 / 军官，或「自定义」自己写名字、一句话、主色和语气。
5. 在「节奏」里确认每天生成时间（默认 07:30）和「生成后弹出窗口」。
6. 点「立即生成」看效果；明天到点会自动生成。

## 日常关注

| 类型 | 输入 | 说明 |
| --- | --- | --- |
| X 账号 | `OpenAI`、`@AnthropicAI` | 走公开的 syndication 时间线，不需要登录；被限流时自动改用该账号的官方博客 RSS 补位，并显示上次缓存 |
| Steam 游戏 | appid，例如 `502500` | 读 Steam 官方新闻接口；连不上时回退到上次成功的结果 |
| Minecraft 服务器 | `host:port` | 先走原生 Java 状态协议（含 SRV 记录），失败再走 mcstatus.io；离线时底栏明确显示“离线” |
| 服务器监控页 | `http://host:port/`、`10.0.0.5:9000` | 当成“状态来源”记录在线状态与响应时间；内网/localhost 地址自动允许 |

条目都按时间倒序，超过关注窗口的旧消息不会混进来。

## 人设卡片

简报页头部的名字、问候语、强调色和 AI 润色的语气都来自这张卡片：

| 卡片 | 气质 |
| --- | --- |
| 🐋 鲸鱼娘 | 蓝色的大肥鱼，语气轻缓，偶尔“呀”“呢”收尾 |
| 🗂 助手 | 干净利落，只讲重点 |
| 🎩 管家 | 礼貌克制，称呼“先生” |
| 🎖 军官 | 简短有力，像战报 |
| 🎨 自定义 | 自己填名字（24 字内）、一句话签名、主色（`#rrggbb`）和语气提示词 |

选中即保存；自定义卡片的四个字段也会即时写入 `config.json` 的 `persona` 段。

## 更多来源：邮箱、学校、飞书、订阅

面板头部和「来源」卡里都有「添加来源」：粘贴一行地址，点「识别」，勾选后再「加入」。识别不出来时，以 `http://` / `https://` 开头的行会退一步按「网页来源」列出来（可手动改分组），照样能加。

| 粘贴的内容 | 识别结果 |
| --- | --- |
| `me@school.edu` / `you@gmail.com` | 邮箱（IMAP）。Gmail 用应用专用密码；学校邮箱若识别不出服务器，会多出一个 IMAP 服务器输入框 |
| `https://…/feed.xml`、`.ics`、任意网页 | 订阅源 / 日历 / 网页抓取（网页可选关键词过滤） |
| `https://www.managebac.com/...` | ManageBac 通知（需要登录 Cookie，或粘贴日历订阅链接） |
| `https://…feishu.cn/docx/...`、`/wiki/...`、`/calendar/...` | 飞书文档 / 知识库 / 日历；新版飞书多为前端渲染，抓不到条目时推荐用「订阅链接」ICS 或机器人推送 |
| `http://af.rainplay.cn:44825/` 这类监控面板 | 服务器监控来源（看起来像登录壳也照样能记在线状态） |
| `10.0.0.5:9000`、`192.168.1.20:8123` | 同时给出 Minecraft 与 HTTP 监控两个候选，自己勾选 |
| `play.example.com:25565`、`minecraft://mc.example.net` | Minecraft 服务器 |
| Steam 商店或新闻链接 | 自动取 appid |

- 密码、授权码、Cookie 都存在本机 DPAPI 加密的 secrets 文件里（`%USERPROFILE%\.dsh\storages\daily-brief\secrets\`），不会写进 `config.json`。
- 网页类来源（含飞书、ManageBac）会自动带上你在「添加来源」里填的 Cookie 再抓取。
- 5 条预算先给 AI 与游戏（3 + 2），这两个板块安静时，空位会让给邮箱、学校通知、飞书、日历等板块，按最新一条的时间轮流补位。
- 「来源」卡可以逐个测试、启停、删除；`删除` 会同时清掉该来源保存的密码/Cookie。


## 桌面窗口

生成后调用本机 Edge（没有则 Chrome）以 `--app=file://…` 打开简报：

- 独立窗口、无浏览器外壳，尺寸与位置可配置（默认 560×860，右下角）。
- 使用插件自己的临时配置目录，不碰你日常浏览器的登录状态。
- 找不到 Chromium 时回退到默认浏览器打开，不会静默失败。

## 计划任务

插件注册名为 **DSH Daily Brief** 的 Windows 计划任务：

- 以当前用户身份、无窗口运行 `lib/engine/runner.js`，不打开 DSH 窗口、不监听端口。
- 生成 `%USERPROFILE%\.dsh\storages\daily-brief\briefings\<日期>\index.html`，随后弹出桌面窗口。
- 错过时间会自动补跑；同一天只生成一次（面板「立即生成」可强制重跑）。
- 日志：`%USERPROFILE%\.dsh\storages\daily-brief\logs\runner.log`。

## AI 润色

- 默认「自动」：仅当本机 DSH 有可用登录时，用 headless 方式让模型重写**标题和一句引言**；失败自动回退本地文案。
- 只改文案，不改条目、不增删新闻。

## 数据与迁移

- 配置、缓存、简报都在 `%USERPROFILE%\.dsh\storages\daily-brief\`；X 与 Steam 的缓存位于其中的 `.cache\`。
- 从 v1 升级时：旧的 `preset-*` 大范围来源会被移除，换成上面的三组关注来源；手动添加的来源保留。
- v1 → v2 升级后请重启一次 DSH：面板本身会即时更新，但插件主进程要重启后才提供「关注范围」编辑、桌面弹窗接口、人设卡片的自定义字段，以及飞书 / IP / 监控页等新的识别规则（面板会显示提示）。
- 不发送任何遥测；所有数据只在本机。

## 版本管理

仓库：<https://github.com/MosesMuxiXie/dsh-daily-brief>（私有）。

- 每次改完代码提交一次，仓库已启用 `core.hooksPath=.githooks`，提交后 `post-commit` 会自动 `git push`。
- 手动同步：`npm run sync`（等价于 `git add -A && git commit -m "sync" && git push`）。
- 推送失败不会阻塞提交；联网后执行 `git push` 即可补齐。

## 开发

```bash
npm test                     # 单元测试
node lib/engine/runner.js --dry-run --force   # 不投递，直接看生成结果
npm run sync                 # 提交并推送（脚本与钩子二选一即可）
```
