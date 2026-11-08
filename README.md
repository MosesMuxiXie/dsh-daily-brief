# 每日简报 · Daily Brief v2

给 DeepSeek Harness（DSH）用的每日简报插件：每天定时把你**主动关注**的几件事——X 上的 AI 账号、Steam 库里在玩的游戏、你自己的服务器或监控页——整理成一张窄卡片，并以桌面小窗口弹出，像记事本那样出现在屏幕角落，而不是发一条系统通知。

它刻意做得「少而准」：默认没有任何信息流，也不替你猜兴趣。装好后由你贴 ID 决定看什么：X 账号 ID、Steam appid（或从本机库勾选）、自己的服务器与监控地址；一个都不填时，简报会提示去哪里添加。

## 特性

- **最多 5 条**：AI 3 条、游戏 2 条；服务器状态单独一条底栏，不占新闻名额。
- **只列你要的**：AI 只抓你粘贴的 X 账号 ID，游戏只抓你选的 Steam appid，没有 Hacker News、IGN 这类大范围聚合；不预置任何账号或游戏。
- **要点式排版**：AI 与游戏各给 2–4 条短要点（谁做了什么/有什么变化），不挂原始链接，扫一眼就够；没配 AI 时退回把标题提炼成要点。
- **五种人设**：鲸鱼娘、助手、管家、军官，以及可自定义名字、一句话、主色和语气的「自定义」；每张卡都有明确的语气约束。
- **本地 Steam 库发现**：安装后自动读取本机 Steam 已安装列表，在面板里勾选即可，不用手抄 appid。
- **服务器由你定义**：`地址:端口`、`minecraft://`、`http(s)://` 监控页都行；内网、IP、非标准端口同样支持。
- **桌面弹窗**：独立 Edge/Chrome `--app` 窗口，无地址栏、无标签页，默认右下角 560×860。
- **一页面板**：今天、简报风格、关注范围、来源、节奏、往期；改完即时保存，没有「保存」按钮。
- **不依赖 DSH 常开**：Windows 计划任务会在后台生成并弹出窗口。

## 环境要求

- Windows 10/11（弹窗与计划任务依赖 Windows；其他平台只能生成 HTML）。
- 已安装 DeepSeek Harness，并能用 `plugin_manager` 安装本地插件目录。
- 本机有 Microsoft Edge 或 Google Chrome（用于独立窗口）。
- Node.js 随 DSH 提供；若要跑测试，需要 Node 18+。

## 安装

1. 在 DSH 对话里让 agent 用 `plugin_manager` 的 `install_bundle` 指向本目录（或先 `git clone` 再安装）。
2. 重载 DSH 页面，左侧边栏会出现「每日简报」。
3. 打开面板，插件会自动创建配置目录：`%USERPROFILE%\.dsh\storages\daily-brief\`。

## 首次使用

1. **简报风格**：点一张人设卡。卡片下方会列出这张卡的约束（例如军官卡「动词开头、每条 ≤24 字」）。
2. **关注范围 → X 账号**：粘贴你想看的账号 ID（`OpenAI`、`@AnthropicAI` 都行），一行一个；插件不预置任何账号，AI 板块完全由这些 ID 决定。
3. **关注范围 → 在玩的游戏**：点「从 Steam 库选择」，勾选本机已安装的游戏；也可以直接填 appid。
4. **关注范围 → 服务器与监控**：自己填，例如 `play.example.com:25565`、`192.168.1.20:8123` 或 `http://status.example.com/`。插件不会预置任何服务器。
5. **节奏**：确认每天生成时间（默认 07:30）和「生成后弹出窗口」。
6. 点「立即生成」看效果。之后每天到点自动生成；同一天只生成一次。

## 关注范围

