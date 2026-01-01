// @ts-check

/** @typedef {import("./types.js").SimulationState} SimulationState */
/** @typedef {import("./types.js").SourceObject} SourceObject */

const TAU = Math.PI * 2;

/**
 * @typedef {Object} SolverConfig
 * @property {SimulationState["domain"]} domain
 * @property {SimulationState["simulation"]["solver"]} solver
 * @property {number} [avgTau]
 * @property {number} [cfl]
 * @property {number} [pmlWidth]
 */

/**
 * @typedef {Object} SourceSample
 * @property {number} index
 * @property {number} amplitude
 * @property {number} phase
 * @property {number} frequency
 */

/**
 * @typedef {Object} SolverStats
 * @property {number} time
 * @property {number} maxInstantaneous
 * @property {number} meanInstantaneous
 */

export class WaveSolver2D {
  /**
   * @param {SolverConfig} config
   */
  constructor(config) {
    const { domain, solver, avgTau = 0.35, cfl = 0.45 } = config;
    const nx = Math.max(2, Math.floor(domain.grid.nx));
    const ny = Math.max(2, Math.floor(domain.grid.ny));

    const dx = domain.worldSize.x / Math.max(1, nx - 1);
    const dy = domain.worldSize.y / Math.max(1, ny - 1);
    const minCell = Math.min(dx, dy);
    const rawSpeed = Number.isFinite(solver.speed) ? solver.speed : 1;
    const waveSpeed = clamp(rawSpeed, 0.05, 20);

    const dt = (cfl * minCell) / (waveSpeed * Math.SQRT2);

    this.nx = nx;
    this.ny = ny;
    this.dx = dx;
    this.dy = dy;
    this.dt = dt;
    this.time = 0;
    this.avgTau = Math.max(0.05, avgTau);
    this.domain = domain;
    this.solverSettings = solver;
    this.loss = clamp(solver.attenuation ?? 0, 0, 2);

    const size = nx * ny;
    this.prev = new Float32Array(size);
    this.curr = new Float32Array(size);
    this.next = new Float32Array(size);
    this.instantaneous = new Float32Array(size);
    this.avgPower = new Float32Array(size);
    this.avgMagnitude = new Float32Array(size);

    this.sources = [];
    this.barrierMask = null;
    this.accumulator = 0;
    this.maxSubstepsPerFrame = 8; // Cap substeps for performance
    this.stats = {
      time: 0,
      maxInstantaneous: 0,
      meanInstantaneous: 0
    };
    const maxPmlWidth = Math.floor(Math.min(nx, ny) * 0.5) - 1;
    const requestedPmlWidth = clamp(config.pmlWidth ?? 24, 16, 32);
    const usablePmlWidth = Math.max(0, Math.min(requestedPmlWidth, maxPmlWidth));
    this.pmlWidth = usablePmlWidth;
    this.pmlSigma = this.#buildPmlSigma(usablePmlWidth, waveSpeed);
    this.pmlMask = this.#buildPmlMask(usablePmlWidth);

    const invDx2 = 1 / (dx * dx);
    const invDy2 = 1 / (dy * dy);
    const c2 = waveSpeed * waveSpeed;
    this.coeffX = c2 * dt * dt * invDx2;
    this.coeffY = c2 * dt * dt * invDy2;
  }

  /**
   * @param {SourceObject[]} sources
   */
  setSources(sources) {
    this.sources = sources
      .filter((source) => source.active)
      .map((source) => {
        const index = this.#indexFromWorld(source.position);
        return {
          index,
          amplitude: source.amplitude,
          phase: source.phase,
          frequency: source.frequency,
          waveform: source.waveform || "cw",
          pulseWidth: source.pulseWidth ?? 0.4,
          pulseDelay: source.pulseDelay ?? 0,
          injection: source.injection || "soft"
        };
      });
  }

