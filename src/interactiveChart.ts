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
const INITIAL_VISIBLE_KLINE_COUNT = 48;
const HISTORY_PREFETCH_MIN_BUFFER_COUNT = 20;
const HISTORY_PREFETCH_FAST_BUFFER_COUNT = 60;
const HISTORY_EDGE_WAIT_THRESHOLD = 2;
const HISTORY_EDGE_CONTINUE_COUNT = 30;

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
  onNeedMoreHistory?: (state: { edgeWaiting: boolean; suggestedLimit: number }) => void;
  onHistoryLoadingChange?: (state: { loading: boolean; error?: boolean }) => void;
};

export function createInteractiveMarketChart(
  container: HTMLElement,
  options: InteractiveMarketChartOptions = {}
): InteractiveMarketChart {
  const chart = echarts.init(container, undefined, { renderer: "canvas" });
  let currentData: MarketChartData | null = null;
  let currentPeriod: ChartPeriod | null = null;
  let requestingHistory = false;
  let lastHoverIndex: number | null = null;
  let edgeWaitingForHistory = false;
  let lastHistoryRequestAt = 0;
  let slowHistoryRequestCount = 0;
  let draggingChart = false;

  const emitLatest = () => {
    lastHoverIndex = getPointCount(currentData) - 1;
    options.onHoverChange?.(getHoverPayload(currentData, lastHoverIndex));
  };

  const emitHoverAt = (index: number | null) => {
    if (index === null) {
      return;
    }

    lastHoverIndex = index;
    options.onHoverChange?.(getHoverPayload(currentData, index));
  };

  const resetKlineWindow = () => {
    if (!currentData || currentData.kind !== "kline") {
      return;
    }

    const dataLength = currentData.bars.length;
    chart.dispatchAction({
      type: "dataZoom",
      dataZoomIndex: 0,
      startValue: Math.max(0, dataLength - INITIAL_VISIBLE_KLINE_COUNT),
      endValue: Math.max(0, dataLength - 1)
    });
    emitLatest();
  };

  chart.on("updateAxisPointer", (event: unknown) => {
    const index = getAxisPointerIndex(event);
    emitHoverAt(index);
  });

  const requestMoreHistory = (edgeWaiting: boolean, suggestedLimit: number) => {
    if (!currentData || currentData.kind !== "kline" || requestingHistory) {
      return;
    }

    requestingHistory = true;
    edgeWaitingForHistory = edgeWaiting;
    lastHistoryRequestAt = Date.now();
    options.onHistoryLoadingChange?.({ loading: true });
    options.onNeedMoreHistory?.({ edgeWaiting, suggestedLimit });
    window.setTimeout(() => {
      requestingHistory = false;
    }, 600);
  };

  chart.on("datazoom", () => {
    if (!currentData || currentData.kind !== "kline" || requestingHistory) {
      return;
    }

    const range = getVisibleKlineWindow(chart, currentData.bars.length);
    const visibleCount = range.endIndex - range.startIndex + 1;
    const prefetchBuffer = getHistoryPrefetchBuffer(visibleCount, slowHistoryRequestCount);
    if (range.startIndex <= prefetchBuffer) {
      const edgeWaiting = range.startIndex <= HISTORY_EDGE_WAIT_THRESHOLD;
      requestMoreHistory(edgeWaiting, edgeWaiting || slowHistoryRequestCount > 0 ? 180 : 90);
    }
  });

  chart.getZr().on("globalout", emitLatest);
  chart.getZr().on("mousedown", () => {
    draggingChart = true;
    container.classList.add("is-chart-dragging");
  });
  chart.getZr().on("mousemove", () => {
    if (!draggingChart || !currentData || currentData.kind !== "kline" || requestingHistory) {
      return;
    }

    const range = getVisibleKlineWindow(chart, currentData.bars.length);
    if (range.startIndex <= HISTORY_EDGE_WAIT_THRESHOLD) {
      requestMoreHistory(true, 180);
    }
  });
  chart.getZr().on("mousewheel", () => {
    if (!currentData || currentData.kind !== "kline" || requestingHistory) {
      return;
    }

    window.setTimeout(() => {
      if (!currentData || currentData.kind !== "kline" || requestingHistory) {
        return;
      }

      const range = getVisibleKlineWindow(chart, currentData.bars.length);
      const visibleCount = range.endIndex - range.startIndex + 1;
      const prefetchBuffer = getHistoryPrefetchBuffer(visibleCount, slowHistoryRequestCount);
      if (range.startIndex <= prefetchBuffer) {
        const edgeWaiting = range.startIndex <= HISTORY_EDGE_WAIT_THRESHOLD;
        requestMoreHistory(edgeWaiting, edgeWaiting || slowHistoryRequestCount > 0 ? 180 : 90);
      }
    }, 0);
  });
  chart.getZr().on("mouseup", () => {
    draggingChart = false;
    container.classList.remove("is-chart-dragging");
  });
  chart.getZr().on("globalout", () => {
    draggingChart = false;
    container.classList.remove("is-chart-dragging");
  });
  chart.getZr().on("dblclick", resetKlineWindow);
  const clearDragging = () => {
    draggingChart = false;
    container.classList.remove("is-chart-dragging");
  };
  window.addEventListener("mouseup", clearDragging);

  return {
    update(data, period) {
      currentData = data;
      currentPeriod = period;
      chart.setOption(data.kind === "intraday" ? buildIntradayOption(data) : buildKlineOption(data, period), true);
      lastHoverIndex = null;
      emitLatest();
    },
    prependHistory(data) {
      if (!currentData || currentData.kind !== "kline" || currentPeriod === null || data.bars.length === 0) {
        return;
      }

      const oldLength = currentData.bars.length;
      const visibleWindow = getVisibleKlineWindow(chart, oldLength);
      const shouldContinueFromEdge = edgeWaitingForHistory || visibleWindow.startIndex <= HISTORY_EDGE_WAIT_THRESHOLD;
      const knownDates = new Set(currentData.bars.map((bar) => bar.date));
      const olderBars = data.bars.filter((bar) => !knownDates.has(bar.date));
      if (olderBars.length === 0) {
        edgeWaitingForHistory = false;
        return;
      }

      const elapsed = Date.now() - lastHistoryRequestAt;
      slowHistoryRequestCount = elapsed > 800 ? Math.min(2, slowHistoryRequestCount + 1) : Math.max(0, slowHistoryRequestCount - 1);
      currentData = {
        ...currentData,
        bars: [...olderBars, ...currentData.bars]
      };
      const nextWindow = shouldContinueFromEdge
        ? getContinuedHistoryWindow(olderBars.length, visibleWindow)
        : {
            startValue: olderBars.length + visibleWindow.startIndex,
            endValue: olderBars.length + visibleWindow.endIndex
          };
      chart.setOption(buildKlineOption(currentData, currentPeriod), true);
      chart.dispatchAction({
        type: "dataZoom",
        dataZoomIndex: 0,
        startValue: nextWindow.startValue,
        endValue: nextWindow.endValue
      });
      edgeWaitingForHistory = false;
      if (lastHoverIndex !== null && lastHoverIndex < oldLength) {
        emitHoverAt(lastHoverIndex + olderBars.length);
      } else {
        emitLatest();
      }
    },
    resize() {
      chart.resize();
    },
    dispose() {
      window.removeEventListener("mouseup", clearDragging);
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
      show: true,
      showContent: false,
      trigger: "axis",
      axisPointer: { type: "cross" }
    },
    axisPointer: { link: [{ xAxisIndex: "all" }] },
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
        axisPointer: buildPriceAxisPointer(),
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
        axisPointer: { label: { show: false } },
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
      show: true,
      showContent: false,
      trigger: "axis",
      axisPointer: { type: "cross" }
    },
    axisPointer: { link: [{ xAxisIndex: "all" }] },
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
        axisPointer: buildPriceAxisPointer(),
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
        axisPointer: { label: { show: false } },
        splitLine: { show: false }
      }
    ],
    dataZoom: [
      buildInsideDataZoom(dates.length)
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
    axisPointer: { label: { show: false } },
    splitLine: { show: false },
    min: "dataMin",
    max: "dataMax"
  };
}

