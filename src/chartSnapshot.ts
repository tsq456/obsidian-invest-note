import { requestUrl, type App, type TFile } from "obsidian";
import { renderAnnotations, type ChartAnnotationSnapshot } from "./chartAnnotation";
import { getAssetChartUrl } from "./stockStore";
import type { ChartPeriod } from "./types";

const SNAPSHOT_DIR = "attachments/invest-note";

type CopyChartSnapshotOptions = {
  symbol: string;
  period: ChartPeriod;
  annotationSnapshot?: ChartAnnotationSnapshot | null;
};

type InsertChartSnapshotOptions = CopyChartSnapshotOptions & {
  app: App;
  symbol: string;
  lineHint: number | null;
};

export async function copyChartSnapshotToClipboard({
  symbol,
  period,
  annotationSnapshot
}: CopyChartSnapshotOptions): Promise<void> {
  const chartUrl = getAssetChartUrl(symbol, period);
  if (!chartUrl) {
    throw new Error("走势图暂不可用");
  }

  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("当前环境不支持复制图片到剪贴板");
  }

  const imageBlob = await createChartSnapshotBlob(chartUrl, annotationSnapshot);
  await navigator.clipboard.write([
    new ClipboardItem({
      [imageBlob.type]: imageBlob
    })
  ]);
}

export async function insertChartSnapshotBelowStockParagraph({
  app,
  symbol,
  period,
  annotationSnapshot,
  lineHint
}: InsertChartSnapshotOptions): Promise<string> {
  const file = app.workspace.getActiveFile();
  if (!file || file.extension !== "md") {
    throw new Error("未找到当前笔记");
  }

  const chartUrl = getAssetChartUrl(symbol, period);
  if (!chartUrl) {
    throw new Error("走势图暂不可用");
  }

  const content = await app.vault.read(file);
  const lines = content.split("\n");
  const paragraph = findStockParagraph(lines, symbol, lineHint);
  if (!paragraph) {
    throw new Error("未找到标的文本所在段落");
  }

  const imageBlob = await createChartSnapshotBlob(chartUrl, annotationSnapshot);
  const imagePath = await createSnapshotPath(app, symbol, period);
  await ensureFolder(app, SNAPSHOT_DIR);
  await app.vault.createBinary(imagePath, await imageBlob.arrayBuffer());
  await insertMarkdownImage(app, file, content, paragraph, imagePath);
  return imagePath;
}

async function createChartSnapshotBlob(url: string, annotationSnapshot?: ChartAnnotationSnapshot | null): Promise<Blob> {
  const imageBuffer = await downloadChartImage(url);
  return convertImageToPngBlob(imageBuffer, annotationSnapshot);
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

async function convertImageToPngBlob(
  imageBuffer: ArrayBuffer,
  annotationSnapshot?: ChartAnnotationSnapshot | null
): Promise<Blob> {
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
    if (annotationSnapshot) {
      renderAnnotations(
        context,
        annotationSnapshot.annotations,
        image.naturalWidth / annotationSnapshot.width,
        image.naturalHeight / annotationSnapshot.height
      );
    }

    const pngBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!pngBlob) {
      throw new Error("走势图快照复制失败");
    }

    return pngBlob;
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

async function createSnapshotPath(app: App, symbol: string, period: ChartPeriod): Promise<string> {
  const timestamp = formatSnapshotTimestamp(new Date());
  const baseName = `${timestamp}-${symbol.toUpperCase()}-${period}-annotated`;
  let path = `${SNAPSHOT_DIR}/${baseName}.png`;

  for (let index = 1; await app.vault.adapter.exists(path); index += 1) {
    path = `${SNAPSHOT_DIR}/${baseName}-${index}.png`;
  }

  return path;
}

async function ensureFolder(app: App, folderPath: string): Promise<void> {
  const parts = folderPath.split("/").filter(Boolean);
  let current = "";

  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!(await app.vault.adapter.exists(current))) {
      await app.vault.createFolder(current);
    }
  }
}

async function insertMarkdownImage(
  app: App,
  file: TFile,
  content: string,
  paragraph: { start: number; end: number },
  imagePath: string
): Promise<void> {
  const lines = content.split("\n");
  const embed = `![](${imagePath})`;
  const nextLine = lines[paragraph.end + 1];
  if (nextLine === "") {
    lines.splice(paragraph.end + 2, 0, embed);
  } else {
    lines.splice(paragraph.end + 1, 0, "", embed);
  }

  await app.vault.modify(file, lines.join("\n"));
}

function findStockParagraph(
  lines: string[],
  symbol: string,
  lineHint: number | null
): { start: number; end: number } | null {
  if (lineHint !== null && lineHint >= 0 && lineHint < lines.length) {
    const hintedParagraph = expandParagraph(lines, lineHint);
    if (paragraphContainsSymbol(lines, hintedParagraph, symbol)) {
      return hintedParagraph;
    }
  }

  for (let line = 0; line < lines.length; line += 1) {
    const paragraph = expandParagraph(lines, line);
    if (paragraphContainsSymbol(lines, paragraph, symbol)) {
      return paragraph;
    }
    line = paragraph.end;
  }

  return null;
}

function expandParagraph(lines: string[], line: number): { start: number; end: number } {
  let start = line;
  let end = line;

  while (start > 0 && lines[start - 1].trim() !== "") {
    start -= 1;
  }

  while (end < lines.length - 1 && lines[end + 1].trim() !== "") {
    end += 1;
  }

  return { start, end };
}

function paragraphContainsSymbol(lines: string[], paragraph: { start: number; end: number }, symbol: string): boolean {
  const text = lines.slice(paragraph.start, paragraph.end + 1).join("\n");
  if (symbol.toUpperCase().startsWith("OF")) {
    const code = symbol.slice(2);
    return new RegExp(`https?:\\/\\/fund\\.eastmoney\\.com\\/${escapeRegExp(code)}(?:\\.html)?(?:[^\\w]|$)`, "i").test(text);
  }

  return new RegExp(`https?:\\/\\/xueqiu\\.com\\/S\\/${escapeRegExp(symbol)}(?:[^\\w]|$)`, "i").test(text);
}

function formatSnapshotTimestamp(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("走势图快照加载失败"));
    image.src = url;
  });
}