  /**
   * Barrier mask uses the x,y footprint only. z/height are ignored in 2D solver.
   * @param {import("./types.js").ShapeObject[]} shapes
   */
  setBarrierFromShapes(shapes) {
    const nx = this.nx;
    const ny = this.ny;
    if (!shapes || shapes.length === 0) {
      this.barrierMask = null;
      return;
    }

    const mask = new Uint8Array(nx * ny);

    const { origin, worldSize } = this.domain;
    const dx = this.dx;
    const dy = this.dy;

    for (const shape of shapes) {
      if (shape.kind === "circle") {
        const radius = Math.max(0, shape.radius ?? 0);
        if (radius <= 0) {
          continue;
        }
        const minX = shape.center.x - radius;
        const maxX = shape.center.x + radius;
        const minY = shape.center.y - radius;
        const maxY = shape.center.y + radius;

        const ix0 = clamp(Math.floor((minX - origin.x) / dx), 0, nx - 1);
        const ix1 = clamp(Math.ceil((maxX - origin.x) / dx), 0, nx - 1);
        const iy0 = clamp(Math.floor((minY - origin.y) / dy), 0, ny - 1);
        const iy1 = clamp(Math.ceil((maxY - origin.y) / dy), 0, ny - 1);

        const r2 = radius * radius;
        for (let y = iy0; y <= iy1; y += 1) {
          const wy = origin.y + y * dy;
          const dyc = wy - shape.center.y;
          for (let x = ix0; x <= ix1; x += 1) {
            const wx = origin.x + x * dx;
            const dxc = wx - shape.center.x;
            if (dxc * dxc + dyc * dyc <= r2) {
              mask[y * nx + x] = 1;
            }
          }
        }
      } else if (shape.kind === "rectangle" && shape.size) {
        const halfW = shape.size.width * 0.5;
        const halfH = shape.size.height * 0.5;
        if (halfW <= 0 || halfH <= 0) {
          continue;
        }
        const angle = ((shape.angles?.z ?? 0) * Math.PI) / 180;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        const radius = Math.hypot(halfW, halfH);
        const minX = shape.center.x - radius;
        const maxX = shape.center.x + radius;
        const minY = shape.center.y - radius;
        const maxY = shape.center.y + radius;

        const ix0 = clamp(Math.floor((minX - origin.x) / dx), 0, nx - 1);
        const ix1 = clamp(Math.ceil((maxX - origin.x) / dx), 0, nx - 1);
        const iy0 = clamp(Math.floor((minY - origin.y) / dy), 0, ny - 1);
        const iy1 = clamp(Math.ceil((maxY - origin.y) / dy), 0, ny - 1);

        for (let y = iy0; y <= iy1; y += 1) {
          const wy = origin.y + y * dy;
          const dyc = wy - shape.center.y;
          for (let x = ix0; x <= ix1; x += 1) {
            const wx = origin.x + x * dx;
            const dxc = wx - shape.center.x;

            const localX = cosA * dxc + sinA * dyc;
            const localY = -sinA * dxc + cosA * dyc;

            if (Math.abs(localX) <= halfW && Math.abs(localY) <= halfH) {
              mask[y * nx + x] = 1;
            }
          }
        }
      }
    }

    this.barrierMask = mask;
  }

