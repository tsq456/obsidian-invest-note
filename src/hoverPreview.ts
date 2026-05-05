import { Menu, Notice, requestUrl } from "obsidian";
import {
  ANNOTATION_COLORS,
  ChartAnnotationController,
  DEFAULT_ANNOTATION_COLOR,
  DEFAULT_TEXT_FONT_SIZE,
  MAX_TEXT_FONT_SIZE,
  MIN_TEXT_FONT_SIZE,
  type AnnotationTool
} from "./chartAnnotation";
import { copyChartSnapshotToClipboard, insertChartSnapshotBelowStockParagraph } from "./chartSnapshot";
import type InvestmentNotesPlugin from "./main";
import { getAssetChartUrl, getAssetSymbolFromHref } from "./stockStore";
import type { AssetType, ChartPeriod, InvestmentNotesData } from "./types";

const CHART_PERIODS: Array<{ value: ChartPeriod; label: string }> = [
  { value: "min", label: "分时" },
  { value: "daily", label: "日K" },
  { value: "weekly", label: "周K" },
  { value: "monthly", label: "月K" }
];
const FUND_CHART_PERIODS: Array<{ value: ChartPeriod; label: string }> = [
  { value: "netWorth", label: "净值走势" },
  { value: "accWorth", label: "累计净值" }
];
const DEFAULT_PERIOD: ChartPeriod = "min";
const DEFAULT_FUND_PERIOD: ChartPeriod = "netWorth";
const TEXT_FONT_STEP = 2;

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

type FundQuoteSnapshot = {
  date: string;
  name: string;
  netWorth: number | null;
  accWorth: number | null;
  dailyReturn: number | null;
};

type StockHoverTarget = {
  element: HTMLElement;
  symbol: string;
  assetType: AssetType;
  sourceMode: boolean;
  lineHint: number | null;
};

export class HoverPreview {
  private popoverEl: HTMLElement | null = null;
  private hideTimer: number | null = null;
  private activePeriod: ChartPeriod = DEFAULT_PERIOD;
  private activeSymbol: string | null = null;
  private annotationController: ChartAnnotationController | null = null;
  private annotationTool: AnnotationTool = "arrow";
  private annotationColor = DEFAULT_ANNOTATION_COLOR;
  private annotationFontSize = DEFAULT_TEXT_FONT_SIZE;
  private activeLineHint: number | null = null;
  private activeKeydownHandler: ((event: KeyboardEvent) => void) | null = null;
  private readonly quoteCache = new Map<string, QuoteSnapshot>();
  private readonly fundQuoteCache = new Map<string, FundQuoteSnapshot>();

  constructor(
    private readonly plugin: InvestmentNotesPlugin,
    private readonly data: InvestmentNotesData
  ) {}

  register(): void {
    this.plugin.registerDomEvent(document, "mouseover", (event) => {
      const target = this.findStockHoverTarget(event.target);
      if (!target) {
        return;
      }

      if (!this.data.settings.enableHoverPreview) {
        return;
      }

      if (target.sourceMode && !this.data.settings.enableSourceHoverPreview) {
        return;
      }

      this.show(target.element, target.symbol, target.lineHint);
    });

    this.plugin.registerDomEvent(document, "mouseout", (event) => {
      const relatedTarget = event.relatedTarget as Node | null;
      const target = event.target as Node | null;
      if (!target || !this.popoverEl) {
        return;
      }

      const stockTarget = this.findStockHoverTarget(target);
      if (!stockTarget && !this.popoverEl.contains(target)) {
        return;
      }

      if (relatedTarget && (this.popoverEl.contains(relatedTarget) || stockTarget?.element.contains(relatedTarget))) {
        return;
      }

      this.scheduleHide();
    });
  }

