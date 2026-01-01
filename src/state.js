// @ts-check

/** @typedef {import("./types.js").SimulationState} SimulationState */

const DEFAULT_VERSION = "1.0";

/**
 * @returns {string}
 */
function nowIso() {
  return new Date().toISOString();
}

/**
 * @returns {SimulationState}
 */
export function createDefaultState() {
  const timestamp = nowIso();
  return {
    version: DEFAULT_VERSION,
    meta: {
      createdAt: timestamp,
      updatedAt: timestamp
    },
    domain: {
      worldSize: { x: 10, y: 20 },
      grid: { nx: 128, ny: 128 },
      origin: { x: -5, y: -10 },
      units: "meters"
    },
    simulation: {
      time: 0,
      running: true,
      timeScale: 1,
      model: "em2d",
      sourceDefaults: {
        amplitude: 1,
        frequency: 1.5,
        phase: 0,
        waveform: "cw",
        pulseWidth: 0.4,
        pulseDelay: 0,
        injection: "soft",
        excite: "hz",
        polarizationAngle: 0
      },
      solver: {
        type: "sumOfSources",
        speed: 1,
        attenuation: 0.1
      }
    },
    sources: [],
    shapes: [],
    visualization: {
      mode: "2d",
      output: "instantaneous",
      colormap: "spectral",
      showGrid: true,
      showAxes: true,
      surface: {
        zScale: 1,
        wireframe: false
      },
      overlays2d: {
        showSources: true,
        showShapes: true
      }
    },
    editor: {
      activeTool: "select",
      snapToGrid: false,
      snapToShapes: true,
      modal: {
        open: false,
        pendingObjectId: null
      },
      selection: {
        type: null,
        id: null
      }
    }
  };
}

/**
 * @param {SimulationState} state
 * @returns {SimulationState}
 */
