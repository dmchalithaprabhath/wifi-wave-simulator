// @ts-check

import { buildPalette } from "./palette.js";

/** @typedef {import("./types.js").SimulationState} SimulationState */
/** @typedef {import("./types.js").SourceObject} SourceObject */

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 8;
const SOURCE_MARKER_RADIUS = 6; // Base radius in pixels (constant screen-space)
const SOURCE_MARKER_HOVER_RADIUS = 8; // Hover/selected radius
const SOURCE_MARKER_HALO_WIDTH = 2; // Halo outline width
const SOURCE_PICK_RADIUS = 12; // Larger pick radius for easier interaction
const RESIZE_HANDLE_SIZE = 8; // pixels
const RESIZE_HANDLE_PICK_RADIUS = 12; // pixels
const SNAP_DISTANCE = 0.3; // world units (increased for better visibility)
const SNAP_DISTANCE_PX = 15; // screen pixels for visual feedback

export class Renderer2D {
  /**
 * @param {HTMLCanvasElement} canvas
 * @param {{
 *  getState: () => SimulationState,
 *  updateState: (updater: (draft: SimulationState) => SimulationState) => void
 * }} store
   * @param {{
   *  onDrawComplete?: (draft: { shapeKind: ("rectangle" | "circle"), center: { x: number, y: number }, size: { width: number, height: number } | null, radius: number | null }) => void
   * }} [options]
 */
  constructor(canvas, store, options = {}) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas 2D context not available.");
    }
    this.ctx = ctx;
    this.store = store;
    this.state = store.getState();
    this.onDrawComplete = options.onDrawComplete || null;

    this.view = {
      center: { x: 0, y: 0 },
      zoom: 1
    };
    this.hasView = false;

    this.offscreen = document.createElement("canvas");
    const offCtx = this.offscreen.getContext("2d");
    if (!offCtx) {
      throw new Error("Offscreen 2D context not available.");
    }
    this.offCtx = offCtx;
    this.imageData = null;
    this.palette = buildPalette();

    this.drag = null;
    this.draw = null;
    this.modalDraft = null;
    this.needsResize = true;
    this.lastRect = null;
    /** @type {string | null} */
    this.hoveredSourceId = null; // Track hovered source for interaction states
    /** @type {{ shapeId: string, handle: { type: string, label: string } } | null} */
    this.hoveredHandle = null; // Track hovered resize handle

    window.addEventListener("resize", () => {
      this.needsResize = true;
    });

    canvas.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    canvas.addEventListener("pointermove", (event) => this.onPointerMove(event));
    canvas.addEventListener("pointerup", (event) => this.onPointerUp(event));
    canvas.addEventListener("pointerleave", (event) => this.onPointerUp(event));
    canvas.addEventListener("wheel", (event) => this.onWheel(event), { passive: false });
  }

  /**
   * @param {SimulationState} state
   */
  setState(state) {
    this.state = state;
  }

  /**
   * @param {import("./solver.js").WaveSolver2D} solver
   */
  render(solver) {
    if (!this.state || this.state.visualization.mode !== "2d") {
      this.clearCanvas();
      return;
    }

    this.ensureView();
    this.resizeIfNeeded();
    this.ensureOffscreen(solver);

    const output =
      this.state.visualization.output === "averaged"
        ? solver.getAveragedMagnitude()
        : solver.getInstantaneousMagnitude();

    const maxValue = this.fillHeatmap(output);
    this.drawHeatmap(maxValue);
    this.drawShapes();
    this.drawSources();
    this.drawDraft();
  }

  clearCanvas() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  ensureView() {
    if (this.hasView) {
      return;
    }
    const domain = this.state.domain;
    this.view.center = {
      x: domain.origin.x + domain.worldSize.x * 0.5,
      y: domain.origin.y + domain.worldSize.y * 0.5
    };
    this.view.zoom = 1;
    this.hasView = true;
  }

  /**
   * @param {import("./solver.js").WaveSolver2D} solver
   */
  ensureOffscreen(solver) {
    if (this.offscreen.width === solver.nx && this.offscreen.height === solver.ny) {
      return;
    }

    this.offscreen.width = solver.nx;
    this.offscreen.height = solver.ny;
    this.imageData = this.offCtx.createImageData(solver.nx, solver.ny);
  }

  resizeIfNeeded() {
    if (!this.needsResize) {
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.needsResize = false;
  }

  /**
   * @param {Float32Array} output
   * @returns {number}
   */
  fillHeatmap(output) {
    if (!this.imageData) {
      return 1;
    }

    const data = this.imageData.data;
    let maxValue = 0;
    for (let i = 0; i < output.length; i += 1) {
      if (output[i] > maxValue) {
        maxValue = output[i];
      }
    }

    const scale = maxValue > 0 ? 1 / maxValue : 1;

    for (let i = 0; i < output.length; i += 1) {
      const t = Math.min(1, Math.pow(output[i] * scale, 0.6));
      const paletteIndex = Math.min(255, Math.floor(t * 255));
      const pOffset = paletteIndex * 4;
      const dOffset = i * 4;
      data[dOffset] = this.palette[pOffset];
      data[dOffset + 1] = this.palette[pOffset + 1];
      data[dOffset + 2] = this.palette[pOffset + 2];
      data[dOffset + 3] = 255;
    }

    this.offCtx.putImageData(this.imageData, 0, 0);
    return maxValue;
  }

  /**
   * @param {number} maxValue
   */
  drawHeatmap(maxValue) {
    const ctx = this.ctx;
    const { scale, offsetX, offsetY } = this.getTransform();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);

    const { origin, worldSize } = this.state.domain;
    ctx.drawImage(
      this.offscreen,
      origin.x,
      origin.y,
      worldSize.x,
      worldSize.y
    );

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(`Max: ${maxValue.toFixed(3)}`, this.canvas.width - 12, 20);
  }

  drawSources() {
    const ctx = this.ctx;
    const sources = this.state.sources;
    const selection = this.state.editor.selection;

    if (!this.state.visualization.overlays2d.showSources) {
      return;
    }

    for (const source of sources) {
      if (!source.active) {
        continue;
      }
      const isSelected =
        selection && selection.type === "source" && selection.id === source.id;
      const isHovered = this.hoveredSourceId === source.id;
      const isDragging = this.drag && this.drag.type === "source" && this.drag.id === source.id;
      
      // Determine interaction state
      const isInteractive = isSelected || isHovered || isDragging;
      const markerRadius = isInteractive ? SOURCE_MARKER_HOVER_RADIUS : SOURCE_MARKER_RADIUS;
      
      const screen = this.worldToScreen(source.position);
      
      // Draw halo outline for high contrast
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, markerRadius + SOURCE_MARKER_HALO_WIDTH, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 255, 255, 0.9)"; // White halo for contrast
      ctx.fill();
      
      // Draw outer ring for selected/hovered/dragging states
      if (isInteractive) {
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, markerRadius + 4, 0, Math.PI * 2);
        ctx.strokeStyle = isDragging ? "rgba(30, 64, 175, 0.8)" : "rgba(37, 99, 235, 0.6)";
        ctx.lineWidth = isDragging ? 2.5 : 1.5;
      ctx.stroke();
      }
      
      // Draw main marker circle
        ctx.beginPath();
      ctx.arc(screen.x, screen.y, markerRadius, 0, Math.PI * 2);
      ctx.fillStyle = isDragging 
        ? "rgba(30, 64, 175, 0.95)" 
        : isSelected 
        ? "rgba(37, 99, 235, 0.9)" 
        : "rgba(59, 130, 246, 0.85)"; // Lighter blue for default
      ctx.fill();
      
      // Inner stroke for definition
      ctx.strokeStyle = isDragging ? "#1e3a8a" : isSelected ? "#2563eb" : "#3b82f6";
      ctx.lineWidth = 1.5;
        ctx.stroke();
      
      // Show coordinates tooltip when dragging
      if (isDragging) {
        const coords = `(${source.position.x.toFixed(2)}, ${source.position.y.toFixed(2)})`;
        ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
        ctx.font = "11px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(coords, screen.x, screen.y + markerRadius + 8);
      }
    }
  }

  drawShapes() {
    const shapes = this.state.shapes;
    if (!this.state.visualization.overlays2d.showShapes || !shapes.length) {
      return;
    }

    const ctx = this.ctx;
    const selection = this.state.editor.selection;
    const { scale, offsetX, offsetY } = this.getTransform();
    const fillColor = "rgba(140, 140, 140, 0.4)";
    const strokeColor = "rgba(70, 70, 70, 0.85)";
    const dpr = window.devicePixelRatio || 1;
    const baseWidth = 1.5 * dpr;
    const selectedOuterWidth = 4 * dpr;
    const selectedInnerWidth = 2.5 * dpr;
    const selectedOuterColor = "rgba(0, 0, 0, 0.55)";
    const selectedInnerColor = "rgba(180, 180, 180, 0.9)";

    ctx.save();
    for (const shape of shapes) {
      const isSelected =
        selection && selection.type === "shape" && selection.id === shape.id;
      ctx.fillStyle = fillColor;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = baseWidth;

      if (shape.kind === "rectangle" && shape.size) {
        const width = shape.size.width * scale;
        const height = shape.size.height * scale;
        const center = {
          x: shape.center.x * scale + offsetX,
          y: shape.center.y * scale + offsetY
        };
        const angle = ((shape.angles?.z ?? 0) * Math.PI) / 180;
        ctx.save();
        ctx.translate(center.x, center.y);
        ctx.rotate(angle);
        ctx.fillRect(-width * 0.5, -height * 0.5, width, height);
        ctx.strokeRect(-width * 0.5, -height * 0.5, width, height);
        if (isSelected) {
          strokePreviewOutline(
            ctx,
            () => {
              ctx.beginPath();
              ctx.rect(-width * 0.5, -height * 0.5, width, height);
            },
            {
              outerWidth: selectedOuterWidth,
              innerWidth: selectedInnerWidth,
              outerColor: selectedOuterColor,
              innerColor: selectedInnerColor,
              dash: null
            }
          );
        }
        ctx.restore();
        
        // Draw resize handles for selected rectangles
        if (isSelected) {
          const handles = this.getResizeHandles(shape);
          const isDragging = this.drag && this.drag.type === "resize" && this.drag.id === shape.id;
          const hoveredHandle = this.hoveredHandle;
          
          for (const handle of handles) {
            const isHovered = hoveredHandle && hoveredHandle.shapeId === shape.id && 
                             hoveredHandle.handle.label === handle.label;
            ctx.fillStyle = isHovered || isDragging ? "rgba(59, 130, 246, 0.9)" : "rgba(37, 99, 235, 0.85)";
            ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
            ctx.lineWidth = 1.5;
            
            ctx.beginPath();
            ctx.arc(handle.x, handle.y, RESIZE_HANDLE_SIZE * 0.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
        }
      }

      if (shape.kind === "circle" && shape.radius != null) {
        const center = {
          x: shape.center.x * scale + offsetX,
          y: shape.center.y * scale + offsetY
        };
        ctx.beginPath();
        const radius = shape.radius * scale;
        ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        if (isSelected) {
          strokePreviewOutline(
            ctx,
            () => {
              ctx.beginPath();
              ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
            },
            {
              outerWidth: selectedOuterWidth,
              innerWidth: selectedInnerWidth,
              outerColor: selectedOuterColor,
              innerColor: selectedInnerColor,
              dash: null
            }
          );
          
          // Draw resize handles for selected circles
          const handles = this.getResizeHandles(shape);
          const isDragging = this.drag && this.drag.type === "resize" && this.drag.id === shape.id;
          const hoveredHandle = this.hoveredHandle;
          
          for (const handle of handles) {
            const isHovered = hoveredHandle && hoveredHandle.shapeId === shape.id && 
                             hoveredHandle.handle.label === handle.label;
            ctx.fillStyle = isHovered || isDragging ? "rgba(59, 130, 246, 0.9)" : "rgba(37, 99, 235, 0.85)";
            ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
            ctx.lineWidth = 1.5;
            
            ctx.beginPath();
            ctx.arc(handle.x, handle.y, RESIZE_HANDLE_SIZE * 0.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
        }
      }
    }
    ctx.restore();
  }
  drawDraft() {
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const previewOuter = 6 * dpr;
    const previewInner = 3 * dpr;
    const previewOuterColor = "rgba(0, 0, 0, 0.6)";
    const previewInnerColor = "rgba(34, 211, 238, 1)";
    const dash = [8 * dpr, 6 * dpr];

    if (this.draw) {
      const { start, current, tool } = this.draw;
      const startScreen = this.worldToScreen(start);
      const currentScreen = this.worldToScreen(current);

      ctx.save();
      if (tool === "draw-rectangle") {
        const x = Math.min(startScreen.x, currentScreen.x);
        const y = Math.min(startScreen.y, currentScreen.y);
        const w = Math.abs(currentScreen.x - startScreen.x);
        const h = Math.abs(currentScreen.y - startScreen.y);
        strokePreviewOutline(
          ctx,
          () => {
            ctx.beginPath();
            ctx.rect(x, y, w, h);
          },
          {
            outerWidth: previewOuter,
            innerWidth: previewInner,
            outerColor: previewOuterColor,
            innerColor: previewInnerColor,
            dash
          }
        );
      } else if (tool === "draw-circle") {
        const rect = getBounds(start, current);
        const radius = Math.min(rect.width, rect.height) * 0.5;
        const center = { x: rect.minX + rect.width * 0.5, y: rect.minY + rect.height * 0.5 };
        const centerScreen = this.worldToScreen(center);
        const radiusPx = radius * this.getTransform().scale;
        strokePreviewOutline(
          ctx,
          () => {
            ctx.beginPath();
            ctx.arc(centerScreen.x, centerScreen.y, radiusPx, 0, Math.PI * 2);
          },
          {
            outerWidth: previewOuter,
            innerWidth: previewInner,
            outerColor: previewOuterColor,
            innerColor: previewInnerColor,
            dash
          }
        );
      }
      ctx.restore();
      return;
    }

    if (!this.modalDraft) {
      return;
    }

    const { shapeKind, center, size, radius, angles } = this.modalDraft;
    const { scale, offsetX, offsetY } = this.getTransform();
    const centerScreen = {
      x: center.x * scale + offsetX,
      y: center.y * scale + offsetY
    };

    ctx.save();
    if (shapeKind === "rectangle" && size) {
      const widthPx = size.width * scale;
      const heightPx = size.height * scale;
      const angle = ((angles?.z ?? 0) * Math.PI) / 180;
      ctx.translate(centerScreen.x, centerScreen.y);
      ctx.rotate(angle);
      strokePreviewOutline(
        ctx,
        () => {
          ctx.beginPath();
          ctx.rect(-widthPx * 0.5, -heightPx * 0.5, widthPx, heightPx);
        },
        {
          outerWidth: previewOuter,
          innerWidth: previewInner,
          outerColor: previewOuterColor,
          innerColor: previewInnerColor,
          dash
        }
      );
    } else if (shapeKind === "circle" && radius != null) {
      const radiusPx = radius * scale;
      strokePreviewOutline(
        ctx,
        () => {
          ctx.beginPath();
          ctx.arc(centerScreen.x, centerScreen.y, radiusPx, 0, Math.PI * 2);
        },
        {
          outerWidth: previewOuter,
          innerWidth: previewInner,
          outerColor: previewOuterColor,
          innerColor: previewInnerColor,
          dash
        }
      );
    }
    ctx.restore();
  }

  /**
   * @param {PointerEvent} event
   */
  onPointerDown(event) {
    if (this.state.visualization.mode !== "2d") {
      return;
    }
    if (event.button !== 0 && event.button !== 1 && event.button !== 2) {
      return;
    }

    const pos = this.getPointerPosition(event);
    const activeTool = this.state.editor.activeTool;
    if (activeTool === "draw-rectangle" || activeTool === "draw-circle") {
      if (event.button !== 0) {
        return;
      }
      const world = this.screenToWorld(pos.x, pos.y);
      this.draw = {
        tool: activeTool,
        start: world,
        current: world
      };
      this.canvas.setPointerCapture(event.pointerId);
      return;
    }

    const sourceId = this.pickSource(pos.x, pos.y);
    const handlePick = this.pickResizeHandle(pos.x, pos.y);
    const shapeId = this.pickShape(pos.x, pos.y);

    // Handle resize handle clicks
    if (handlePick && activeTool === "select" && event.button === 0) {
      const shape = this.state.shapes.find(s => s.id === handlePick.shapeId);
      if (!shape) return;
      
      // Get the actual handle position in world coordinates
      const handles = this.getResizeHandles(shape);
      const handleInfo = handles.find(h => h.label === handlePick.handle.label);
      
      this.setSelection("shape", handlePick.shapeId);
      this.drag = {
        type: "resize",
        id: handlePick.shapeId,
        handle: handlePick.handle,
        start: pos,
        startWorld: this.screenToWorld(pos.x, pos.y),
        initialHandleWorld: handleInfo ? { x: handleInfo.worldX, y: handleInfo.worldY } : null,
        // Store initial shape state for edge resize calculations
        initialShape: shape ? {
          center: { ...shape.center },
          angleZ: shape.angles?.z ?? 0,
          size: shape.kind === "rectangle" && shape.size ? { ...shape.size } : null,
          radius: shape.kind === "circle" ? shape.radius : null
        } : null
      };
      this.canvas.setPointerCapture(event.pointerId);
      return;
    }

    if (activeTool === "place-source" && event.button === 0) {
      const world = this.screenToWorld(pos.x, pos.y);
      const defaults = this.state.simulation.sourceDefaults;
      const newName = `Source ${this.state.sources.length + 1}`;
      const newSource = createSource(world, defaults, newName);
      this.store.updateState((draft) => {
        draft.sources.push(newSource);
        draft.editor.selection = { type: "source", id: newSource.id };
        return draft;
      });
      this.drag = {
        type: "source",
        id: newSource.id
      };
      this.canvas.setPointerCapture(event.pointerId);
      return;
    }

    // Handle shape selection and dragging
    if (shapeId && activeTool === "select" && event.button === 0) {
      this.setSelection("shape", shapeId);
      this.drag = {
        type: "shape",
        id: shapeId,
        start: pos
      };
      this.canvas.setPointerCapture(event.pointerId);
      return;
    }

    // Handle source selection and dragging
    if (sourceId && (activeTool === "select" || activeTool === "place-source")) {
      this.setSelection("source", sourceId);
      this.hoveredSourceId = sourceId; // Set hover when starting drag
      this.drag = {
        type: "source",
        id: sourceId
      };
      this.canvas.setPointerCapture(event.pointerId);
      return;
    }

    if (activeTool === "select") {
      this.setSelection(null, null);
    }

    if (event.button === 0 || event.button === 1 || event.button === 2) {
      this.drag = {
        type: "pan",
        start: { x: pos.x, y: pos.y },
        center: { ...this.view.center }
      };
      this.canvas.setPointerCapture(event.pointerId);
    }
  }

  /**
   * @param {PointerEvent} event
   */
  onPointerMove(event) {
    if (this.state.visualization.mode !== "2d") {
      return;
    }

    const pos = this.getPointerPosition(event);

    if (this.draw) {
      this.draw.current = this.screenToWorld(pos.x, pos.y);
      return;
    }

    // Update hover state for sources and handles (redraw will happen in next animation frame)
    if (!this.drag) {
      const hoveredId = this.pickSource(pos.x, pos.y);
      const handlePick = this.pickResizeHandle(pos.x, pos.y);
      
      if (hoveredId !== this.hoveredSourceId || handlePick !== this.hoveredHandle) {
        this.hoveredSourceId = hoveredId;
        this.hoveredHandle = handlePick;
        
        // Update cursor based on hover state
        if (handlePick) {
          const handle = handlePick.handle;
          let cursor = "default";
          if (handle.type === "corner") {
            // Diagonal resize cursors for corners
            if (handle.label === "nw" || handle.label === "se") {
              cursor = "nwse-resize";
            } else {
              cursor = "nesw-resize";
            }
          } else if (handle.type === "edge") {
            // Horizontal/vertical resize cursors for edges
            if (handle.label === "n" || handle.label === "s") {
              cursor = "ns-resize";
            } else {
              cursor = "ew-resize";
            }
          } else if (handle.type === "radius") {
            // For circle radius handles, use appropriate cursor based on direction
            if (handle.label === "n" || handle.label === "s") {
              cursor = "ns-resize";
            } else {
              cursor = "ew-resize";
            }
          }
          this.canvas.style.cursor = cursor;
        } else if (hoveredId) {
          this.canvas.style.cursor = "move";
        } else {
          this.canvas.style.cursor = "default";
        }
        // Don't manually render - animation loop will handle it
      }
      return;
    }

    if (this.drag.type === "source" && this.drag.id) {
      const world = this.screenToWorld(pos.x, pos.y);
      this.updateSourcePosition(this.drag.id, world);
      return;
    }

    if (this.drag.type === "shape" && this.drag.id) {
      const world = this.screenToWorld(pos.x, pos.y);
      this.updateShapePosition(this.drag.id, world);
      return;
    }

    if (this.drag.type === "resize" && this.drag.id && this.drag.handle) {
      const world = this.screenToWorld(pos.x, pos.y);
      const snapped = this.applySnapping(world.x, world.y, this.drag.id);
      this.updateShapeResize(this.drag.id, this.drag.handle, snapped);
      return;
    }

    if (this.drag.type === "pan" && this.drag.start && this.drag.center) {
      const deltaX = pos.x - this.drag.start.x;
      const deltaY = pos.y - this.drag.start.y;
      const scale = this.getTransform().scale;

      this.view.center = {
        x: this.drag.center.x - deltaX / scale,
        y: this.drag.center.y - deltaY / scale
      };
    }
  }

  /**
   * @param {PointerEvent} event
   */
  onPointerUp(event) {
    if (this.draw) {
      const drawState = this.draw;
      this.draw = null;
      this.finalizeDraw(drawState);
    }

    if (this.drag) {
      this.drag = null;
    }
    
    // Clear hover state when pointer is released (redraw will happen in next animation frame)
    if (this.hoveredSourceId !== null) {
      this.hoveredSourceId = null;
    }

    try {
      this.canvas.releasePointerCapture(event.pointerId);
    } catch (error) {
      // Ignore pointer capture errors.
    }
  }

  /**
   * @param {WheelEvent} event
   */
  onWheel(event) {
    if (this.state.visualization.mode !== "2d") {
      return;
    }
    event.preventDefault();

    const pos = this.getPointerPosition(event);
    const worldBefore = this.screenToWorld(pos.x, pos.y);

    const zoomFactor = Math.exp(-event.deltaY * 0.001);
    this.view.zoom = clamp(this.view.zoom * zoomFactor, MIN_ZOOM, MAX_ZOOM);

    const worldAfter = this.screenToWorld(pos.x, pos.y);
    this.view.center = {
      x: this.view.center.x + (worldBefore.x - worldAfter.x),
      y: this.view.center.y + (worldBefore.y - worldAfter.y)
    };
  }

  /**
   * @param {{ tool: string, start: { x: number, y: number }, current: { x: number, y: number } }} drawState
   */
  finalizeDraw(drawState) {
    if (!this.onDrawComplete) {
      return;
    }
    const rect = getBounds(drawState.start, drawState.current);
    if (drawState.tool === "draw-rectangle") {
      this.onDrawComplete({
        shapeKind: "rectangle",
        center: { x: rect.minX + rect.width * 0.5, y: rect.minY + rect.height * 0.5 },
        size: { width: rect.width, height: rect.height },
        radius: null
      });
      return;
    }

    const radius = Math.min(rect.width, rect.height) * 0.5;
    this.onDrawComplete({
      shapeKind: "circle",
      center: { x: rect.minX + rect.width * 0.5, y: rect.minY + rect.height * 0.5 },
      size: null,
      radius
    });
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {string | null}
   */
  pickSource(x, y) {
    for (const source of this.state.sources) {
      if (!source.active) {
        continue;
      }
      const screen = this.worldToScreen(source.position);
      const dx = screen.x - x;
      const dy = screen.y - y;
      // Use larger pick radius for easier interaction
      if (dx * dx + dy * dy <= SOURCE_PICK_RADIUS * SOURCE_PICK_RADIUS) {
        return source.id;
      }
    }
    return null;
  }

  /**
   * @param {number} x Screen X coordinate
   * @param {number} y Screen Y coordinate
   * @returns {string | null} Shape ID if point is inside a shape, null otherwise
   */
  pickShape(x, y) {
    // First check if clicking on a resize handle (don't select shape if clicking handle)
    const handlePick = this.pickResizeHandle(x, y);
    if (handlePick) {
      return null;
    }
    
    const world = this.screenToWorld(x, y);
    const shapes = this.state.shapes;
    
    // Check shapes in reverse order (last drawn = topmost)
    for (let i = shapes.length - 1; i >= 0; i -= 1) {
      const shape = shapes[i];
      
      if (shape.kind === "rectangle" && shape.size) {
        const center = shape.center;
        const width = shape.size.width;
        const height = shape.size.height;
        const angle = ((shape.angles?.z ?? 0) * Math.PI) / 180;
        
        // Transform point to shape-local coordinates (accounting for rotation)
        const dx = world.x - center.x;
        const dy = world.y - center.y;
        const cos = Math.cos(-angle);
        const sin = Math.sin(-angle);
        const localX = dx * cos - dy * sin;
        const localY = dx * sin + dy * cos;
        
        // Check if point is inside rectangle bounds
        const halfWidth = width * 0.5;
        const halfHeight = height * 0.5;
        if (Math.abs(localX) <= halfWidth && Math.abs(localY) <= halfHeight) {
          return shape.id;
        }
      } else if (shape.kind === "circle" && shape.radius != null) {
        const center = shape.center;
        const radius = shape.radius;
        const dx = world.x - center.x;
        const dy = world.y - center.y;
        const distSq = dx * dx + dy * dy;
        if (distSq <= radius * radius) {
          return shape.id;
        }
      }
    }
    
    return null;
  }

  /**
   * @param {import("./types.js").ShapeObject} shape
   * @returns {Array<{ type: string, label: string, x: number, y: number, worldX: number, worldY: number }>}
   */
  getResizeHandles(shape) {
    const handles = [];
    
    if (shape.kind === "rectangle" && shape.size) {
      const width = shape.size.width;
      const height = shape.size.height;
      const center = shape.center;
      const angle = ((shape.angles?.z ?? 0) * Math.PI) / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const halfWidth = width * 0.5;
      const halfHeight = height * 0.5;
      
      // Corner positions in local coordinates
      const corners = [
        { x: -halfWidth, y: -halfHeight, label: "nw" },
        { x: halfWidth, y: -halfHeight, label: "ne" },
        { x: halfWidth, y: halfHeight, label: "se" },
        { x: -halfWidth, y: halfHeight, label: "sw" }
      ];
      
      // Edge midpoints in local coordinates
      const edges = [
        { x: 0, y: -halfHeight, label: "n" },
        { x: halfWidth, y: 0, label: "e" },
        { x: 0, y: halfHeight, label: "s" },
        { x: -halfWidth, y: 0, label: "w" }
      ];
      
      // Transform to world coordinates
      for (const corner of corners) {
        const worldX = center.x + corner.x * cos - corner.y * sin;
        const worldY = center.y + corner.x * sin + corner.y * cos;
        const screen = this.worldToScreen({ x: worldX, y: worldY });
        handles.push({
          type: "corner",
          label: corner.label,
          x: screen.x,
          y: screen.y,
          worldX,
          worldY
        });
      }
      
      for (const edge of edges) {
        const worldX = center.x + edge.x * cos - edge.y * sin;
        const worldY = center.y + edge.x * sin + edge.y * cos;
        const screen = this.worldToScreen({ x: worldX, y: worldY });
        handles.push({
          type: "edge",
          label: edge.label,
          x: screen.x,
          y: screen.y,
          worldX,
          worldY
        });
      }
    } else if (shape.kind === "circle" && shape.radius != null) {
      const center = shape.center;
      const radius = shape.radius;
      const directions = [
        { dx: 0, dy: -1, label: "n" },
        { dx: 1, dy: 0, label: "e" },
        { dx: 0, dy: 1, label: "s" },
        { dx: -1, dy: 0, label: "w" }
      ];
      
      for (const dir of directions) {
        const worldX = center.x + dir.dx * radius;
        const worldY = center.y + dir.dy * radius;
        const screen = this.worldToScreen({ x: worldX, y: worldY });
        handles.push({
          type: "radius",
          label: dir.label,
          x: screen.x,
          y: screen.y,
          worldX,
          worldY
        });
      }
    }
    
    return handles;
  }

  /**
   * @param {number} x Screen X
   * @param {number} y Screen Y
   * @returns {{ shapeId: string, handle: { type: string, label: string } } | null}
   */
  pickResizeHandle(x, y) {
    const selection = this.state.editor.selection;
    if (!selection || selection.type !== "shape") {
      return null;
    }
    
    const shape = this.state.shapes.find(s => s.id === selection.id);
    if (!shape) {
      return null;
    }
    
    const handles = this.getResizeHandles(shape);
    for (const handle of handles) {
      const dx = x - handle.x;
      const dy = y - handle.y;
      if (dx * dx + dy * dy <= RESIZE_HANDLE_PICK_RADIUS * RESIZE_HANDLE_PICK_RADIUS) {
        return { shapeId: shape.id, handle: { type: handle.type, label: handle.label } };
      }
    }
    
    return null;
  }

  /**
   * @param {string} excludeShapeId
   * @returns {Array<{ type: string, x: number, y: number, edge?: { p1: { x: number, y: number }, p2: { x: number, y: number } } }>}
   */
  getSnapTargets(excludeShapeId) {
    const targets = [];
    
    for (const shape of this.state.shapes) {
      if (shape.id === excludeShapeId) continue;
      
      if (shape.kind === "rectangle" && shape.size) {
        const center = shape.center;
        const width = shape.size.width;
        const height = shape.size.height;
        const angle = ((shape.angles?.z ?? 0) * Math.PI) / 180;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const halfWidth = width * 0.5;
        const halfHeight = height * 0.5;
        
        // Center
        targets.push({ type: "center", x: center.x, y: center.y });
        
        // Corners (in local coordinates)
        const corners = [
          { x: -halfWidth, y: -halfHeight },
          { x: halfWidth, y: -halfHeight },
          { x: halfWidth, y: halfHeight },
          { x: -halfWidth, y: halfHeight }
        ];
        
        // Transform corners to world coordinates
        const worldCorners = corners.map(corner => ({
          x: center.x + corner.x * cos - corner.y * sin,
          y: center.y + corner.x * sin + corner.y * cos
        }));
        
        // Add corners as point targets
        for (const corner of worldCorners) {
          targets.push({ type: "corner", x: corner.x, y: corner.y });
        }
        
        // Add edges as line segments (for line snapping)
        // Edge 1: top (nw to ne)
        targets.push({
          type: "edge",
          x: worldCorners[0].x,
          y: worldCorners[0].y,
          edge: { p1: worldCorners[0], p2: worldCorners[1] }
        });
        // Edge 2: right (ne to se)
        targets.push({
          type: "edge",
          x: worldCorners[1].x,
          y: worldCorners[1].y,
          edge: { p1: worldCorners[1], p2: worldCorners[2] }
        });
        // Edge 3: bottom (se to sw)
        targets.push({
          type: "edge",
          x: worldCorners[2].x,
          y: worldCorners[2].y,
          edge: { p1: worldCorners[2], p2: worldCorners[3] }
        });
        // Edge 4: left (sw to nw)
        targets.push({
          type: "edge",
          x: worldCorners[3].x,
          y: worldCorners[3].y,
          edge: { p1: worldCorners[3], p2: worldCorners[0] }
        });
      } else if (shape.kind === "circle" && shape.radius != null) {
        const cx = shape.center.x;
        const cy = shape.center.y;
        const r = shape.radius;
        targets.push({ type: "center", x: cx, y: cy });
        // Cardinal points (useful for snapping to circle boundary)
        targets.push({ type: "circle-point", x: cx, y: cy - r });
        targets.push({ type: "circle-point", x: cx + r, y: cy });
        targets.push({ type: "circle-point", x: cx, y: cy + r });
        targets.push({ type: "circle-point", x: cx - r, y: cy });
      }
    }
    
    // Also add snap targets from sources
    for (const source of this.state.sources) {
      if (source.active) {
        targets.push({ type: "source", x: source.position.x, y: source.position.y });
      }
    }
    
    return targets;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {string} excludeShapeId
   * @returns {{ x: number, y: number, snapped: boolean }}
   */
  applySnapping(x, y, excludeShapeId) {
    if (!this.state.editor.snapToShapes) {
      return { x, y, snapped: false };
    }
    
    const targets = this.getSnapTargets(excludeShapeId);
    const { scale } = this.getTransform();
    const snapDistanceWorld = SNAP_DISTANCE_PX / scale; // Convert screen pixels to world units
    /** @type {{ dist: number, x: number, y: number } | null} */
    let bestPoint = null;
    /** @type {{ dist: number, x: number, y: number } | null} */
    let bestEdge = null;
    
    for (const target of targets) {
      if (target.edge) {
        // Snap to nearest point on edge line segment
        const { p1, p2 } = target.edge;
        const closestPoint = this.closestPointOnLineSegment(x, y, p1.x, p1.y, p2.x, p2.y);
        const dx = closestPoint.x - x;
        const dy = closestPoint.y - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < snapDistanceWorld && (!bestEdge || dist < bestEdge.dist)) {
          bestEdge = { dist, x: closestPoint.x, y: closestPoint.y };
        }
      } else {
        // Point snap (center, corner, source, circle-point)
        const dx = target.x - x;
        const dy = target.y - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < snapDistanceWorld && (!bestPoint || dist < bestPoint.dist)) {
          bestPoint = { dist, x: target.x, y: target.y };
        }
      }
    }
    
    // Prefer snapping to points (corners/centers) over edges when both are viable.
    if (bestPoint) {
      return { x: bestPoint.x, y: bestPoint.y, snapped: true };
    }
    if (bestEdge) {
      return { x: bestEdge.x, y: bestEdge.y, snapped: true };
    }
    return { x, y, snapped: false };
  }

  /**
   * @param {import("./types.js").ShapeObject} shape
   * @param {{ x: number, y: number }} desiredCenter
   * @returns {Array<{ x: number, y: number }>}
   */
  getShapeSnapFeatures(shape, desiredCenter) {
    const features = [];
    // Always include center
    features.push({ x: desiredCenter.x, y: desiredCenter.y });

    if (shape.kind === "rectangle" && shape.size) {
      const width = shape.size.width;
      const height = shape.size.height;
      const angle = ((shape.angles?.z ?? 0) * Math.PI) / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const halfW = width * 0.5;
      const halfH = height * 0.5;

      const localPoints = [
        // corners
        { x: -halfW, y: -halfH },
        { x: halfW, y: -halfH },
        { x: halfW, y: halfH },
        { x: -halfW, y: halfH },
        // edge midpoints
        { x: 0, y: -halfH },
        { x: halfW, y: 0 },
        { x: 0, y: halfH },
        { x: -halfW, y: 0 }
      ];

      for (const p of localPoints) {
        features.push({
          x: desiredCenter.x + p.x * cos - p.y * sin,
          y: desiredCenter.y + p.x * sin + p.y * cos
        });
      }
    } else if (shape.kind === "circle" && shape.radius != null) {
      const r = shape.radius;
      features.push({ x: desiredCenter.x, y: desiredCenter.y - r });
      features.push({ x: desiredCenter.x + r, y: desiredCenter.y });
      features.push({ x: desiredCenter.x, y: desiredCenter.y + r });
      features.push({ x: desiredCenter.x - r, y: desiredCenter.y });
    }

    return features;
  }

  /**
   * Snap a moving shape by snapping any of its feature points (corners/edge midpoints/etc),
   * then translating the center by the same delta.
   * @param {import("./types.js").ShapeObject} shape
   * @param {{ x: number, y: number }} desiredCenter
   * @returns {{ x: number, y: number, snapped: boolean }}
   */
  applyMoveSnapping(shape, desiredCenter) {
    if (!this.state.editor.snapToShapes) {
      return { x: desiredCenter.x, y: desiredCenter.y, snapped: false };
    }

    const features = this.getShapeSnapFeatures(shape, desiredCenter);
    let best = null;

    for (const f of features) {
      const snapped = this.applySnapping(f.x, f.y, shape.id);
      if (!snapped.snapped) continue;
      const dx = snapped.x - f.x;
      const dy = snapped.y - f.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (!best || dist < best.dist) {
        best = { dx, dy, dist };
      }
    }

    if (best) {
      return {
        x: desiredCenter.x + best.dx,
        y: desiredCenter.y + best.dy,
        snapped: true
      };
    }
    return { x: desiredCenter.x, y: desiredCenter.y, snapped: false };
  }

  /**
   * Find the closest point on a line segment to a given point
   * @param {number} px Point X
   * @param {number} py Point Y
   * @param {number} x1 Line segment start X
   * @param {number} y1 Line segment start Y
   * @param {number} x2 Line segment end X
   * @param {number} y2 Line segment end Y
   * @returns {{ x: number, y: number }}
   */
  closestPointOnLineSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSq = dx * dx + dy * dy;
    
    if (lengthSq === 0) {
      // Line segment is a point
      return { x: x1, y: y1 };
    }
    
    // Calculate parameter t (0 to 1) for closest point on line
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSq));
    
    // Return closest point on line segment
    return {
      x: x1 + t * dx,
      y: y1 + t * dy
    };
  }

  /**
   * @param {string} id
   * @param {{ x: number, y: number }} world
   */
  updateSourcePosition(id, world) {
    const { origin, worldSize } = this.state.domain;
    const clamped = {
      x: clamp(world.x, origin.x, origin.x + worldSize.x),
      y: clamp(world.y, origin.y, origin.y + worldSize.y)
    };

    this.store.updateState((draft) => {
      const source = draft.sources.find((item) => item.id === id);
      if (!source) {
        return draft;
      }
      source.position.x = clamped.x;
      source.position.y = clamped.y;
      return draft;
    });
  }

  /**
   * @param {string} id
   * @param {{ x: number, y: number }} world
   */
  updateShapePosition(id, world) {
    const { origin, worldSize } = this.state.domain;
    const shape = this.state.shapes.find((s) => s.id === id);
    if (!shape) {
      return;
    }
    
    // Apply feature-based snapping so shapes snap by edges/corners while moving (not just center)
    const desiredCenter = { x: world.x, y: world.y };
    const snappedMove = this.applyMoveSnapping(shape, desiredCenter);
    const snappedWorld = snappedMove.snapped ? { x: snappedMove.x, y: snappedMove.y } : desiredCenter;
    
    const clamped = {
      x: clamp(snappedWorld.x, origin.x, origin.x + worldSize.x),
      y: clamp(snappedWorld.y, origin.y, origin.y + worldSize.y)
    };

    this.store.updateState((draft) => {
      const shape = draft.shapes.find((item) => item.id === id);
      if (!shape) {
        return draft;
      }
      shape.center.x = clamped.x;
      shape.center.y = clamped.y;
      return draft;
    });
  }

  /**
   * @param {string} id
   * @param {{ type: string, label: string }} handle
   * @param {{ x: number, y: number, snapped: boolean }} world
   */
  updateShapeResize(id, handle, world) {
    const shape = this.state.shapes.find(s => s.id === id);
    if (!shape || !this.drag || this.drag.type !== "resize" || !this.drag.initialShape) return;
    
    const initialShape = this.drag.initialShape;
    if (!initialShape || !initialShape.center) return;
    
    // Use snapped mouse position (snapping already applied in onPointerMove)
    const snappedWorld = world;
    
    this.store.updateState((draft) => {
      const shape = draft.shapes.find((item) => item.id === id);
      if (!shape) return draft;
      
      if (shape.kind === "rectangle" && shape.size) {
        const angle = (((/** @type {any} */ (initialShape).angleZ ?? (shape.angles?.z ?? 0)) * Math.PI) / 180);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const initialCenter = initialShape.center;
        const minSize = 0.1;
        const minHalf = minSize * 0.5;

        /** @param {number} wx @param {number} wy */
        const worldToLocal = (wx, wy) => {
          const dx = wx - initialCenter.x;
          const dy = wy - initialCenter.y;
          return {
            x: dx * cos + dy * sin,
            y: -dx * sin + dy * cos
          };
        };

        /** @param {number} lx @param {number} ly */
        const localToWorld = (lx, ly) => {
          return {
            x: initialCenter.x + lx * cos - ly * sin,
            y: initialCenter.y + lx * sin + ly * cos
          };
        };
        
        if (handle.type === "corner") {
          // Standard local-space solve:
          // - convert dragged point to initial-rectangle local space
          // - keep opposite corner fixed (in initial local space)
          // - compute new center as midpoint and new size as distance
          const oldWidth = initialShape.size?.width || shape.size.width;
          const oldHeight = initialShape.size?.height || shape.size.height;
          const halfW0 = oldWidth * 0.5;
          const halfH0 = oldHeight * 0.5;

          const p = worldToLocal(snappedWorld.x, snappedWorld.y);

          const isLeft = handle.label === "nw" || handle.label === "sw";
          const isTop = handle.label === "nw" || handle.label === "ne";

          // Opposite corner (fixed) in initial local space
          const opp = {
            x: isLeft ? halfW0 : -halfW0,
            y: isTop ? halfH0 : -halfH0
          };

          const centerLocal = {
            x: (p.x + opp.x) * 0.5,
            y: (p.y + opp.y) * 0.5
          };

          const halfW = Math.max(minHalf, Math.abs(p.x - opp.x) * 0.5);
          const halfH = Math.max(minHalf, Math.abs(p.y - opp.y) * 0.5);

          const centerWorld = localToWorld(centerLocal.x, centerLocal.y);
          shape.center.x = centerWorld.x;
          shape.center.y = centerWorld.y;
          shape.size.width = halfW * 2;
          shape.size.height = halfH * 2;
          
        } else if (handle.type === "edge") {
          // Standard local-space solve with fixed opposite edge.
          // Note: we intentionally ignore movement parallel to the edge; only the normal axis resizes.
          const oldWidth = initialShape.size?.width || shape.size.width;
          const oldHeight = initialShape.size?.height || shape.size.height;
          const halfW0 = oldWidth * 0.5;
          const halfH0 = oldHeight * 0.5;

          const p = worldToLocal(snappedWorld.x, snappedWorld.y);

          if (handle.label === "n" || handle.label === "s") {
            const fixedY = handle.label === "n" ? halfH0 : -halfH0; // opposite edge (south/north) in initial local space
            const dragY = p.y;
            const centerLocalY = (fixedY + dragY) * 0.5;
            const halfH = Math.max(minHalf, Math.abs(fixedY - dragY) * 0.5);

            const centerWorld = localToWorld(0, centerLocalY);
            shape.center.x = centerWorld.x;
            shape.center.y = centerWorld.y;
            shape.size.height = halfH * 2;
            shape.size.width = Math.max(minSize, oldWidth);
          } else {
            const fixedX = handle.label === "w" ? halfW0 : -halfW0; // opposite edge (east/west) in initial local space
            const dragX = p.x;
            const centerLocalX = (fixedX + dragX) * 0.5;
            const halfW = Math.max(minHalf, Math.abs(fixedX - dragX) * 0.5);

            const centerWorld = localToWorld(centerLocalX, 0);
            shape.center.x = centerWorld.x;
            shape.center.y = centerWorld.y;
            shape.size.width = halfW * 2;
            shape.size.height = Math.max(minSize, oldHeight);
          }
        }
      } else if (shape.kind === "circle" && shape.radius != null) {
        // Keep center fixed during resize (standard behavior)
        const cx = initialShape.center.x;
        const cy = initialShape.center.y;
        const dx = snappedWorld.x - cx;
        const dy = snappedWorld.y - cy;
        shape.center.x = cx;
        shape.center.y = cy;
        shape.radius = Math.max(0.1, Math.sqrt(dx * dx + dy * dy));
      }
      
      return draft;
    });
  }

  /**
   * @param {"source" | "shape" | null} type
   * @param {string | null} id
   */
  setSelection(type, id) {
    const current = this.state.editor.selection;
    if (current && current.type === type && current.id === id) {
      return;
    }
    this.store.updateState((draft) => {
      draft.editor.selection = { type, id };
      return draft;
    });
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {{ x: number, y: number }}
   */
  screenToWorld(x, y) {
    const { scale, offsetX, offsetY } = this.getTransform();
    return {
      x: (x - offsetX) / scale,
      y: (y - offsetY) / scale
    };
  }

  /**
   * @param {{ x: number, y: number }} world
   * @returns {{ x: number, y: number }}
   */
  worldToScreen(world) {
    const { scale, offsetX, offsetY } = this.getTransform();
    return {
      x: world.x * scale + offsetX,
      y: world.y * scale + offsetY
    };
  }

  /**
   * @returns {{ scale: number, offsetX: number, offsetY: number }}
   */
  getTransform() {
    const rect = this.canvas.getBoundingClientRect();
    if (
      rect &&
      (!this.lastRect ||
        rect.width !== this.lastRect.width ||
        rect.height !== this.lastRect.height)
    ) {
      this.needsResize = true;
      this.lastRect = { width: rect.width, height: rect.height };
    }

    const { worldSize } = this.state.domain;
    const baseScale = Math.min(
      this.canvas.width / worldSize.x,
      this.canvas.height / worldSize.y
    );
    const scale = baseScale * this.view.zoom;
    const offsetX = this.canvas.width * 0.5 - this.view.center.x * scale;
    const offsetY = this.canvas.height * 0.5 - this.view.center.y * scale;
    return { scale, offsetX, offsetY };
  }

  /**
   * @param {PointerEvent | WheelEvent} event
   * @returns {{ x: number, y: number }}
   */
  getPointerPosition(event) {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return {
      x: (event.clientX - rect.left) * dpr,
      y: (event.clientY - rect.top) * dpr
    };
  }

  /**
   * @param {{ shapeKind: "rectangle" | "circle", center: { x: number, y: number }, size: { width: number, height: number } | null, radius: number | null, angles?: { x?: number, y?: number, z?: number } } | null} draft
   */
  setModalDraft(draft) {
    this.modalDraft = draft;
  }
}

/**
 * @param {{ x: number, y: number }} position
 * @param {{ amplitude: number, frequency: number, phase: number }} defaults
 * @param {string} name
 * @returns {SourceObject}
 */
/**
 * @param {{ x: number, y: number }} position
 * @param {import("./types.js").SimulationState["simulation"]["sourceDefaults"]} defaults
 * @param {string} name
 */
function createSource(position, defaults, name) {
  const now = Date.now();
  return {
    id: `src-${now}-${Math.floor(Math.random() * 1000)}`,
    name: typeof name === "string" ? name : "Source",
    position: { x: position.x, y: position.y, z: 0 },
    amplitude: defaults?.amplitude ?? 1,
    phase: defaults?.phase ?? 0,
    frequency: defaults?.frequency ?? 1.5,
    waveform: defaults?.waveform ?? "cw",
    pulseWidth: defaults?.pulseWidth ?? 0.4,
    pulseDelay: defaults?.pulseDelay ?? 0,
    injection: defaults?.injection ?? "soft",
    excite: defaults?.excite ?? "hz",
    polarizationAngle: defaults?.polarizationAngle ?? 0,
    height: 1,
    angles: { x: 0, y: 0, z: 0 },
    active: true
  };
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * @param {{ x: number, y: number }} a
 * @param {{ x: number, y: number }} b
 */
function getBounds(a, b) {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  return {
    minX,
    minY,
    width: maxX - minX,
    height: maxY - minY
  };
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {() => void} drawPath
 * @param {{
 *  outerWidth: number,
 *  innerWidth: number,
 *  outerColor: string,
 *  innerColor: string,
 *  dash: number[] | null
 * }} style
 */
function strokePreviewOutline(ctx, drawPath, style) {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.setLineDash([]);
  ctx.lineWidth = style.outerWidth;
  ctx.strokeStyle = style.outerColor;
  drawPath();
  ctx.stroke();
  ctx.lineWidth = style.innerWidth;
  ctx.strokeStyle = style.innerColor;
  if (style.dash && style.dash.length) {
    ctx.setLineDash(style.dash);
  }
  drawPath();
  ctx.stroke();
  ctx.restore();
}