  /**
   * @param {number} deltaSeconds
   */
  step(deltaSeconds) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
      return;
    }

    this.accumulator += deltaSeconds;
    const dt = this.dt;
    let substepCount = 0;

    while (this.accumulator >= dt && substepCount < this.maxSubstepsPerFrame) {
      this.#advance(dt);
      this.accumulator -= dt;
      substepCount += 1;
    }
    
    // Clamp accumulator if we hit the substep limit to prevent unbounded growth
    if (this.accumulator >= dt && substepCount >= this.maxSubstepsPerFrame) {
      // Cap accumulator to prevent it from growing unbounded
      const maxAccumulator = dt * this.maxSubstepsPerFrame;
      if (this.accumulator > maxAccumulator) {
        this.accumulator = maxAccumulator;
      }
    }
  }

  /**
   * @returns {Float32Array}
   */
  getInstantaneousMagnitude() {
    return this.instantaneous;
  }

  /**
   * @returns {Float32Array}
   */
  getAveragedMagnitude() {
    return this.avgMagnitude;
  }

  /**
   * @returns {SolverStats}
   */
  getStats() {
    return this.stats;
  }

  reset() {
    this.prev.fill(0);
    this.curr.fill(0);
    this.next.fill(0);
    this.instantaneous.fill(0);
    this.avgPower.fill(0);
    this.avgMagnitude.fill(0);
    this.time = 0;
    this.accumulator = 0;
    this.stats = {
      time: 0,
      maxInstantaneous: 0,
      meanInstantaneous: 0
    };
  }

  /**
   * @param {number} dt
   */
  #advance(dt) {
    const { nx, ny, coeffX, coeffY } = this;
    const curr = this.curr;
    const prev = this.prev;
    const next = this.next;
    const barrier = this.barrierMask;
    const sigma = this.pmlSigma;
    const loss = this.loss;
    const pmlMask = this.pmlMask;

    if (nx > 1 && ny > 1) {
      for (let x = 0; x < nx; x += 1) {
        curr[x] = 0;
        prev[x] = 0;
        const topIdx = (ny - 1) * nx + x;
        curr[topIdx] = 0;
        prev[topIdx] = 0;
      }
      for (let y = 0; y < ny; y += 1) {
        const leftIdx = y * nx;
        const rightIdx = leftIdx + nx - 1;
        curr[leftIdx] = 0;
        prev[leftIdx] = 0;
        curr[rightIdx] = 0;
        prev[rightIdx] = 0;
      }
    }

    if (barrier) {
      for (let i = 0; i < barrier.length; i += 1) {
        if (barrier[i]) {
          curr[i] = 0;
          prev[i] = 0;
        }
      }
    }

    for (let y = 0; y < ny; y += 1) {
      const rowOffset = y * nx;
      const upOffset = y === 0 ? rowOffset : rowOffset - nx;
      const downOffset = y === ny - 1 ? rowOffset : rowOffset + nx;

      for (let x = 0; x < nx; x += 1) {
        const idx = rowOffset + x;
        const leftIdx = x === 0 ? idx : idx - 1;
        const rightIdx = x === nx - 1 ? idx : idx + 1;
        const upIdx = upOffset + x;
        const downIdx = downOffset + x;

        const laplacian =
          (curr[leftIdx] - 2 * curr[idx] + curr[rightIdx]) * coeffX +
          (curr[upIdx] - 2 * curr[idx] + curr[downIdx]) * coeffY;

        const sigmaVal = (sigma ? sigma[idx] : 0) + loss;
        if (sigmaVal > 0) {
          const sdt = sigmaVal * dt * 0.5;
          next[idx] =
            (2 * curr[idx] - prev[idx] * (1 - sdt) + laplacian) / (1 + sdt);
        } else {
          next[idx] = 2 * curr[idx] - prev[idx] + laplacian;
        }
      }
    }

    if (this.sources.length) {
      const t = this.time;
      for (const source of this.sources) {
        const signal = source.amplitude * evalSourceSignal(source, t);
        if (source.injection === "hard") {
          next[source.index] = signal;
        } else {
          next[source.index] += signal;
        }
      }
    }

    if (barrier) {
      for (let i = 0; i < barrier.length; i += 1) {
        if (barrier[i]) {
          next[i] = 0;
        }
      }
    }

    if (nx > 1 && ny > 1) {
      for (let x = 0; x < nx; x += 1) {
        next[x] = 0;
        next[(ny - 1) * nx + x] = 0;
      }
      for (let y = 0; y < ny; y += 1) {
        next[y * nx] = 0;
        next[y * nx + nx - 1] = 0;
      }
    }


    this.prev = curr;
    this.curr = next;
    this.next = prev;

    const alpha = Math.min(1, dt / this.avgTau);
    const field = this.curr;
    const avgPower = this.avgPower;
    const avgMagnitude = this.avgMagnitude;
    const instant = this.instantaneous;
    let max = 0;
    let sum = 0;

    for (let i = 0; i < field.length; i += 1) {
      if (pmlMask && pmlMask[i]) {
        avgPower[i] = 0;
        avgMagnitude[i] = 0;
        instant[i] = 0;
        continue;
      }
      const value = field[i];
      const absValue = Math.abs(value);
      const power = value * value;

      const nextAvg = avgPower[i] + alpha * (power - avgPower[i]);
      avgPower[i] = nextAvg;
      avgMagnitude[i] = Math.sqrt(nextAvg);
      instant[i] = absValue;

      if (absValue > max) {
        max = absValue;
      }
      sum += absValue;
    }

    this.time += dt;
    this.stats = {
      time: this.time,
      maxInstantaneous: max,
      meanInstantaneous: sum / field.length
    };
  }

  /**
   * Build a graded PML damping profile near the domain edges.
   * @param {number} width
   * @param {number} waveSpeed
   * @returns {Float32Array | null}
   */
  #buildPmlSigma(width, waveSpeed) {
    const nx = this.nx;
    const ny = this.ny;
    if (width <= 0) {
      return null;
    }

    const sigma = new Float32Array(nx * ny);
    const p = 3;
    const targetReflection = 1e-6;
    const thickness = width * Math.min(this.dx, this.dy);
    const sigmaMax =
      ((p + 1) * Math.log(1 / targetReflection) * waveSpeed) / (2 * thickness);

    for (let y = 0; y < ny; y += 1) {
      const distY = Math.min(y, ny - 1 - y);
      const rampY = distY < width ? (width - distY) / width : 0;
      for (let x = 0; x < nx; x += 1) {
        const distX = Math.min(x, nx - 1 - x);
        const rampX = distX < width ? (width - distX) / width : 0;
        const sigmaVal =
          sigmaMax *
          (Math.pow(rampX, p) + Math.pow(rampY, p));
        sigma[y * nx + x] = sigmaVal;
      }
    }

    return sigma;
  }

  /**
   * @param {number} width
   * @returns {Uint8Array | null}
   */
  #buildPmlMask(width) {
    const nx = this.nx;
    const ny = this.ny;
    if (width <= 0) {
      return null;
    }
    const mask = new Uint8Array(nx * ny);
    for (let y = 0; y < ny; y += 1) {
      const distY = Math.min(y, ny - 1 - y);
      for (let x = 0; x < nx; x += 1) {
        const distX = Math.min(x, nx - 1 - x);
        if (distX < width || distY < width) {
          mask[y * nx + x] = 1;
        }
      }
    }
    return mask;
  }


  /**
   * @param {{ x: number, y: number, z?: number }} position
   * @returns {number}
   */
  #indexFromWorld(position) {
    const { origin, worldSize } = this.domain;
    const nx = this.nx;
    const ny = this.ny;

    const xNorm = (position.x - origin.x) / worldSize.x;
    const yNorm = (position.y - origin.y) / worldSize.y;

    const ix = Math.min(nx - 1, Math.max(0, Math.round(xNorm * (nx - 1))));
    const iy = Math.min(ny - 1, Math.max(0, Math.round(yNorm * (ny - 1))));

    return iy * nx + ix;
  }
}

