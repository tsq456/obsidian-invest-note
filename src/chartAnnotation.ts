export type AnnotationTool = "arrow" | "line" | "rect" | "polyline" | "text";

type Point = {
  x: number;
  y: number;
};

export type AnnotationColor = {
  name: string;
  label: string;
  value: string;
};

type BaseAnnotation = {
  color: string;
};

type LineAnnotation = BaseAnnotation & {
  type: "arrow" | "line";
  start: Point;
  end: Point;
};

type RectAnnotation = BaseAnnotation & {
  type: "rect";
  start: Point;
  end: Point;
};

type PolylineAnnotation = BaseAnnotation & {
  type: "polyline";
  points: Point[];
};

type TextAnnotation = BaseAnnotation & {
  type: "text";
  point: Point;
  text: string;
  fontSize: number;
};

type DragAnnotation = LineAnnotation | RectAnnotation;

export type ChartAnnotation = LineAnnotation | RectAnnotation | PolylineAnnotation | TextAnnotation;

export type ChartAnnotationSnapshot = {
  annotations: ChartAnnotation[];
  width: number;
  height: number;
};

export const ANNOTATION_COLORS: AnnotationColor[] = [
  { name: "red", label: "红色", value: "#d14b3f" },
  { name: "yellow", label: "黄色", value: "#f2c94c" },
  { name: "blue", label: "蓝色", value: "#2f80ed" },
  { name: "green", label: "绿色", value: "#219653" },
  { name: "black", label: "黑色", value: "#111827" }
];
export const DEFAULT_ANNOTATION_COLOR = "#f2c94c";
export const DEFAULT_TEXT_FONT_SIZE = 14;
export const MIN_TEXT_FONT_SIZE = 12;
export const MAX_TEXT_FONT_SIZE = 36;

const STROKE_WIDTH = 2;
const ARROW_HEAD_LENGTH = 12;
const ARROW_HEAD_ANGLE = Math.PI / 7;
const PREVIEW_ALPHA = 0.45;
const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const TEXT_HOVER_PADDING = 4;

