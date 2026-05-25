import { requestUrl } from "obsidian";
import type { ChartPeriod, KlinePeriodCount, MarketChartData, MarketKlineBar, MarketTrendPoint } from "./types";

const EASTMONEY_HEADERS = {
  Accept: "application/json,text/plain,*/*",
  Referer: "https://quote.eastmoney.com/",
  "User-Agent": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Obsidian Investment Notes"
};
const EASTMONEY_TREND_HOSTS = [
  "https://push2delay.eastmoney.com",
  "https://push2his.eastmoney.com",
  "https://push2.eastmoney.com"
];
const EASTMONEY_KLINE_HOSTS = ["https://push2his.eastmoney.com", "https://push2.eastmoney.com"];
const SINA_HEADERS = {
  Accept: "application/javascript,text/plain,*/*",
  Referer: "https://finance.sina.com.cn/",
  "User-Agent": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Obsidian Investment Notes"
};

const KLINE_PERIOD: Record<MarketKlinePeriod, number> = {
  minute5: 5,
  minute30: 30,
  minute60: 60,
  daily: 101,
  weekly: 102,
  monthly: 103
};

type MarketKlinePeriod = Exclude<ChartPeriod, "min">;
type SinaDirectKlinePeriod = "minute5" | "minute30" | "minute60" | "daily";

type EastMoneyKlineResponse = {
  data?: {
    name?: string;
    klines?: string[];
  };
};

type EastMoneyTrendResponse = {
  data?: {
    name?: string;
    preClose?: number;
    trends?: string[];
  };
};

type SinaKlineRow = {
  day?: string;
  open?: string;
  high?: string;
  low?: string;
  close?: string;
  volume?: string;
  amount?: string;
};

export async function fetchMarketChartData(
  symbol: string,
  period: ChartPeriod,
  klinePeriodCount: KlinePeriodCount = 180
): Promise<MarketChartData> {
  if (period === "min") {
    return fetchIntradayData(symbol);
  }

  if (isMarketKlinePeriod(period)) {
    return fetchKlineData(symbol, period, normalizeKlinePeriodCount(klinePeriodCount));
  }

  throw new Error(`Unsupported market chart period: ${period}`);
}

async function fetchIntradayData(symbol: string): Promise<MarketChartData> {
  const secid = toEastMoneySecid(symbol);
  if (!secid) {
    throw new Error(`Unsupported symbol: ${symbol}`);
  }

  const body = await requestEastMoneyJson<EastMoneyTrendResponse>(
    `/api/qt/stock/trends2/get?secid=${secid}` +
      "&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13" +
      "&fields2=f51,f52,f53,f54,f55,f56,f57,f58&ndays=1&iscr=0&iscca=0",
    EASTMONEY_TREND_HOSTS
  );
  const data = body.data;
  if (!data?.trends) {
    throw new Error("Empty intraday response");
  }

  return {
    kind: "intraday",
    symbol,
    name: data.name ?? symbol,
    preClose: toNullableNumber(data.preClose),
    points: data.trends.map(parseTrendPoint).filter((point): point is MarketTrendPoint => point !== null)
  };
}

async function fetchKlineData(
  symbol: string,
  period: MarketKlinePeriod,
  klinePeriodCount: KlinePeriodCount
): Promise<MarketChartData> {
  if (period === "daily" || period === "weekly" || period === "monthly") {
    const secid = toEastMoneySecid(symbol);
    try {
      if (!secid) {
        throw new Error(`Unsupported symbol: ${symbol}`);
      }

      const body = await requestEastMoneyJson<EastMoneyKlineResponse>(
        `/api/qt/stock/kline/get?secid=${secid}` +
          "&fields1=f1,f2,f3,f4,f5,f6" +
          "&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61" +
          `&klt=${KLINE_PERIOD[period]}&fqt=1&end=20500101&lmt=${klinePeriodCount}`,
        EASTMONEY_KLINE_HOSTS
      );
      const data = body.data;
      const bars = data?.klines?.map(parseKlineBar).filter((bar): bar is MarketKlineBar => bar !== null) ?? [];
      if (bars.length > 0) {
        return {
          kind: "kline",
          symbol,
          name: data?.name ?? symbol,
          period,
          bars
        };
      }
    } catch (error) {
      console.warn("[investment-notes] EastMoney kline failed; falling back to Sina", error);
    }
  }

  return {
    kind: "kline",
    symbol,
    name: symbol,
    period,
    bars: await fetchSinaKlineBars(symbol, period, klinePeriodCount)
  };
}

function parseKlineBar(raw: string): MarketKlineBar | null {
  const [date, open, close, high, low, volume, amount, amplitude, changePercent, changeAmount, turnover] =
    raw.split(",");
  const bar = {
    date,
    open: Number(open),
    close: Number(close),
    high: Number(high),
    low: Number(low),
    volume: Number(volume),
    amount: Number(amount),
    amplitude: toNullableNumber(Number(amplitude)),
    changePercent: toNullableNumber(Number(changePercent)),
    changeAmount: toNullableNumber(Number(changeAmount)),
    turnover: toNullableNumber(Number(turnover))
  };

  return isFiniteMarketNumber(bar.open) &&
    isFiniteMarketNumber(bar.close) &&
    isFiniteMarketNumber(bar.high) &&
    isFiniteMarketNumber(bar.low)
    ? bar
    : null;
}

function parseTrendPoint(raw: string): MarketTrendPoint | null {
  const [time, open, close, high, low, volume, amount, average] = raw.split(",");
  const point = {
    time,
    open: Number(open),
    close: Number(close),
    high: Number(high),
    low: Number(low),
    volume: Number(volume),
    amount: Number(amount),
    average: toNullableNumber(Number(average))
  };

  return isFiniteMarketNumber(point.close) ? point : null;
}

