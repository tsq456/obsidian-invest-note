import { Notice, requestUrl } from "obsidian";
import { copyChartSnapshotToClipboard } from "./chartSnapshot";
import type InvestmentNotesPlugin from "./main";
import { getSinaChartUrl, getXueqiuSymbolFromHref } from "./stockStore";
import type { ChartPeriod, InvestmentNotesData } from "./types";

const CHART_PERIODS: Array<{ value: ChartPeriod; label: string }> = [
  { value: "min", label: "分时" },
  { value: "daily", label: "日K" },
  { value: "weekly", label: "周K" },
  { value: "monthly", label: "月K" }
];
const DEFAULT_PERIOD: ChartPeriod = "min";

type QuoteSnapshot = {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  previousClose: number | null;
  changeAmount: number | null;
  changePercent: number | null;
  volume: number | null;
  amount: number | null;
};

type EastMoneyQuoteResponse = {
  data?: {
    f43?: number;
    f44?: number;
    f45?: number;
    f46?: number;
    f47?: number;
    f48?: number;
    f60?: number;
    f169?: number;
    f170?: number;
    f86?: number;
  };
};

export class HoverPreview {
  private popoverEl: HTMLElement | null = null;
  private hideTimer: number | null = null;
  private activePeriod: ChartPeriod = DEFAULT_PERIOD;
  private activeSymbol: string | null = null;
  private readonly quoteCache = new Map<string, QuoteSnapshot>();

  constructor(
    private readonly plugin: InvestmentNotesPlugin,
    private readonly data: InvestmentNotesData
  ) {}

  register(): void {
    this.plugin.registerDomEvent(document, "mouseover", (event) => {
      const anchor = this.findStockAnchor(event.target);
      if (!anchor) {
        return;
      }

      const href = anchor.getAttribute("href") ?? "";
      const symbol = getXueqiuSymbolFromHref(href);
      if (!symbol || !this.data.settings.enableHoverPreview) {
        return;
      }

      this.show(anchor, symbol);
    });

    this.plugin.registerDomEvent(document, "mouseout", (event) => {
      const relatedTarget = event.relatedTarget as Node | null;
      const target = event.target as Node | null;
      if (!target || !this.popoverEl) {
        return;
      }

      const anchor = this.findStockAnchor(target);
      if (!anchor && !this.popoverEl.contains(target)) {
        return;
      }

      if (relatedTarget && (this.popoverEl.contains(relatedTarget) || anchor?.contains(relatedTarget))) {
        return;
      }

      this.scheduleHide();
    });
  }

  private show(anchor: HTMLAnchorElement, symbol: string): void {
    this.clearHideTimer();
    this.popoverEl?.remove();
    this.activeSymbol = symbol;
    this.activePeriod = normalizeChartPeriod(this.data.settings.defaultChartPeriod);

    const popover = document.body.createDiv({ cls: "stock-note-popover" });
    const header = popover.createDiv({ cls: "stock-note-popover-header" });
    header.createSpan({
      cls: "stock-note-popover-symbol",
      text: this.getDisplayTitle(symbol)
    });

    const quoteEl = popover.createDiv({ cls: "stock-note-quote-section" });
    void this.renderQuote(symbol, quoteEl);

    const periodControls = popover.createDiv({ cls: "stock-note-period-tabs" });
    const imageWrap = popover.createDiv({ cls: "stock-note-popover-image-wrap" });
    CHART_PERIODS.forEach((period) => {
      const button = periodControls.createEl("button", {
        cls: "stock-note-period-tab",
        text: period.label,
        attr: {
          type: "button"
        }
      });
      if (period.value === this.activePeriod) {
        button.addClass("is-active");
      }
      button.addEventListener("click", () => {
        this.activePeriod = period.value;
        periodControls.querySelectorAll(".stock-note-period-tab").forEach((el) => el.removeClass("is-active"));
        button.addClass("is-active");
        this.renderChart(symbol, imageWrap);
      });
    });
    this.renderChart(symbol, imageWrap);

    const actions = popover.createDiv({ cls: "stock-note-popover-actions" });
    const snapshotButton = actions.createEl("button", {
      cls: "stock-note-action-button",
      text: "复制快照",
      attr: {
        type: "button"
      }
    });
    snapshotButton.addEventListener("click", () => {
      void this.copyCurrentChartSnapshot(symbol, snapshotButton);
    });

    popover.addEventListener("mouseenter", () => this.clearHideTimer());
    popover.addEventListener("mouseleave", () => this.scheduleHide());

    document.body.appendChild(popover);
    this.positionPopover(anchor, popover);
    this.popoverEl = popover;
  }

