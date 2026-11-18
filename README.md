# nav-crawler · 垂直领域导航站爬虫

把任意「导航站 / 垂直领域导航页」的分级结构（大类 → 小类 → 站点链接）解析成结构化数据，落地为 **Markdown + JSON + CSV/MySQL/Mongo**，并内置内容过滤、合规度评估、去重与增量标记。

仓库地址：`git@github.com:xiaorunbao/nav-crawler.git`

- 目标站点通过配置驱动，不改代码即可换站
- 支持单页解析，也支持跟随翻页 / 子导航页深抓并跨页合并同名分类
- 分类容器解析失败时自动退化为「按标题层级」的通用解析
- 结构特殊的站点（如 XenForo / onenav 主题）可挂专用适配器，配置里一行 `adapter` 即可切换
- 成人/违规内容按分类名、链接名、描述、URL 四路过滤，输出过滤明细供核对
- 分类级合规度画像（adult / piracy / gambling 信号，只出聚合比例，不落地条目）
- 同一子类内 URL 去重、跨子类保留（同一工具可归属多个垂直领域），同时统计唯一链接数
- 状态持久化，第二次抓取标记「新增」
- 产物可导出 CSV / MySQL / MongoDB 三类落库格式，配套本地 MySQL 容器与备份回滚脚本
- `web/` 内含一个 Next.js 前端原型，消费导航数据结构做展示

## 环境要求

| 部分           | 要求                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------- |
| 爬虫 / 导出    | Node.js ≥ 18，依赖仅 `cheerio`                                                             |
| 前端 `web/`  | Node.js ≥ 20.9，包管理器固定 **pnpm**（见 `web/package.json` 的 `packageManager`） |
| 数据库（可选） | Docker + Docker Compose（MySQL 8.4，宿主机端口默认 3307）                                     |

## 快速开始

```bash
git clone git@github.com:xiaorunbao/nav-crawler.git
cd nav-crawler
npm install
```

### 抓取

```bash
node src/cli.js --list            # 查看已配置站点
node src/cli.js --site jubt5      # 抓指定站点
```

`examples/sample-site/` 是一个离线演示站点（`index.html` + `page-2.html`），在 `config/sites.json` 里加一条 `entry` 指向本地文件的站点即可不联网验证选择器与翻页逻辑。

产物落在 `output/<站点名>/`：

| 文件                                   | 说明                                                                                    |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| `navigation.md`                      | 分级导航清单：二级导航页概览、分类目录、每类链接数、合规度分布、`新增` 标记           |
| `links.json`                         | 结构化数据：`meta` + `stats` + `filterSummary` + `riskSummary` + `categories` |
| `rejected.json`                      | 被过滤条目及原因（站点声明 `writeRejected: false` 时不生成）                          |
| `db/csv`、`db/mysql`、`db/mongo` | 由 `export-db.js` 生成的落库文件                                                      |
| `output/state.json`                  | 跨次运行状态，记录每个 URL 首次/最近出现时间（`structureOnly` 站点不写入）            |

## 接入自己的导航站

1. 打开 `config/sites.json`，在 `sites` 里增一条（`defaults` 中的选择器/参数会被按需覆盖）：

```json
{
  "name": "my-nav-site",
  "enabled": true,
  "entry": "https://your-domain.com/cn/index.html",
  "selectors": {
    "category": ".nav-section",
    "categoryName": "h2",
    "subCategory": ".nav-group",
    "subCategoryName": "h3",
    "link": "a.nav-item",
    "linkName": ".title",
    "linkDesc": ".desc"
  },
  "deep": { "enabled": true, "followSelector": ".pagination a.next", "maxDepth": 2 }
}
```

2. 跑 `node src/cli.js --site my-nav-site`。

### 选择器怎么定

| 字段                          | 含义                       | 备注                                           |
| ----------------------------- | -------------------------- | ---------------------------------------------- |
| `selectors.category`        | 大类容器的 CSS 选择器      | 留空则走通用标题分层解析                       |
| `selectors.categoryName`    | 大类名称节点               | 缺失时依次尝试 `data-cat`、容器内首个标题    |
| `selectors.subCategory`     | 小类容器（嵌在大类内）     | 缺失则大类下链接归到「全部站点」               |
| `selectors.subCategoryName` | 小类名称节点               | 缺失时尝试 `data-sub`、容器内首个 h3/h4      |
| `selectors.link`            | 链接元素                   | 默认 `a`                                     |
| `selectors.linkName`        | 链接名称节点               | 置空则自动推断（常见类名 → 首个子元素）       |
| `selectors.linkDesc`        | 链接描述节点               | 置空则不输出描述                               |
| `deep.followSelector`       | 翻页/子导航链接            | 配合 `deep.enabled`、`maxDepth`            |
| `deep.sameHostOnly`         | 只跟随同域页面             | 默认 `true`                                  |
| `fetch.cookie`              | 手动带 Cookie              | 用于免登录/无验证码的受限页面                  |
| `excludeCategories`         | 整块排除的分类名关键词     | 只记数量，不落地条目                           |
| `structureOnly`             | 只输出分类骨架与数量       | 不落地链接、不写状态，适合高风险站点做结构快照 |
| `writeRejected`             | 是否生成 `rejected.json` | 被过滤条目可能敏感，可置 `false`             |

不确定结构时，先用浏览器开发者工具选中一个分类标题，看它的父级 class，把父级 class 填给 `category`，标题标签填给 `categoryName`，依此类推。完全没有规律结构的站点，直接不写 `selectors`，让通用解析按 `h1/h2`（大类）、`h3/h4`（小类）切分。

## 已内置的站点适配器

### jubt5.one（XenForo 风格导航模板）

`config/sites.json` 里的 `jubt5` 站点走 `src/adapters/jubt.js`：

