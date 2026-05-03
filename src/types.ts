export type StockMarket = "SH" | "SZ" | "BJ";
export type ChartPeriod = "min" | "daily" | "weekly" | "monthly";

export type StockInfo = {
  code: string;
  market: StockMarket;
  name: string;
  symbol: string;
  sina: string;
  xueqiu: string;
  pinyin: string;
  abbr: string;
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
  linkTextColor: string;
  linkBackgroundColor: string;
  linkBorderColor: string;
  linkBold: boolean;
  linkPillStyle: boolean;
};

export type InvestmentNotesData = {
  settings: InvestmentNotesSettings;
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
  linkTextColor: "#d14b3f",
  linkBackgroundColor: "rgba(209, 75, 63, 0.08)",
  linkBorderColor: "rgba(209, 75, 63, 0.24)",
  linkBold: false,
  linkPillStyle: true
};
