import { Plugin } from "obsidian";
import { HoverPreview } from "./hoverPreview";
import {
  applyStockLinkStyleVariables,
  createStockLinkDecorationExtension,
  decorateRenderedStockLinks
} from "./linkStyling";
import { InvestmentNotesSettingTab } from "./settings";
import { StockSuggest } from "./stockSuggest";
import { StockStore } from "./stockStore";
import { DEFAULT_SETTINGS, type InvestmentNotesData } from "./types";

export default class InvestmentNotesPlugin extends Plugin {
  data!: InvestmentNotesData;
  stockStore!: StockStore;

  async onload(): Promise<void> {
    await this.loadPluginData();

    this.stockStore = new StockStore(this, this.data, () => this.savePluginData());
    await this.stockStore.initialize();

    this.applyStyleSettings();
    this.addSettingTab(new InvestmentNotesSettingTab(this));
    this.registerEditorSuggest(new StockSuggest(this));
    this.registerMarkdownPostProcessor((el) => decorateRenderedStockLinks(el));
    this.registerEditorExtension(createStockLinkDecorationExtension());

    new HoverPreview(this, this.data).register();
  }

  onunload(): void {
    document.body.removeClass("stock-note-link-pill-disabled");
    document.body.style.removeProperty("--stock-note-link-color");
    document.body.style.removeProperty("--stock-note-link-bg");
    document.body.style.removeProperty("--stock-note-link-border");
    document.body.style.removeProperty("--stock-note-link-font-weight");
  }

  async loadPluginData(): Promise<void> {
    const saved = (await this.loadData()) as Partial<InvestmentNotesData> | null;
    this.data = {
      settings: {
        ...DEFAULT_SETTINGS,
        ...(saved?.settings ?? {})
      },
      assetCache: saved?.assetCache ?? null,
      stockCache: saved?.stockCache ?? null
    };
  }

  async savePluginData(): Promise<void> {
    await this.saveData(this.data);
  }

  applyStyleSettings(): void {
    applyStockLinkStyleVariables(this.data.settings);
  }
}
