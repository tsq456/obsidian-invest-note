# Obsidian Invest Note

Obsidian Invest Note is an Obsidian plugin for A-share investment notes. It adds stock search completion, Xueqiu stock links, and Sina chart hover previews.

## Features

- Type `$` by default to search A-share stocks by Chinese name, pinyin initials, full pinyin, code, or symbol.
- Insert standard Markdown links such as `[$寒武纪$](https://xueqiu.com/S/SH688256)`.
- Hover Xueqiu stock links to preview Sina Finance chart images.
- Customize the trigger keyword, hover chart period, and short-link colors.
- Maintain a local stock list cache with remote refresh.
- Prefer Tushare `stock_basic` when a valid token with permission is configured; otherwise fall back to Eastmoney.

## Install Manually

1. Run `npm install && npm run build`.
2. Copy this folder to:

   ```text
   <your-vault>/.obsidian/plugins/investment-notes/
   ```

3. Make sure the plugin folder contains:

   ```text
   manifest.json
   main.js
   styles.css
   data/stocks.seed.json
   ```

4. Enable `Investment Notes` in Obsidian community plugins.

## Usage

Type the trigger keyword and a query:

```md
$寒
$hwj
$688256
```

Select a stock from the suggestion list. The plugin inserts:

```md
[$寒武纪$](https://xueqiu.com/S/SH688256)
```

Hover the rendered link to show the configured Sina chart image. Clicking the link opens the Xueqiu stock page.

## Settings

- `Trigger keyword`: defaults to `$`; can be changed to values such as `@`, `$$`, or `stock:`.
- `Tushare Token`: optional. If set, stock list refresh uses Tushare `stock_basic` first.
- `Auto update stock list`: refreshes local stock cache in the background.
- `Refresh interval`: defaults to 7 days.
- `Default chart period`: `min`, `daily`, `weekly`, or `monthly`.
- `Hover preview`: enable or disable chart hover preview.
- Link style settings: text color, background color, border color, bold, and pill style.

## Data Sources

- Stock list:
  - Primary when configured: Tushare `stock_basic`.
  - Fallback: Eastmoney `push2delay` paginated list.
  - Offline fallback: bundled `data/stocks.seed.json`.
- Hover charts:
  - Sina Finance image URL format: `https://image.sinajs.cn/newchart/{period}/n/{market}{code}.gif`.

These are external data sources without plugin-controlled SLA. Failures fall back to local cache where possible.

## Development

```bash
npm install
npm run build
```

Main source modules:

- `src/stockStore.ts`: stock list loading, search, Tushare/Eastmoney refresh, symbol helpers.
- `src/stockSuggest.ts`: editor suggestion and Markdown link insertion.
- `src/hoverPreview.ts`: chart hover popover.
- `src/linkStyling.ts`: rendered link styling and CodeMirror decoration.
- `src/settings.ts`: plugin settings UI.

