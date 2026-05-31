import * as echarts from "echarts";
import type { ChartPeriod, MarketChartData, MarketKlineBar, MarketTrendPoint } from "./types";

const MUTED_TEXT_COLOR = "#8a8f98";
const MA_SERIES = [
  { name: "MA5", dayCount: 5, color: "#4777d9" },
  { name: "MA10", dayCount: 10, color: "#d99a20" },
  { name: "MA20", dayCount: 20, color: "#8b5cf6" },
  { name: "MA30", dayCount: 30, color: "#0891b2" },
  { name: "MA60", dayCount: 60, color: "#64748b" }
];

export type InteractiveMarketChart = {
  update(data: MarketChartData, period: ChartPeriod): void;
  prependHistory(data: Extract<MarketChartData, { kind: "kline" }>): void;
  resize(): void;
  dispose(): void;
};

export type ChartHoverPayload =
  | {
      kind: "intraday";
      point: MarketTrendPoint;
    }
  | {
      kind: "kline";
      bar: MarketKlineBar;
    };

type InteractiveMarketChartOptions = {
  onHoverChange?: (payload: ChartHoverPayload | null) => void;
  onNeedMoreHistory?: () => void;
};

export function createInteractiveMarketChart(
  container: HTMLElement,
  options: InteractiveMarketChartOptions = {}
): InteractiveMarketChart {
  const chart = echarts.init(container, undefined, { renderer: "canvas" });
  let currentData: MarketChartData | null = null;
  let currentPeriod: ChartPeriod | null = null;
  let requestingHistory = false;

  const emitLatest = () => {
    options.onHoverChange?.(getHoverPayload(currentData, getPointCount(currentData) - 1));
  };

  chart.on("updateAxisPointer", (event: unknown) => {
    const index = getAxisPointerIndex(event);
    if (index === null) {
      return;
    }
    options.onHoverChange?.(getHoverPayload(currentData, index));
  });

  chart.on("datazoom", () => {
    if (!currentData || currentData.kind !== "kline" || requestingHistory) {
      return;
    }

    const range = getInsideDataZoomRange(chart);
    if (range !== null && range <= 1) {
      requestingHistory = true;
      options.onNeedMoreHistory?.();
      window.setTimeout(() => {
        requestingHistory = false;
      }, 600);
    }
  });

  chart.getZr().on("globalout", emitLatest);

  return {
    update(data, period) {
      currentData = data;
      currentPeriod = period;
      chart.setOption(data.kind === "intraday" ? buildIntradayOption(data) : buildKlineOption(data, period), true);
      emitLatest();
    },
    prependHistory(data) {
      if (!currentData || currentData.kind !== "kline" || currentPeriod === null || data.bars.length === 0) {
        return;
      }

      const oldLength = currentData.bars.length;
      const knownDates = new Set(currentData.bars.map((bar) => bar.date));
      const olderBars = data.bars.filter((bar) => !knownDates.has(bar.date));
      if (olderBars.length === 0) {
        return;
      }

      currentData = {
        ...currentData,
        bars: [...olderBars, ...currentData.bars]
      };
      chart.setOption(buildKlineOption(currentData, currentPeriod), true);
      chart.dispatchAction({
        type: "dataZoom",
        dataZoomIndex: 0,
        startValue: olderBars.length,
        endValue: olderBars.length + oldLength - 1
      });
      emitLatest();
    },
    resize() {
      chart.resize();
    },
    dispose() {
      chart.dispose();
    }
  };
}

function buildIntradayOption(data: Extract<MarketChartData, { kind: "intraday" }>): echarts.EChartsOption {
  const times = data.points.map((point) => point.time.slice(11));
  const prices = data.points.map((point) => point.close);
  const averages = data.points.map((point) => point.average ?? "-");
  const volumes = data.points.map((point) => ({
    value: point.volume / 10000,
    itemStyle: { color: point.close >= (data.preClose ?? point.open) ? "#d14b3f" : "#1f8f4d" }
  }));

  return {
    animation: false,
    color: ["#d14b3f", "#d99a20"],
    tooltip: {
      show: false,
      trigger: "axis",
      axisPointer: { type: "cross", label: { show: false } }
    },
    axisPointer: { label: { show: false }, link: [{ xAxisIndex: "all" }] },
    grid: [
      { left: 48, right: 12, top: 18, height: "58%" },
      { left: 48, right: 12, top: "76%", height: "14%" }
    ],
    xAxis: [
      buildCategoryAxis(times, false),
      { ...buildCategoryAxis(times, true), gridIndex: 1 }
    ],
    yAxis: [
      {
        scale: true,
        axisLabel: { color: MUTED_TEXT_COLOR },
        splitLine: { lineStyle: { color: "rgba(120, 120, 120, 0.18)" } }
      },
      {
        gridIndex: 1,
        scale: true,
        splitNumber: 2,
        axisLabel: {
          color: MUTED_TEXT_COLOR,
          hideOverlap: true,
          margin: 4,
          formatter: (value: number) => formatAxisVolume(value)
        },
        splitLine: { show: false }
      }
    ],
    series: [
      {
        name: "分时",
        type: "line",
        data: prices,
        symbol: "none",
        lineStyle: { width: 1.6 }
      },
      {
        name: "均价",
        type: "line",
        data: averages,
        symbol: "none",
        lineStyle: { width: 1.2 }
      },
      {
        name: "成交量",
        type: "bar",
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: volumes,
        barWidth: "60%"
      }
    ]
  };
}