  private async copyCurrentChartSnapshot(symbol: string, button: HTMLButtonElement): Promise<void> {
    const originalText = button.textContent ?? "复制快照";
    button.disabled = true;
    button.setText("复制中...");

    try {
      await copyChartSnapshotToClipboard({
        symbol,
        period: this.activePeriod
      });
      new Notice("走势图快照已复制，可在笔记中粘贴");
    } catch (error) {
      const message = error instanceof Error ? error.message : "走势图快照复制失败";
      console.warn("[investment-notes] Failed to copy chart snapshot", error);
      new Notice(message || "走势图快照复制失败");
    } finally {
      button.disabled = false;
      button.setText(originalText);
    }
  }

  private async renderQuote(symbol: string, quoteEl: HTMLElement): Promise<void> {
    quoteEl.empty();
    quoteEl.createSpan({ cls: "stock-note-quote-loading", text: "行情加载中..." });

    try {
      const quote = await this.getQuoteSnapshot(symbol);
      if (symbol !== this.activeSymbol) {
        return;
      }

      quoteEl.empty();
      renderPriceSummary(quoteEl, quote);
      const detailEl = quoteEl.createDiv({ cls: "stock-note-quote-row" });
      addQuoteItem(detailEl, "日期", quote.date);
      addQuoteItem(detailEl, "开盘", formatPrice(quote.open), getPriceChangeClass(quote.open, quote.previousClose));
      addQuoteItem(detailEl, "最高", formatPrice(quote.high), getPriceChangeClass(quote.high, quote.previousClose));
      addQuoteItem(detailEl, "最低", formatPrice(quote.low), getPriceChangeClass(quote.low, quote.previousClose));
      addQuoteItem(detailEl, "收盘", formatPrice(quote.close), getPriceChangeClass(quote.close, quote.previousClose));
      addQuoteItem(detailEl, "成交量", formatVolumeHands(quote.volume));
      addQuoteItem(detailEl, "成交额", formatAmount(quote.amount));
    } catch (error) {
      console.warn("[investment-notes] Failed to load quote snapshot", error);
      if (symbol === this.activeSymbol) {
        quoteEl.empty();
        quoteEl.createSpan({ cls: "stock-note-quote-loading", text: "行情暂不可用" });
      }
    }
  }

  private renderChart(symbol: string, imageWrap: HTMLElement): void {
    imageWrap.empty();
    const loading = imageWrap.createDiv({ cls: "stock-note-popover-loading", text: "图表加载中..." });
    const chartUrl = getSinaChartUrl(symbol, this.activePeriod);
    if (!chartUrl) {
      loading.setText("图表暂不可用");
      return;
    }

    const img = imageWrap.createEl("img", {
      cls: "stock-note-popover-image",
      attr: {
        src: chartUrl,
        alt: `${symbol} 图表`
      }
    });
    img.hide();

    img.addEventListener("load", () => {
      loading.hide();
      img.show();
    });
    img.addEventListener("error", () => {
      loading.setText("图表暂不可用");
    });
  }

  private async getQuoteSnapshot(symbol: string): Promise<QuoteSnapshot> {
    const cached = this.quoteCache.get(symbol);
    if (cached) {
      return cached;
    }

    const quote = await fetchQuoteSnapshot(symbol);
    this.quoteCache.set(symbol, quote);
    return quote;
  }

  private getDisplayTitle(symbol: string): string {
    const stock = this.plugin.stockStore.getBySymbol(symbol);
    const code = toTushareDisplayCode(symbol);
    return stock ? `${stock.name}（${code}）` : code;
  }

  private positionPopover(anchor: HTMLAnchorElement, popover: HTMLElement): void {
    const anchorRect = anchor.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const margin = 8;

    let top = anchorRect.bottom + margin;
    let left = anchorRect.left;

    if (left + popoverRect.width > window.innerWidth - margin) {
      left = window.innerWidth - popoverRect.width - margin;
    }

    if (top + popoverRect.height > window.innerHeight - margin) {
      top = anchorRect.top - popoverRect.height - margin;
    }

    popover.style.left = `${Math.max(margin, left)}px`;
    popover.style.top = `${Math.max(margin, top)}px`;
  }

  private findStockAnchor(target: EventTarget | Node | null): HTMLAnchorElement | null {
    if (!(target instanceof HTMLElement)) {
      return null;
    }

    const anchor = target.closest("a");
    if (!(anchor instanceof HTMLAnchorElement)) {
      return null;
    }

    const href = anchor.getAttribute("href") ?? "";
    return getXueqiuSymbolFromHref(href) ? anchor : null;
  }

  private scheduleHide(): void {
    this.clearHideTimer();
    this.hideTimer = window.setTimeout(() => {
      this.popoverEl?.remove();
      this.popoverEl = null;
    }, 120);
  }