export function normalizeState(state) {
  const next = safeClone(state);
  const defaults = createDefaultState();
  if (!next.domain) {
    next.domain = defaults.domain;
  } else {
    if (!next.domain.worldSize) {
      next.domain.worldSize = defaults.domain.worldSize;
    } else {
      next.domain.worldSize = {
        x: clamp(next.domain.worldSize.x ?? defaults.domain.worldSize.x, 1, 500),
        y: clamp(next.domain.worldSize.y ?? defaults.domain.worldSize.y, 1, 500)
      };
    }
    if (!next.domain.origin) {
      next.domain.origin = defaults.domain.origin;
    } else {
      next.domain.origin = {
        x: Number.isFinite(next.domain.origin.x)
          ? next.domain.origin.x
          : defaults.domain.origin.x,
        y: Number.isFinite(next.domain.origin.y)
          ? next.domain.origin.y
          : defaults.domain.origin.y
      };
    }
    if (!next.domain.grid) {
      next.domain.grid = defaults.domain.grid;
    }
    if (next.domain.grid && Object.prototype.hasOwnProperty.call(next.domain.grid, "nz")) {
      delete /** @type {any} */ (next.domain.grid).nz;
    }
    if (next.domain.units !== "meters" && next.domain.units !== "units") {
      next.domain.units = defaults.domain.units;
    }
  }

  if (!next.simulation) {
    next.simulation = defaults.simulation;
  } else {
    if (typeof next.simulation.running !== "boolean") {
      next.simulation.running = true;
    }
    if (!Number.isFinite(next.simulation.timeScale)) {
      next.simulation.timeScale = defaults.simulation.timeScale;
    }
    if (next.simulation.model !== "scalarWave2d" && next.simulation.model !== "em2d") {
      next.simulation.model = defaults.simulation.model;
    }
    if (!next.simulation.solver) {
      next.simulation.solver = defaults.simulation.solver;
    } else {
      next.simulation.solver = {
        type: "sumOfSources",
        speed: clamp(next.simulation.solver.speed ?? defaults.simulation.solver.speed, 0.05, 20),
        attenuation: clamp(
          next.simulation.solver.attenuation ?? defaults.simulation.solver.attenuation,
          0,
          2
        )
      };
    }
    if (!next.simulation.sourceDefaults) {
      next.simulation.sourceDefaults = defaults.simulation.sourceDefaults;
    } else {
      const waveformRaw = next.simulation.sourceDefaults.waveform;
      const waveform =
        waveformRaw === "gaussian" || waveformRaw === "ricker" ? waveformRaw : "cw";
      const injectionRaw = next.simulation.sourceDefaults.injection;
      const injection = injectionRaw === "hard" ? "hard" : "soft";
      const exciteRaw = next.simulation.sourceDefaults.excite;
      const excite =
        exciteRaw === "ex" || exciteRaw === "ey" || exciteRaw === "e" || exciteRaw === "hz"
          ? exciteRaw
          : "hz";
      next.simulation.sourceDefaults = {
        amplitude: clamp(next.simulation.sourceDefaults.amplitude ?? 1, 0, 10),
        frequency: clamp(next.simulation.sourceDefaults.frequency ?? 1.5, 0.01, 50),
        phase: clamp(next.simulation.sourceDefaults.phase ?? 0, -Math.PI, Math.PI),
        waveform,
        pulseWidth: clamp(next.simulation.sourceDefaults.pulseWidth ?? 0.4, 0.001, 20),
        pulseDelay: clamp(next.simulation.sourceDefaults.pulseDelay ?? 0, 0, 20),
        injection,
        excite,
        polarizationAngle: clamp(
          next.simulation.sourceDefaults.polarizationAngle ?? 0,
          -180,
          180
        )
      };
    }
  }
  // EM-only app: always force the model to EM.
  next.simulation.model = "em2d";
  if (!next.visualization) {
    next.visualization = defaults.visualization;
  } else {
    if (!next.visualization.output) {
      next.visualization.output = "instantaneous";
    }
    if (!next.visualization.surface) {
      next.visualization.surface = defaults.visualization.surface;
    }
    if (!next.visualization.overlays2d) {
      next.visualization.overlays2d = defaults.visualization.overlays2d;
    }
  }
  if (next.visualization && Object.prototype.hasOwnProperty.call(next.visualization, "zProbe")) {
    delete /** @type {any} */ (next.visualization).zProbe;
  }
  if (!next.editor) {
    next.editor = defaults.editor;
  } else {
    if (typeof next.editor.snapToGrid !== "boolean") {
      next.editor.snapToGrid = defaults.editor.snapToGrid;
    }
    if (typeof next.editor.snapToShapes !== "boolean") {
      next.editor.snapToShapes = defaults.editor.snapToShapes;
    }
    if (!next.editor.modal) {
      next.editor.modal = defaults.editor.modal;
    }
    if (!next.editor.selection) {
      next.editor.selection = defaults.editor.selection;
    }
  }

  const origin = next.domain.origin;
  const worldSize = next.domain.worldSize;
  const maxSize = Math.max(worldSize.x, worldSize.y, 1);
  next.domain.grid = normalizeGrid(next.domain.grid, worldSize, next.simulation);

  next.sources = (next.sources || []).map((source, index) => ({
    ...source,
    name: typeof source.name === "string" && source.name.trim()
      ? source.name.trim()
      : `Source ${index + 1}`,
    position: {
      x: clamp(source.position?.x ?? 0, origin.x, origin.x + worldSize.x),
      y: clamp(source.position?.y ?? 0, origin.y, origin.y + worldSize.y),
      z: 0
    },
    amplitude: clamp(source.amplitude ?? 1, 0, 10),
    frequency: clamp(
      source.frequency ?? next.simulation.sourceDefaults.frequency ?? 1.5,
      0.01,
      50
    ),
    phase: clamp(source.phase ?? 0, -Math.PI, Math.PI),
    waveform:
      source.waveform === "gaussian" || source.waveform === "ricker"
        ? source.waveform
        : "cw",
    pulseWidth: clamp(
      source.pulseWidth ?? next.simulation.sourceDefaults.pulseWidth ?? 0.4,
      0.001,
      20
    ),
    pulseDelay: clamp(
      source.pulseDelay ?? next.simulation.sourceDefaults.pulseDelay ?? 0,
      0,
      20
    ),
    injection: source.injection === "hard" ? "hard" : "soft",
    excite:
      source.excite === "ex" ||
      source.excite === "ey" ||
      source.excite === "e" ||
      source.excite === "hz"
        ? source.excite
        : next.simulation.sourceDefaults.excite ?? "hz",
    polarizationAngle: clamp(
      source.polarizationAngle ?? next.simulation.sourceDefaults.polarizationAngle ?? 0,
      -180,
      180
    ),
    height: clamp(source.height ?? 1, 0, 10),
    angles: {
      x: clamp(source.angles?.x ?? 0, -180, 180),
      y: clamp(source.angles?.y ?? 0, -180, 180),
      z: clamp(source.angles?.z ?? 0, -180, 180)
    },
    active: source.active !== false
  }));

  next.shapes = (next.shapes || []).map((shape, index) => {
    const defaultName = shape.kind === "circle" ? "Circle" : "Rectangle";
    const name =
      typeof shape.name === "string" && shape.name.trim()
        ? shape.name.trim()
        : `${defaultName} ${index + 1}`;
    if (shape.kind === "circle") {
      const material = normalizeMaterial(shape.material);
      return {
        id: shape.id,
        kind: "circle",
        name,
        center: {
          x: clamp(shape.center?.x ?? 0, origin.x, origin.x + worldSize.x),
          y: clamp(shape.center?.y ?? 0, origin.y, origin.y + worldSize.y),
          z: 0
        },
        size: null,
        radius: clamp(shape.radius ?? 0, 0.05, maxSize * 0.5),
        height: clamp(shape.height ?? 1, 0, 10),
        angles: {
          x: clamp(shape.angles?.x ?? 0, -180, 180),
          y: clamp(shape.angles?.y ?? 0, -180, 180),
          z: clamp(shape.angles?.z ?? 0, -180, 180)
        },
        material,
        tags: Array.isArray(shape.tags) ? shape.tags : []
      };
    }

    const safeSize = shape.size || { width: 0, height: 0 };
    const material = normalizeMaterial(shape.material);
    return {
      id: shape.id,
      kind: "rectangle",
      name,
      center: {
        x: clamp(shape.center?.x ?? 0, origin.x, origin.x + worldSize.x),
        y: clamp(shape.center?.y ?? 0, origin.y, origin.y + worldSize.y),
        z: 0
      },
      size: {
        width: clamp(safeSize.width ?? 0, 0.05, maxSize),
        height: clamp(safeSize.height ?? 0, 0.05, maxSize)
      },
      radius: null,
      height: clamp(shape.height ?? 1, 0, 10),
      angles: {
        x: clamp(shape.angles?.x ?? 0, -180, 180),
        y: clamp(shape.angles?.y ?? 0, -180, 180),
        z: clamp(shape.angles?.z ?? 0, -180, 180)
      },
      material,
      tags: Array.isArray(shape.tags) ? shape.tags : []
    };
  });
  return next;
}

