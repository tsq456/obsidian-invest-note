import * as echarts from "echarts";
import type { ChartPeriod, MarketChartData, MarketKlineBar } from "./types";

const MUTED_TEXT_COLOR = "#8a8f98";

export type InteractiveMarketChart = {
  update(data: MarketChartData, period: ChartPeriod): void;
  resize(): void;
  dispose(): void;
};

export function createInteractiveMarketChart(container: HTMLElement): InteractiveMarketChart {
  const chart = echarts.init(container, undefined, { renderer: "canvas" });

  return {
    update(data, period) {
      chart.setOption(data.kind === "intraday" ? buildIntradayOption(data) : buildKlineOption(data, period), true);
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
      trigger: "axis",
      axisPointer: { type: "cross" },
      formatter(params) {
        const items = Array.isArray(params) ? params : [params];
        const index = items[0]?.dataIndex ?? 0;
        const point = data.points[index];
        if (!point) {
          return "";
        }
        return [
          `<strong>${point.time}</strong>`,
          `价格：${formatPrice(point.close)}`,
          `均价：${formatPrice(point.average)}`,
          `成交量：${formatVolume(point.volume)}`,
          `成交额：${formatAmount(point.amount)}`
        ].join("<br>");
      }
    },
    axisPointer: { link: [{ xAxisIndex: "all" }] },
    grid: [
      { left: 48, right: 12, top: 18, height: 172 },
      { left: 48, right: 12, top: 224, height: 54 }
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
        axisLabel: { color: MUTED_TEXT_COLOR, formatter: "{value}万" },
        splitLine: { lineStyle: { color: "rgba(120, 120, 120, 0.12)" } }
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
    color: ["#4777d9", "#d99a20"],
    legend: {
      top: 0,
      left: 8,
      itemWidth: 12,
      itemHeight: 8,
      textStyle: { color: MUTED_TEXT_COLOR },
      data: [getPeriodLabel(period), "MA5", "MA10", "成交量"]
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
      formatter(params) {
        const items = Array.isArray(params) ? params : [params];
        const index = items[0]?.dataIndex ?? 0;
        const bar = data.bars[index];
        if (!bar) {
          return "";
        }
        return [
          `<strong>${bar.date}</strong>`,
          `开盘：${formatPrice(bar.open)}`,
          `收盘：${formatPrice(bar.close)}`,
          `最高：${formatPrice(bar.high)}`,
          `最低：${formatPrice(bar.low)}`,
          `涨跌幅：${formatPercent(bar.changePercent)}`,
          `成交量：${formatVolume(bar.volume)}`,
          `成交额：${formatAmount(bar.amount)}`
        ].join("<br>");
      }
    },
    axisPointer: { link: [{ xAxisIndex: "all" }] },
    grid: [
      { left: 48, right: 12, top: 34, height: 156 },
      { left: 48, right: 12, top: 224, height: 54 }
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
        axisLabel: { color: MUTED_TEXT_COLOR, formatter: "{value}万" },
        splitLine: { lineStyle: { color: "rgba(120, 120, 120, 0.12)" } }
      }
    ],
    dataZoom: [
      { type: "inside", xAxisIndex: [0, 1], start: 35, end: 100 },
      {
        type: "slider",
        xAxisIndex: [0, 1],
        bottom: 0,
        height: 18,
        showDetail: false,
        borderColor: "rgba(120, 120, 120, 0.24)",
        fillerColor: "rgba(80, 120, 200, 0.18)"
      }
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
      buildMaSeries("MA5", data.bars, 5),
      buildMaSeries("MA10", data.bars, 10),
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

function buildMaSeries(name: string, bars: MarketKlineBar[], dayCount: number): echarts.SeriesOption {
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
    lineStyle: { width: 1.2 }
  };
}

function getPeriodLabel(period: ChartPeriod): string {
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

function formatAmount(value: number | null): string {
  if (value === null) return "-";
  if (Math.abs(value) >= 100000000) return `${(value / 100000000).toFixed(2)}亿`;
  if (Math.abs(value) >= 10000) return `${(value / 10000).toFixed(2)}万`;
  return value.toFixed(0);
}