function toEastMoneySecid(symbol: string): string | null {
  const match = symbol.toUpperCase().match(/^(SH|SZ|BJ)(\d{6})$/);
  if (!match) {
    return null;
  }

  const marketCode = match[1] === "SH" ? "1" : "0";
  return `${marketCode}.${match[2]}`;
}

async function fetchSinaKlineBars(
  symbol: string,
  period: MarketKlinePeriod,
  klinePeriodCount: KlinePeriodCount
): Promise<MarketKlineBar[]> {
  const sinaSymbol = toSinaSymbol(symbol);
  if (!sinaSymbol) {
    throw new Error(`Unsupported Sina symbol: ${symbol}`);
  }

  const datalen = getSinaDatalen(period, klinePeriodCount);
  const scale = getSinaScale(period);
  const response = await requestUrl({
    url:
      "https://quotes.sina.cn/cn/api/jsonp.php/var%20kline=/CN_MarketDataService.getKLineData" +
      `?symbol=${sinaSymbol}&scale=${scale}&ma=no&datalen=${datalen}`,
    method: "GET",
    headers: SINA_HEADERS
  });
  const rows = parseSinaKlineRows(response.text);
  const sourceBars = rows.map(parseSinaKlineBar).filter((bar): bar is MarketKlineBar => bar !== null);
  const bars = isSinaDirectKlinePeriod(period) ? sourceBars : aggregateBars(sourceBars, period);
  if (bars.length === 0) {
    throw new Error("Empty Sina kline response");
  }

  return bars.slice(-klinePeriodCount);
}

async function requestEastMoneyJson<T>(path: string, hosts: string[]): Promise<T> {
  const errors: string[] = [];

  for (const host of hosts) {
    try {
      const response = await requestUrl({
        url: `${host}${path}`,
        method: "GET",
        headers: EASTMONEY_HEADERS
      });
      if (!response.text && !response.json) {
        throw new Error("Empty response");
      }
      return (response.json ?? JSON.parse(response.text)) as T;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(errors.join(" | "));
}

function parseSinaKlineRows(text: string): SinaKlineRow[] {
  const match = text.match(/=\s*\((\[[\s\S]*\])\);?\s*$/);
  if (!match) {
    throw new Error("Unexpected Sina kline response");
  }

  return JSON.parse(match[1]) as SinaKlineRow[];
}

function parseSinaKlineBar(row: SinaKlineRow): MarketKlineBar | null {
  const date = row.day ?? "";
  const open = Number(row.open);
  const close = Number(row.close);
  const high = Number(row.high);
  const low = Number(row.low);
  if (!date || !isFiniteMarketNumber(open) || !isFiniteMarketNumber(close)) {
    return null;
  }

  const volumeShares = Number(row.volume);
  const amount = Number(row.amount);
  return {
    date,
    open,
    close,
    high,
    low,
    volume: isFiniteMarketNumber(volumeShares) ? volumeShares / 100 : 0,
    amount: isFiniteMarketNumber(amount) ? amount : 0,
    amplitude: null,
    changePercent: null,
    changeAmount: null,
    turnover: null
  };
}

function aggregateBars(
  dailyBars: MarketKlineBar[],
  period: "weekly" | "monthly"
): MarketKlineBar[] {
  const groups = new Map<string, MarketKlineBar[]>();
  for (const bar of dailyBars) {
    const key = period === "weekly" ? getWeekKey(bar.date) : bar.date.slice(0, 7);
    const group = groups.get(key) ?? [];
    group.push(bar);
    groups.set(key, group);
  }

  return Array.from(groups.values()).map((group) => {
    const first = group[0];
    const last = group[group.length - 1];
    return {
      date: last.date,
      open: first.open,
      close: last.close,
      high: Math.max(...group.map((bar) => bar.high)),
      low: Math.min(...group.map((bar) => bar.low)),
      volume: group.reduce((sum, bar) => sum + bar.volume, 0),
      amount: group.reduce((sum, bar) => sum + bar.amount, 0),
      amplitude: null,
      changePercent: null,
      changeAmount: null,
      turnover: null
    };
  });
}

function getWeekKey(dateText: string): string {
  const date = new Date(`${dateText}T00:00:00`);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() + 4 - day);
  const yearStart = new Date(date.getFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getFullYear()}-${String(week).padStart(2, "0")}`;
}

function toSinaSymbol(symbol: string): string | null {
  const match = symbol.toLowerCase().match(/^(sh|sz|bj)(\d{6})$/);
  if (!match || match[1] === "bj") {
    return null;
  }

  return `${match[1]}${match[2]}`;
}

function isMarketKlinePeriod(period: ChartPeriod): period is MarketKlinePeriod {
  return period !== "min";
}

function isSinaDirectKlinePeriod(period: MarketKlinePeriod): period is SinaDirectKlinePeriod {
  return period === "minute5" || period === "minute30" || period === "minute60" || period === "daily";
}

function getSinaScale(period: MarketKlinePeriod): number {
  if (period === "minute5") return 5;
  if (period === "minute30") return 30;
  if (period === "minute60") return 60;
  return 240;
}

function getSinaDatalen(period: MarketKlinePeriod, klinePeriodCount: KlinePeriodCount): number {
  if (period === "weekly") return Math.max(klinePeriodCount * 7, 720);
  if (period === "monthly") return Math.max(klinePeriodCount * 31, 1800);
  return klinePeriodCount;
}

function normalizeKlinePeriodCount(value: number): KlinePeriodCount {
  if (value === 60 || value === 180 || value === 360) {
    return value;
  }

  return 180;
}

function toNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isFiniteMarketNumber(value: number): boolean {
  return Number.isFinite(value);
}