- `h4` 大类 + `xe-widget` 卡片，外链在 `data-original-title` / `myopener()` 里
- 左侧 `#main-menu` 的 `.html` 链接是二级导航页（影视解说 / 磁力影视 / 网盘 / 电子书 / 小说 / ACG / 音乐 / ASMR / 软件游戏 等），适配器自动跟随并跨页合并同名分类
- 已配置 `excludeCategories: ["置顶推荐"]`、`delayMs: 700`、`structureOnly: true`（只留分类骨架与数量，不落地链接、不写 state）

### ai-bot.cn（AI 工具集导航，onenav 主题）

`src/adapters/ai-bot.js`：

- 首页每个 `<h4 class="text-gray">` 是一个大类，其下卡片 `.url-body` 归入该大类
- 卡片真实外链取 `data-url`；指向站内详情页（`/sites/xxx.html`）的卡片，再抓一次详情页取「访问官网」按钮的真实地址
- Tab 面板标题作为子类名，不属于任何面板的卡片归到「精选工具」
- 一次运行约 35 个请求（1 首页 + 31 详情页），按 `delayMs` 限速

### 复用与新增

结构同属 onenav 主题的站点，配置里写 `"adapter": "ai-bot"` 即可；结构不同的，在 `src/adapters/` 下新增一个导出 `crawl(site, defaults, options)` 的模块，返回 `{ site, pages, categories, stats, warnings }`，配置里 `"adapter": "模块名"` 就能挂上。

## 过滤与合规度

内置清单在 [filter.js](src/filter.js) 的 `DEFAULT_BLOCKLIST`、[risk.js](src/risk.js) 的 `DEFAULT_RISK_RULES`，`config/blocklist.json` 与之取并集：

```json
{
  "categories": ["棋牌娱乐示例"],
  "strongKeywords": ["约炮平台"],
  "wordKeywords": [],
  "domains": ["example.com"],
  "allow": ["javafx.example", "javascript.info"],
  "risk": {
    "piracy": [],
    "nameTokens": [],
    "gambling": [],
    "thresholds": { "low": 0.15, "medium": 0.4 }
  }
}
```

- `categories`：只匹配分类名/子分类名，命中即整块丢弃
- `strongKeywords`：子串匹配，对名称、描述、URL 生效
- `wordKeywords`：英文按单词边界匹配（`jav` 不会误伤 `javafx`）
- `domains`：按域名后缀匹配
- `allow`：白名单，命中即放行（救回误杀）
- `risk`：合规度信号词与阈值；分类按 adult / piracy / gambling 命中比例分为 `clean / low / medium / high`，只输出聚合计数与比例，仅供人工复核，不构成法律判断

调完规则重跑一次，看 `rejected.json` 里有没有误杀、`links.json` 的 `riskSummary` 里有没有该整类排除的分类。

## 命令行参数

```bash
node src/cli.js --site <名称|all>    # 指定站点，默认 all（仅 enabled 站点）
                --config <路径>      # 换配置文件
                --out <目录>         # 换产物目录（state 状态随之独立）
                --list               # 列出站点
                --no-deep            # 关闭翻页深抓
                --delay <毫秒>       # 页面间隔，默认取配置 / 800
                --max-pages <N>      # 单站最多抓几页，默认 30
```

## 数据落库导出

`src/export-db.js` 读取 `output/<站点>/links.json` 与 `output/state.json`，生成六张表的数据：

`nav_site`、`nav_page`、`nav_category`、`nav_sub_category`、`nav_link`、`nav_crawl_state`

```bash
npm run export:db                     # 默认导出 CSV
npm run export:db:all                 # CSV + MySQL + Mongo
node src/export-db.js --site jubt5 --target mysql --db nav
```

| 参数                  | 说明                                                        |
| --------------------- | ----------------------------------------------------------- |
| `--site <名称\|all>` | 默认 `all`（扫描 `output` 下含 `links.json` 的目录）  |
| `--out <目录>`      | 产物根目录，默认 `output`                                 |
| `--target <目标>`   | `csv` / `mysql` / `mongo` / `all`，默认 `csv`     |
| `--db <库名>`       | MySQL 库名，默认 `nav`（仅允许字母、数字、下划线、`$`） |
| `--operator <标识>` | `createBy` / `updateBy` 取值，默认 `nav-crawler`      |
| `--now <ISO时间>`   | 缺失时间字段的兜底时间，默认当前时间                        |

产物位置：`output/<站点>/db/csv/`、`output/<站点>/db/mysql/{schema.sql,data.sql}`、`output/<站点>/db/mongo/*.ndjson`。

## 前端原型（web/）

独立 pnpm 工程：Next.js 16（App Router / Turbopack）+ React 19 + TypeScript + Tailwind CSS 4 + shadcn/ui + Zustand。

```bash
cd web
pnpm install --frozen-lockfile
pnpm dev --port 3100        # http://localhost:3100
pnpm build && pnpm start --port 3100
```

页面：`/` 首页分类导航、`/secondary` 次级导航快捷面板、`/sites/[slug]` 站点详情。依赖全部为精确版本，升级时显式指定版本，勿使用 `^` / `~` 范围，也勿混用 npm / yarn。

## 抓取礼仪与使用边界

- 只抓自己有权访问的站点；抓取前看目标站点的 robots.txt 与服务条款
- 默认 800ms 页面间隔、单站 30 页上限，公开站点建议再调大间隔
- 站内链接、`javascript:` / `mailto:` / 锚点会被跳过；跨域页面默认不跟随
- 不支持需要登录/验证码的页面；这类站点请用 `fetch.cookie` 配置手动带 Cookie
- 高风险站点优先用 `structureOnly: true` 做结构快照，或 `excludeCategories` 整块排除，避免把敏感条目落地