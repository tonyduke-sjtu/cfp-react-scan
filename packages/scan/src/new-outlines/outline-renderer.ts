import { Size } from "~web/widget/types";
import { drawCanvas, updateScroll } from "./canvas";
import { ActiveOutline, OutlineData } from "./types";

export interface OutlineRenderer {
  renderOutlines(outlines: OutlineData[]): void;
  resize(size: Size): void;
  scroll(deltaX: number, deltaY: number): void;
  dispose(): void;
}

export class CanvasOutlineRenderer implements OutlineRenderer {
  private activeOutlines: Map<string, ActiveOutline> = new Map();
  private animationFrameId: ReturnType<typeof requestAnimationFrame> | null =
    null;
  private ctx: CanvasRenderingContext2D | null;
  private isResizeScheduled = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private size: Size,
    private dpr: number,
  ) {
    this.ctx = canvas.getContext("2d", { alpha: true });
    this.setCanvasSize(size);
  }

  scroll(deltaX: number, deltaY: number): void {
    updateScroll(this.activeOutlines, deltaX, deltaY);
  }

  resize(size: Size): void {
    this.size = size;
    if (this.isResizeScheduled) return;
    this.isResizeScheduled = true;
    setTimeout(() => {
      this.setCanvasSize(this.size);
      this.draw();
      this.isResizeScheduled = false;
    });
  }

  renderOutlines(outlines: OutlineData[]): void {
    this.updateOutlines(outlines);
    if (!this.animationFrameId) {
      this.animationFrameId = requestAnimationFrame(this.draw);
    }
  }

  dispose(): void {}

  private setCanvasSize(size: Size) {
    this.canvas.style.width = `{size.width}px`;
    this.canvas.style.height = `{size.height}px`;
    this.canvas.width = size.width * this.dpr;
    this.canvas.height = size.height * this.dpr;
    if (this.ctx) {
      this.ctx.resetTransform();
      this.ctx.scale(this.dpr, this.dpr);
    }
  }

  private updateOutlines(outlines: OutlineData[]) {
    for (const {
      id,
      name,
      count,
      x,
      y,
      width,
      height,
      didCommit,
    } of outlines) {
      const outline: ActiveOutline = {
        id,
        name,
        count,
        x,
        y,
        width,
        height,
        frame: 0,
        targetX: x,
        targetY: y,
        targetWidth: width,
        targetHeight: height,
        didCommit,
      };
      const key = String(outline.id);

      const existingOutline = this.activeOutlines.get(key);
      if (existingOutline) {
        existingOutline.count++;
        existingOutline.frame = 0;
        existingOutline.targetX = x;
        existingOutline.targetY = y;
        existingOutline.targetWidth = width;
        existingOutline.targetHeight = height;
        existingOutline.didCommit = didCommit;
      } else {
        this.activeOutlines.set(key, outline);
      }
    }
  }

  private draw = () => {
    if (!this.ctx || !this.canvas) {
      return;
    }

    const shouldContinue = drawCanvas(
      this.ctx,
      this.canvas,
      this.dpr,
      this.activeOutlines,
    );

    if (shouldContinue) {
      this.animationFrameId = requestAnimationFrame(this.draw);
    } else {
      this.animationFrameId = null;
    }
  };
}

// The worker code will be replaced at build time
const workerCode = "__WORKER_CODE__";
const OUTLINE_ARRAY_SIZE = 7;
const SupportedArrayBuffer =
  typeof SharedArrayBuffer !== "undefined" ? SharedArrayBuffer : ArrayBuffer;

export class WorkerOutlineRenderer implements OutlineRenderer {
  private worker: Worker;
  private isResizeScheduled = false;

  constructor(
    private canvasEl: HTMLCanvasElement,
    private size: Size,
    private dpr: number,
  ) {
    this.worker = new Worker(
      URL.createObjectURL(
        new Blob([workerCode], { type: "application/javascript" }),
      ),
    );

    this.setCanvasSize(size);

    const offscreenCanvas = canvasEl.transferControlToOffscreen();
    this.worker.postMessage(
      {
        type: "init",
        canvas: offscreenCanvas,
        width: size.width * dpr,
        height: size.height * dpr,
        dpr,
      },
      [offscreenCanvas],
    );
  }

  dispose(): void {
    this.worker.terminate();
  }

  private setCanvasSize(size: Size) {
    this.canvasEl.style.width = `${size.width}px`;
    this.canvasEl.style.height = `${size.height}px`;
  }

  renderOutlines(outlines: OutlineData[]): void {
    const arrayBuffer = new SupportedArrayBuffer(
      outlines.length * OUTLINE_ARRAY_SIZE * 4,
    );
    const sharedView = new Float32Array(arrayBuffer);
    const outlineNames = new Array(outlines.length);

    outlines.forEach((outline, i) => {
      const { id, name, count, x, y, width, height, didCommit } = outline;
      const scaledIndex = i * OUTLINE_ARRAY_SIZE;
      sharedView[scaledIndex] = id;
      sharedView[scaledIndex + 1] = count;
      sharedView[scaledIndex + 2] = x;
      sharedView[scaledIndex + 3] = y;
      sharedView[scaledIndex + 4] = width;
      sharedView[scaledIndex + 5] = height;
      sharedView[scaledIndex + 6] = didCommit;
      outlineNames[i] = name;
    });

    this.worker.postMessage({
      type: "draw-outlines",
      data: arrayBuffer,
      names: outlineNames,
    });
  }

  resize(size: Size): void {
    this.size = size;
    if (this.isResizeScheduled) return;
    this.isResizeScheduled = true;
    setTimeout(() => {
      this.setCanvasSize(this.size);
      this.worker.postMessage({
        type: "resize",
        width: this.size.width,
        height: this.size.height,
        dpr: this.dpr,
      });
      this.isResizeScheduled = false;
    });
  }

  scroll(deltaX: number, deltaY: number): void {
    this.worker.postMessage({
      type: "scroll",
      deltaX,
      deltaY,
    });
  }
}