export class ChartAnnotationController {
  private readonly context: CanvasRenderingContext2D;
  private readonly annotations: ChartAnnotation[] = [];
  private draft: DragAnnotation | null = null;
  private polylineDraft: Point[] = [];
  private polylinePreview: Point | null = null;
  private textInput: HTMLInputElement | null = null;
  private draggingText: { index: number; offset: Point; moved: boolean } | null = null;
  private hoveredTextIndex: number | null = null;
  private suppressNextTextClick = false;
  private tool: AnnotationTool = "arrow";
  private color = DEFAULT_ANNOTATION_COLOR;
  private fontSize = DEFAULT_TEXT_FONT_SIZE;
  private resizeObserver: ResizeObserver | null = null;
  private readonly boundResize = () => this.resize();
  private readonly boundPointerDown = (event: PointerEvent) => this.handlePointerDown(event);
  private readonly boundPointerMove = (event: PointerEvent) => this.handlePointerMove(event);
  private readonly boundPointerLeave = () => this.handlePointerLeave();
  private readonly boundPointerUp = (event: PointerEvent) => this.handlePointerUp(event);
  private readonly boundClick = (event: MouseEvent) => this.handleClick(event);
  private readonly boundDblClick = (event: MouseEvent) => this.handleDblClick(event);

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly image: HTMLImageElement
  ) {
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("标注图层初始化失败");
    }

    this.context = context;
    this.canvas.addClass("is-active");
    this.canvas.addEventListener("pointerdown", this.boundPointerDown);
    this.canvas.addEventListener("pointermove", this.boundPointerMove);
    this.canvas.addEventListener("pointerleave", this.boundPointerLeave);
    this.canvas.addEventListener("pointerup", this.boundPointerUp);
    this.canvas.addEventListener("pointercancel", this.boundPointerUp);
    this.canvas.addEventListener("click", this.boundClick);
    this.canvas.addEventListener("dblclick", this.boundDblClick);

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(this.boundResize);
      this.resizeObserver.observe(this.image);
    } else {
      window.addEventListener("resize", this.boundResize);
    }

    this.resize();
  }

  setTool(tool: AnnotationTool): void {
    if (this.tool !== tool) {
      this.finishPolyline();
      this.removeTextInput(false);
    }

    this.tool = tool;
  }

  setColor(color: string): void {
    this.color = color;
  }

  setFontSize(fontSize: number): void {
    this.fontSize = clamp(fontSize, MIN_TEXT_FONT_SIZE, MAX_TEXT_FONT_SIZE);
  }

  undo(): void {
    this.removeTextInput(false);
    this.hoveredTextIndex = null;
    if (this.polylineDraft.length > 0) {
      this.polylineDraft.pop();
      if (this.polylineDraft.length === 0) {
        this.polylinePreview = null;
      }
    } else {
      this.annotations.pop();
    }

    this.draft = null;
    this.render();
  }

  clear(): void {
    this.annotations.length = 0;
    this.polylineDraft = [];
    this.polylinePreview = null;
    this.draft = null;
    this.draggingText = null;
    this.hoveredTextIndex = null;
    this.removeTextInput(false);
    this.render();
  }

  finishPolyline(): void {
    if (this.polylineDraft.length >= 2) {
      this.annotations.push({
        type: "polyline",
        points: [...this.polylineDraft],
        color: this.color
      });
    }

    this.polylineDraft = [];
    this.polylinePreview = null;
    this.draft = null;
    this.hoveredTextIndex = null;
    this.render();
  }

  handleEscape(): boolean {
    if (this.textInput) {
      this.removeTextInput(false);
      return true;
    }

    if (this.polylineDraft.length > 0) {
      this.finishPolyline();
      return true;
    }

    return false;
  }

  getSnapshot(): ChartAnnotationSnapshot | null {
    this.commitTextInput();
    this.finishPolyline();
    if (this.annotations.length === 0 || this.canvas.width === 0 || this.canvas.height === 0) {
      return null;
    }

    return {
      annotations: this.annotations.map(cloneAnnotation),
      width: this.canvas.width,
      height: this.canvas.height
    };
  }

  destroy(): void {
    this.commitTextInput();
    this.finishPolyline();
    this.resizeObserver?.disconnect();
    window.removeEventListener("resize", this.boundResize);
    this.canvas.removeEventListener("pointerdown", this.boundPointerDown);
    this.canvas.removeEventListener("pointermove", this.boundPointerMove);
    this.canvas.removeEventListener("pointerleave", this.boundPointerLeave);
    this.canvas.removeEventListener("pointerup", this.boundPointerUp);
    this.canvas.removeEventListener("pointercancel", this.boundPointerUp);
    this.canvas.removeEventListener("click", this.boundClick);
    this.canvas.removeEventListener("dblclick", this.boundDblClick);
    this.removeTextInput(false);
  }

  private handlePointerDown(event: PointerEvent): void {
    if (this.tool === "text") {
      const point = this.getPoint(event);
      const textIndex = this.findTextAnnotationIndex(point);
      if (textIndex === null) {
        return;
      }

      event.preventDefault();
      this.commitTextInput();
      const annotation = this.annotations[textIndex];
      if (annotation.type !== "text") {
        return;
      }

      this.canvas.setPointerCapture(event.pointerId);
      this.draggingText = {
        index: textIndex,
        offset: {
          x: point.x - annotation.point.x,
          y: point.y - annotation.point.y
        },
        moved: false
      };
      return;
    }

    if (this.tool === "polyline") {
      return;
    }

    event.preventDefault();
    this.commitTextInput();
    this.canvas.setPointerCapture(event.pointerId);
    const point = this.getPoint(event);
    this.draft = {
      type: this.tool,
      start: point,
      end: point,
      color: this.color
    };
    this.render();
  }

  private handlePointerMove(event: PointerEvent): void {
    if (this.draggingText) {
      event.preventDefault();
      const annotation = this.annotations[this.draggingText.index];
      if (annotation?.type !== "text") {
        return;
      }

      const point = this.getPoint(event);
      annotation.point = {
        x: clamp(point.x - this.draggingText.offset.x, 0, this.canvas.width),
        y: clamp(point.y - this.draggingText.offset.y, 0, this.canvas.height)
      };
      this.draggingText.moved = true;
      this.hoveredTextIndex = this.draggingText.index;
      this.render();
      return;
    }

    if (this.tool === "text") {
      this.hoveredTextIndex = this.findTextAnnotationIndex(this.getPoint(event));
      this.render();
      return;
    }

    if (this.tool === "polyline" && this.polylineDraft.length > 0) {
      this.polylinePreview = this.getPoint(event);
      this.render();
      return;
    }

    if (!this.draft || this.tool === "polyline") {
      return;
    }

    event.preventDefault();
    this.draft.end = this.getPoint(event);
    this.render();
  }

  private handlePointerLeave(): void {
    if (this.hoveredTextIndex !== null) {
      this.hoveredTextIndex = null;
      this.render();
    }

    if (this.polylinePreview) {
      this.polylinePreview = null;
      this.render();
    }
  }

  private handlePointerUp(event: PointerEvent): void {
    if (this.draggingText) {
      event.preventDefault();
      this.suppressNextTextClick = this.draggingText.moved;
      this.draggingText = null;
      return;
    }

    if (!this.draft || this.tool === "polyline" || this.tool === "text") {
      return;
    }

    event.preventDefault();
    this.draft.end = this.getPoint(event);
    this.annotations.push(this.draft);
    this.draft = null;
    this.render();
  }

  private handleClick(event: MouseEvent): void {
    if (this.tool === "text") {
      event.preventDefault();
      event.stopPropagation();
      if (this.suppressNextTextClick) {
        this.suppressNextTextClick = false;
        return;
      }

      if (event.detail <= 1) {
        const point = this.getPoint(event);
        const textIndex = this.findTextAnnotationIndex(point);
        this.showTextInput(point, textIndex);
      }
      return;
    }

    if (this.tool !== "polyline") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.detail > 1) {
      return;
    }

    this.commitTextInput();
    const point = this.getPoint(event);
    this.polylineDraft.push(point);
    this.polylinePreview = point;
    this.render();
  }

  private handleDblClick(event: MouseEvent): void {
    if (this.tool !== "polyline") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.finishPolyline();
  }

  private showTextInput(point: Point, annotationIndex: number | null = null): void {
    this.commitTextInput();
    const parent = this.canvas.parentElement;
    if (!parent) {
      return;
    }
    const existing = annotationIndex === null ? null : this.annotations[annotationIndex];
    const textAnnotation = existing?.type === "text" ? existing : null;
    const inputPoint = textAnnotation?.point ?? point;
    const inputColor = textAnnotation?.color ?? this.color;
    const inputFontSize = textAnnotation?.fontSize ?? this.fontSize;

    const input = parent.createEl("input", {
      cls: "stock-note-annotation-text-input",
      attr: {
        type: "text",
        placeholder: "输入文字"
      }
    });
    input.style.left = `${inputPoint.x}px`;
    input.style.top = `${inputPoint.y}px`;
    input.style.color = inputColor;
    input.style.fontSize = `${inputFontSize}px`;
    input.dataset.x = String(inputPoint.x);
    input.dataset.y = String(inputPoint.y);
    if (annotationIndex !== null) {
      input.dataset.index = String(annotationIndex);
    }
    if (textAnnotation) {
      input.value = textAnnotation.text;
    }
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        this.commitTextInput();
      } else if (event.key === "Escape") {
        this.removeTextInput(false);
      }
    });
    input.addEventListener("blur", () => this.commitTextInput());
    this.textInput = input;
    input.focus();
    input.select();
  }

  private commitTextInput(): void {
    const input = this.textInput;
    if (!input) {
      return;
    }

    const text = input.value.trim();
    const x = Number.parseFloat(input.dataset.x ?? "");
    const y = Number.parseFloat(input.dataset.y ?? "");
    const color = input.style.color || this.color;
    const fontSize = Number.parseInt(input.style.fontSize, 10) || this.fontSize;
    const index = Number.parseInt(input.dataset.index ?? "", 10);
    this.removeTextInput(false);

    if (!text || !Number.isFinite(x) || !Number.isFinite(y)) {
      return;
    }

    const annotation: TextAnnotation = {
      type: "text",
      point: { x, y },
      text,
      color,
      fontSize
    };
    if (Number.isFinite(index) && this.annotations[index]?.type === "text") {
      this.annotations[index] = annotation;
    } else {
      this.annotations.push(annotation);
    }
    this.render();
  }

  private removeTextInput(commit: boolean): void {
    if (commit) {
      this.commitTextInput();
      return;
    }

    const input = this.textInput;
    this.textInput = null;
    input?.remove();
  }

  private resize(): void {
    const width = Math.max(0, Math.round(this.image.clientWidth));
    const height = Math.max(0, Math.round(this.image.clientHeight));
    if (width === this.canvas.width && height === this.canvas.height) {
      return;
    }

    this.canvas.width = width;
    this.canvas.height = height;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.render();
  }

  private render(): void {
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    renderAnnotations(this.context, this.annotations, 1, 1);
    if (this.tool === "text" && this.hoveredTextIndex !== null) {
      this.renderTextHoverBox(this.hoveredTextIndex);
    }
    if (this.polylineDraft.length > 0) {
      renderAnnotations(this.context, [{ type: "polyline", points: this.polylineDraft, color: this.color }], 1, 1);
      if (this.polylinePreview) {
        renderPreviewLine(this.context, this.polylineDraft[this.polylineDraft.length - 1], this.polylinePreview, this.color);
      }
    }
    if (this.draft) {
      renderAnnotations(this.context, [this.draft], 1, 1);
    }
  }

  private renderTextHoverBox(index: number): void {
    const annotation = this.annotations[index];
    if (annotation?.type !== "text") {
      return;
    }

    const bounds = this.getTextBounds(annotation);
    this.context.save();
    this.context.strokeStyle = "rgba(47, 128, 237, 0.95)";
    this.context.fillStyle = "rgba(47, 128, 237, 0.08)";
    this.context.lineWidth = 1;
    this.context.setLineDash([4, 3]);
    this.context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
    this.context.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
    this.context.restore();
  }

  private getPoint(event: MouseEvent | PointerEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: clamp(event.clientX - rect.left, 0, this.canvas.width),
      y: clamp(event.clientY - rect.top, 0, this.canvas.height)
    };
  }

  private findTextAnnotationIndex(point: Point): number | null {
    for (let index = this.annotations.length - 1; index >= 0; index -= 1) {
      const annotation = this.annotations[index];
      if (annotation.type !== "text") {
        continue;
      }

      const bounds = this.getTextBounds(annotation);
      const withinX = point.x >= bounds.x && point.x <= bounds.x + bounds.width;
      const withinY = point.y >= bounds.y && point.y <= bounds.y + bounds.height;
      if (withinX && withinY) {
        return index;
      }
    }

    return null;
  }

  private getTextBounds(annotation: TextAnnotation): { x: number; y: number; width: number; height: number } {
    this.context.font = `${annotation.fontSize}px ${FONT_FAMILY}`;
    const textWidth = this.context.measureText(annotation.text).width || annotation.text.length * annotation.fontSize * 0.6;
    const textHeight = annotation.fontSize * 1.25;
    return {
      x: annotation.point.x - TEXT_HOVER_PADDING,
      y: annotation.point.y - TEXT_HOVER_PADDING,
      width: textWidth + TEXT_HOVER_PADDING * 2,
      height: textHeight + TEXT_HOVER_PADDING * 2
    };
  }
}

