export type StockMarket = "SH" | "SZ" | "BJ";
export type AssetType = "stock" | "etf" | "fund";
export type ChartPeriod = "min" | "daily" | "weekly" | "monthly" | "netWorth" | "accWorth";

export type InvestmentAsset = {
  assetType: AssetType;
  code: string;
  market: StockMarket | "OF";
  name: string;
  symbol: string;
  sina: string;
  xueqiu: string;
  url: string;
  pinyin: string;
  abbr: string;
  category?: string;
};

export type StockInfo = InvestmentAsset;

export type AssetCache = {
  assets: InvestmentAsset[];
  updatedAt: number;
  sourceVersion: string;
};

export type StockCache = {
  stocks: StockInfo[];
  updatedAt: number;
  sourceVersion: string;
};

export type InvestmentNotesSettings = {
  triggerKeyword: string;
  tushareToken: string;
  autoUpdateStockList: boolean;
  stockListTtlDays: number;
  defaultChartPeriod: ChartPeriod;
  enableHoverPreview: boolean;
  enableSourceHoverPreview: boolean;
  hoverPreviewDelayMs: number;
  linkTextColor: string;
  linkBackgroundColor: string;
  linkBorderColor: string;
  linkBold: boolean;
  linkPillStyle: boolean;
};

export type InvestmentNotesData = {
  settings: InvestmentNotesSettings;
  assetCache: AssetCache | null;
  stockCache: StockCache | null;
};

export const DEFAULT_SETTINGS: InvestmentNotesSettings = {
  triggerKeyword: "$",
  tushareToken: "",
  autoUpdateStockList: true,
  stockListTtlDays: 7,
  defaultChartPeriod: "min",
  enableHoverPreview: true,
  enableSourceHoverPreview: true,
  hoverPreviewDelayMs: 300,
  linkTextColor: "#d14b3f",
  linkBackgroundColor: "rgba(209, 75, 63, 0.08)",
  linkBorderColor: "rgba(209, 75, 63, 0.24)",
  linkBold: false,
  linkPillStyle: true
};
