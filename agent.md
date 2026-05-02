# Agent Notes

This repository contains an Obsidian Community Plugin-style TypeScript project for A-share investment notes.

## Current Behavior

- The plugin inserts standard Markdown links, not a private syntax:
  - `[$寒武纪$](https://xueqiu.com/S/SH688256)`
- Stock search is local and supports name, code, Xueqiu symbol, pinyin, and pinyin initials.
- The stock list refresh order is:
  1. Tushare `stock_basic`, only when `settings.tushareToken` is configured.
  2. Eastmoney `push2delay` paginated list.
  3. Existing local cache or bundled seed list.
- Hover chart preview uses Sina image URLs and does not parse or draw market data.
- Reading mode links are decorated by a Markdown post processor.
- Live preview styling uses CodeMirror decorations.
- Source mode keeps Markdown text visually close to default; source-mode hover is not implemented yet.

## Build

Use:

```bash
npm install
npm run build
```

The build emits `main.js` at the repository root. `main.js`, `manifest.json`, `styles.css`, and `data/stocks.seed.json` are needed for manual Obsidian installation.

## Important Files

- `src/main.ts`: plugin lifecycle and extension registration.
- `src/types.ts`: settings and stock type definitions.
- `src/stockStore.ts`: stock cache, search scoring, Tushare/Eastmoney fetchers, symbol conversion.
- `src/stockSuggest.ts`: `EditorSuggest` implementation.
- `src/hoverPreview.ts`: DOM hover popover for rendered Xueqiu links.
- `src/linkStyling.ts`: Markdown post-processing and CodeMirror decorations.
- `src/settings.ts`: settings tab.

## Constraints

- Keep v1 A-share only unless the product scope changes.
- Do not require Python, AkShare, or local market-data services.
- Treat Tushare as optional because it needs token permissions.
- Treat Eastmoney and Sina endpoints as best-effort non-official data sources.
- Do not commit `node_modules`.

## Suggested Next Work

- Add source-mode hover support by adding `data-stock-symbol` to CodeMirror decorations and teaching `hoverPreview.ts` to read `.stock-note-link-cm[data-stock-symbol]`.
- Add a compact test harness for stock normalization and search scoring.
- Consider expanding `data/stocks.seed.json` or generating it from a known good snapshot.

