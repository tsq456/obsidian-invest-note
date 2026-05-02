# Obsidian Invest Note

Obsidian Invest Note 是一个用于 A 股复盘笔记的 Obsidian 插件。它支持股票搜索补全、生成雪球个股链接，并在鼠标悬浮时展示新浪财经图表图片。

## 功能

- 默认输入 `$` 触发 A 股股票搜索。
- 支持按中文名称、拼音首字母、拼音全拼、股票代码、雪球 symbol 搜索。
- 选择股票后插入标准 Markdown 链接，例如：

  ```md
  [$寒武纪$](https://xueqiu.com/S/SH688256)
  ```

- 鼠标悬浮雪球股票链接时展示新浪财经图表。
- 支持自定义触发关键字、悬浮图周期、股票短链颜色和样式。
- 股票列表使用本地缓存，并支持远端刷新。
- 配置了具备权限的 Tushare Token 时，优先使用 Tushare `stock_basic`；否则回退到东方财富。

## 手动安装

1. 构建插件：

   ```bash
   npm install
   npm run build
   ```

2. 将本目录复制到 Obsidian 库的插件目录：

   ```text
   <你的 Obsidian 库>/.obsidian/plugins/investment-notes/
   ```

3. 确认插件目录至少包含：

   ```text
   manifest.json
   main.js
   styles.css
   data/stocks.seed.json
   ```

4. 在 Obsidian 的“第三方插件”中启用 `Investment Notes`。

## 使用方式

输入触发关键字和搜索内容：

```md
$寒
$hwj
$688256
```

从候选列表中选择股票后，插件会插入：

```md
[$寒武纪$](https://xueqiu.com/S/SH688256)
```

在阅读模式或实时预览中，将鼠标移到股票链接上，会显示配置周期对应的新浪财经图表。点击链接会打开雪球个股页面。

## 设置项

- `触发关键字`：默认 `$`，可改成 `@`、`$$`、`stock:` 等固定字符串。
- `Tushare Token`：可选。填写后刷新股票列表会优先调用 Tushare `stock_basic`。
- `自动更新股票列表`：启动后按刷新周期后台更新本地股票缓存。
- `刷新周期`：默认 7 天。
- `默认图表周期`：支持 `min`、`daily`、`weekly`、`monthly`。
- `启用悬浮图表`：开启或关闭 hover 图表预览。
- 股票短链样式：文本颜色、背景色、边框色、是否加粗、是否启用胶囊背景。

## 数据源说明

股票列表：

- 优先数据源：Tushare `stock_basic`，需要用户配置具备权限的 token。
- 兜底数据源：东方财富 `push2delay` 分页接口。
- 离线兜底：插件内置的 `data/stocks.seed.json`。

悬浮图表：

- 使用新浪财经图片地址：

  ```text
  https://image.sinajs.cn/newchart/{period}/n/{market}{code}.gif
  ```

这些都是外部数据源，插件无法承诺稳定性。远端请求失败时会继续使用本地缓存或内置种子库。

## 开发

```bash
npm install
npm run build
```

主要模块：

- `src/stockStore.ts`：股票列表加载、搜索、Tushare/东方财富刷新、symbol 转换。
- `src/stockSuggest.ts`：编辑器补全和 Markdown 链接插入。
- `src/hoverPreview.ts`：悬浮图表浮窗。
- `src/linkStyling.ts`：阅读模式链接样式和 CodeMirror 装饰。
- `src/settings.ts`：插件设置页。