function buildPriceAxisPointer(): echarts.YAXisComponentOption["axisPointer"] {
  return {
    label: {
      show: true,
      precision: 2,
      backgroundColor: "#333333",
      color: "#ffffff",
      fontSize: 12,
      fontWeight: 600,
      padding: [3, 8]
    }
  };
}

function buildInsideDataZoom(dataLength: number): echarts.DataZoomComponentOption {
  const visibleCount = Math.min(INITIAL_VISIBLE_KLINE_COUNT, dataLength);
  return {
    type: "inside",
    xAxisIndex: [0, 1],
    startValue: Math.max(0, dataLength - visibleCount),
    endValue: Math.max(0, dataLength - 1),
    zoomOnMouseWheel: true,
    moveOnMouseMove: true,
    preventDefaultMouseMove: true,
    throttle: 80
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

function getVisibleKlineWindow(chart: echarts.ECharts, dataLength: number): { startIndex: number; endIndex: number } {
  const option = chart.getOption() as {
    dataZoom?: Array<{
      start?: number;
      end?: number;
      startValue?: number | string;
      endValue?: number | string;
    }>;
  };
  const zoom = option.dataZoom?.[0];
  if (!zoom || dataLength <= 0) {
    return { startIndex: 0, endIndex: Math.max(0, dataLength - 1) };
  }

  const startFromValue = normalizeZoomIndex(zoom.startValue, dataLength);
  const endFromValue = normalizeZoomIndex(zoom.endValue, dataLength);
  if (startFromValue !== null && endFromValue !== null) {
    return {
      startIndex: Math.min(startFromValue, endFromValue),
      endIndex: Math.max(startFromValue, endFromValue)
    };
  }

  const startPercent = typeof zoom.start === "number" ? zoom.start : 0;
  const endPercent = typeof zoom.end === "number" ? zoom.end : 100;
  return {
    startIndex: clampIndex(Math.floor((startPercent / 100) * (dataLength - 1)), dataLength),
    endIndex: clampIndex(Math.ceil((endPercent / 100) * (dataLength - 1)), dataLength)
  };
}

function normalizeZoomIndex(value: number | string | undefined, dataLength: number): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clampIndex(Math.round(value), dataLength);
  }
  if (typeof value === "string" && value.trim() !== "") {
    const index = Number.parseInt(value, 10);
    return Number.isFinite(index) ? clampIndex(index, dataLength) : null;
  }
  return null;
}

function clampIndex(value: number, dataLength: number): number {
  return Math.max(0, Math.min(Math.max(0, dataLength - 1), value));
}

function getHistoryPrefetchBuffer(visibleCount: number, slowRequestCount: number): number {
  if (slowRequestCount > 0 || visibleCount <= 24) {
    return HISTORY_PREFETCH_FAST_BUFFER_COUNT;
  }

  return Math.max(HISTORY_PREFETCH_MIN_BUFFER_COUNT, Math.ceil(visibleCount * 0.55));
}

function getContinuedHistoryWindow(
  addedCount: number,
  previousWindow: { startIndex: number; endIndex: number }
): { startValue: number; endValue: number } {
  const visibleCount = Math.max(1, previousWindow.endIndex - previousWindow.startIndex + 1);
  const startValue = Math.max(0, addedCount - Math.min(HISTORY_EDGE_CONTINUE_COUNT, Math.max(8, Math.floor(visibleCount * 0.5))));
  return {
    startValue,
    endValue: startValue + visibleCount - 1
  };
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