| 类型 | 输入示例 | 行为 |
| --- | --- | --- |
| X 账号 | `OpenAI`、`@AnthropicAI` | 读公开 syndication 时间线，不需要登录；被限流时改用该账号的官方博客 RSS 补位，并显示上次缓存 |
| Steam 游戏 | `502500`，或「从 Steam 库选择」 | 读 Steam 官方新闻接口；连不上时回退到上次成功结果 |
| Minecraft 服务器 | `play.example.com:25565`、`minecraft://mc.example.net` | 原生 Java 状态协议（含 SRV），失败再走 mcstatus.io；离线时底栏写明「离线」 |
| 监控页 / 内网服务 | `http://host:port/`、`10.0.0.5:9000` | 当成「状态来源」记录在线状态与响应时间；内网与 localhost 会自动允许 |

- 条目按时间倒序，超出关注窗口的旧消息不会混进来。
- 服务器与监控只占底栏，加多少个都不挤占 5 条新闻名额。

## 人设卡片

简报页头的名字、问候语、强调色以及 AI 润色的语气，都来自选中的卡片。

| 卡片 | 风格 | 主要约束 |
| --- | --- | --- |
| 🐋 鲸鱼娘 | 蓝色鲸鱼少女，聪明但懒，傲娇又甜 | 称你为「主人」、自称「本鲸」、只说简体中文、绝不承认胖、素材不足会直说 |
| 🗂 助手 | 先结论、后背景，不讲废话 | 短句、不寒暄、标注不确定、只整理事实 |
| 🎩 管家 | 正式、周到，像一份晨间汇报 | 称「您」、结论 → 要点 → 留意、不用感叹号 |
| 🎖 军官 | 作战简报：动词开头，数字优先 | 每条尽量 ≤24 字、时间与数字优先、不对上级提问 |
| 🎨 自定义 | 名字、语气、颜色都由你定 | 名字（24 字内）、一句话签名、主色 `#rrggbb`、语气提示词（2000 字内） |

选中即保存。人设只影响文案与配色，不影响抓取范围。

## 更多来源：邮箱、学校、飞书、订阅

面板的「添加来源」支持一次粘贴多行地址，先「识别」再勾选「加入」。

| 粘贴的内容 | 识别结果 |
| --- | --- |
| `you@gmail.com`、`me@school.edu` | 邮箱（IMAP）。Gmail 用应用专用密码；学校邮箱识别不出服务器时会多出一个 IMAP 服务器输入框 |
| `https://…/feed.xml`、`.ics`、任意网页 | 订阅源 / 日历 / 网页抓取（可加关键词过滤） |
| `https://www.managebac.com/...`、`https://…managebac.cn/...` | ManageBac 通知（.com / .cn 及学校子域；需要登录 Cookie，或日历订阅链接） |
| `https://…feishu.cn/docx|wiki|calendar/...` | 飞书文档 / 知识库 / 日历；前端渲染抓不到时建议用 ICS 订阅 |
| `http://status.example.com/` | 服务器监控来源 |
| `10.0.0.5:9000`、`192.168.1.20:8123` | 同时给出 Minecraft 与 HTTP 监控两个候选，自己勾选 |
| Steam 商店或新闻链接 | 自动取 appid |

- 密码、授权码、Cookie 保存在本机 DPAPI 加密的 secrets 文件里（`…\daily-brief\secrets\`），不写进 `config.json`。
- 网页类来源会自动带上你填的 Cookie 再抓取。
- 5 条预算先给 AI 与游戏；这两个板块安静时，空位会让给邮箱、学校通知、飞书、日历等板块。
- 「来源」卡可以逐个测试、启停、删除；缺登录信息时该行会出现「未填 Cookie / 未填密码」和「补填」按钮，就地粘贴即可，不用删除重加。
- 删除来源会同时清掉该来源保存的密码/Cookie。

### ManageBac 要填什么

两种接法，任选一种：

1. **日历订阅（推荐，不需要登录状态）**：打开 ManageBac →「日历 / Calendar」→ 复制 ICS 订阅链接（通常带一串访问口令）→ 粘贴到「添加来源」。识别为日历来源，每天直接读事件。
2. **网页通知（要 Cookie）**：粘贴学校 ManageBac 的网址（如 `https://www.managebac.com/student/`）→ 识别为「ManageBac」→ 在 Cookie 输入框里粘贴登录 Cookie（浏览器登录后按 F12 → Network → 刷新 → 点任意请求 → 复制 Request Headers 里 `cookie` 冒号后的整段值）。也可以先留空加入，之后在「来源」卡里点「补填」。