/**
 * 2D electromagnetic wave solver (TEz-style) using an explicit FDTD-like update.
 * This is a simplified model intended for visualization (not a full material EM stack).
 *
 * Fields:
 * - Ex, Ey: electric field components
 * - Hz: magnetic field component (out of plane)
 *
 * Output magnitude:
 * - instantaneous: |E| = sqrt(Ex^2 + Ey^2)
 * - averaged: EMA of power
 */
export class EMSolver2D {
  /**
   * @param {SolverConfig} config
   */
  constructor(config) {
    const { domain, solver, avgTau = 0.35, cfl = 0.45 } = config;
    const nx = Math.max(2, Math.floor(domain.grid.nx));
    const ny = Math.max(2, Math.floor(domain.grid.ny));
    this.nx = nx;
    this.ny = ny;
    this.domain = domain;

    this.dx = domain.worldSize.x / Math.max(1, nx - 1);
    this.dy = domain.worldSize.y / Math.max(1, ny - 1);
    const minCell = Math.min(this.dx, this.dy);

    // NOTE: For real-time educational use, we treat `solver.speed` as the effective
    // wave speed in "world units / second". This keeps Maxwell scaling consistent
    // while allowing an interactive simulation without requiring GHz-scale dt.
    const rawSpeed = Number.isFinite(solver.speed) ? solver.speed : 1;
    const waveSpeed = clamp(rawSpeed, 0.05, 50);
    const dt = (cfl * minCell) / (waveSpeed * Math.SQRT2);

    this.dt = dt;
    this.time = 0;
    this.avgTau = Math.max(0.05, avgTau);
    this.solverSettings = solver;
    // Loss acts like a uniform conductivity term.
    this.loss = clamp(solver.attenuation ?? 0, 0, 5);

    // Choose μ and ε so that c = 1/sqrt(μ ε) matches waveSpeed.
    // Use μ=1, ε=1/c^2 for a consistent normalized system.
    this.mu = 1;
    this.eps = 1 / (waveSpeed * waveSpeed);

    const size = nx * ny;
    this.ex = new Float32Array(size);
    this.ey = new Float32Array(size);
    this.hz = new Float32Array(size);
    this.instantaneous = new Float32Array(size);
    this.avgPower = new Float32Array(size);
    this.avgMagnitude = new Float32Array(size);
    this.sources = [];
    // Material grids (same resolution as fields)
    this.epsRGrid = new Float32Array(size);
    this.sigmaGrid = new Float32Array(size);
    // Optional PEC-like metal mask
    this.metalMask = null;
    this.epsRGrid.fill(1);
    this.sigmaGrid.fill(0);
    this.accumulator = 0;
    this.maxSubstepsPerFrame = 8;
    this.stats = {
      time: 0,
      maxInstantaneous: 0,
      meanInstantaneous: 0
    };
    const maxPmlWidth = Math.floor(Math.min(nx, ny) * 0.5) - 1;
    const requestedPmlWidth = clamp(config.pmlWidth ?? 24, 16, 32);
    const usablePmlWidth = Math.max(0, Math.min(requestedPmlWidth, maxPmlWidth));
    this.pmlWidth = usablePmlWidth;
    // Sigma is an electric-conductivity-like profile (1/s).
    this.pmlSigma = buildPmlSigma(nx, ny, usablePmlWidth, this.dx, this.dy, waveSpeed);
    this.pmlMask = buildPmlMask(nx, ny, usablePmlWidth);
  }

  /** @param {SourceObject[]} _sources */
  setSources(sources) {
    this.sources = sources
      .filter((source) => source.active)
      .map((source) => {
        const index = indexFromWorld(source.position, this.domain, this.nx, this.ny);
        return {
          index,
          amplitude: source.amplitude,
          phase: source.phase,
          frequency: source.frequency,
          waveform: source.waveform || "cw",
          pulseWidth: source.pulseWidth ?? 0.4,
          pulseDelay: source.pulseDelay ?? 0,
          injection: source.injection || "soft",
          excite: source.excite || "hz",
          polarizationAngle: source.polarizationAngle ?? 0
        };
      });
  }

  /** @param {import("./types.js").ShapeObject[]} _shapes */
  setBarrierFromShapes(shapes) {
    const grids = buildMaterialGrids(this.domain, this.nx, this.ny, shapes);
    if (!grids) {
      this.epsRGrid.fill(1);
      this.sigmaGrid.fill(0);
      this.metalMask = null;
      return;
    }
    this.epsRGrid = grids.epsR;
    this.sigmaGrid = grids.sigma;
    this.metalMask = grids.metalMask;
  }