function buildKlineOption(
  data: Extract<MarketChartData, { kind: "kline" }>,
  period: ChartPeriod
): echarts.EChartsOption {
  const dates = data.bars.map((bar) => bar.date);
  const candles = data.bars.map((bar) => [bar.open, bar.close, bar.low, bar.high]);
  const volumes = data.bars.map((bar) => ({
    value: bar.volume / 10000,
    itemStyle: { color: bar.close >= bar.open ? "#d14b3f" : "#1f8f4d" }
  }));

  return {
    animation: false,
    color: MA_SERIES.map((item) => item.color),
    legend: {
      top: 0,
      left: 8,
      itemWidth: 12,
      itemHeight: 8,
      textStyle: { color: MUTED_TEXT_COLOR },
      data: MA_SERIES.map((item) => item.name)
    },
    tooltip: {
      show: false,
      trigger: "axis",
      axisPointer: { type: "cross", label: { show: false } }
    },
    axisPointer: { label: { show: false }, link: [{ xAxisIndex: "all" }] },
    grid: [
      { left: 48, right: 12, top: 34, height: "52%" },
      { left: 48, right: 12, top: "74%", height: "14%" }
    ],
    xAxis: [
      buildCategoryAxis(dates, false),
      { ...buildCategoryAxis(dates, true), gridIndex: 1 }
    ],
    yAxis: [
      {
        scale: true,
        axisLabel: { color: MUTED_TEXT_COLOR },
        splitLine: { lineStyle: { color: "rgba(120, 120, 120, 0.18)" } }
      },
      {
        gridIndex: 1,
        scale: true,
        splitNumber: 2,
        axisLabel: {
          color: MUTED_TEXT_COLOR,
          hideOverlap: true,
          margin: 4,
          formatter: (value: number) => formatAxisVolume(value)
        },
        splitLine: { show: false }
      }
    ],
    dataZoom: [
      { type: "inside", xAxisIndex: [0, 1], start: 0, end: 100, zoomOnMouseWheel: true, moveOnMouseMove: true }
    ],
    series: [
      {
        name: getPeriodLabel(period),
        type: "candlestick",
        data: candles,
        itemStyle: {
          color: "#d14b3f",
          color0: "#1f8f4d",
          borderColor: "#d14b3f",
          borderColor0: "#1f8f4d"
        }
      },
      ...MA_SERIES.map((item) => buildMaSeries(item.name, data.bars, item.dayCount, item.color)),
      {
        name: "成交量",
        type: "bar",
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: volumes,
        barWidth: "58%"
      }
    ]
  };
}

function buildCategoryAxis(data: string[], showLabel: boolean): echarts.XAXisComponentOption {
  return {
    type: "category",
    data,
    boundaryGap: true,
    axisTick: { show: false },
    axisLine: { lineStyle: { color: "rgba(120, 120, 120, 0.28)" } },
    axisLabel: { show: showLabel, color: MUTED_TEXT_COLOR },
    splitLine: { show: false },
    min: "dataMin",
    max: "dataMax"
  };
}

function buildMaSeries(name: string, bars: MarketKlineBar[], dayCount: number, color: string): echarts.SeriesOption {
  return {
    name,
    type: "line",
    data: bars.map((_, index) => {
      if (index < dayCount - 1) {
        return "-";
      }

      let sum = 0;
      for (let i = 0; i < dayCount; i += 1) {
        sum += bars[index - i].close;
      }
      return Number((sum / dayCount).toFixed(2));
    }),
    smooth: true,
    symbol: "none",
    lineStyle: { color, width: 1.15 }
  };
}

function getAxisPointerIndex(event: unknown): number | null {
  const axesInfo = (event as { axesInfo?: Array<{ value?: number | string }> }).axesInfo;
  const rawValue = axesInfo?.find((item) => item.value !== undefined)?.value;
  const index = typeof rawValue === "number" ? rawValue : Number(rawValue);
  return Number.isFinite(index) ? Math.max(0, Math.floor(index)) : null;
}

function getHoverPayload(data: MarketChartData | null, index: number): ChartHoverPayload | null {
  if (!data || index < 0) {
    return null;
  }

  if (data.kind === "intraday") {
    const point = data.points[index];
    return point ? { kind: "intraday", point } : null;
  }

  const bar = data.bars[index];
  return bar ? { kind: "kline", bar } : null;
}

function getPointCount(data: MarketChartData | null): number {
  if (!data) {
    return 0;
  }

  return data.kind === "intraday" ? data.points.length : data.bars.length;
}

function getInsideDataZoomRange(chart: echarts.ECharts): number | null {
  const option = chart.getOption() as { dataZoom?: Array<{ start?: number }> };
  const start = option.dataZoom?.[0]?.start;
  return typeof start === "number" ? start : null;
}

function getPeriodLabel(period: ChartPeriod): string {
  if (period === "minute5") return "5分K";
  if (period === "minute30") return "30分K";
  if (period === "minute60") return "60分K";
  if (period === "weekly") return "周K";
  if (period === "monthly") return "月K";
  return "日K";
}

function formatPrice(value: number | null): string {
  return value === null ? "-" : value.toFixed(2);
}

function formatPercent(value: number | null): string {
  return value === null ? "-" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatVolume(value: number | null): string {
  if (value === null) return "-";
  if (Math.abs(value) >= 100000000) return `${(value / 100000000).toFixed(2)}亿手`;
  if (Math.abs(value) >= 10000) return `${(value / 10000).toFixed(2)}万手`;
  return `${value.toFixed(0)}手`;
}

function formatAxisVolume(value: number): string {
  if (Math.abs(value) >= 10000) return `${(value / 10000).toFixed(1)}亿`;
  return `${Math.round(value)}万`;
}

function formatAmount(value: number | null): string {
  if (value === null) return "-";
  if (Math.abs(value) >= 100000000) return `${(value / 100000000).toFixed(2)}亿`;
  if (Math.abs(value) >= 10000) return `${(value / 10000).toFixed(2)}万`;
  return value.toFixed(0);
}
