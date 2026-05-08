import { Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, TFile } from "obsidian";
import type InvestmentNotesPlugin from "./main";
import type { InvestmentAsset } from "./types";

export class StockSuggest extends EditorSuggest<InvestmentAsset> {
  constructor(private readonly plugin: InvestmentNotesPlugin) {
    super(plugin.app);
  }

  onTrigger(
    cursor: EditorPosition,
    editor: Editor,
    _file: TFile | null
  ): EditorSuggestTriggerInfo | null {
    const triggerKeyword = this.plugin.data.settings.triggerKeyword;
    if (!triggerKeyword) {
      return null;
    }

    const line = editor.getLine(cursor.line);
    const beforeCursor = line.slice(0, cursor.ch);
    const triggerIndex = beforeCursor.lastIndexOf(triggerKeyword);
    if (triggerIndex < 0) {
      return null;
    }

    const query = beforeCursor.slice(triggerIndex + triggerKeyword.length);
    if (!isValidQueryFragment(query)) {
      return null;
    }

    return {
      start: {
        line: cursor.line,
        ch: triggerIndex
      },
      end: cursor,
      query
    };
  }

  getSuggestions(context: EditorSuggestContext): InvestmentAsset[] {
    return this.plugin.stockStore.search(context.query);
  }

  renderSuggestion(stock: InvestmentAsset, el: HTMLElement): void {
    el.addClass("investment-notes-suggestion");

    const nameEl = el.createDiv({ cls: "investment-notes-suggestion-name" });
    nameEl.setText(stock.name);

    const metaEl = el.createDiv({ cls: "investment-notes-suggestion-meta" });
    metaEl.setText(`${getAssetTypeLabel(stock)} · ${stock.symbol} · ${stock.category ?? stock.abbr}`);
  }

  selectSuggestion(stock: InvestmentAsset): void {
    if (!this.context) {
      return;
    }

    const replacement = `[$${stock.name}$](${stock.url})`;
    this.context.editor.replaceRange(replacement, this.context.start, this.context.end);
  }
}

function getAssetTypeLabel(asset: InvestmentAsset): string {
  if (asset.assetType === "etf") return "ETF";
  if (asset.assetType === "fund") return "场外基金";
  return "股票";
}

function isValidQueryFragment(query: string): boolean {
  if (query.includes("\t") || query.includes("\n")) {
    return false;
  }

  if (/\s/.test(query)) {
    return false;
  }

  return !/[\[\]\(\)]/.test(query);
}