  /** @param {number} deltaSeconds */
  step(deltaSeconds) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
      return;
    }

    this.accumulator += deltaSeconds;
    const dt = this.dt;
    let substepCount = 0;
    while (this.accumulator >= dt && substepCount < this.maxSubstepsPerFrame) {
      this.#advance(dt);
      this.accumulator -= dt;
      substepCount += 1;
    }

    if (this.accumulator >= dt && substepCount >= this.maxSubstepsPerFrame) {
      const maxAccumulator = dt * this.maxSubstepsPerFrame;
      if (this.accumulator > maxAccumulator) {
        this.accumulator = maxAccumulator;
      }
    }
  }

  reset() {
    this.time = 0;
    this.accumulator = 0;
    this.stats.time = 0;
    this.stats.maxInstantaneous = 0;
    this.stats.meanInstantaneous = 0;
    this.ex.fill(0);
    this.ey.fill(0);
    this.hz.fill(0);
    this.instantaneous.fill(0);
    this.avgPower.fill(0);
    this.avgMagnitude.fill(0);
  }

  /** @returns {Float32Array} */
  getInstantaneousMagnitude() {
    return this.instantaneous;
  }

  /** @returns {Float32Array} */
  getAveragedMagnitude() {
    return this.avgMagnitude;
  }

  /** @returns {SolverStats} */
  getStats() {
    return this.stats;
  }

  /**
   * @param {number} dt
   */
  #advance(dt) {
    const { nx, ny } = this;
    const ex = this.ex;
    const ey = this.ey;
    const hz = this.hz;
    const epsRGrid = this.epsRGrid;
    const sigmaGrid = this.sigmaGrid;
    const metal = this.metalMask;
    const sigma = this.pmlSigma;
    const loss = this.loss;
    const pmlMask = this.pmlMask;

    const invDx = 1 / Math.max(1e-9, this.dx);
    const invDy = 1 / Math.max(1e-9, this.dy);

    const mu = this.mu;
    const epsBase = this.eps;
    const dtOverMu = dt / mu;

    // PEC-like metal: zero fields in metal region
    if (metal) {
      for (let i = 0; i < metal.length; i += 1) {
        if (metal[i]) {
          ex[i] = 0;
          ey[i] = 0;
          hz[i] = 0;
        }
      }
    }

    // Update Hz from curl(E) with matched (approx) magnetic conductivity near boundaries.
    for (let y = 0; y < ny - 1; y += 1) {
      const row = y * nx;
      for (let x = 0; x < nx - 1; x += 1) {
        const idx = row + x;
        if (metal && metal[idx]) continue;

        const dEx_dy = (ex[idx + nx] - ex[idx]) * invDy;
        const dEy_dx = (ey[idx + 1] - ey[idx]) * invDx;
        const curlE = dEx_dy - dEy_dx;

        const epsCell = epsBase * epsRGrid[idx];
        const sigmaMat = sigmaGrid[idx];
        const sigmaE = (sigma ? sigma[idx] : 0) + sigmaMat + loss;
        const sigmaM = sigmaE * (mu / epsCell); // matched-layer approximation
        const denom = 1 + (sigmaM * dt) / (2 * mu);
        const ch1 = (1 - (sigmaM * dt) / (2 * mu)) / denom;
        const ch2 = dtOverMu / denom;
        hz[idx] = ch1 * hz[idx] + ch2 * curlE;
      }
    }

    // Source injection into Hz (soft source).
    if (this.sources.length) {
      const t = this.time;
      for (const source of this.sources) {
        const signal =
          source.amplitude *
          Math.sin(TAU * source.frequency * t + source.phase);
        hz[source.index] += signal;
      }
    }

    // Update Ex, Ey from curl(H) with electric conductivity.
    for (let y = 1; y < ny - 1; y += 1) {
      const row = y * nx;
      for (let x = 1; x < nx - 1; x += 1) {
        const idx = row + x;
        if (metal && metal[idx]) continue;

        const dHz_dy = (hz[idx] - hz[idx - nx]) * invDy;
        const dHz_dx = (hz[idx] - hz[idx - 1]) * invDx;

        const epsCell = epsBase * epsRGrid[idx];
        const dtOverEps = dt / epsCell;
        const sigmaMat = sigmaGrid[idx];
        const sigmaE = (sigma ? sigma[idx] : 0) + sigmaMat + loss;
        const denom = 1 + (sigmaE * dt) / (2 * epsCell);
        const ce1 = (1 - (sigmaE * dt) / (2 * epsCell)) / denom;
        const ce2 = dtOverEps / denom;

        // TEz-like updates:
        // Ex += (1/eps) * dHz/dy
        // Ey -= (1/eps) * dHz/dx
        ex[idx] = ce1 * ex[idx] + ce2 * dHz_dy;
        ey[idx] = ce1 * ey[idx] - ce2 * dHz_dx;
      }
    }

    // Sources: inject into selected field (Hz / Ex / Ey / rotated E).
    if (this.sources.length) {
      const t = this.time;
      for (const source of this.sources) {
        const idx = source.index;
        if (metal && metal[idx]) continue;
        if (pmlMask && pmlMask[idx]) continue;

        const s = source.amplitude * evalSourceSignal(source, t);
        const inj = source.injection;
        const excite = source.excite;

        if (excite === "hz") {
          if (inj === "hard") hz[idx] = s;
          else hz[idx] += s;
        } else if (excite === "ex") {
          if (inj === "hard") ex[idx] = s;
          else ex[idx] += s;
        } else if (excite === "ey") {
          if (inj === "hard") ey[idx] = s;
          else ey[idx] += s;
        } else {
          const a = (source.polarizationAngle * Math.PI) / 180;
          const sx = s * Math.cos(a);
          const sy = s * Math.sin(a);
          if (inj === "hard") {
            ex[idx] = sx;
            ey[idx] = sy;
          } else {
            ex[idx] += sx;
            ey[idx] += sy;
          }
        }
      }
    }

    // Hard boundary: zero fields at edges to keep things stable.
    for (let x = 0; x < nx; x += 1) {
      const top = x;
      const bottom = (ny - 1) * nx + x;
      ex[top] = 0;
      ey[top] = 0;
      hz[top] = 0;
      ex[bottom] = 0;
      ey[bottom] = 0;
      hz[bottom] = 0;
    }
    for (let y = 0; y < ny; y += 1) {
      const left = y * nx;
      const right = left + nx - 1;
      ex[left] = 0;
      ey[left] = 0;
      hz[left] = 0;
      ex[right] = 0;
      ey[right] = 0;
      hz[right] = 0;
    }

    // Compute magnitudes + stats
    const alpha = Math.min(1, dt / this.avgTau);
    const avgPower = this.avgPower;
    const avgMagnitude = this.avgMagnitude;
    const instant = this.instantaneous;
    let max = 0;
    let sum = 0;

    for (let i = 0; i < instant.length; i += 1) {
      if (pmlMask && pmlMask[i]) {
        avgPower[i] = 0;
        avgMagnitude[i] = 0;
        instant[i] = 0;
        continue;
      }
      const e2 = ex[i] * ex[i] + ey[i] * ey[i];
      const value = Math.sqrt(e2);
      const power = value * value;

      const nextAvg = avgPower[i] + alpha * (power - avgPower[i]);
      avgPower[i] = nextAvg;
      avgMagnitude[i] = Math.sqrt(nextAvg);
      instant[i] = value;

      if (value > max) {
        max = value;
      }
      sum += value;
    }

    this.time += dt;
    this.stats = {
      time: this.time,
      maxInstantaneous: max,
      meanInstantaneous: sum / instant.length
    };
  }
}

