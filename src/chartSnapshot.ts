import { requestUrl } from "obsidian";
import { getSinaChartUrl } from "./stockStore";
import type { ChartPeriod } from "./types";

type CopyChartSnapshotOptions = {
  symbol: string;
  period: ChartPeriod;
};

export async function copyChartSnapshotToClipboard({ symbol, period }: CopyChartSnapshotOptions): Promise<void> {
  const chartUrl = getSinaChartUrl(symbol, period);
  if (!chartUrl) {
    throw new Error("走势图暂不可用");
  }

  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("当前环境不支持复制图片到剪贴板");
  }

  const imageBuffer = await downloadChartImage(chartUrl);
  const imageBlob = await convertImageToPngBlob(imageBuffer);
  await navigator.clipboard.write([
    new ClipboardItem({
      [imageBlob.type]: imageBlob
    })
  ]);
}

async function downloadChartImage(url: string): Promise<ArrayBuffer> {
  const response = await requestUrl({
    url,
    method: "GET",
    headers: {
      Accept: "image/gif,image/*,*/*",
      Referer: "https://finance.sina.com.cn/",
      "User-Agent": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Obsidian Investment Notes"
    }
  });

  if (!response.arrayBuffer || response.arrayBuffer.byteLength === 0) {
    throw new Error("走势图快照下载失败");
  }

  return response.arrayBuffer;
}

async function convertImageToPngBlob(imageBuffer: ArrayBuffer): Promise<Blob> {
  const imageUrl = URL.createObjectURL(new Blob([imageBuffer]));

  try {
    const image = await loadImage(imageUrl);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("走势图快照复制失败");
    }

    context.drawImage(image, 0, 0);
    const pngBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!pngBlob) {
      throw new Error("走势图快照复制失败");
    }

    return pngBlob;
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("走势图快照加载失败"));
    image.src = url;
  });
}
