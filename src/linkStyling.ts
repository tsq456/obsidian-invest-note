import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  type PluginValue
} from "@codemirror/view";
import { getAssetSymbolFromHref } from "./stockStore";
import type { InvestmentNotesSettings } from "./types";

const MARKDOWN_STOCK_LINK_REGEX =
  /\[(\$[^\]\n]+?\$)\]\((https?:\/\/xueqiu\.com\/S\/(?:SH|SZ|BJ)\d{6}[^\)]*)\)/gi;
const RENDERED_STOCK_LABEL_REGEX = /^\$\s*(.+?)\s*\$$/;

export function decorateRenderedStockLinks(el: HTMLElement): void {
  el.querySelectorAll<HTMLAnchorElement>("a").forEach((anchor) => {
    const href = anchor.getAttribute("href") ?? "";
    if (!getAssetSymbolFromHref(href)) {
      return;
    }

    anchor.addClass("stock-note-link");
    anchor.addClass("stock-note-link-rendered");
    spaceRenderedStockLabel(anchor);
  });
}

function spaceRenderedStockLabel(anchor: HTMLAnchorElement): void {
  if (anchor.childNodes.length !== 1 || anchor.firstChild?.nodeType !== Node.TEXT_NODE) {
    return;
  }

  const label = anchor.textContent ?? "";
  const match = label.match(RENDERED_STOCK_LABEL_REGEX);
  if (!match) {
    return;
  }

  anchor.textContent = `$ ${match[1]} $`;
}

export function createStockLinkDecorationExtension() {
  return ViewPlugin.fromClass(
    class implements PluginValue {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view);
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildDecorations(update.view);
        }
      }
    },
    {
      decorations: (value) => value.decorations
    }
  );
}

export function applyStockLinkStyleVariables(settings: InvestmentNotesSettings): void {
  const root = document.body;
  root.style.setProperty("--stock-note-link-color", settings.linkTextColor);
  root.style.setProperty("--stock-note-link-bg", settings.linkBackgroundColor);
  root.style.setProperty("--stock-note-link-border", settings.linkBorderColor);
  root.style.setProperty("--stock-note-link-font-weight", settings.linkBold ? "600" : "inherit");
  root.toggleClass("stock-note-link-pill-disabled", !settings.linkPillStyle);
}

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();

  for (const range of view.visibleRanges) {
    const text = view.state.doc.sliceString(range.from, range.to);
    MARKDOWN_STOCK_LINK_REGEX.lastIndex = 0;

    for (let match = MARKDOWN_STOCK_LINK_REGEX.exec(text); match; match = MARKDOWN_STOCK_LINK_REGEX.exec(text)) {
      const label = match[1];
      const href = match[2];
      const symbol = getAssetSymbolFromHref(href);
      if (!symbol) {
        continue;
      }
      const matchStart = range.from + match.index;
      const labelStart = matchStart + 1;
      const labelEnd = labelStart + label.length;
      const stockLinkMark = Decoration.mark({
        attributes: {
          class: "stock-note-link stock-note-link-cm",
          "data-stock-note-symbol": symbol,
          "data-stock-note-asset-type": getAssetTypeFromSymbol(symbol)
        }
      });
      builder.add(labelStart, labelEnd, stockLinkMark);
    }
  }

  return builder.finish();
}

function getAssetTypeFromSymbol(symbol: string): string {
  if (isEtfSymbol(symbol)) {
    return "etf";
  }

  return "stock";
}

function isEtfSymbol(symbol: string): boolean {
  const code = symbol.slice(2);
  return /^(15|51|56|58)\d{4}$/.test(code);
}
