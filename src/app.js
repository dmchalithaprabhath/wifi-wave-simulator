// @ts-check

import {
  createDefaultState,
  createStore,
  isSimulationState,
  normalizeState
} from "./state.js";
import { loadState, saveState } from "./persistence.js";
import { initUI } from "./ui.js";
import { createSolverFromState } from "./solver.js";
import { Renderer2D } from "./renderer2d.js";
import { Renderer3D } from "./renderer3d.js";
import { initModal } from "./modal.js";
import { initSignalSettings } from "./signalSettings.js";

/**
 * @returns {import("./types.js").SimulationState}
 */
function resolveInitialState() {
  const stored = loadState();
  if (stored && isSimulationState(stored)) {
    return normalizeState(stored);
  }
  // Ensure defaults get the same normalization (grid scaling, clamping, etc.)
  // as imported/saved states. This prevents the initial 30x30 default from
  // starting with a stale 128x128 grid.
  return normalizeState(createDefaultState());
}

const store = createStore(resolveInitialState());
const viewportStatus = document.querySelector("#viewportStatus");
const viewportCanvas2d = document.querySelector("#viewportCanvas2d");
const viewportCanvas3d = document.querySelector("#viewportCanvas3d");

if (!(viewportCanvas2d instanceof HTMLCanvasElement)) {
  throw new Error("2D viewport canvas not found.");
}
if (!(viewportCanvas3d instanceof HTMLCanvasElement)) {
  throw new Error("3D viewport canvas not found.");
}

let currentState = store.getState();
let solverKey = getSolverKey(currentState);
let solver = createSolverFromState(currentState);
let shapesKey = getShapesKey(currentState);
const resetSimulation = () => solver.reset();

const render = initUI(store, { onReset: resetSimulation });
let modal = null;
const renderer2d = new Renderer2D(viewportCanvas2d, store, {
  onDrawComplete: (draft) => {
    if (modal) {
      modal.openModal(draft);
    }
  }
});
modal = initModal(store, {
  onDraftChange: (draft) => renderer2d.setModalDraft(draft)
});
initSignalSettings(store);
const renderer3d = new Renderer3D(viewportCanvas3d);

store.subscribe((state) => {
  saveState(state);
  render(state);
  currentState = state;
  renderer2d.setState(state);
  renderer3d.setState(state);
  updateViewportMode(state.visualization.mode);

  const nextKey = getSolverKey(state);
  if (nextKey !== solverKey) {
    solver = createSolverFromState(state);
    solverKey = nextKey;
    shapesKey = getShapesKey(state);
  } else {
    solver.setSources(state.sources);
    const nextShapesKey = getShapesKey(state);
    if (nextShapesKey !== shapesKey) {
      solver.setBarrierFromShapes(state.shapes);
      shapesKey = nextShapesKey;
    }
  }
});

render(currentState);
solver.setSources(currentState.sources);
renderer3d.setState(currentState);
updateViewportMode(currentState.visualization.mode);

let lastTime = performance.now();
requestAnimationFrame(function frame(now) {
  const rawDelta = (now - lastTime) / 1000;
  const clampedDelta = Math.min(0.1, Math.max(0, rawDelta));
  lastTime = now;

  let timeScale = Number.isFinite(currentState.simulation.timeScale)
    ? currentState.simulation.timeScale
    : 1;
  timeScale = clamp(timeScale, 0, 4);

  const isRunning = currentState.simulation.running !== false;
  if (isRunning && timeScale > 0) {
    solver.step(clampedDelta * timeScale);
  }
  updateViewportStatus();
  if (currentState.visualization.mode === "2d") {
    renderer2d.render(solver);
  } else {
    renderer3d.render(solver);
  }
  requestAnimationFrame(frame);
});

function updateViewportStatus() {
  if (!(viewportStatus instanceof HTMLDivElement)) {
    return;
  }
  const stats = solver.getStats();
  const isRunning = currentState.simulation.running !== false;
  const modelLabel = "EM (WiFi)";
  const nx = solver.nx;
  const ny = solver.ny;
  const dx = Number.isFinite(solver.dx) ? solver.dx : 0;
  const dt = Number.isFinite(solver.dt) ? solver.dt : 0;
  const gridClampNote = nx >= 512 || ny >= 512 ? " (grid clamped)" : "";

  const speed = Number.isFinite(currentState.simulation.solver.speed)
    ? currentState.simulation.solver.speed
    : 1;
  const freq = Number.isFinite(currentState.simulation.sourceDefaults.frequency)
    ? currentState.simulation.sourceDefaults.frequency
    : 1;
  const lambda = freq > 0 ? speed / freq : 0;
  const cellsPerLambda = dx > 0 ? lambda / dx : 0;
  const lines = [
    "Viewport (placeholder)",
    `Active tool: ${currentState.editor.activeTool}`,
    `Mode: ${currentState.visualization.mode.toUpperCase()}`,
    `Model: ${modelLabel}${gridClampNote}`,
    `Output: ${currentState.visualization.output === "averaged" ? "AVERAGED" : "INSTANT"}`,
    `Status: ${isRunning ? "RUNNING" : "PAUSED"}`,
    `Sim time: ${stats.time.toFixed(2)}s`,
    `Grid: ${nx} x ${ny}`,
    `dx: ${dx.toExponential(2)}, dt: ${dt.toExponential(2)}`,
    `λ: ${lambda.toExponential(2)}, cells/λ: ${cellsPerLambda.toFixed(1)}`,
    `Max amplitude: ${stats.maxInstantaneous.toFixed(3)}`
  ];
  viewportStatus.textContent = lines.join("\n");
}

/**
 * @param {"2d" | "3d"} mode
 */
function updateViewportMode(mode) {
  const is2d = mode === "2d";
  viewportCanvas2d.style.display = is2d ? "block" : "none";
  viewportCanvas3d.style.display = is2d ? "none" : "block";
  viewportCanvas2d.style.pointerEvents = is2d ? "auto" : "none";
  viewportCanvas3d.style.pointerEvents = is2d ? "none" : "auto";
}

/**
 * @param {import("./types.js").SimulationState} state
 * @returns {string}
 */
function getSolverKey(state) {
  return JSON.stringify({
    domain: state.domain,
    solver: state.simulation.solver,
    model: state.simulation.model
  });
}

/**
 * @param {import("./types.js").SimulationState} state
 * @returns {string}
 */
function getShapesKey(state) {
  return JSON.stringify(state.shapes || []);
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