  private show(targetEl: HTMLElement, symbol: string, lineHint: number | null): void {
    this.clearHideTimer();
    this.removePopover();
    const assetType = getAssetTypeFromSymbol(symbol);
    this.activeSymbol = symbol;
    this.activePeriod =
      assetType === "fund" ? DEFAULT_FUND_PERIOD : normalizeMarketChartPeriod(this.data.settings.defaultChartPeriod);
    this.annotationTool = "arrow";
    this.annotationColor = DEFAULT_ANNOTATION_COLOR;
    this.annotationFontSize = DEFAULT_TEXT_FONT_SIZE;
    this.activeLineHint = lineHint;

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
    const actions = popover.createDiv({ cls: "stock-note-popover-actions" });
    getChartPeriods(assetType).forEach((period) => {
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

    this.renderSnapshotControls(actions, symbol);
    this.renderAnnotationControls(actions);
    this.renderChart(symbol, imageWrap);

    popover.addEventListener("mouseenter", () => this.clearHideTimer());
    popover.addEventListener("mouseleave", () => this.scheduleHide());
    this.activeKeydownHandler = (event) => {
      if (event.key === "Escape" && this.annotationController?.handleEscape()) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !isEditableTarget(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        this.annotationController?.undo();
      }
    };
    document.addEventListener("keydown", this.activeKeydownHandler, true);

    document.body.appendChild(popover);
    this.positionPopover(targetEl, popover);
    this.popoverEl = popover;
  }

  private async copyCurrentChartSnapshot(symbol: string, button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    setButtonIcon(button, "copy", "复制中...", true);

    try {
      await copyChartSnapshotToClipboard({
        symbol,
        period: this.activePeriod,
        annotationSnapshot: this.annotationController?.getSnapshot() ?? null
      });
      new Notice("走势图快照已复制，可在笔记中粘贴");
    } catch (error) {
      const message = error instanceof Error ? error.message : "走势图快照复制失败";
      console.warn("[investment-notes] Failed to copy chart snapshot", error);
      new Notice(message || "走势图快照复制失败");
    } finally {
      button.disabled = false;
      setButtonIcon(button, "copy", "复制快照", true);
    }
  }

  private async insertCurrentChartSnapshot(symbol: string): Promise<void> {
    try {
      const imagePath = await insertChartSnapshotBelowStockParagraph({
        app: this.plugin.app,
        symbol,
        period: this.activePeriod,
        annotationSnapshot: this.annotationController?.getSnapshot() ?? null,
        lineHint: this.activeLineHint
      });
      new Notice(`走势图图片已插入：${imagePath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "走势图图片插入失败";
      console.warn("[investment-notes] Failed to insert chart snapshot", error);
      new Notice(message || "走势图图片插入失败");
    }
  }

  private async renderQuote(symbol: string, quoteEl: HTMLElement): Promise<void> {
    quoteEl.empty();
    quoteEl.createSpan({ cls: "stock-note-quote-loading", text: "行情加载中..." });

    try {
      if (getAssetTypeFromSymbol(symbol) === "fund") {
        const quote = await this.getFundQuoteSnapshot(symbol);
        if (symbol !== this.activeSymbol) {
          return;
        }

        quoteEl.empty();
        renderFundSummary(quoteEl, quote);
        const detailEl = quoteEl.createDiv({ cls: "stock-note-quote-row stock-note-fund-quote-row" });
        addQuoteItem(detailEl, "日期", quote.date);
        addQuoteItem(detailEl, "单位净值", formatNetWorth(quote.netWorth));
        addQuoteItem(detailEl, "累计净值", formatNetWorth(quote.accWorth));
        addQuoteItem(detailEl, "日涨幅", formatSignedPercent(quote.dailyReturn), getValueChangeClass(quote.dailyReturn));
        return;
      }

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
    this.annotationController?.destroy();
    this.annotationController = null;
    imageWrap.empty();
    const loading = imageWrap.createDiv({ cls: "stock-note-popover-loading", text: "图表加载中..." });
    const period = this.activePeriod;
    const chartUrl = getAssetChartUrl(symbol, this.activePeriod);
    if (!chartUrl) {
      loading.setText("图表暂不可用");
      return;
    }

    const chartFrame = imageWrap.createDiv({ cls: "stock-note-chart-frame" });
    const img = imageWrap.createEl("img", {
      cls: "stock-note-popover-image",
      attr: {
        src: chartUrl,
        alt: `${symbol} 图表`
      }
    });
    chartFrame.appendChild(img);
    const annotationCanvas = chartFrame.createEl("canvas", {
      cls: "stock-note-annotation-canvas"
    });
    img.hide();
    annotationCanvas.hide();

    img.addEventListener("load", () => {
      if (symbol !== this.activeSymbol || period !== this.activePeriod || !imageWrap.contains(chartFrame)) {
        return;
      }

      loading.hide();
      img.show();
      annotationCanvas.show();
      this.annotationController = new ChartAnnotationController(annotationCanvas, img);
      this.annotationController.setTool(this.annotationTool);
      this.annotationController.setColor(this.annotationColor);
      this.annotationController.setFontSize(this.annotationFontSize);
    });
    img.addEventListener("error", () => {
      loading.setText("图表暂不可用");
    });
  }

  private renderSnapshotControls(actions: HTMLElement, symbol: string): void {
    const group = actions.createDiv({ cls: "stock-note-snapshot-controls" });
    const snapshotButton = group.createEl("button", {
      cls: "stock-note-action-button stock-note-copy-button",
      attr: {
        type: "button"
      }
    });
    setButtonIcon(snapshotButton, "copy", "复制快照", true);
    snapshotButton.addEventListener("click", () => {
      void this.copyCurrentChartSnapshot(symbol, snapshotButton);
    });

    const menuButton = group.createEl("button", {
      cls: "stock-note-action-button stock-note-icon-button stock-note-menu-button",
      attr: {
        type: "button"
      }
    });
    setButtonIcon(menuButton, "chevron-down", "更多操作");
    menuButton.addEventListener("click", (event) => {
      const menu = new Menu();
      menu.addItem((item) =>
        item
          .setTitle("插入图片")
          .setIcon("image-plus")
          .onClick(() => {
            void this.insertCurrentChartSnapshot(symbol);
          })
      );
      menu.showAtMouseEvent(event);
    });
  }

  private renderAnnotationControls(actions: HTMLElement): void {
    const toolButtons = new Map<AnnotationTool, HTMLButtonElement>();
    const colorButtons = new Map<string, HTMLButtonElement>();
    let fontSizeLabel: HTMLElement;

    const setTool = (tool: AnnotationTool) => {
      this.annotationTool = tool;
      this.annotationController?.setTool(tool);
      toolButtons.forEach((button, value) => button.toggleClass("is-active", value === tool));
    };
    const setColor = (color: string) => {
      this.annotationColor = color;
      this.annotationController?.setColor(color);
      colorButtons.forEach((button, value) => button.toggleClass("is-active", value === color));
    };
    const setFontSize = (fontSize: number) => {
      this.annotationFontSize = Math.min(MAX_TEXT_FONT_SIZE, Math.max(MIN_TEXT_FONT_SIZE, fontSize));
      this.annotationController?.setFontSize(this.annotationFontSize);
      fontSizeLabel.setText(`${this.annotationFontSize}`);
    };

    const toolSpecs: Array<{ tool: AnnotationTool; icon: StockNoteIcon; label: string }> = [
      { tool: "arrow" as const, icon: "arrow-up-right", label: "箭头" },
      { tool: "line" as const, icon: "minus", label: "直线" },
      { tool: "rect" as const, icon: "square", label: "矩形" },
      { tool: "polyline" as const, icon: "polyline", label: "折线" },
      { tool: "text" as const, icon: "type", label: "文字" }
    ];

    toolSpecs.forEach(({ tool, icon, label }) => {
      const button = actions.createEl("button", {
        cls: "stock-note-action-button stock-note-icon-button",
        attr: {
          type: "button"
        }
      });
      setButtonIcon(button, icon, label);
      button.addEventListener("click", () => setTool(tool));
      toolButtons.set(tool, button);
    });

    const undoButton = actions.createEl("button", {
      cls: "stock-note-action-button stock-note-icon-button",
      attr: {
        type: "button"
      }
    });
    setButtonIcon(undoButton, "undo", "撤销");
    undoButton.addEventListener("click", () => this.annotationController?.undo());

    const clearButton = actions.createEl("button", {
      cls: "stock-note-action-button stock-note-icon-button",
      attr: {
        type: "button"
      }
    });
    setButtonIcon(clearButton, "trash", "清空");
    clearButton.addEventListener("click", () => this.annotationController?.clear());

    const colorGroup = actions.createDiv({ cls: "stock-note-color-tools" });
    ANNOTATION_COLORS.forEach((color) => {
      const button = colorGroup.createEl("button", {
        cls: "stock-note-color-button",
        attr: {
          type: "button",
          title: color.label,
          "aria-label": color.label
        }
      });
      button.style.setProperty("--stock-note-annotation-color", color.value);
      button.addEventListener("click", () => setColor(color.value));
      colorButtons.set(color.value, button);
    });

    const fontGroup = actions.createDiv({ cls: "stock-note-font-tools" });
    const decreaseButton = fontGroup.createEl("button", {
      cls: "stock-note-action-button stock-note-icon-button",
      attr: {
        type: "button"
      }
    });
    setButtonIcon(decreaseButton, "text-smaller", "减小字号");
    decreaseButton.addEventListener("click", () => setFontSize(this.annotationFontSize - TEXT_FONT_STEP));
    fontSizeLabel = fontGroup.createSpan({ cls: "stock-note-font-size-value", text: `${this.annotationFontSize}` });
    const increaseButton = fontGroup.createEl("button", {
      cls: "stock-note-action-button stock-note-icon-button",
      attr: {
        type: "button"
      }
    });
    setButtonIcon(increaseButton, "text-bigger", "增大字号");
    increaseButton.addEventListener("click", () => setFontSize(this.annotationFontSize + TEXT_FONT_STEP));

    setTool(this.annotationTool);
    setColor(this.annotationColor);
    setFontSize(this.annotationFontSize);
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

  private async getFundQuoteSnapshot(symbol: string): Promise<FundQuoteSnapshot> {
    const cached = this.fundQuoteCache.get(symbol);
    if (cached) {
      return cached;
    }

    const quote = await fetchFundQuoteSnapshot(symbol);
    this.fundQuoteCache.set(symbol, quote);
    return quote;
  }

  private getDisplayTitle(symbol: string): string {
    const asset = this.plugin.stockStore.getBySymbol(symbol);
    const code = toDisplayCode(symbol);
    return asset ? `${asset.name}（${code}）` : code;
  }

  private positionPopover(targetEl: HTMLElement, popover: HTMLElement): void {
    const anchorRect = targetEl.getBoundingClientRect();
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

  private findStockHoverTarget(target: EventTarget | Node | null): StockHoverTarget | null {
    if (!(target instanceof HTMLElement)) {
      return null;
    }

    const sourceTarget = target.closest<HTMLElement>("[data-stock-note-symbol]");
    const sourceSymbol = sourceTarget?.getAttribute("data-stock-note-symbol");
    if (sourceTarget && sourceSymbol) {
      const symbol = sourceSymbol.toUpperCase();
      return {
        element: sourceTarget,
        symbol,
        assetType: getAssetTypeFromSymbol(symbol),
        sourceMode: true,
        lineHint: getLineHint(sourceTarget)
      };
    }

    const anchor = target.closest("a");
    if (!(anchor instanceof HTMLAnchorElement)) {
      return null;
    }

    const href = anchor.getAttribute("href") ?? "";
    const symbol = getAssetSymbolFromHref(href);
    return symbol
      ? { element: anchor, symbol, assetType: getAssetTypeFromSymbol(symbol), sourceMode: false, lineHint: getLineHint(anchor) }
      : null;
  }

  private scheduleHide(): void {
    this.clearHideTimer();
    this.hideTimer = window.setTimeout(() => {
      this.removePopover();
    }, 120);
  }

  private clearHideTimer(): void {
    if (this.hideTimer !== null) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  private removePopover(): void {
    if (this.activeKeydownHandler) {
      document.removeEventListener("keydown", this.activeKeydownHandler, true);
      this.activeKeydownHandler = null;
    }
    this.annotationController?.destroy();
    this.annotationController = null;
    this.popoverEl?.remove();
    this.popoverEl = null;
  }
}

type StockNoteIcon =
  | "arrow-up-right"
  | "chevron-down"
  | "check"
  | "copy"
  | "minus"
  | "polyline"
  | "square"
  | "text-bigger"
  | "text-smaller"
  | "trash"
  | "type"
  | "undo";

const ICON_PATHS: Record<StockNoteIcon, string> = {
  "arrow-up-right": '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  copy:
    '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  minus: '<path d="M5 12h14"/>',
  polyline: '<path d="M4 18 9 8l6 8 5-10"/><circle cx="4" cy="18" r="1.5"/><circle cx="9" cy="8" r="1.5"/><circle cx="15" cy="16" r="1.5"/><circle cx="20" cy="6" r="1.5"/>',
  square: '<rect width="14" height="14" x="5" y="5" rx="1"/>',
  "text-bigger": '<path d="M4 18h2l1.5-4h5L14 18h2L11 6H9L4 18Z"/><path d="M8.2 12h3.6"/><path d="M18 9v6"/><path d="M15 12h6"/>',
  "text-smaller": '<path d="M4 18h2l1.5-4h5L14 18h2L11 6H9L4 18Z"/><path d="M8.2 12h3.6"/><path d="M16 12h6"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  type: '<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>'
};

function setButtonIcon(button: HTMLButtonElement, icon: StockNoteIcon, label: string, showText = false): void {
  button.empty();
  button.setAttribute("aria-label", label);
  button.setAttribute("title", label);
  const iconEl = button.createSpan({ cls: "stock-note-button-icon" });
  iconEl.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICON_PATHS[icon]}</svg>`;
  if (showText) {
    button.createSpan({ cls: "stock-note-button-label", text: label });
  }
}

function getLineHint(element: HTMLElement): number | null {
  const lineEl = element.closest<HTMLElement>("[data-line]");
  const rawLine = lineEl?.getAttribute("data-line");
  if (!rawLine) {
    return null;
  }

  const line = Number.parseInt(rawLine, 10);
  return Number.isFinite(line) ? line : null;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable ||
    target.closest("[contenteditable='true']") !== null
  );
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

async function fetchFundQuoteSnapshot(symbol: string): Promise<FundQuoteSnapshot> {
  const match = symbol.toUpperCase().match(/^OF(\d{6})$/);
  if (!match) {
    throw new Error(`Unsupported fund symbol: ${symbol}`);
  }

  const code = match[1];
  const response = await requestUrl({
    url: `https://fund.eastmoney.com/pingzhongdata/${code}.js?v=${Date.now()}`,
    method: "GET",
    headers: {
      Accept: "application/javascript,text/plain,*/*",
      Referer: `https://fund.eastmoney.com/${code}.html`,
      "User-Agent": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Obsidian Investment Notes"
    }
  });
  const text = response.text;
  const name = parseStringVar(text, "fS_name") ?? code;
  const netWorthTrend = parseJsonVar<Array<{ x?: number; y?: number; equityReturn?: number }>>(text, "Data_netWorthTrend");
  const accWorthTrend = parseJsonVar<Array<[number, number]>>(text, "Data_ACWorthTrend");
  const latestNetWorth = netWorthTrend && netWorthTrend.length > 0 ? netWorthTrend[netWorthTrend.length - 1] : null;
  const latestAccWorth = accWorthTrend && accWorthTrend.length > 0 ? accWorthTrend[accWorthTrend.length - 1] : null;

  return {
    name,
    date: latestNetWorth?.x ? formatDate(new Date(latestNetWorth.x)) : "-",
    netWorth: toNullableNumber(latestNetWorth?.y),
    accWorth: toNullableNumber(latestAccWorth?.[1]),
    dailyReturn: toNullableNumber(latestNetWorth?.equityReturn)
  };
}

function parseStringVar(text: string, name: string): string | null {
  const match = text.match(new RegExp(`var\\s+${name}\\s*=\\s*"([^"]*)"`));
  return match ? match[1] : null;
}

function parseJsonVar<T>(text: string, name: string): T | null {
  const startMatch = text.match(new RegExp(`var\\s+${name}\\s*=`));
  if (!startMatch || startMatch.index === undefined) {
    return null;
  }

  const start = startMatch.index + startMatch[0].length;
  const end = text.indexOf(";", start);
  if (end < 0) {
    return null;
  }

  try {
    return JSON.parse(text.slice(start, end).trim()) as T;
  } catch (error) {
    console.warn(`[investment-notes] Failed to parse ${name}`, error);
    return null;
  }
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

function renderFundSummary(parent: HTMLElement, quote: FundQuoteSnapshot): void {
  const changeClass = getValueChangeClass(quote.dailyReturn);
  const summary = parent.createDiv({ cls: "stock-note-price-summary stock-note-fund-summary" });
  const netWorthEl = summary.createSpan({
    cls: "stock-note-price-current",
    text: formatNetWorth(quote.netWorth)
  });
  const dailyReturnEl = summary.createSpan({
    cls: "stock-note-price-change",
    text: formatSignedPercent(quote.dailyReturn)
  });

  if (changeClass) {
    netWorthEl.addClass(changeClass);
    dailyReturnEl.addClass(changeClass);
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

function getChartPeriods(assetType: AssetType): Array<{ value: ChartPeriod; label: string }> {
  return assetType === "fund" ? FUND_CHART_PERIODS : CHART_PERIODS;
}

function getAssetTypeFromSymbol(symbol: string): AssetType {
  const normalized = symbol.toUpperCase();
  if (normalized.startsWith("OF")) {
    return "fund";
  }

  return "stock";
}

function normalizeMarketChartPeriod(period: string): ChartPeriod {
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

function toDisplayCode(symbol: string): string {
  const fundMatch = symbol.toUpperCase().match(/^OF(\d{6})$/);
  if (fundMatch) {
    return fundMatch[1];
  }

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

function formatNetWorth(value: number | null): string {
  return value === null ? "-" : value.toFixed(4);
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