export function renderAnnotations(
  context: CanvasRenderingContext2D,
  annotations: ChartAnnotation[],
  scaleX: number,
  scaleY: number
): void {
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";

  annotations.forEach((annotation) => {
    context.strokeStyle = annotation.color;
    context.fillStyle = annotation.color;
    context.lineWidth = STROKE_WIDTH * Math.max(scaleX, scaleY);

    if (annotation.type === "rect") {
      drawRect(context, annotation, scaleX, scaleY);
      return;
    }

    if (annotation.type === "polyline") {
      drawPolyline(context, annotation.points, scaleX, scaleY);
      return;
    }

    if (annotation.type === "text") {
      drawText(context, annotation, scaleX, scaleY);
      return;
    }

    drawLine(context, annotation.start, annotation.end, scaleX, scaleY);
    if (annotation.type === "arrow") {
      drawArrowHead(context, annotation.start, annotation.end, scaleX, scaleY);
    }
  });

  context.restore();
}

function renderPreviewLine(context: CanvasRenderingContext2D, start: Point, end: Point, color: string): void {
  context.save();
  context.globalAlpha = PREVIEW_ALPHA;
  context.strokeStyle = color;
  context.lineWidth = STROKE_WIDTH;
  context.setLineDash([6, 5]);
  drawLine(context, start, end, 1, 1);
  context.restore();
}

