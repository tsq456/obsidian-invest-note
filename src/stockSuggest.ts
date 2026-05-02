import { Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, TFile } from "obsidian";
import type InvestmentNotesPlugin from "./main";
import type { StockInfo } from "./types";

export class StockSuggest extends EditorSuggest<StockInfo> {
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

  getSuggestions(context: EditorSuggestContext): StockInfo[] {
    return this.plugin.stockStore.search(context.query);
  }

  renderSuggestion(stock: StockInfo, el: HTMLElement): void {
    el.addClass("investment-notes-suggestion");

    const nameEl = el.createDiv({ cls: "investment-notes-suggestion-name" });
    nameEl.setText(stock.name);

    const metaEl = el.createDiv({ cls: "investment-notes-suggestion-meta" });
    metaEl.setText(`${stock.symbol} · ${stock.abbr}`);
  }

  selectSuggestion(stock: StockInfo): void {
    if (!this.context) {
      return;
    }

    const replacement = `[$${stock.name}$](${stock.xueqiu})`;
    this.context.editor.replaceRange(replacement, this.context.start, this.context.end);
  }
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
