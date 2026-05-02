import { Notice, Plugin, requestUrl } from "obsidian";
import { pinyin } from "pinyin-pro";
import type { InvestmentNotesData, StockCache, StockInfo, StockMarket } from "./types";

const EASTMONEY_BASE_QUERY =
  "/api/qt/clist/get?pn=1&pz=100&po=1&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f3&fields=f12,f13,f14";
const EASTMONEY_HOSTS = [
  "https://push2delay.eastmoney.com",
  "https://push2.eastmoney.com",
  "https://push2his.eastmoney.com"
];
const EASTMONEY_MARKET_FILTERS = [
  "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23",
  "m:0+t:81+s:2048"
];
const TUSHARE_API_URL = "https://api.tushare.pro";
const EASTMONEY_PAGE_SIZE = 100;

type EastMoneyDiffItem = {
  f12?: string;
  f13?: number;
  f14?: string;
};

type EastMoneyResponse = {
  data?: {
    total?: number;
    diff?: EastMoneyDiffItem[] | Record<string, EastMoneyDiffItem>;
  };
};

type TushareResponse = {
  code?: number;
  msg?: string;
  data?: {
    fields?: string[];
    items?: unknown[][];
  };
};

export class StockStore {
  private stocks: StockInfo[] = [];

  constructor(
    private readonly plugin: Plugin,
    private readonly data: InvestmentNotesData,
    private readonly persist: () => Promise<void>
  ) {}

  async initialize(): Promise<void> {
    const seedStocks = await this.loadSeedStocks();
    const cachedStocks = this.data.stockCache?.stocks ?? [];
    this.stocks = cachedStocks.length > 0 ? cachedStocks : seedStocks;

    if (this.data.settings.autoUpdateStockList && this.isCacheExpired()) {
      const refreshTimer = window.setTimeout(() => {
        void this.refreshFromRemote(false);
      }, 5000);
      this.plugin.register(() => window.clearTimeout(refreshTimer));
    }
  }

  getAll(): StockInfo[] {
    return this.stocks;
  }

