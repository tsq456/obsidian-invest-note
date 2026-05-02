# Agent 说明

这个仓库是一个 Obsidian Community Plugin 风格的 TypeScript 项目，用于实现 A 股投资/复盘笔记能力。

## 当前行为

- 插件插入的是标准 Markdown 链接，不是私有语法：

  ```md
  [$寒武纪$](https://xueqiu.com/S/SH688256)
  ```

- 股票搜索在本地完成，支持名称、代码、雪球 symbol、拼音全拼和拼音首字母。
- 股票列表刷新顺序：
  1. 如果配置了 `settings.tushareToken`，优先调用 Tushare `stock_basic`。
  2. Tushare 未配置或失败时，调用东方财富 `push2delay` 分页接口。
  3. 远端都失败时，继续使用本地缓存或内置种子库。
- 悬浮图表使用新浪财经图片 URL，不解析行情数据，也不自绘图表。
- 悬浮图表上方的行情摘要只展示日期、开盘、最高、最低、收盘、成交量、成交额。
- 分时/日 K/周 K/月 K 使用新浪图片；年 K 使用东方财富历史 K，失败后在有 token 时用 Tushare `daily` 聚合。
- 阅读模式链接通过 Markdown post processor 加样式。
- 实时预览样式通过 CodeMirror decoration 实现。
- 源码模式目前尽量保持 Markdown 原文默认显示；源码模式 hover 尚未实现。

## 构建

```bash
npm install
npm run build
```

构建后会在仓库根目录生成 `main.js`。手动安装 Obsidian 插件时需要：

```text
main.js
manifest.json
styles.css
data/stocks.seed.json
```

## 重要文件

- `src/main.ts`：插件生命周期和扩展注册。
- `src/types.ts`：设置项和股票数据类型。
- `src/stockStore.ts`：股票缓存、搜索评分、Tushare/东方财富请求、symbol 转换。
- `src/stockSuggest.ts`：`EditorSuggest` 实现。
- `src/hoverPreview.ts`：阅读模式/实时预览中的 DOM hover 浮窗。
- `src/linkStyling.ts`：Markdown 后处理和 CodeMirror 装饰。
- `src/settings.ts`：插件设置页。

## 约束

- v1 保持仅支持 A 股，除非产品范围明确变化。
- 不要求用户安装 Python、AkShare 或本地行情服务。
- Tushare 是可选能力，因为它需要 token 和接口权限。
- 东方财富和新浪接口都是非官方免费数据源，只能按 best-effort 处理。
- 不要提交 `node_modules`。

## 后续建议

- 支持源码模式 hover：在 CodeMirror decoration 上写入 `data-stock-symbol`，并让 `hoverPreview.ts` 识别 `.stock-note-link-cm[data-stock-symbol]`。
- 增加股票标准化和搜索评分的小型测试。
- 扩充 `data/stocks.seed.json`，或从一次稳定的远端快照生成种子库。
