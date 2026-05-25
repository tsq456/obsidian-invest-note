export type StockMarket = "SH" | "SZ" | "BJ";
export type AssetType = "stock" | "etf";
export type ChartPeriod =
  | "min"
  | "minute5"
  | "minute30"
  | "minute60"
  | "daily"
  | "weekly"
  | "monthly";
export type HoverCardWidth = 400 | 700 | 1000;
export type KlinePeriodCount = 60 | 180 | 360;

export type MarketKlineBar = {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
  amplitude: number | null;
  changePercent: number | null;
  changeAmount: number | null;
  turnover: number | null;
};

export type MarketTrendPoint = {
  time: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
  average: number | null;
};

export type MarketChartData =
  | {
      kind: "intraday";
      symbol: string;
      name: string;
      preClose: number | null;
      points: MarketTrendPoint[];
    }
  | {
      kind: "kline";
      symbol: string;
      name: string;
      period: Exclude<ChartPeriod, "min">;
      bars: MarketKlineBar[];
    };

export type InvestmentAsset = {
  assetType: AssetType;
  code: string;
  market: StockMarket;
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
  hoverCardWidth: HoverCardWidth;
  klinePeriodCount: KlinePeriodCount;
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
  hoverCardWidth: 700,
  klinePeriodCount: 180,
  enableHoverPreview: true,
  enableSourceHoverPreview: true,
  hoverPreviewDelayMs: 300,
  linkTextColor: "#d14b3f",
  linkBackgroundColor: "rgba(209, 75, 63, 0.08)",
  linkBorderColor: "rgba(209, 75, 63, 0.24)",
  linkBold: false,
  linkPillStyle: true
};