/**
 * @param {any} value
 * @returns {import("./types.js").MaterialSettings}
 */
function normalizeMaterial(value) {
  const preset =
    value && typeof value.preset === "string"
      ? value.preset
      : "drywall";
  const epsRRaw = value && Number.isFinite(value.epsR) ? value.epsR : null;
  const sigmaRaw = value && Number.isFinite(value.sigma) ? value.sigma : null;

  // Preset defaults (educational, normalized σ units).
  // - air: epsR=1, sigma=0
  // - drywall: epsR~2.7, sigma small
  // - concrete: epsR~6, sigma higher
  // - metal: treat as highly conductive + PEC-like in solver
  /** @type {Record<string, { epsR: number, sigma: number, preset: string }>} */
  const presets = {
    air: { preset: "air", epsR: 1, sigma: 0 },
    drywall: { preset: "drywall", epsR: 2.7, sigma: 0.02 },
    concrete: { preset: "concrete", epsR: 6, sigma: 0.2 },
    metal: { preset: "metal", epsR: 1, sigma: 50 },
    custom: { preset: "custom", epsR: 2.7, sigma: 0.02 }
  };

  const base = presets[preset] || presets.drywall;
  const epsR = clamp(epsRRaw ?? base.epsR, 1, 20);
  const sigma = clamp(sigmaRaw ?? base.sigma, 0, 200);

  return {
    preset: /** @type {import("./types.js").MaterialSettings["preset"]} */ (
      base.preset
    ),
    epsR,
    sigma
  };
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Auto-scales grid resolution based on domain size and wavelength to maintain
 * consistent quality (cells per wavelength) regardless of domain size.
 * This ensures PML effectiveness and reduces reflections in larger domains.
 * @param {{ nx?: number, ny?: number }} grid
 * @param {{ x: number, y: number }} worldSize
 * @param {SimulationState["simulation"]} simulation
 */
function normalizeGrid(grid, worldSize, simulation) {
  // Auto-calculate grid resolution based on wavelength and domain size.
  // For EM, use a slightly lower cells/λ target for interactivity.
  const isEm = simulation?.model === "em2d";
  const speed = clamp(simulation?.solver?.speed ?? 1, 0.05, isEm ? 50 : 20);
  const frequency = clamp(
    simulation?.sourceDefaults?.frequency ?? (isEm ? 5 : 1.5),
    isEm ? 0.01 : 0.1,
    isEm ? 50 : 6
  );
  const wavelength = speed / frequency;
  const cellsPerLambda = isEm ? 12 : 16;

  const dx = clamp(wavelength / cellsPerLambda, 0.01, 10);
  let nx = Math.max(2, Math.round(worldSize.x / dx) + 1);
  let ny = Math.max(2, Math.round(worldSize.y / dx) + 1);

  // Hard cap to keep browser interactive; if exceeded, increase dx proportionally.
  const MAX_GRID = 512;
  if (nx > MAX_GRID || ny > MAX_GRID) {
    const scale = Math.max(nx / MAX_GRID, ny / MAX_GRID);
    nx = Math.max(2, Math.round(nx / scale));
    ny = Math.max(2, Math.round(ny / scale));
  }

  return { nx, ny };
}

/**
 * @param {unknown} value
 * @returns {value is SimulationState}
 */
export function isSimulationState(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  /** @type {SimulationState} */
  const state = /** @type {SimulationState} */ (value);
  return (
    typeof state.version === "string" &&
    !!state.meta &&
    typeof state.meta.createdAt === "string" &&
    typeof state.meta.updatedAt === "string" &&
    !!state.domain &&
    !!state.simulation &&
    Array.isArray(state.sources) &&
    Array.isArray(state.shapes) &&
    !!state.visualization &&
    !!state.editor
  );
}

/**
 * @param {SimulationState} state
 * @returns {SimulationState}
 */
export function touchUpdatedAt(state) {
  return {
    ...state,
    meta: {
      createdAt: state.meta.createdAt || nowIso(),
      updatedAt: nowIso()
    }
  };
}

/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function safeClone(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return /** @type {T} */ (JSON.parse(JSON.stringify(value)));
}

/**
 * @param {SimulationState} initialState
 */
export function createStore(initialState) {
  /** @type {SimulationState} */
  let state = initialState;
  const listeners = new Set();

  /**
   * @returns {SimulationState}
   */
  function getState() {
    return state;
  }

  /**
   * @param {SimulationState} nextState
   * @param {{ touch?: boolean }} [options]
   */
  function setState(nextState, options = {}) {
    const shouldTouch = options.touch !== false;
    state = shouldTouch ? touchUpdatedAt(nextState) : nextState;
    listeners.forEach((listener) => listener(state));
  }

  /**
   * @param {(draft: SimulationState) => SimulationState} updater
   */
  function updateState(updater) {
    const draft = safeClone(state);
    const next = updater(draft);
    setState(next, { touch: true });
  }

  /**
   * @param {(state: SimulationState) => void} listener
   * @returns {() => void}
   */
  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    getState,
    setState,
    updateState,
    subscribe
  };
}