function drawLine(context: CanvasRenderingContext2D, start: Point, end: Point, scaleX: number, scaleY: number): void {
  context.beginPath();
  context.moveTo(start.x * scaleX, start.y * scaleY);
  context.lineTo(end.x * scaleX, end.y * scaleY);
  context.stroke();
}

function drawRect(
  context: CanvasRenderingContext2D,
  annotation: RectAnnotation,
  scaleX: number,
  scaleY: number
): void {
  const x = Math.min(annotation.start.x, annotation.end.x) * scaleX;
  const y = Math.min(annotation.start.y, annotation.end.y) * scaleY;
  const width = Math.abs(annotation.end.x - annotation.start.x) * scaleX;
  const height = Math.abs(annotation.end.y - annotation.start.y) * scaleY;

  context.strokeRect(x, y, width, height);
}

function drawPolyline(context: CanvasRenderingContext2D, points: Point[], scaleX: number, scaleY: number): void {
  if (points.length === 0) {
    return;
  }

  context.beginPath();
  context.moveTo(points[0].x * scaleX, points[0].y * scaleY);
  points.slice(1).forEach((point) => context.lineTo(point.x * scaleX, point.y * scaleY));
  context.stroke();
}

function drawText(
  context: CanvasRenderingContext2D,
  annotation: TextAnnotation,
  scaleX: number,
  scaleY: number
): void {
  context.font = `${annotation.fontSize * Math.max(scaleX, scaleY)}px ${FONT_FAMILY}`;
  context.textBaseline = "top";
  context.fillText(annotation.text, annotation.point.x * scaleX, annotation.point.y * scaleY);
}

