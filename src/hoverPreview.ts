import type { Plugin } from "obsidian";
import { getSinaChartUrl, getXueqiuSymbolFromHref } from "./stockStore";
import type { InvestmentNotesData } from "./types";

export class HoverPreview {
  private popoverEl: HTMLElement | null = null;
  private hideTimer: number | null = null;

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
    const chartUrl = getSinaChartUrl(symbol, this.data.settings.defaultChartPeriod);
    if (!chartUrl) {
      return;
    }

    this.clearHideTimer();
    this.popoverEl?.remove();

    const popover = document.body.createDiv({ cls: "stock-note-popover" });
    const header = popover.createDiv({ cls: "stock-note-popover-header" });
    header.createSpan({ cls: "stock-note-popover-symbol", text: symbol });
    header.createSpan({
      cls: "stock-note-popover-period",
      text: periodLabel(this.data.settings.defaultChartPeriod)
    });

    const imageWrap = popover.createDiv({ cls: "stock-note-popover-image-wrap" });
    const loading = imageWrap.createDiv({ cls: "stock-note-popover-loading", text: "图表加载中..." });
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

    popover.addEventListener("mouseenter", () => this.clearHideTimer());
    popover.addEventListener("mouseleave", () => this.scheduleHide());

    document.body.appendChild(popover);
    this.positionPopover(anchor, popover);
    this.popoverEl = popover;
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
    default:
      return "分时";
  }
}
