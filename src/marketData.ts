import { requestUrl } from "obsidian";
import type { ChartPeriod, MarketChartData, MarketKlineBar, MarketTrendPoint } from "./types";

const EASTMONEY_HEADERS = {
  Accept: "application/json,text/plain,*/*",
  Referer: "https://quote.eastmoney.com/",
  "User-Agent": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Obsidian Investment Notes"
};

const KLINE_PERIOD: Record<Exclude<ChartPeriod, "min" | "netWorth" | "accWorth">, number> = {
  daily: 101,
  weekly: 102,
  monthly: 103
};

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

export async function fetchMarketChartData(symbol: string, period: ChartPeriod): Promise<MarketChartData> {
  if (period === "min") {
    return fetchIntradayData(symbol);
  }

  if (period === "daily" || period === "weekly" || period === "monthly") {
    return fetchKlineData(symbol, period);
  }

  throw new Error(`Unsupported market chart period: ${period}`);
}

async function fetchIntradayData(symbol: string): Promise<MarketChartData> {
  const secid = toEastMoneySecid(symbol);
  if (!secid) {
    throw new Error(`Unsupported symbol: ${symbol}`);
  }

  const response = await requestUrl({
    url:
      `https://push2his.eastmoney.com/api/qt/stock/trends2/get?secid=${secid}` +
      "&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13" +
      "&fields2=f51,f52,f53,f54,f55,f56,f57,f58&ndays=1&iscr=0&iscca=0",
    method: "GET",
    headers: EASTMONEY_HEADERS
  });
  const data = (response.json as EastMoneyTrendResponse).data;
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
  period: Exclude<ChartPeriod, "min" | "netWorth" | "accWorth">
): Promise<MarketChartData> {
  const secid = toEastMoneySecid(symbol);
  if (!secid) {
    throw new Error(`Unsupported symbol: ${symbol}`);
  }

  const response = await requestUrl({
    url:
      `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}` +
      "&fields1=f1,f2,f3,f4,f5,f6" +
      "&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61" +
      `&klt=${KLINE_PERIOD[period]}&fqt=1&end=20500101&lmt=120`,
    method: "GET",
    headers: EASTMONEY_HEADERS
  });
  const data = (response.json as EastMoneyKlineResponse).data;
  if (!data?.klines) {
    throw new Error("Empty kline response");
  }

  return {
    kind: "kline",
    symbol,
    name: data.name ?? symbol,
    period,
    bars: data.klines.map(parseKlineBar).filter((bar): bar is MarketKlineBar => bar !== null)
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

function toNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isFiniteMarketNumber(value: number): boolean {
  return Number.isFinite(value);
}