Cookie 只保存在本机加密文件里；过期后重新补填一次即可。

## 桌面窗口

生成后调用本机 Edge（没有则 Chrome）以 `--app=file://…` 打开简报：

- 独立窗口、无浏览器外壳，尺寸与位置可配置（默认 560×860，右下角，也可居中）。
- 使用插件自己的临时配置目录，不影响日常浏览器的登录状态。
- 找不到 Chromium 时回退到默认浏览器打开，不会静默失败。

## 计划任务

插件注册名为 **DSH Daily Brief** 的 Windows 计划任务：

- 以当前用户身份、无窗口运行 `lib/engine/runner.js`，不打开 DSH 窗口、不监听端口。
- 生成 `…\daily-brief\briefings\<日期>\index.html`，随后弹出桌面窗口。
- 错过时间会自动补跑；同一天只生成一次（「立即生成」可强制重跑，且不计入自动生成记录）。
- 日志：`…\daily-brief\logs\runner.log`。

## AI 润色

- 默认「自动」：仅当本机 DSH 有可用登录时，用 headless 方式让模型写标题、一句引言和两段要点；失败自动回退本地文案。
- 只改文案，不改抓取结果、不增删条目；提示词里明确禁止编造与出现网址。

## 数据与隐私

- 配置、缓存、简报都在 `%USERPROFILE%\.dsh\storages\daily-brief\`；X 与 Steam 缓存位于其中的 `.cache\`。
- 所有抓取只访问你添加的来源与本机 Steam 安装信息，不发遥测。
- 从 v1 升级：旧的 `preset-*` 大范围来源会被移除，手动添加的来源保留；升级后重启一次 DSH 以获得新识别规则与人设字段。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| 面板提示「重启一次 DSH」 | 插件主进程仍是旧代码：完全退出并重开 DSH，面板会恢复可编辑 |
| X 板块经常很少 | syndication 对同一出口 IP 限流很紧（约每 15 分钟 1 次），插件会自动用官方博客补位；可减少账号数量 |
| Steam 显示「暂时连不上」 | 官方新闻接口偶发超时，会自动显示上次结果；稍后重跑即可 |
| 服务器一直离线 | 确认地址与端口、服务器是否开机；内网地址需允许私有网络（已默认允许） |
| 桌面窗口没出现 | 检查是否安装 Edge/Chrome；查看 `logs\runner.log` 的投递记录 |
| 飞书/ManageBac 抓不到条目 | 多为前端渲染或需要登录：改用日历 ICS 订阅，或在「添加来源」里填入 Cookie |

## 配置参考（`config.json`）

- `sources[]`：`type`（x/steam/minecraft/http/rss/atom/json/ics/page/imap/graph/managebac）、`section`、`label`、`enabled`、`options`。
- `persona`：`preset`（whale/assistant/butler/officer/custom）、`customName`、`customTagline`、`customAccent`、`customPrompt`。
- `schedule`：`time`（HH:MM）、`enabled`、`wakeToRun`。
- `delivery.popup`：`enabled`、`position`、`width`、`height`、`openOnGenerate`。
- `ai.polish`：`auto` / `off`。

## 开发

```bash
npm test                                      # 单元测试（node --test）
node lib/engine/runner.js --dry-run --force   # 生成但不投递，检查输出
node lib/engine/runner.js --force             # 生成并投递（按配置弹窗）
```

目录结构：

- `lib/engine/`：配置、抓取、渲染、AI、弹窗、计划任务。
- `lib/engine/collect/`：各类来源采集器（x、steam、minecraft、feed、http、imap…）。
- `lib/host/`：面板 API、工具注册、计划任务桥接。
- `client.js`：面板 UI（单页）。
- `test/unit.test.mjs`：纯函数与渲染测试。

## 版本与反馈

- 本插件按「每次改动提交一次」维护；仓库地址与提交钩子见 `.githooks/post-commit`。
- 遇到问题请附：生成日期、`logs\runner.log` 相关片段、面板里「来源」卡的测试结果。
