import { Notice, PluginSettingTab, Setting } from "obsidian";
import type InvestmentNotesPlugin from "./main";
import type { ChartPeriod, HoverCardWidth, KlinePeriodCount } from "./types";

const PERIOD_OPTIONS: Partial<Record<ChartPeriod, string>> = {
  min: "分时",
  minute5: "5 分钟 K",
  minute30: "30 分钟 K",
  minute60: "60 分钟 K",
  daily: "日 K",
  weekly: "周 K",
  monthly: "月 K"
};

export class InvestmentNotesSettingTab extends PluginSettingTab {
  constructor(private readonly plugin: InvestmentNotesPlugin) {
    super(plugin.app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Investment Notes" });

    new Setting(containerEl)
      .setName("触发关键字")
      .setDesc("用于触发投资标的搜索的固定字符串，例如 $、@、$$ 或 stock:。")
      .addText((text) =>
        text
          .setPlaceholder("$")
          .setValue(this.plugin.data.settings.triggerKeyword)
          .onChange(async (value) => {
            const normalized = value.trim();
            if (!normalized) {
              new Notice("触发关键字不能为空");
              return;
            }

            this.plugin.data.settings.triggerKeyword = normalized;
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl)
      .setName("启用悬浮图表")
      .setDesc("鼠标移入股票或 ETF 链接时展示预览卡片。")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.data.settings.enableHoverPreview)
          .onChange(async (value) => {
            this.plugin.data.settings.enableHoverPreview = value;
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl)
      .setName("源码模式预览卡片")
      .setDesc("在源码模式和实时预览模式中，鼠标移入投资标的文本时展示同一张预览卡片。")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.data.settings.enableSourceHoverPreview)
          .onChange(async (value) => {
            this.plugin.data.settings.enableSourceHoverPreview = value;
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl)
      .setName("悬停显示延迟")
      .setDesc("鼠标停留多久后显示预览卡片，单位毫秒。默认 300，设为 0 可立即显示。")
      .addText((text) =>
        text
          .setPlaceholder("300")
          .setValue(String(this.plugin.data.settings.hoverPreviewDelayMs))
          .onChange(async (value) => {
            const delay = Number.parseInt(value, 10);
            if (!Number.isFinite(delay) || delay < 0) {
              return;
            }

            this.plugin.data.settings.hoverPreviewDelayMs = Math.min(5000, delay);
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl)
      .setName("悬浮卡片大小")
      .setDesc("控制行情预览卡片宽度，窄卡片会自动压缩指标列和操作区。")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("400", "400 px")
          .addOption("700", "700 px")
          .addOption("1000", "1000 px")
          .setValue(String(this.plugin.data.settings.hoverCardWidth ?? 700))
          .onChange(async (value) => {
            this.plugin.data.settings.hoverCardWidth = Number(value) as HoverCardWidth;
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl)
      .setName("默认图表周期")
      .setDesc("股票和 ETF 悬浮预览默认展示的图表周期。")
      .addDropdown((dropdown) => {
        Object.entries(PERIOD_OPTIONS).forEach(([value, label]) => dropdown.addOption(value, label));
        dropdown
          .setValue(this.plugin.data.settings.defaultChartPeriod)
          .onChange(async (value) => {
            this.plugin.data.settings.defaultChartPeriod = value as ChartPeriod;
            await this.plugin.savePluginData();
          });
      });

    new Setting(containerEl)
      .setName("K 线加载范围")
      .setDesc("控制 K 线图默认拉取多少个周期；对日 K 是交易日，对周 K/月 K 是周或月周期。")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("60", "60 个周期")
          .addOption("180", "180 个周期")
          .addOption("360", "360 个周期")
          .setValue(String(this.plugin.data.settings.klinePeriodCount ?? 180))
          .onChange(async (value) => {
            this.plugin.data.settings.klinePeriodCount = Number(value) as KlinePeriodCount;
            await this.plugin.savePluginData();
          })
      );

    containerEl.createEl("h3", { text: "标的列表" });

    new Setting(containerEl)
      .setName("Tushare Token")
      .setDesc("可选。填写后刷新 A 股列表会优先使用 Tushare stock_basic；ETF 使用东方财富公开数据。")
      .addText((text) =>
        text
          .setPlaceholder("留空使用东方财富")
          .setValue(this.plugin.data.settings.tushareToken)
          .onChange(async (value) => {
            this.plugin.data.settings.tushareToken = value.trim();
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl)
      .setName("自动更新标的列表")
      .setDesc("启动时按刷新周期后台检查股票和 ETF 列表。")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.data.settings.autoUpdateStockList)
          .onChange(async (value) => {
            this.plugin.data.settings.autoUpdateStockList = value;
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl)
      .setName("刷新周期")
      .setDesc("单位：天。默认 7 天。")
      .addText((text) =>
        text
          .setPlaceholder("7")
          .setValue(String(this.plugin.data.settings.stockListTtlDays))
          .onChange(async (value) => {
            const ttl = Number.parseInt(value, 10);
            if (!Number.isFinite(ttl) || ttl < 1) {
              return;
            }

            this.plugin.data.settings.stockListTtlDays = ttl;
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl)
      .setName("手动刷新")
      .setDesc(`上次刷新：${this.plugin.stockStore.getLastUpdatedText()}`)
      .addButton((button) =>
        button
          .setButtonText("立即刷新标的列表")
          .setCta()
          .onClick(async () => {
            button.setDisabled(true).setButtonText("刷新中...");
            await this.plugin.stockStore.refreshFromRemote(true);
            this.display();
          })
      );

    containerEl.createEl("h3", { text: "标的短链样式" });

    this.addColorSetting("文本颜色", "linkTextColor");
    this.addColorSetting("背景色", "linkBackgroundColor");
    this.addColorSetting("边框色", "linkBorderColor");

    new Setting(containerEl)
      .setName("加粗")
      .setDesc("让标的短链文本加粗。")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.data.settings.linkBold)
          .onChange(async (value) => {
            this.plugin.data.settings.linkBold = value;
            this.plugin.applyStyleSettings();
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl)
      .setName("胶囊背景")
      .setDesc("启用背景、边框、圆角和内边距。关闭后仅保留文本颜色和可选加粗。")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.data.settings.linkPillStyle)
          .onChange(async (value) => {
            this.plugin.data.settings.linkPillStyle = value;
            this.plugin.applyStyleSettings();
            await this.plugin.savePluginData();
          })
      );
  }

  private addColorSetting(
    name: string,
    key: "linkTextColor" | "linkBackgroundColor" | "linkBorderColor"
  ): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc("支持 CSS 颜色值，例如 #d14b3f 或 rgba(209, 75, 63, 0.08)。")
      .addText((text) =>
        text
          .setValue(this.plugin.data.settings[key])
          .onChange(async (value) => {
            this.plugin.data.settings[key] = value.trim();
            this.plugin.applyStyleSettings();
            await this.plugin.savePluginData();
          })
      );
  }
}