  search(query: string, limit = 20): StockInfo[] {
    const normalized = normalizeSearchText(query);
    if (!normalized) {
      return this.stocks.slice(0, limit);
    }

    return this.stocks
      .map((stock) => ({
        stock,
        score: scoreStock(stock, normalized)
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.stock.code.localeCompare(b.stock.code))
      .slice(0, limit)
      .map((entry) => entry.stock);
  }

  async refreshFromRemote(showNotice = true): Promise<void> {
    try {
      const remoteStocks = await this.fetchRemoteStocks();
      if (remoteStocks.length === 0) {
        throw new Error("远端返回了空股票列表");
      }

      this.stocks = remoteStocks;
      this.data.stockCache = {
        stocks: remoteStocks,
        updatedAt: Date.now(),
        sourceVersion: this.data.settings.tushareToken ? "tushare-stock-basic-v1" : "eastmoney-clist-v2"
      };
      await this.persist();

      if (showNotice) {
        new Notice(`股票列表已更新：${remoteStocks.length} 只`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[investment-notes] Stock list refresh failed; using local cache. ${message}`);
      if (showNotice) {
        new Notice("股票列表刷新失败，已继续使用本地缓存");
      }
    }
  }

  getLastUpdatedText(): string {
    const updatedAt = this.data.stockCache?.updatedAt;
    if (!updatedAt) {
      return "尚未刷新，正在使用内置种子库";
    }

    return new Date(updatedAt).toLocaleString();
  }

  private isCacheExpired(): boolean {
    const updatedAt = this.data.stockCache?.updatedAt ?? 0;
    const ttlDays = Math.max(1, this.data.settings.stockListTtlDays);
    return Date.now() - updatedAt > ttlDays * 24 * 60 * 60 * 1000;
  }

  private async loadSeedStocks(): Promise<StockInfo[]> {
    const dir = this.plugin.manifest.dir;
    if (!dir) {
      return [];
    }

    try {
      const raw = await this.plugin.app.vault.adapter.read(`${dir}/data/stocks.seed.json`);
      return JSON.parse(raw) as StockInfo[];
    } catch (error) {
      console.error("[investment-notes] Failed to load seed stock list", error);
      return [];
    }
  }

  private async fetchRemoteStocks(): Promise<StockInfo[]> {
    const token = this.data.settings.tushareToken.trim();
    const errors: string[] = [];

    if (token) {
      try {
        return await this.fetchTushareStocks(token);
      } catch (error) {
        errors.push(`Tushare: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    try {
      return await this.fetchEastMoneyStocks();
    } catch (error) {
      errors.push(`东方财富: ${error instanceof Error ? error.message : String(error)}`);
    }

    throw new Error(errors.join(" | "));
  }

  private async fetchTushareStocks(token: string): Promise<StockInfo[]> {
    const response = await requestUrl({
      url: TUSHARE_API_URL,
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify({
        api_name: "stock_basic",
        token,
        params: {
          list_status: "L"
        },
        fields: "ts_code,symbol,name,exchange,list_status"
      })
    });
    const body = response.json as TushareResponse;

    if (body.code !== 0) {
      throw new Error(body.msg || `Tushare 返回错误 code=${body.code}`);
    }

    const fields = body.data?.fields ?? [];
    const items = body.data?.items ?? [];
    const stocks = items
      .map((item) => normalizeTushareStock(fields, item))
      .filter((stock): stock is StockInfo => stock !== null);

    if (stocks.length === 0) {
      throw new Error("Tushare 返回了空股票列表");
    }

    return stocks;
  }

  private async fetchEastMoneyStocks(): Promise<StockInfo[]> {
    const errors: string[] = [];

    for (const host of EASTMONEY_HOSTS) {
      try {
        return await this.fetchEastMoneyStocksFromHost(host);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    throw new Error(errors.join(" | "));
  }

  private async fetchEastMoneyStocksFromHost(host: string): Promise<StockInfo[]> {
    const allStocks: StockInfo[] = [];

    for (const marketFilter of EASTMONEY_MARKET_FILTERS) {
      allStocks.push(...(await this.fetchEastMoneyStocksByMarket(host, marketFilter)));
    }

    return dedupeStocks(allStocks);
  }

  private async fetchEastMoneyStocksByMarket(host: string, marketFilter: string): Promise<StockInfo[]> {
    const stocks: StockInfo[] = [];
    let total = Number.POSITIVE_INFINITY;
    let fetchedRows = 0;

    for (let page = 1; fetchedRows < total; page += 1) {
      const pageUrl = `${host}${EASTMONEY_BASE_QUERY.replace(/pn=\d+/, `pn=${page}`)}&fs=${encodeURIComponent(
        marketFilter
      )}`;
      const response = await requestUrl({
        url: pageUrl,
        method: "GET",
        headers: {
          Accept: "application/json,text/plain,*/*",
          Referer: "https://quote.eastmoney.com/",
          "User-Agent":
            "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Obsidian Investment Notes"
        }
      });
      const body = response.json as EastMoneyResponse;
      const diff = body.data?.diff;
      const rows = Array.isArray(diff) ? diff : Object.values(diff ?? {});
      total = body.data?.total ?? rows.length;

      if (rows.length === 0) {
        break;
      }

      fetchedRows += rows.length;
      stocks.push(
        ...rows
          .map((item) => normalizeEastMoneyStock(item))
          .filter((stock): stock is StockInfo => stock !== null)
      );

      if (page > 100) {
        break;
      }
    }

    return stocks;
  }
}

function normalizeTushareStock(fields: string[], item: unknown[]): StockInfo | null {
  const record = Object.fromEntries(fields.map((field, index) => [field, item[index]]));
  const tsCode = typeof record.ts_code === "string" ? record.ts_code.trim() : "";
  const code = typeof record.symbol === "string" ? record.symbol.trim() : "";
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const exchange = typeof record.exchange === "string" ? record.exchange.trim() : "";
  const status = typeof record.list_status === "string" ? record.list_status.trim() : "L";

  if (!code || !name || status !== "L") {
    return null;
  }

  const market = tushareMarketFromExchange(exchange) ?? tushareMarketFromTsCode(tsCode);
  if (!market) {
    return null;
  }

  return buildStockInfo(code, market, name);
}

function normalizeEastMoneyStock(item: EastMoneyDiffItem): StockInfo | null {
  const code = item.f12?.trim();
  const name = item.f14?.trim();
  if (!code || !name || !/^\d{6}$/.test(code)) {
    return null;
  }

  const market = inferMarket(code, item.f13);
  if (!market) {
    return null;
  }

  const fullPinyin = pinyin(name, {
    toneType: "none",
    type: "array",
    nonZh: "removed"
  })
    .join("")
    .toLowerCase();

  const abbr = pinyin(name, {
    toneType: "none",
    pattern: "first",
    type: "array",
    nonZh: "removed"
  })
    .join("")
    .toLowerCase();

  return buildStockInfo(code, market, name);
}

function buildStockInfo(code: string, market: StockMarket, name: string): StockInfo {
  const fullPinyin = pinyin(name, {
    toneType: "none",
    type: "array",
    nonZh: "removed"
  })
    .join("")
    .toLowerCase();

  const abbr = pinyin(name, {
    toneType: "none",
    pattern: "first",
    type: "array",
    nonZh: "removed"
  })
    .join("")
    .toLowerCase();

  const symbol = `${market}${code}`;
  const sina = `${market.toLowerCase()}${code}`;

  return {
    code,
    market,
    name,
    symbol,
    sina,
    xueqiu: `https://xueqiu.com/S/${symbol}`,
    pinyin: fullPinyin,
    abbr
  };
}

function tushareMarketFromExchange(exchange: string): StockMarket | null {
  switch (exchange.toUpperCase()) {
    case "SSE":
      return "SH";
    case "SZSE":
      return "SZ";
    case "BSE":
      return "BJ";
    default:
      return null;
  }
}

function tushareMarketFromTsCode(tsCode: string): StockMarket | null {
  const suffix = tsCode.split(".")[1]?.toUpperCase();
  if (suffix === "SH") return "SH";
  if (suffix === "SZ") return "SZ";
  if (suffix === "BJ") return "BJ";
  return null;
}

function dedupeStocks(stocks: StockInfo[]): StockInfo[] {
  const bySymbol = new Map<string, StockInfo>();
  for (const stock of stocks) {
    bySymbol.set(stock.symbol, stock);
  }

  return Array.from(bySymbol.values());
}

function inferMarket(code: string, eastMoneyMarket?: number): StockMarket | null {
  if (code.startsWith("6")) {
    return "SH";
  }

  if (code.startsWith("0") || code.startsWith("3")) {
    return "SZ";
  }

  if (code.startsWith("4") || code.startsWith("8") || code.startsWith("9")) {
    return "BJ";
  }

  if (eastMoneyMarket === 1) {
    return "SH";
  }

  if (eastMoneyMarket === 0) {
    return "SZ";
  }

  return null;
}

function scoreStock(stock: StockInfo, query: string): number {
  const code = stock.code.toLowerCase();
  const symbol = stock.symbol.toLowerCase();
  const name = stock.name.toLowerCase();
  const py = stock.pinyin.toLowerCase();
  const abbr = stock.abbr.toLowerCase();
  const sina = stock.sina.toLowerCase();

  if (code === query || symbol === query || sina === query) return 100;
  if (name === query || py === query || abbr === query) return 95;
  if (code.startsWith(query) || symbol.startsWith(query) || sina.startsWith(query)) return 90;
  if (name.startsWith(query) || py.startsWith(query) || abbr.startsWith(query)) return 80;
  if (name.includes(query)) return 70;
  if (py.includes(query) || abbr.includes(query)) return 60;
  if (code.includes(query) || symbol.includes(query)) return 50;
  return 0;
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

export function getSinaChartUrl(symbol: string, period: string): string | null {
  if (period === "yearly") {
    return null;
  }

  const match = symbol.toUpperCase().match(/^(SH|SZ|BJ)(\d{6})$/);
  if (!match) {
    return null;
  }

  return `https://image.sinajs.cn/newchart/${period}/n/${match[1].toLowerCase()}${match[2]}.gif`;
}

export function getXueqiuSymbolFromHref(href: string): string | null {
  const match = href.match(/https?:\/\/xueqiu\.com\/S\/((?:SH|SZ|BJ)\d{6})/i);
  return match ? match[1].toUpperCase() : null;
}
