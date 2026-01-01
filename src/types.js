// @ts-check

/** @typedef {{ x: number, y: number }} Vec2 */
/** @typedef {{ x: number, y: number, z: number }} Vec3 */

/** @typedef {{ width: number, height: number }} Size2D */

/**
 * Shape material parameters for EM simulation.
 * - epsR: relative permittivity (dimensionless)
 * - sigma: effective conductivity (1/s in our normalized solver)
 * @typedef {"air" | "drywall" | "concrete" | "metal" | "custom"} MaterialPreset
 * @typedef {{ preset: MaterialPreset, epsR: number, sigma: number }} MaterialSettings
 */

/**
 * @typedef {Object} DomainSettings
 * @property {Vec2} worldSize
 * @property {{ nx: number, ny: number }} grid
 * @property {Vec2} origin
 * @property {"meters" | "units"} units
 */

/**
 * @typedef {Object} SolverSettings
 * @property {"sumOfSources"} type
 * @property {number} speed
 * @property {number} attenuation
 */

/**
 * High-level physics model selection.
 * - scalarWave2d: 2D scalar wave equation (acoustic/membrane-like)
 * - em2d: electromagnetic (Maxwell/FDTD) placeholder for future work
 * @typedef {"scalarWave2d" | "em2d"} SimulationModel
 */

/**
 * @typedef {Object} SimulationSettings
 * @property {number} time
 * @property {boolean} running
 * @property {number} timeScale
 * @property {SimulationModel} model
 * @property {{
 *  amplitude: number,
 *  frequency: number,
 *  phase: number,
 *  waveform: "cw" | "gaussian" | "ricker",
 *  pulseWidth: number,
 *  pulseDelay: number,
 *  injection: "soft" | "hard",
 *  excite: "hz" | "ex" | "ey" | "e",
 *  polarizationAngle: number
 * }} sourceDefaults
 * @property {SolverSettings} solver
 */

/**
 * @typedef {Object} SourceObject
 * @property {string} id
 * @property {string} name
 * @property {Vec3} position
 * @property {number} amplitude
 * @property {number} phase
 * @property {number} frequency
 * @property {"cw" | "gaussian" | "ricker"} waveform
 * @property {number} pulseWidth
 * @property {number} pulseDelay
 * @property {"soft" | "hard"} injection
 * @property {"hz" | "ex" | "ey" | "e"} excite
 * @property {number} polarizationAngle
 * @property {number} height
 * @property {Vec3} angles
 * @property {boolean} active
 */

/**
 * @typedef {Object} RectangleShape
 * @property {"rectangle"} kind
 * @property {string} id
 * @property {string} name
 * @property {Vec3} center
 * @property {Size2D} size
 * @property {null} radius
 * @property {number} height
 * @property {Vec3} angles
 * @property {MaterialSettings} material
 * @property {string[]} tags
 */

/**
 * @typedef {Object} CircleShape
 * @property {"circle"} kind
 * @property {string} id
 * @property {string} name
 * @property {Vec3} center
 * @property {null} size
 * @property {number} radius
 * @property {number} height
 * @property {Vec3} angles
 * @property {MaterialSettings} material
 * @property {string[]} tags
 */

/** @typedef {RectangleShape | CircleShape} ShapeObject */

/**
 * @typedef {Object} VisualizationSettings
 * @property {"2d" | "3d"} mode
 * @property {"instantaneous" | "averaged"} output
 * @property {string} colormap
 * @property {boolean} showGrid
 * @property {boolean} showAxes
 * @property {{ zScale: number, wireframe: boolean }} surface
 * @property {{ showSources: boolean, showShapes: boolean }} overlays2d
 */

/**
 * @typedef {Object} ModalState
 * @property {boolean} open
 * @property {string | null} pendingObjectId
 */

/**
 * @typedef {Object} SelectionState
 * @property {"source" | "shape" | null} type
 * @property {string | null} id
 */

/**
 * @typedef {Object} EditorSettings
 * @property {"select" | "draw-rectangle" | "draw-circle" | "place-source"} activeTool
 * @property {boolean} snapToGrid
 * @property {boolean} snapToShapes
 * @property {ModalState} modal
 * @property {SelectionState} selection
 */

/**
 * @typedef {Object} SimulationState
 * @property {string} version
 * @property {{ createdAt: string, updatedAt: string }} meta
 * @property {DomainSettings} domain
 * @property {SimulationSettings} simulation
 * @property {SourceObject[]} sources
 * @property {ShapeObject[]} shapes
 * @property {VisualizationSettings} visualization
 * @property {EditorSettings} editor
 */

export {};