/**
 * Evaluate a source signal.
 * - cw: sin(2π f t + phase)
 * - gaussian: exp(-0.5*((t-t0)/w)^2) * sin(2π f (t-t0) + phase)
 * - ricker: (1 - 2 a^2) exp(-a^2), a = π f (t-t0)
 *
 * @param {{ waveform?: string, frequency: number, phase: number, pulseWidth?: number, pulseDelay?: number }} source
 * @param {number} t
 */
function evalSourceSignal(source, t) {
  const f = Math.max(0, Number.isFinite(source.frequency) ? source.frequency : 0);
  const phase = Number.isFinite(source.phase) ? source.phase : 0;
  const t0 = Number.isFinite(source.pulseDelay) ? source.pulseDelay : 0;
  const w = Math.max(1e-6, Number.isFinite(source.pulseWidth) ? source.pulseWidth : 0.4);
  const tau = t - t0;
  const kind = source.waveform || "cw";

  if (kind === "gaussian") {
    const env = Math.exp(-0.5 * (tau / w) * (tau / w));
    return env * Math.sin(TAU * f * tau + phase);
  }
  if (kind === "ricker") {
    // Phase as a tiny time shift for consistency.
    const phaseShift = f > 0 ? phase / (TAU * f) : 0;
    const tt = tau + phaseShift;
    const a = Math.PI * f * tt;
    const a2 = a * a;
    return (1 - 2 * a2) * Math.exp(-a2);
  }
  return Math.sin(TAU * f * t + phase);
}

/**
 * @param {SimulationState} state
 * @returns {WaveSolver2D | EMSolver2D}
 */
export function createSolverFromState(state) {
  const solver =
    state.simulation.model === "em2d"
      ? new EMSolver2D({
          domain: state.domain,
          solver: state.simulation.solver
        })
      : new WaveSolver2D({
    domain: state.domain,
    solver: state.simulation.solver
  });
  solver.setSources(state.sources);
  solver.setBarrierFromShapes(state.shapes);
  return solver;
}

/**
 * @param {SimulationState["domain"]} domain
 * @param {number} nx
 * @param {number} ny
 * @param {import("./types.js").ShapeObject[]} shapes
 * @returns {Uint8Array | null}
 */