  private clearHideTimer(): void {
    if (this.hideTimer !== null) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }
}

async function fetchQuoteSnapshot(symbol: string): Promise<QuoteSnapshot> {
  const secid = toEastMoneySecid(symbol);
  if (!secid) {
    throw new Error(`Unsupported symbol: ${symbol}`);
  }

  const response = await requestUrl({
    url: `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fields=f43,f44,f45,f46,f47,f48,f60,f86,f169,f170`,
    method: "GET",
    headers: {
      Accept: "application/json,text/plain,*/*",
      Referer: "https://quote.eastmoney.com/",
      "User-Agent": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Obsidian Investment Notes"
    }
  });
  const data = (response.json as EastMoneyQuoteResponse).data;
  if (!data) {
    throw new Error("Empty quote response");
  }

  return {
    date: data.f86 ? formatDate(new Date(data.f86 * 1000)) : "-",
    open: toNullableNumber(data.f46),
    high: toNullableNumber(data.f44),
    low: toNullableNumber(data.f45),
    close: toNullableNumber(data.f43),
    previousClose: toNullableNumber(data.f60),
    changeAmount: toNullableNumber(data.f169),
    changePercent: toNullableNumber(data.f170),
    volume: toNullableNumber(data.f47),
    amount: toNullableNumber(data.f48)
  };
}

function renderPriceSummary(parent: HTMLElement, quote: QuoteSnapshot): void {
  const changeClass = getValueChangeClass(quote.changeAmount);
  const summary = parent.createDiv({ cls: "stock-note-price-summary" });
  const priceEl = summary.createSpan({
    cls: "stock-note-price-current",
    text: formatCurrencyPrice(quote.close)
  });
  const changeAmountEl = summary.createSpan({
    cls: "stock-note-price-change",
    text: formatSignedPrice(quote.changeAmount)
  });
  const changePercentEl = summary.createSpan({
    cls: "stock-note-price-change",
    text: formatSignedPercent(quote.changePercent)
  });

  if (changeClass) {
    priceEl.addClass(changeClass);
    changeAmountEl.addClass(changeClass);
    changePercentEl.addClass(changeClass);
  }
}

function addQuoteItem(parent: HTMLElement, label: string, value: string, valueClass?: string): void {
  const item = parent.createSpan({ cls: "stock-note-quote-item" });
  item.createSpan({ cls: "stock-note-quote-label", text: `${label}: ` });
  const valueEl = item.createSpan({ cls: "stock-note-quote-value", text: value });
  if (valueClass) {
    valueEl.addClass(valueClass);
  }
}

function getPriceChangeClass(value: number | null, previousClose: number | null): string | undefined {
  if (value === null || previousClose === null) {
    return undefined;
  }

  return getValueChangeClass(value - previousClose);
}

function getValueChangeClass(value: number | null): string | undefined {
  if (value === null || value === 0) {
    return undefined;
  }

  return value > 0 ? "stock-note-change-up" : "stock-note-change-down";
}

function normalizeChartPeriod(period: string): ChartPeriod {
  return CHART_PERIODS.some((item) => item.value === period) ? (period as ChartPeriod) : DEFAULT_PERIOD;
}

function toEastMoneySecid(symbol: string): string | null {
  const match = symbol.toUpperCase().match(/^(SH|SZ|BJ)(\d{6})$/);
  if (!match) {
    return null;
  }

  const marketCode = match[1] === "SH" ? "1" : "0";
  return `${marketCode}.${match[2]}`;
}

function toTushareDisplayCode(symbol: string): string {
  const match = symbol.toUpperCase().match(/^(SH|SZ|BJ)(\d{6})$/);
  return match ? `${match[2]}.${match[1]}` : symbol;
}

function toNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatPrice(value: number | null): string {
  return value === null ? "-" : value.toFixed(2);
}

function formatCurrencyPrice(value: number | null): string {
  return value === null ? "-" : `￥${value.toFixed(2)}`;
}

function formatSignedPrice(value: number | null): string {
  if (value === null) {
    return "-";
  }

  return `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
}

function formatSignedPercent(value: number | null): string {
  if (value === null) {
    return "-";
  }

  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatVolumeHands(value: number | null): string {
  if (value === null) {
    return "-";
  }

  if (Math.abs(value) >= 10000) {
    return `${(value / 10000).toFixed(2)}万手`;
  }

  return `${value.toFixed(0)}手`;
}

function formatAmount(value: number | null): string {
  if (value === null) {
    return "-";
  }

  if (Math.abs(value) >= 100000000) {
    return `${(value / 100000000).toFixed(2)}亿`;
  }

  if (Math.abs(value) >= 10000) {
    return `${(value / 10000).toFixed(2)}万`;
  }

  return value.toFixed(0);
}
