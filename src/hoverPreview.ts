import { requestUrl, type Plugin } from "obsidian";
import { getSinaChartUrl, getXueqiuSymbolFromHref } from "./stockStore";
import type { ChartPeriod, InvestmentNotesData } from "./types";

const CHART_PERIODS: Array<{ value: ChartPeriod; label: string }> = [
  { value: "min", label: "分时" },
  { value: "daily", label: "日K" },
  { value: "weekly", label: "周K" },
  { value: "monthly", label: "月K" },
  { value: "yearly", label: "年K" }
];

type QuoteSnapshot = {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
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
    f86?: number;
  };
};

type EastMoneyKlineResponse = {
  data?: {
    klines?: string[];
  };
};

type KlineBar = {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
};

export class HoverPreview {
  private popoverEl: HTMLElement | null = null;
  private hideTimer: number | null = null;
  private activePeriod: ChartPeriod = "min";
  private activeSymbol: string | null = null;

  constructor(
    private readonly plugin: Plugin,
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
    this.activePeriod = this.data.settings.defaultChartPeriod;

    const popover = document.body.createDiv({ cls: "stock-note-popover" });
    const header = popover.createDiv({ cls: "stock-note-popover-header" });
    header.createSpan({ cls: "stock-note-popover-symbol", text: symbol });

    const periodControls = header.createDiv({ cls: "stock-note-period-tabs" });
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
        void this.renderChart(symbol, imageWrap);
      });
    });

    const quoteEl = popover.createDiv({ cls: "stock-note-quote-row" });
    this.renderQuote(symbol, quoteEl);

    const imageWrap = popover.createDiv({ cls: "stock-note-popover-image-wrap" });
    void this.renderChart(symbol, imageWrap);

    popover.addEventListener("mouseenter", () => this.clearHideTimer());
    popover.addEventListener("mouseleave", () => this.scheduleHide());

    document.body.appendChild(popover);
    this.positionPopover(anchor, popover);
    this.popoverEl = popover;
  }

  private async renderQuote(symbol: string, quoteEl: HTMLElement): Promise<void> {
    quoteEl.empty();
    quoteEl.createSpan({ cls: "stock-note-quote-loading", text: "行情加载中..." });

    try {
      const quote = await fetchQuoteSnapshot(symbol);
      if (symbol !== this.activeSymbol) {
        return;
      }

      quoteEl.empty();
      addQuoteItem(quoteEl, "日期", quote.date);
      addQuoteItem(quoteEl, "开盘", formatPrice(quote.open));
      addQuoteItem(quoteEl, "最高", formatPrice(quote.high));
      addQuoteItem(quoteEl, "最低", formatPrice(quote.low));
      addQuoteItem(quoteEl, "收盘", formatPrice(quote.close));
      addQuoteItem(quoteEl, "成交量", formatVolumeHands(quote.volume));
      addQuoteItem(quoteEl, "成交额", formatAmount(quote.amount));
    } catch (error) {
      console.warn("[investment-notes] Failed to load quote snapshot", error);
      if (symbol === this.activeSymbol) {
        quoteEl.empty();
        quoteEl.createSpan({ cls: "stock-note-quote-loading", text: "行情暂不可用" });
      }
    }
  }

  private async renderChart(symbol: string, imageWrap: HTMLElement): Promise<void> {
    imageWrap.empty();
    const loading = imageWrap.createDiv({ cls: "stock-note-popover-loading", text: "图表加载中..." });

    if (this.activePeriod === "yearly") {
      try {
        const bars = await fetchYearlyKlines(symbol, this.data.settings.tushareToken);
        if (symbol !== this.activeSymbol || this.activePeriod !== "yearly") {
          return;
        }

        imageWrap.empty();
        imageWrap.appendChild(renderYearlyKlineSvg(bars));
      } catch (error) {
        console.warn("[investment-notes] Failed to load yearly kline", error);
        loading.setText("年K暂不可用");
      }
      return;
    }

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

function periodLabel(period: string): string {
  switch (period) {
    case "daily":
      return "日 K";
    case "weekly":
      return "周 K";
    case "monthly":
      return "月 K";
    case "yearly":
      return "年 K";
    default:
      return "分时";
  }
}

async function fetchQuoteSnapshot(symbol: string): Promise<QuoteSnapshot> {
  const secid = toEastMoneySecid(symbol);
  if (!secid) {
    throw new Error(`Unsupported symbol: ${symbol}`);
  }

  const response = await requestUrl({
    url: `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fields=f43,f44,f45,f46,f47,f48,f86`,
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
    volume: toNullableNumber(data.f47),
    amount: toNullableNumber(data.f48)
  };
}

async function fetchYearlyKlines(symbol: string, tushareToken: string): Promise<KlineBar[]> {
  const errors: string[] = [];

  try {
    return await fetchEastMoneyYearlyKlines(symbol);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  if (tushareToken.trim()) {
    try {
      return await fetchTushareYearlyKlines(symbol, tushareToken.trim());
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(errors.join(" | "));
}

async function fetchEastMoneyYearlyKlines(symbol: string): Promise<KlineBar[]> {
  const secid = toEastMoneySecid(symbol);
  if (!secid) {
    throw new Error(`Unsupported symbol: ${symbol}`);
  }

  const hosts = ["push2his.eastmoney.com", "push2.eastmoney.com", "push2delay.eastmoney.com"];
  const errors: string[] = [];

  for (const host of hosts) {
    try {
      const response = await requestUrl({
        url: `https://${host}/api/qt/stock/kline/get?secid=${secid}&ut=fa5fd1943c7b386f172d6893dbfba10b&klt=103&fqt=0&beg=19900101&end=20500101&lmt=240&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55`,
        method: "GET",
        headers: {
          Accept: "application/json,text/plain,*/*",
          Referer: "https://quote.eastmoney.com/",
          "User-Agent": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Obsidian Investment Notes"
        }
      });
      const klines = (response.json as EastMoneyKlineResponse).data?.klines ?? [];
      const bars = aggregateYearlyBars(
        klines.map((line) => {
          const [date, open, close, high, low] = line.split(",");
          return {
            date,
            open: Number(open),
            close: Number(close),
            high: Number(high),
            low: Number(low)
          };
        })
      );

      if (bars.length > 0) {
        return bars;
      }

      errors.push(`${host}: empty klines`);
    } catch (error) {
      errors.push(`${host}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(errors.join(" | "));
}

async function fetchTushareYearlyKlines(symbol: string, token: string): Promise<KlineBar[]> {
  const tsCode = toTushareCode(symbol);
  if (!tsCode) {
    throw new Error(`Unsupported symbol: ${symbol}`);
  }

  const response = await requestUrl({
    url: "https://api.tushare.pro",
    method: "POST",
    contentType: "application/json",
    headers: {
      Accept: "application/json,text/plain,*/*"
    },
    body: JSON.stringify({
      api_name: "daily",
      token,
      params: {
        ts_code: tsCode,
        start_date: "19900101",
        end_date: formatCompactDate(new Date())
      },
      fields: "trade_date,open,high,low,close"
    })
  });

  const body = response.json as {
    code?: number;
    msg?: string;
    data?: {
      fields?: string[];
      items?: unknown[][];
    };
  };
  if (body.code !== 0) {
    throw new Error(body.msg || `Tushare 返回错误 code=${body.code}`);
  }

  const fields = body.data?.fields ?? [];
  const items = body.data?.items ?? [];
  const bars = items
    .map((item) => {
      const record = Object.fromEntries(fields.map((field, index) => [field, item[index]]));
      const tradeDate = typeof record.trade_date === "string" ? record.trade_date : "";
      return {
        date: `${tradeDate.slice(0, 4)}-${tradeDate.slice(4, 6)}-${tradeDate.slice(6, 8)}`,
        open: Number(record.open),
        close: Number(record.close),
        high: Number(record.high),
        low: Number(record.low)
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const yearlyBars = aggregateYearlyBars(bars);
  if (yearlyBars.length === 0) {
    throw new Error("Tushare daily 返回了空数据");
  }

  return yearlyBars;
}

function aggregateYearlyBars(inputBars: KlineBar[]): KlineBar[] {
  const validBars = inputBars.filter(
    (bar) => bar.date && [bar.open, bar.close, bar.high, bar.low].every(Number.isFinite)
  );
  const byYear = new Map<string, KlineBar>();
  for (const bar of validBars) {
    const year = bar.date.slice(0, 4);
    const existing = byYear.get(year);
    if (!existing) {
      byYear.set(year, { date: year, open: bar.open, close: bar.close, high: bar.high, low: bar.low });
      continue;
    }

    existing.close = bar.close;
    existing.high = Math.max(existing.high, bar.high);
    existing.low = Math.min(existing.low, bar.low);
  }

  return Array.from(byYear.values()).slice(-18);
}

function renderYearlyKlineSvg(bars: KlineBar[]): SVGSVGElement {
  const width = 540;
  const height = 260;
  const padding = { top: 16, right: 16, bottom: 28, left: 42 };
  const svg = createSvgElement("svg");
  svg.setAttribute("class", "stock-note-yearly-svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "年K图");

  if (bars.length === 0) {
    const text = createSvgElement("text");
    text.setAttribute("x", String(width / 2));
    text.setAttribute("y", String(height / 2));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("class", "stock-note-yearly-empty");
    text.textContent = "年K暂无数据";
    svg.appendChild(text);
    return svg;
  }

  const high = Math.max(...bars.map((bar) => bar.high));
  const low = Math.min(...bars.map((bar) => bar.low));
  const range = high - low || 1;
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const slot = innerWidth / bars.length;
  const candleWidth = Math.max(5, Math.min(18, slot * 0.48));
  const y = (value: number) => padding.top + ((high - value) / range) * innerHeight;

  const gridTop = createSvgElement("line");
  gridTop.setAttribute("x1", String(padding.left));
  gridTop.setAttribute("x2", String(width - padding.right));
  gridTop.setAttribute("y1", String(padding.top));
  gridTop.setAttribute("y2", String(padding.top));
  gridTop.setAttribute("class", "stock-note-yearly-grid");
  svg.appendChild(gridTop);

  const gridBottom = createSvgElement("line");
  gridBottom.setAttribute("x1", String(padding.left));
  gridBottom.setAttribute("x2", String(width - padding.right));
  gridBottom.setAttribute("y1", String(height - padding.bottom));
  gridBottom.setAttribute("y2", String(height - padding.bottom));
  gridBottom.setAttribute("class", "stock-note-yearly-grid");
  svg.appendChild(gridBottom);

  bars.forEach((bar, index) => {
    const x = padding.left + slot * index + slot / 2;
    const rising = bar.close >= bar.open;
    const cls = rising ? "is-up" : "is-down";

    const wick = createSvgElement("line");
    wick.setAttribute("x1", String(x));
    wick.setAttribute("x2", String(x));
    wick.setAttribute("y1", String(y(bar.high)));
    wick.setAttribute("y2", String(y(bar.low)));
    wick.setAttribute("class", `stock-note-yearly-wick ${cls}`);
    svg.appendChild(wick);

    const bodyTop = y(Math.max(bar.open, bar.close));
    const bodyBottom = y(Math.min(bar.open, bar.close));
    const body = createSvgElement("rect");
    body.setAttribute("x", String(x - candleWidth / 2));
    body.setAttribute("y", String(bodyTop));
    body.setAttribute("width", String(candleWidth));
    body.setAttribute("height", String(Math.max(2, bodyBottom - bodyTop)));
    body.setAttribute("class", `stock-note-yearly-body ${cls}`);
    svg.appendChild(body);

    if (index === 0 || index === bars.length - 1 || index % 3 === 0) {
      const label = createSvgElement("text");
      label.setAttribute("x", String(x));
      label.setAttribute("y", String(height - 8));
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("class", "stock-note-yearly-label");
      label.textContent = bar.date;
      svg.appendChild(label);
    }
  });

  const highLabel = createSvgElement("text");
  highLabel.setAttribute("x", "4");
  highLabel.setAttribute("y", String(padding.top + 4));
  highLabel.setAttribute("class", "stock-note-yearly-axis");
  highLabel.textContent = formatPrice(high);
  svg.appendChild(highLabel);

  const lowLabel = createSvgElement("text");
  lowLabel.setAttribute("x", "4");
  lowLabel.setAttribute("y", String(height - padding.bottom));
  lowLabel.setAttribute("class", "stock-note-yearly-axis");
  lowLabel.textContent = formatPrice(low);
  svg.appendChild(lowLabel);

  return svg;
}

function addQuoteItem(parent: HTMLElement, label: string, value: string): void {
  const item = parent.createSpan({ cls: "stock-note-quote-item" });
  item.createSpan({ cls: "stock-note-quote-label", text: `${label}: ` });
  item.createSpan({ cls: "stock-note-quote-value", text: value });
}

function toEastMoneySecid(symbol: string): string | null {
  const match = symbol.toUpperCase().match(/^(SH|SZ|BJ)(\d{6})$/);
  if (!match) {
    return null;
  }

  const marketCode = match[1] === "SH" ? "1" : "0";
  return `${marketCode}.${match[2]}`;
}

function toTushareCode(symbol: string): string | null {
  const match = symbol.toUpperCase().match(/^(SH|SZ|BJ)(\d{6})$/);
  if (!match) {
    return null;
  }

  return `${match[2]}.${match[1]}`;
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

function formatCompactDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function formatPrice(value: number | null): string {
  return value === null ? "-" : value.toFixed(2);
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

function createSvgElement<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS("http://www.w3.org/2000/svg", tag);
}
