import { Notice, Plugin, requestUrl } from "obsidian";
import { pinyin } from "pinyin-pro";
import seedStocks from "../data/stocks.seed.json";
import type { ChartPeriod, InvestmentAsset, InvestmentNotesData, StockInfo, StockMarket } from "./types";

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
const EASTMONEY_ETF_FILTER = "b:MK0021,b:MK0022,b:MK0023,b:MK0024";
const TUSHARE_API_URL = "https://api.tushare.pro";
const EASTMONEY_FUND_CODE_URL = "https://fund.eastmoney.com/js/fundcode_search.js";
const ASSET_CACHE_SOURCE_VERSION = "investment-assets-v2";
const EMBEDDED_SEED_STOCKS = seedStocks as Array<Partial<InvestmentAsset> & Pick<InvestmentAsset, "code" | "market" | "name" | "symbol" | "sina" | "xueqiu" | "pinyin" | "abbr">>;

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
  private assets: InvestmentAsset[] = [];

  constructor(
    private readonly plugin: Plugin,
    private readonly data: InvestmentNotesData,
    private readonly persist: () => Promise<void>
  ) {}

  async initialize(): Promise<void> {
    const seedAssets = await this.loadSeedAssets();
    const cachedAssets = this.data.assetCache?.assets ?? this.data.stockCache?.stocks ?? [];
    this.assets = cachedAssets.length > 0 ? normalizeCachedAssets(cachedAssets) : seedAssets;

    if (this.data.settings.autoUpdateStockList && this.isCacheExpired()) {
      const refreshTimer = window.setTimeout(() => {
        void this.refreshFromRemote(false);
      }, 5000);
      this.plugin.register(() => window.clearTimeout(refreshTimer));
    }
  }

  getAll(): InvestmentAsset[] {
    return this.assets;
  }

  getBySymbol(symbol: string): InvestmentAsset | null {
    const normalized = symbol.toUpperCase();
    return this.assets.find((asset) => asset.symbol === normalized) ?? null;
  }

  search(query: string, limit = 20): InvestmentAsset[] {
    const normalized = normalizeSearchText(query);
    if (!normalized) {
      return this.assets.slice(0, limit);
    }

    return this.assets
      .map((asset, index) => ({
        asset,
        index,
        score: scoreAsset(asset, normalized)
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, limit)
      .map((entry) => entry.asset);
  }

  async refreshFromRemote(showNotice = true): Promise<void> {
    try {
      const remoteAssets = await this.fetchRemoteAssets();
      if (remoteAssets.length === 0) {
        throw new Error("远端返回了空标的列表");
      }

      this.assets = remoteAssets;
      this.data.assetCache = {
        assets: remoteAssets,
        updatedAt: Date.now(),
        sourceVersion: ASSET_CACHE_SOURCE_VERSION
      };
      this.data.stockCache = null;
      await this.persist();

      if (showNotice) {
        new Notice(`标的列表已更新：${remoteAssets.length} 个`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[investment-notes] Asset list refresh failed; using local cache. ${message}`);
      if (showNotice) {
        new Notice("标的列表刷新失败，已继续使用本地缓存");
      }
    }
  }

  getLastUpdatedText(): string {
    const updatedAt = this.data.assetCache?.updatedAt ?? this.data.stockCache?.updatedAt;
    if (!updatedAt) {
      return "尚未刷新，正在使用内置种子库";
    }

    return new Date(updatedAt).toLocaleString();
  }

  private isCacheExpired(): boolean {
    const updatedAt = this.data.assetCache?.updatedAt ?? this.data.stockCache?.updatedAt ?? 0;
    const ttlDays = Math.max(1, this.data.settings.stockListTtlDays);
    return Date.now() - updatedAt > ttlDays * 24 * 60 * 60 * 1000;
  }

  private async loadSeedAssets(): Promise<InvestmentAsset[]> {
    const dir = this.plugin.manifest.dir;
    if (!dir) {
      return normalizeCachedAssets(EMBEDDED_SEED_STOCKS);
    }

    try {
      const raw = await this.plugin.app.vault.adapter.read(`${dir}/data/stocks.seed.json`);
      return normalizeCachedAssets(JSON.parse(raw) as StockInfo[]);
    } catch (error) {
      console.warn("[investment-notes] Failed to load seed stock list from plugin data folder; using bundled seed.", error);
      return normalizeCachedAssets(EMBEDDED_SEED_STOCKS);
    }
  }

  private async fetchRemoteAssets(): Promise<InvestmentAsset[]> {
    const errors: string[] = [];
    const groups: InvestmentAsset[][] = [];

    try {
      groups.push(await this.fetchRemoteStocks());
    } catch (error) {
      errors.push(`股票: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      groups.push(await this.fetchEastMoneyEtfs());
    } catch (error) {
      errors.push(`ETF: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      groups.push(await this.fetchEastMoneyFunds());
    } catch (error) {
      errors.push(`场外基金: ${error instanceof Error ? error.message : String(error)}`);
    }

    const assets = dedupeAssets(groups.flat());
    if (assets.length === 0) {
      throw new Error(errors.join(" | "));
    }

    if (errors.length > 0) {
      console.warn(`[investment-notes] Partial asset refresh failure: ${errors.join(" | ")}`);
    }

    return assets;
  }

  private async fetchRemoteStocks(): Promise<InvestmentAsset[]> {
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

  private async fetchTushareStocks(token: string): Promise<InvestmentAsset[]> {
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
      .filter((stock): stock is InvestmentAsset => stock !== null);

    if (stocks.length === 0) {
      throw new Error("Tushare 返回了空股票列表");
    }

    return stocks;
  }

  private async fetchEastMoneyStocks(): Promise<InvestmentAsset[]> {
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

  private async fetchEastMoneyStocksFromHost(host: string): Promise<InvestmentAsset[]> {
    const allStocks: InvestmentAsset[] = [];

    for (const marketFilter of EASTMONEY_MARKET_FILTERS) {
      allStocks.push(...(await this.fetchEastMoneyAssetsByMarket(host, marketFilter, "stock")));
    }

    return dedupeAssets(allStocks);
  }

  private async fetchEastMoneyEtfs(): Promise<InvestmentAsset[]> {
    const errors: string[] = [];

    for (const host of EASTMONEY_HOSTS) {
      try {
        return dedupeAssets(await this.fetchEastMoneyAssetsByMarket(host, EASTMONEY_ETF_FILTER, "etf"));
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    throw new Error(errors.join(" | "));
  }

  private async fetchEastMoneyAssetsByMarket(
    host: string,
    marketFilter: string,
    assetType: "stock" | "etf"
  ): Promise<InvestmentAsset[]> {
    const assets: InvestmentAsset[] = [];
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
      assets.push(
        ...rows
          .map((item) => normalizeEastMoneyAsset(item, assetType))
          .filter((asset): asset is InvestmentAsset => asset !== null)
      );

      if (page > 100) {
        break;
      }
    }

    return assets;
  }

  private async fetchEastMoneyFunds(): Promise<InvestmentAsset[]> {
    const rows = await this.fetchEastMoneyFundCodeRows();
    const funds = rows
      .filter((row) => {
        const code = typeof row[0] === "string" ? row[0].trim() : "";
        const name = typeof row[2] === "string" ? row[2].trim() : "";
        return !isExchangeTradedEtf(code, name);
      })
      .map((row) => normalizeEastMoneyFund(row))
      .filter((asset): asset is InvestmentAsset => asset !== null);
    if (funds.length === 0) {
      throw new Error("天天基金返回了空基金列表");
    }

    return funds;
  }
  private async fetchEastMoneyFundCodeRows(): Promise<unknown[][]> {
    const response = await requestUrl({
      url: EASTMONEY_FUND_CODE_URL,
      method: "GET",
      headers: {
        Accept: "application/javascript,text/plain,*/*",
        Referer: "https://fund.eastmoney.com/",
        "User-Agent": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Obsidian Investment Notes"
      }
    });
    const match = response.text.match(/var\s+r\s*=\s*(\[[\s\S]*\]);?/);
    if (!match) {
      throw new Error("天天基金列表格式已变化");
    }

    return JSON.parse(match[1]) as unknown[][];
  }
}

function normalizeTushareStock(fields: string[], item: unknown[]): InvestmentAsset | null {
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

  return buildAssetInfo("stock", code, market, name);
}

function normalizeEastMoneyAsset(item: EastMoneyDiffItem, assetType: "stock" | "etf"): InvestmentAsset | null {
  const code = item.f12?.trim();
  const name = item.f14?.trim();
  if (!code || !name || !/^\d{6}$/.test(code)) {
    return null;
  }

  const market = inferMarket(code, item.f13);
  if (!market) {
    return null;
  }

  return buildAssetInfo(assetType, code, market, name);
}

function normalizeEastMoneyFund(row: unknown[]): InvestmentAsset | null {
  const code = typeof row[0] === "string" ? row[0].trim() : "";
  const abbr = typeof row[1] === "string" ? row[1].trim().toLowerCase() : "";
  const name = typeof row[2] === "string" ? row[2].trim() : "";
  const category = typeof row[3] === "string" ? row[3].trim() : "";
  const fullPinyin = typeof row[4] === "string" ? row[4].trim().toLowerCase() : "";
  if (!/^\d{6}$/.test(code) || !name) {
    return null;
  }

  return {
    assetType: "fund",
    code,
    market: "OF",
    name,
    symbol: `OF${code}`,
    sina: "",
    xueqiu: "",
    url: `https://fund.eastmoney.com/${code}.html`,
    pinyin: fullPinyin || toFullPinyin(name),
    abbr: abbr || toPinyinAbbr(name),
    category
  };
}

function buildAssetInfo(assetType: "stock" | "etf", code: string, market: StockMarket, name: string): InvestmentAsset {
  const symbol = `${market}${code}`;

  return {
    assetType,
    code,
    market,
    name,
    symbol,
    sina: `${market.toLowerCase()}${code}`,
    xueqiu: `https://xueqiu.com/S/${symbol}`,
    url: `https://xueqiu.com/S/${symbol}`,
    pinyin: toFullPinyin(name),
    abbr: toPinyinAbbr(name)
  };
}

function normalizeCachedAssets(assets: Array<Partial<InvestmentAsset> & Pick<InvestmentAsset, "code" | "market" | "name" | "symbol">>): InvestmentAsset[] {
  return assets
    .map((asset) => {
      if (asset.symbol.startsWith("OF") || asset.assetType === "fund" || asset.market === "OF") {
        const etfMarket = inferEtfMarket(asset.code);
        if (etfMarket && isExchangeTradedEtf(asset.code, asset.name)) {
          return buildAssetInfo("etf", asset.code, etfMarket, asset.name);
        }

        return normalizeEastMoneyFund([
          asset.code,
          asset.abbr ?? "",
          asset.name,
          asset.category ?? "",
          asset.pinyin ?? ""
        ]);
      }

      const market = asset.market === "SH" || asset.market === "SZ" || asset.market === "BJ" ? asset.market : null;
      if (!market) {
        return null;
      }

      const cachedAssetType: string = typeof asset.assetType === "string" ? asset.assetType : "stock";
      if (cachedAssetType === "listedFund") {
        return null;
      }

      return buildAssetInfo(cachedAssetType === "etf" ? "etf" : "stock", asset.code, market, asset.name);
    })
    .filter((asset): asset is InvestmentAsset => asset !== null);
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

function dedupeAssets(assets: InvestmentAsset[]): InvestmentAsset[] {
  const byKey = new Map<string, InvestmentAsset>();
  for (const asset of assets) {
    byKey.set(`${asset.assetType}:${asset.symbol}`, asset);
  }

  return Array.from(byKey.values());
}

function inferMarket(code: string, eastMoneyMarket?: number): StockMarket | null {
  if (eastMoneyMarket === 1) {
    return "SH";
  }

  if (eastMoneyMarket === 0) {
    return "SZ";
  }

  if (code.startsWith("6") || code.startsWith("5")) {
    return "SH";
  }

  if (code.startsWith("0") || code.startsWith("1") || code.startsWith("2") || code.startsWith("3")) {
    return "SZ";
  }

  if (code.startsWith("4") || code.startsWith("8") || code.startsWith("9")) {
    return "BJ";
  }

  return null;
}

function isExchangeTradedEtf(code: string, name: string): boolean {
  if (!/^\d{6}$/.test(code) || !/ETF/i.test(name) || /联接/.test(name)) {
    return false;
  }

  return /^(15|51|56|58)\d{4}$/.test(code);
}

function inferEtfMarket(code: string): StockMarket | null {
  if (/^15\d{4}$/.test(code)) {
    return "SZ";
  }

  if (/^(51|56|58)\d{4}$/.test(code)) {
    return "SH";
  }

  return null;
}

function scoreAsset(asset: InvestmentAsset, query: string): number {
  const code = asset.code.toLowerCase();
  const symbol = asset.symbol.toLowerCase();
  const name = asset.name.toLowerCase();
  const py = asset.pinyin.toLowerCase();
  const abbr = asset.abbr.toLowerCase();
  const sina = asset.sina.toLowerCase();
  const category = (asset.category ?? "").toLowerCase();

  if (code === query || symbol === query || sina === query) return 100;
  if (name === query || py === query || abbr === query) return 95;
  if (code.startsWith(query) || symbol.startsWith(query) || sina.startsWith(query)) return 90;
  if (name.startsWith(query) || py.startsWith(query) || abbr.startsWith(query)) return 80;
  if (name.includes(query)) return 70;
  if (py.includes(query) || abbr.includes(query)) return 60;
  if (code.includes(query) || symbol.includes(query) || category.includes(query)) return 50;
  return 0;
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function toFullPinyin(name: string): string {
  return pinyin(name, {
    toneType: "none",
    type: "array",
    nonZh: "removed"
  })
    .join("")
    .toLowerCase();
}

function toPinyinAbbr(name: string): string {
  return pinyin(name, {
    toneType: "none",
    pattern: "first",
    type: "array",
    nonZh: "removed"
  })
    .join("")
    .toLowerCase();
}

export function getAssetChartUrl(symbol: string, period: ChartPeriod): string | null {
  const normalized = symbol.toUpperCase();
  const fundMatch = normalized.match(/^OF(\d{6})$/);
  if (fundMatch) {
    if (period === "netWorth") {
      return `https://j4.dfcfw.com/charts/pic6/${fundMatch[1]}.png`;
    }
    if (period === "accWorth") {
      return `https://j4.dfcfw.com/charts/pic7/${fundMatch[1]}.png`;
    }
    return null;
  }

  const match = normalized.match(/^(SH|SZ|BJ)(\d{6})$/);
  if (!match) {
    return null;
  }

  if (period === "netWorth" || period === "accWorth") {
    return null;
  }

  return `https://image.sinajs.cn/newchart/${period}/n/${match[1].toLowerCase()}${match[2]}.gif`;
}

export function getSinaChartUrl(symbol: string, period: ChartPeriod): string | null {
  return getAssetChartUrl(symbol, period);
}

export function getAssetSymbolFromHref(href: string): string | null {
  const xueqiuMatch = href.match(/https?:\/\/xueqiu\.com\/S\/((?:SH|SZ|BJ)\d{6})/i);
  if (xueqiuMatch) {
    return xueqiuMatch[1].toUpperCase();
  }

  const fundMatch = href.match(/https?:\/\/fund\.eastmoney\.com\/(\d{6})(?:\.html)?/i);
  if (!fundMatch) {
    return null;
  }

  const code = fundMatch[1];
  const etfMarket = inferEtfMarket(code);
  return etfMarket ? `${etfMarket}${code}` : `OF${code}`;
}

export function getXueqiuSymbolFromHref(href: string): string | null {
  const symbol = getAssetSymbolFromHref(href);
  return symbol && !symbol.startsWith("OF") ? symbol : null;
}