function buildBarrierMask(domain, nx, ny, shapes) {
  if (!shapes || shapes.length === 0) {
    return null;
  }
  const mask = new Uint8Array(nx * ny);
  const { origin, worldSize } = domain;
  const dx = worldSize.x / Math.max(1, nx - 1);
  const dy = worldSize.y / Math.max(1, ny - 1);

  for (const shape of shapes) {
    if (shape.kind === "circle") {
      const radius = Math.max(0, shape.radius ?? 0);
      if (radius <= 0) continue;
      const minX = shape.center.x - radius;
      const maxX = shape.center.x + radius;
      const minY = shape.center.y - radius;
      const maxY = shape.center.y + radius;

      const ix0 = clamp(Math.floor((minX - origin.x) / dx), 0, nx - 1);
      const ix1 = clamp(Math.ceil((maxX - origin.x) / dx), 0, nx - 1);
      const iy0 = clamp(Math.floor((minY - origin.y) / dy), 0, ny - 1);
      const iy1 = clamp(Math.ceil((maxY - origin.y) / dy), 0, ny - 1);

      const r2 = radius * radius;
      for (let y = iy0; y <= iy1; y += 1) {
        const wy = origin.y + y * dy;
        const dyc = wy - shape.center.y;
        for (let x = ix0; x <= ix1; x += 1) {
          const wx = origin.x + x * dx;
          const dxc = wx - shape.center.x;
          if (dxc * dxc + dyc * dyc <= r2) {
            mask[y * nx + x] = 1;
          }
        }
      }
    } else if (shape.kind === "rectangle" && shape.size) {
      const halfW = shape.size.width * 0.5;
      const halfH = shape.size.height * 0.5;
      if (halfW <= 0 || halfH <= 0) continue;

      const angle = ((shape.angles?.z ?? 0) * Math.PI) / 180;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      const radius = Math.hypot(halfW, halfH);
      const minX = shape.center.x - radius;
      const maxX = shape.center.x + radius;
      const minY = shape.center.y - radius;
      const maxY = shape.center.y + radius;

      const ix0 = clamp(Math.floor((minX - origin.x) / dx), 0, nx - 1);
      const ix1 = clamp(Math.ceil((maxX - origin.x) / dx), 0, nx - 1);
      const iy0 = clamp(Math.floor((minY - origin.y) / dy), 0, ny - 1);
      const iy1 = clamp(Math.ceil((maxY - origin.y) / dy), 0, ny - 1);

      for (let y = iy0; y <= iy1; y += 1) {
        const wy = origin.y + y * dy;
        const dyc = wy - shape.center.y;
        for (let x = ix0; x <= ix1; x += 1) {
          const wx = origin.x + x * dx;
          const dxc = wx - shape.center.x;

          const localX = cosA * dxc + sinA * dyc;
          const localY = -sinA * dxc + cosA * dyc;

          if (Math.abs(localX) <= halfW && Math.abs(localY) <= halfH) {
            mask[y * nx + x] = 1;
          }
        }
      }
    }
  }

  return mask;
}

/**
 * Build material grids for EM:
 * - epsR: relative permittivity
 * - sigma: conductivity-like loss (normalized)
 * - metalMask: PEC-like cells
 * Later shapes overwrite earlier ones.
 *
 * @param {SimulationState["domain"]} domain
 * @param {number} nx
 * @param {number} ny
 * @param {import("./types.js").ShapeObject[]} shapes
 * @returns {{ epsR: Float32Array, sigma: Float32Array, metalMask: Uint8Array | null } | null}
 */