function drawArrowHead(
  context: CanvasRenderingContext2D,
  start: Point,
  end: Point,
  scaleX: number,
  scaleY: number
): void {
  const startX = start.x * scaleX;
  const startY = start.y * scaleY;
  const endX = end.x * scaleX;
  const endY = end.y * scaleY;
  const angle = Math.atan2(endY - startY, endX - startX);
  const length = ARROW_HEAD_LENGTH * Math.max(scaleX, scaleY);

  context.beginPath();
  context.moveTo(endX, endY);
  context.lineTo(endX - length * Math.cos(angle - ARROW_HEAD_ANGLE), endY - length * Math.sin(angle - ARROW_HEAD_ANGLE));
  context.moveTo(endX, endY);
  context.lineTo(endX - length * Math.cos(angle + ARROW_HEAD_ANGLE), endY - length * Math.sin(angle + ARROW_HEAD_ANGLE));
  context.stroke();
}

function cloneAnnotation(annotation: ChartAnnotation): ChartAnnotation {
  if (annotation.type === "polyline") {
    return {
      type: "polyline",
      points: annotation.points.map((point) => ({ ...point })),
      color: annotation.color
    };
  }

  if (annotation.type === "text") {
    return {
      type: "text",
      point: { ...annotation.point },
      text: annotation.text,
      color: annotation.color,
      fontSize: annotation.fontSize
    };
  }

  return {
    type: annotation.type,
    start: { ...annotation.start },
    end: { ...annotation.end },
    color: annotation.color
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