function buildMaterialGrids(domain, nx, ny, shapes) {
  if (!shapes || shapes.length === 0) {
    return null;
  }
  const epsR = new Float32Array(nx * ny);
  const sigma = new Float32Array(nx * ny);
  epsR.fill(1);
  sigma.fill(0);
  /** @type {Uint8Array | null} */
  let metalMask = null;

  const { origin, worldSize } = domain;
  const dx = worldSize.x / Math.max(1, nx - 1);
  const dy = worldSize.y / Math.max(1, ny - 1);

  for (const shape of shapes) {
    const mat = shape.material || { preset: "drywall", epsR: 2.7, sigma: 0.02 };
    const epsVal = clamp(mat.epsR ?? 1, 1, 20);
    const sigVal = clamp(mat.sigma ?? 0, 0, 200);
    const isMetal = mat.preset === "metal";
    if (isMetal && !metalMask) {
      metalMask = new Uint8Array(nx * ny);
    }

    if (shape.kind === "circle") {
      const radius = Math.max(0, shape.radius ?? 0);
      if (radius <= 0) continue;
      const minX = shape.center.x - radius;
      const maxX = shape.center.x + radius;
      const minY = shape.center.y - radius;
      const maxY = shape.center.y + radius;

      const ix0 = clamp(Math.floor((minX - origin.x) / dx), 0, nx - 1);
      const ix1 = clamp(Math.ceil((maxX - origin.x) / dx), 0, nx - 1);
      const iy0 = clamp(Math.floor((minY - origin.y) / dy), 0, ny - 1);
      const iy1 = clamp(Math.ceil((maxY - origin.y) / dy), 0, ny - 1);

      const r2 = radius * radius;
      for (let y = iy0; y <= iy1; y += 1) {
        const wy = origin.y + y * dy;
        const dyc = wy - shape.center.y;
        for (let x = ix0; x <= ix1; x += 1) {
          const wx = origin.x + x * dx;
          const dxc = wx - shape.center.x;
          if (dxc * dxc + dyc * dyc <= r2) {
            const idx = y * nx + x;
            epsR[idx] = epsVal;
            sigma[idx] = sigVal;
            if (metalMask) {
              metalMask[idx] = isMetal ? 1 : 0;
            }
          }
        }
      }
    } else if (shape.kind === "rectangle" && shape.size) {
      const halfW = shape.size.width * 0.5;
      const halfH = shape.size.height * 0.5;
      if (halfW <= 0 || halfH <= 0) continue;

      const angle = ((shape.angles?.z ?? 0) * Math.PI) / 180;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      const radius = Math.hypot(halfW, halfH);
      const minX = shape.center.x - radius;
      const maxX = shape.center.x + radius;
      const minY = shape.center.y - radius;
      const maxY = shape.center.y + radius;

      const ix0 = clamp(Math.floor((minX - origin.x) / dx), 0, nx - 1);
      const ix1 = clamp(Math.ceil((maxX - origin.x) / dx), 0, nx - 1);
      const iy0 = clamp(Math.floor((minY - origin.y) / dy), 0, ny - 1);
      const iy1 = clamp(Math.ceil((maxY - origin.y) / dy), 0, ny - 1);

      for (let y = iy0; y <= iy1; y += 1) {
        const wy = origin.y + y * dy;
        const dyc = wy - shape.center.y;
        for (let x = ix0; x <= ix1; x += 1) {
          const wx = origin.x + x * dx;
          const dxc = wx - shape.center.x;

          const localX = cosA * dxc + sinA * dyc;
          const localY = -sinA * dxc + cosA * dyc;

          if (Math.abs(localX) <= halfW && Math.abs(localY) <= halfH) {
            const idx = y * nx + x;
            epsR[idx] = epsVal;
            sigma[idx] = sigVal;
            if (metalMask) {
              metalMask[idx] = isMetal ? 1 : 0;
            }
          }
        }
      }
    }
  }

  return { epsR, sigma, metalMask };
}

/**
 * @param {{ x: number, y: number, z?: number }} position
 * @param {SimulationState["domain"]} domain
 * @param {number} nx
 * @param {number} ny
 * @returns {number}
 */
function indexFromWorld(position, domain, nx, ny) {
  const { origin, worldSize } = domain;
  const xNorm = (position.x - origin.x) / worldSize.x;
  const yNorm = (position.y - origin.y) / worldSize.y;
  const ix = Math.min(nx - 1, Math.max(0, Math.round(xNorm * (nx - 1))));
  const iy = Math.min(ny - 1, Math.max(0, Math.round(yNorm * (ny - 1))));
  return iy * nx + ix;
}

/**
 * @param {number} nx
 * @param {number} ny
 * @param {number} width
 * @param {number} dx
 * @param {number} dy
 * @param {number} waveSpeed
 * @returns {Float32Array | null}
 */
function buildPmlSigma(nx, ny, width, dx, dy, waveSpeed) {
  if (width <= 0) return null;
  const sigma = new Float32Array(nx * ny);
  const p = 3;
  const targetReflection = 1e-6;
  const thickness = width * Math.min(dx, dy);
  const sigmaMax =
    ((p + 1) * Math.log(1 / targetReflection) * waveSpeed) / (2 * thickness);

  for (let y = 0; y < ny; y += 1) {
    const distY = Math.min(y, ny - 1 - y);
    const rampY = distY < width ? (width - distY) / width : 0;
    for (let x = 0; x < nx; x += 1) {
      const distX = Math.min(x, nx - 1 - x);
      const rampX = distX < width ? (width - distX) / width : 0;
      const sigmaVal = sigmaMax * (Math.pow(rampX, p) + Math.pow(rampY, p));
      sigma[y * nx + x] = sigmaVal;
    }
  }
  return sigma;
}

/**
 * @param {number} nx
 * @param {number} ny
 * @param {number} width
 * @returns {Uint8Array | null}
 */
function buildPmlMask(nx, ny, width) {
  if (width <= 0) return null;
  const mask = new Uint8Array(nx * ny);
  for (let y = 0; y < ny; y += 1) {
    const distY = Math.min(y, ny - 1 - y);
    for (let x = 0; x < nx; x += 1) {
      const distX = Math.min(x, nx - 1 - x);
      if (distX < width || distY < width) {
        mask[y * nx + x] = 1;
      }
    }
  }
  return mask;
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
