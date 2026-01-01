// @ts-check

import { buildPalette, samplePalette } from "./palette.js";

/** @typedef {import("./types.js").SimulationState} SimulationState */

const MIN_DISTANCE = 0.5;
const MAX_DISTANCE = 200;

export class Renderer3D {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl", { antialias: true });
    if (!gl) {
      throw new Error("WebGL is not available.");
    }
    this.gl = gl;

    this.program = createProgram(gl, vertexShaderSource, fragmentShaderSource);
    this.attribs = {
      position: gl.getAttribLocation(this.program, "a_position"),
      color: gl.getAttribLocation(this.program, "a_color")
    };
    this.uniforms = {
      matrix: gl.getUniformLocation(this.program, "u_matrix"),
      alpha: gl.getUniformLocation(this.program, "u_alpha")
    };

    this.positionBuffer = gl.createBuffer();
    this.colorBuffer = gl.createBuffer();
    this.indexBuffer = gl.createBuffer();
    // 3D solids are rendered in two passes:
    // - walls (depth-tested, alpha blended) so waves can be seen "through" walls
    // - sources (overlay, no depth test) so markers remain visible
    this.wallPositionBuffer = gl.createBuffer();
    this.wallColorBuffer = gl.createBuffer();
    this.wallIndexBuffer = gl.createBuffer();
    this.sourcePositionBuffer = gl.createBuffer();
    this.sourceColorBuffer = gl.createBuffer();
    this.sourceIndexBuffer = gl.createBuffer();

    this.palette = buildPalette();

    this.meshKey = "";
    this.indexCount = 0;
    this.indexType = gl.UNSIGNED_SHORT;
    this.positions = null;
    this.colors = null;
    this.wallIndexCount = 0;
    this.wallIndexType = gl.UNSIGNED_SHORT;
    this.sourceIndexCount = 0;
    this.sourceIndexType = gl.UNSIGNED_SHORT;
    this.solidKey = "";

    // Add mesh update throttling
    this.lastMeshUpdateTime = 0;
    this.meshUpdateInterval = 1000 / 30; // 30 Hz
    
    // Store solver dimensions for verification
    this.solverNx = 0;
    this.solverNy = 0;
    this.renderNx = 0;
    this.renderNy = 0;
    this.meshVertexCount = 0;
    this.needsDownsampling = false;
    this._loggedUpdate = false;

    this.state = null;
    this.orbit = {
      yaw: -Math.PI * 0.25,
      pitch: Math.PI * 0.2,
      distance: 10,
      center: { x: 0, y: 0, z: 0 }
    };
    this.orbitKey = "";

    this.drag = null;
    this.needsResize = true;

    canvas.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    canvas.addEventListener("pointermove", (event) => this.onPointerMove(event));
    canvas.addEventListener("pointerup", (event) => this.onPointerUp(event));
    canvas.addEventListener("pointerleave", (event) => this.onPointerUp(event));
    canvas.addEventListener("wheel", (event) => this.onWheel(event), { passive: false });
    window.addEventListener("resize", () => {
      this.needsResize = true;
    });
  }

  /**
   * @param {SimulationState} state
   */
  setState(state) {
    this.state = state;
    this.ensureOrbit();
  }

  /**
   * @param {import("./solver.js").WaveSolver2D} solver
   */
  render(solver) {
    if (!this.state || this.state.visualization.mode !== "3d") {
      return;
    }

    this.resizeIfNeeded();
    this.ensureMesh(solver);

    const output =
      this.state.visualization.output === "averaged"
        ? solver.getAveragedMagnitude()
        : solver.getInstantaneousMagnitude();

    const zScale = Number.isFinite(this.state.visualization.surface.zScale)
      ? this.state.visualization.surface.zScale
      : 1;

    // Throttle mesh updates for performance
    const now = performance.now();
    if (now - this.lastMeshUpdateTime >= this.meshUpdateInterval) {
    this.updateSurface(output, zScale);
      this.lastMeshUpdateTime = now;
    }

    this.drawScene();
    this.updateSolidsIfNeeded();
    this.drawWalls();
    this.drawSources();
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

  ensureOrbit() {
    if (!this.state) {
      return;
    }
    const domain = this.state.domain;
    const key = `${domain.origin.x}-${domain.origin.y}-${domain.worldSize.x}-${domain.worldSize.y}`;
    if (key === this.orbitKey) {
      return;
    }
    this.orbitKey = key;
    const size = Math.max(domain.worldSize.x, domain.worldSize.y);
    this.orbit = {
      yaw: -Math.PI * 0.3,
      pitch: Math.PI * 0.25,
      distance: size * 1.6,
      center: {
        x: domain.origin.x + domain.worldSize.x * 0.5,
        y: domain.origin.y + domain.worldSize.y * 0.5,
        z: 0
      }
    };
  }

  /**
   * @param {import("./solver.js").WaveSolver2D} solver
   */
  ensureMesh(solver) {
    if (!this.state) {
      return;
    }
    const domain = this.state.domain;
    const key = `${solver.nx}-${solver.ny}-${domain.origin.x}-${domain.origin.y}-${domain.worldSize.x}-${domain.worldSize.y}`;
    if (key === this.meshKey) {
      return;
    }
    this.meshKey = key;

    // Store solver dimensions
    const solverNx = solver.nx;
    const solverNy = solver.ny;
    const solverVertexCount = solverNx * solverNy;
    
    // Log for debugging
    console.log(`[Renderer3D] Solver grid: nx=${solverNx}, ny=${solverNy}, vertexCount=${solverVertexCount}`);
    
    // Downsample grid for 3D rendering to maintain performance and avoid index buffer limits
    const maxVertices = 65535; // 16-bit index buffer limit
    const maxGridSize = 255; // Max grid dimension: 255*255 = 65,025 < 65535
    
    let renderNx = solverNx;
    let renderNy = solverNy;
    let needsDownsampling = false;
    
    // Calculate downsampling if needed
    if (solverVertexCount > maxVertices) {
      needsDownsampling = true;
      const aspect = solverNx / solverNy;
      if (aspect >= 1) {
        renderNx = maxGridSize;
        renderNy = Math.max(2, Math.floor(maxGridSize / aspect));
      } else {
        renderNy = maxGridSize;
        renderNx = Math.max(2, Math.floor(maxGridSize * aspect));
      }
      console.log(`[Renderer3D] Downsampling mesh: renderNx=${renderNx}, renderNy=${renderNy} (from ${solverNx}x${solverNy})`);
    }
    
    const renderVertexCount = renderNx * renderNy;
    if (renderVertexCount > maxVertices) {
      throw new Error(`Grid too large for index buffer: ${renderVertexCount} vertices (max: ${maxVertices}).`);
    }

    const positions = new Float32Array(renderVertexCount * 3);
    const colors = new Float32Array(renderVertexCount * 3);

    const dx = domain.worldSize.x / Math.max(1, renderNx - 1);
    const dy = domain.worldSize.y / Math.max(1, renderNy - 1);

    for (let y = 0; y < renderNy; y += 1) {
      for (let x = 0; x < renderNx; x += 1) {
        const idx = y * renderNx + x;
        const offset = idx * 3;
        positions[offset] = domain.origin.x + x * dx;
        positions[offset + 1] = domain.origin.y + y * dy;
        positions[offset + 2] = 0;
        colors[offset] = 0;
        colors[offset + 1] = 0;
        colors[offset + 2] = 0;
      }
    }

    const indices = new Uint16Array((renderNx - 1) * (renderNy - 1) * 6);
    let idx = 0;
    for (let y = 0; y < renderNy - 1; y += 1) {
      for (let x = 0; x < renderNx - 1; x += 1) {
        const i0 = y * renderNx + x;
        const i1 = i0 + 1;
        const i2 = i0 + renderNx;
        const i3 = i2 + 1;

        indices[idx++] = i0;
        indices[idx++] = i2;
        indices[idx++] = i1;
        indices[idx++] = i1;
        indices[idx++] = i2;
        indices[idx++] = i3;
      }
    }

    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    this.positions = positions;
    this.colors = colors;
    this.indexCount = indices.length;
    this.solverNx = solverNx;
    this.solverNy = solverNy;
    this.renderNx = renderNx;
    this.renderNy = renderNy;
    this.meshVertexCount = renderVertexCount;
    this.needsDownsampling = needsDownsampling;
  }

  /**
   * @param {Float32Array} output
   * @param {number} zScale
   */
  updateSurface(output, zScale) {
    if (!this.positions || !this.colors) {
      return 0;
    }
    
    // Verify field length matches solver dimensions
    const solverFieldLength = output.length;
    const expectedSolverLength = this.solverNx * this.solverNy;
    const renderNx = this.renderNx || this.solverNx;
    const renderNy = this.renderNy || this.solverNy;
    const renderVertexCount = this.meshVertexCount || (renderNx * renderNy);
    
    // Log for debugging (only first time or on mismatch)
    if (!this._loggedUpdate || solverFieldLength !== expectedSolverLength) {
      console.log(`[Renderer3D] updateSurface: solverField.length=${solverFieldLength}, expectedSolver=${expectedSolverLength}, renderMesh=${renderVertexCount}, downsampling=${this.needsDownsampling || false}`);
      this._loggedUpdate = true;
    }
    
    if (solverFieldLength !== expectedSolverLength) {
      console.error(`[Renderer3D] Mismatch detected! Solver field length (${solverFieldLength}) does not match expected (${expectedSolverLength}). Rebuilding mesh required.`);
      // Don't update - mesh needs to be rebuilt
      return 0;
    }
    
    // Find max value from solver output
    let maxValue = 0;
    for (let i = 0; i < solverFieldLength; i += 1) {
      const value = output[i];
      if (Number.isFinite(value) && value > maxValue) {
        maxValue = value;
      }
    }

    const scale = maxValue > 0 ? 1 / maxValue : 1;

    if (this.needsDownsampling) {
      // Sample from full-resolution solver output to downsampled mesh
      for (let y = 0; y < renderNy; y += 1) {
        for (let x = 0; x < renderNx; x += 1) {
          // Map render grid coordinates to solver grid coordinates
          const solverX = Math.floor((x / (renderNx - 1)) * (this.solverNx - 1));
          const solverY = Math.floor((y / (renderNy - 1)) * (this.solverNy - 1));
          const solverIdx = solverY * this.solverNx + solverX;
          
          if (solverIdx >= solverFieldLength) {
            continue; // Safety check
          }
          
          const value = output[solverIdx];
          if (!Number.isFinite(value)) {
            continue; // Skip NaN/Inf values
          }
          
          const renderIdx = y * renderNx + x;
          const offset = renderIdx * 3;
          this.positions[offset + 2] = value * zScale;

          const t = Math.min(1, Math.pow(value * scale, 0.6));
          const color = samplePalette(this.palette, t);
          this.colors[offset] = color[0] / 255;
          this.colors[offset + 1] = color[1] / 255;
          this.colors[offset + 2] = color[2] / 255;
        }
      }
    } else {
      // Direct mapping - no downsampling needed
      for (let i = 0; i < renderVertexCount; i += 1) {
        if (i >= solverFieldLength) {
          break; // Safety check
        }
      const value = output[i];
        if (!Number.isFinite(value)) {
          continue; // Skip NaN/Inf values
        }
      const offset = i * 3;
      this.positions[offset + 2] = value * zScale;

      const t = Math.min(1, Math.pow(value * scale, 0.6));
      const color = samplePalette(this.palette, t);
      this.colors[offset] = color[0] / 255;
      this.colors[offset + 1] = color[1] / 255;
      this.colors[offset + 2] = color[2] / 255;
      }
    }

    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.positions);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.colors);

    return maxValue;
  }

  drawScene() {
    const gl = this.gl;

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.depthMask(true);

    gl.useProgram(this.program);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.enableVertexAttribArray(this.attribs.position);
    gl.vertexAttribPointer(this.attribs.position, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    gl.enableVertexAttribArray(this.attribs.color);
    gl.vertexAttribPointer(this.attribs.color, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);

    const matrix = this.computeViewProjection();
    if (this.uniforms.matrix) {
      gl.uniformMatrix4fv(this.uniforms.matrix, false, matrix);
    }
    if (this.uniforms.alpha) {
      gl.uniform1f(this.uniforms.alpha, 1);
    }

    gl.drawElements(gl.TRIANGLES, this.indexCount, this.indexType, 0);
  }

  updateSolidsIfNeeded() {
    if (!this.state) {
      return;
    }
    const nextKey = JSON.stringify({
      shapes: this.state.shapes,
      sources: this.state.sources
    });
    if (nextKey === this.solidKey) {
      return;
    }
    this.solidKey = nextKey;
    const wallGeometry = buildWallGeometry(this.state);
    const sourceGeometry = buildSourceGeometry(this.state);
    this.uploadGeometry(this.wallPositionBuffer, this.wallColorBuffer, this.wallIndexBuffer, wallGeometry);
    this.uploadGeometry(
      this.sourcePositionBuffer,
      this.sourceColorBuffer,
      this.sourceIndexBuffer,
      sourceGeometry
    );
    this.wallIndexCount = wallGeometry.indices.length;
    this.sourceIndexCount = sourceGeometry.indices.length;
  }

  /**
   * @param {WebGLBuffer | null} positionBuffer
   * @param {WebGLBuffer | null} colorBuffer
   * @param {WebGLBuffer | null} indexBuffer
   * @param {{ positions: Float32Array, colors: Float32Array, indices: Uint16Array }} geometry
   */
  uploadGeometry(positionBuffer, colorBuffer, indexBuffer, geometry) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, geometry.positions, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, geometry.colors, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geometry.indices, gl.STATIC_DRAW);
  }

  drawWalls() {
    if (this.wallIndexCount === 0) {
      return;
    }
    const gl = this.gl;
    gl.useProgram(this.program);

    // X-ray walls: depth-tested + alpha blended, without writing depth.
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.wallPositionBuffer);
    gl.enableVertexAttribArray(this.attribs.position);
    gl.vertexAttribPointer(this.attribs.position, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.wallColorBuffer);
    gl.enableVertexAttribArray(this.attribs.color);
    gl.vertexAttribPointer(this.attribs.color, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.wallIndexBuffer);

    const matrix = this.computeViewProjection();
    if (this.uniforms.matrix) {
      gl.uniformMatrix4fv(this.uniforms.matrix, false, matrix);
    }
    if (this.uniforms.alpha) {
      gl.uniform1f(this.uniforms.alpha, 0.28);
    }

    gl.drawElements(gl.TRIANGLES, this.wallIndexCount, this.wallIndexType, 0);
  }

  drawSources() {
    if (this.sourceIndexCount === 0) {
      return;
    }
    const gl = this.gl;
    gl.useProgram(this.program);

    // Sources as overlay: always visible.
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.sourcePositionBuffer);
    gl.enableVertexAttribArray(this.attribs.position);
    gl.vertexAttribPointer(this.attribs.position, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.sourceColorBuffer);
    gl.enableVertexAttribArray(this.attribs.color);
    gl.vertexAttribPointer(this.attribs.color, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.sourceIndexBuffer);

    const matrix = this.computeViewProjection();
    if (this.uniforms.matrix) {
      gl.uniformMatrix4fv(this.uniforms.matrix, false, matrix);
    }
    if (this.uniforms.alpha) {
      gl.uniform1f(this.uniforms.alpha, 1);
    }

    gl.drawElements(gl.TRIANGLES, this.sourceIndexCount, this.sourceIndexType, 0);
  }

  computeViewProjection() {
    const proj = new Float32Array(16);
    const view = new Float32Array(16);
    const viewProj = new Float32Array(16);

    const aspect = this.canvas.width / this.canvas.height;
    const fov = Math.PI / 4;
    const near = 0.05;
    const far = Math.max(50, this.orbit.distance * 6);

    mat4Perspective(proj, fov, aspect, near, far);
    const eye = computeOrbitEye(this.orbit);
    mat4LookAt(view, eye, this.orbit.center, { x: 0, y: 0, z: 1 });
    mat4Multiply(viewProj, proj, view);

    return viewProj;
  }

  /**
   * @param {PointerEvent} event
   */
  onPointerDown(event) {
    if (!this.state || this.state.visualization.mode !== "3d") {
      return;
    }
    if (event.button !== 0) {
      return;
    }
    this.drag = {
      startX: event.clientX,
      startY: event.clientY,
      yaw: this.orbit.yaw,
      pitch: this.orbit.pitch
    };
    this.canvas.setPointerCapture(event.pointerId);
  }

  /**
   * @param {PointerEvent} event
   */
  onPointerMove(event) {
    if (!this.drag || !this.state || this.state.visualization.mode !== "3d") {
      return;
    }
    const dx = event.clientX - this.drag.startX;
    const dy = event.clientY - this.drag.startY;
    const sensitivity = 0.005;

    this.orbit.yaw = this.drag.yaw - dx * sensitivity;
    this.orbit.pitch = clamp(
      this.drag.pitch - dy * sensitivity,
      -Math.PI * 0.45,
      Math.PI * 0.45
    );
  }

  /**
   * @param {PointerEvent} event
   */
  onPointerUp(event) {
    if (!this.drag) {
      return;
    }
    this.drag = null;
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
    if (!this.state || this.state.visualization.mode !== "3d") {
      return;
    }
    event.preventDefault();
    const factor = Math.exp(event.deltaY * 0.001);
    this.orbit.distance = clamp(
      this.orbit.distance * factor,
      MIN_DISTANCE,
      MAX_DISTANCE
    );
  }
}

const vertexShaderSource = `
  attribute vec3 a_position;
  attribute vec3 a_color;
  uniform mat4 u_matrix;
  uniform float u_alpha;
  varying vec3 v_color;
  void main() {
    gl_Position = u_matrix * vec4(a_position, 1.0);
    v_color = a_color;
  }
`;

const fragmentShaderSource = `
  precision mediump float;
  varying vec3 v_color;
  uniform float u_alpha;
  void main() {
    gl_FragColor = vec4(v_color, u_alpha);
  }
`;

/**
 * @param {WebGLRenderingContext} gl
 * @param {string} vsSource
 * @param {string} fsSource
 */
function createProgram(gl, vsSource, fsSource) {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vsSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fsSource);

  const program = gl.createProgram();
  if (!program) {
    throw new Error("Unable to create WebGL program.");
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`WebGL program link failed: ${info}`);
  }

  return program;
}

/**
 * @param {WebGLRenderingContext} gl
 * @param {number} type
 * @param {string} source
 */
function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error("Unable to create WebGL shader.");
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`WebGL shader compile failed: ${info}`);
  }
  return shader;
}

/**
 * @param {{ yaw: number, pitch: number, distance: number, center: { x: number, y: number, z: number } }} orbit
 */
function computeOrbitEye(orbit) {
  const cosPitch = Math.cos(orbit.pitch);
  const sinPitch = Math.sin(orbit.pitch);
  const cosYaw = Math.cos(orbit.yaw);
  const sinYaw = Math.sin(orbit.yaw);

  return {
    x: orbit.center.x + orbit.distance * cosPitch * cosYaw,
    y: orbit.center.y + orbit.distance * cosPitch * sinYaw,
    z: orbit.center.z + orbit.distance * sinPitch
  };
}

/**
 * @param {Float32Array} out
 * @param {number} fovy
 * @param {number} aspect
 * @param {number} near
 * @param {number} far
 */
function mat4Perspective(out, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  out[0] = f / aspect;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  out[4] = 0;
  out[5] = f;
  out[6] = 0;
  out[7] = 0;
  out[8] = 0;
  out[9] = 0;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[12] = 0;
  out[13] = 0;
  out[14] = (2 * far * near) / (near - far);
  out[15] = 0;
}

/**
 * @param {Float32Array} out
 * @param {{ x: number, y: number, z: number }} eye
 * @param {{ x: number, y: number, z: number }} center
 * @param {{ x: number, y: number, z: number }} up
 */
function mat4LookAt(out, eye, center, up) {
  let zx = eye.x - center.x;
  let zy = eye.y - center.y;
  let zz = eye.z - center.z;

  let len = Math.hypot(zx, zy, zz);
  if (len === 0) {
    zz = 1;
    len = 1;
  }
  zx /= len;
  zy /= len;
  zz /= len;

  let xx = up.y * zz - up.z * zy;
  let xy = up.z * zx - up.x * zz;
  let xz = up.x * zy - up.y * zx;

  len = Math.hypot(xx, xy, xz);
  if (len === 0) {
    xx = 1;
    len = 1;
  }
  xx /= len;
  xy /= len;
  xz /= len;

  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  out[0] = xx;
  out[1] = yx;
  out[2] = zx;
  out[3] = 0;
  out[4] = xy;
  out[5] = yy;
  out[6] = zy;
  out[7] = 0;
  out[8] = xz;
  out[9] = yz;
  out[10] = zz;
  out[11] = 0;
  out[12] = -(xx * eye.x + xy * eye.y + xz * eye.z);
  out[13] = -(yx * eye.x + yy * eye.y + yz * eye.z);
  out[14] = -(zx * eye.x + zy * eye.y + zz * eye.z);
  out[15] = 1;
}

/**
 * @param {Float32Array} out
 * @param {Float32Array} a
 * @param {Float32Array} b
 */
function mat4Multiply(out, a, b) {
  for (let i = 0; i < 4; i += 1) {
    const bi0 = b[i * 4];
    const bi1 = b[i * 4 + 1];
    const bi2 = b[i * 4 + 2];
    const bi3 = b[i * 4 + 3];

    out[i * 4] = a[0] * bi0 + a[4] * bi1 + a[8] * bi2 + a[12] * bi3;
    out[i * 4 + 1] = a[1] * bi0 + a[5] * bi1 + a[9] * bi2 + a[13] * bi3;
    out[i * 4 + 2] = a[2] * bi0 + a[6] * bi1 + a[10] * bi2 + a[14] * bi3;
    out[i * 4 + 3] = a[3] * bi0 + a[7] * bi1 + a[11] * bi2 + a[15] * bi3;
  }
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
 * @param {SimulationState} state
 * @returns {{ positions: Float32Array, colors: Float32Array, indices: Uint16Array }}
 */
function buildWallGeometry(state) {
  const positions = [];
  const colors = [];
  const indices = [];
  let indexOffset = 0;
  const shapeColor = [0.2, 0.2, 0.2];
  const zOffset = 0.002;

  for (const shape of state.shapes) {
    if (shape.kind === "rectangle" && shape.size) {
      const width = Math.max(0.01, shape.size.width);
      const depth = Math.max(0.01, shape.size.height);
      const height = Math.max(0.01, shape.height ?? 1);
      const angle = ((shape.angles?.z ?? 0) * Math.PI) / 180;
      addBox(
        positions,
        colors,
        indices,
        {
          x: shape.center.x,
          y: shape.center.y,
          z: height * 0.5 + zOffset
        },
        { x: width, y: depth, z: height },
        angle,
        shapeColor,
        indexOffset
      );
      indexOffset = positions.length / 3;
    } else if (shape.kind === "circle") {
      const radius = Math.max(0.01, shape.radius ?? 0);
      const height = Math.max(0.01, shape.height ?? 1);
      addCylinder(
        positions,
        colors,
        indices,
        {
          x: shape.center.x,
          y: shape.center.y,
          z: height * 0.5 + zOffset
        },
        radius,
        height,
        shapeColor,
        indexOffset
      );
      indexOffset = positions.length / 3;
    }
  }

  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    indices: new Uint16Array(indices)
  };
}

/**
 * @param {SimulationState} state
 * @returns {{ positions: Float32Array, colors: Float32Array, indices: Uint16Array }}
 */
function buildSourceGeometry(state) {
  const positions = [];
  const colors = [];
  const indices = [];
  let indexOffset = 0;
  const sourceColor = [0.1, 0.4, 0.9];
  const zOffset = 0.002;

  // Use constant-size tiny sphere for sources (not scaling with domain)
  const sourceMarkerRadius = 0.05; // Constant world-space size, very small
  for (const source of state.sources) {
    if (!source.active) {
      continue;
    }
    addSphere(
      positions,
      colors,
      indices,
      {
        x: source.position.x,
        y: source.position.y,
        z: sourceMarkerRadius + zOffset
      },
      sourceMarkerRadius,
      sourceColor,
      indexOffset
    );
    indexOffset = positions.length / 3;
  }

  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    indices: new Uint16Array(indices)
  };
}

/**
 * @param {number[]} positions
 * @param {number[]} colors
 * @param {number[]} indices
 * @param {{ x: number, y: number, z: number }} center
 * @param {{ x: number, y: number, z: number }} size
 * @param {number} angle
 * @param {number[]} color
 * @param {number} indexOffset
 */
function addBox(positions, colors, indices, center, size, angle, color, indexOffset) {
  const hx = size.x * 0.5;
  const hy = size.y * 0.5;
  const hz = size.z * 0.5;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const corners = [
    [-hx, -hy, -hz],
    [hx, -hy, -hz],
    [hx, hy, -hz],
    [-hx, hy, -hz],
    [-hx, -hy, hz],
    [hx, -hy, hz],
    [hx, hy, hz],
    [-hx, hy, hz]
  ];

  for (const corner of corners) {
    const x = corner[0];
    const y = corner[1];
    const z = corner[2];
    const rx = cosA * x - sinA * y + center.x;
    const ry = sinA * x + cosA * y + center.y;
    positions.push(rx, ry, z + center.z);
    colors.push(color[0], color[1], color[2]);
  }

  const base = indexOffset;
  indices.push(
    base,
    base + 1,
    base + 2,
    base,
    base + 2,
    base + 3,
    base + 4,
    base + 6,
    base + 5,
    base + 4,
    base + 7,
    base + 6,
    base,
    base + 4,
    base + 5,
    base,
    base + 5,
    base + 1,
    base + 1,
    base + 5,
    base + 6,
    base + 1,
    base + 6,
    base + 2,
    base + 2,
    base + 6,
    base + 7,
    base + 2,
    base + 7,
    base + 3,
    base + 3,
    base + 7,
    base + 4,
    base + 3,
    base + 4,
    base
  );
}

/**
 * @param {number[]} positions
 * @param {number[]} colors
 * @param {number[]} indices
 * @param {{ x: number, y: number, z: number }} center
 * @param {number} radius
 * @param {number} height
 * @param {number[]} color
 * @param {number} indexOffset
 */
function addCylinder(
  positions,
  colors,
  indices,
  center,
  radius,
  height,
  color,
  indexOffset
) {
  const segments = 24;
  const hz = height * 0.5;

  for (let i = 0; i < segments; i += 1) {
    const theta = (i / segments) * Math.PI * 2;
    const x = Math.cos(theta) * radius + center.x;
    const y = Math.sin(theta) * radius + center.y;
    positions.push(x, y, center.z - hz);
    colors.push(color[0], color[1], color[2]);
    positions.push(x, y, center.z + hz);
    colors.push(color[0], color[1], color[2]);
  }

  const bottomCenterIndex = indexOffset + segments * 2;
  positions.push(center.x, center.y, center.z - hz);
  colors.push(color[0], color[1], color[2]);
  const topCenterIndex = bottomCenterIndex + 1;
  positions.push(center.x, center.y, center.z + hz);
  colors.push(color[0], color[1], color[2]);

  for (let i = 0; i < segments; i += 1) {
    const next = (i + 1) % segments;
    const bottomA = indexOffset + i * 2;
    const topA = bottomA + 1;
    const bottomB = indexOffset + next * 2;
    const topB = bottomB + 1;

    indices.push(bottomA, bottomB, topA);
    indices.push(topA, bottomB, topB);

    indices.push(bottomCenterIndex, bottomB, bottomA);
    indices.push(topCenterIndex, topA, topB);
  }
}

/**
 * @param {number[]} positions
 * @param {number[]} colors
 * @param {number[]} indices
 * @param {{ x: number, y: number, z: number }} center
 * @param {number} radius
 * @param {number[]} color
 * @param {number} indexOffset
 */
function addSphere(
  positions,
  colors,
  indices,
  center,
  radius,
  color,
  indexOffset
) {
  const segments = 16; // Lower detail for tiny marker
  const rings = 8;
  
  // Generate sphere vertices
  for (let ring = 0; ring <= rings; ring += 1) {
    const phi = (ring / rings) * Math.PI;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    
    for (let seg = 0; seg <= segments; seg += 1) {
      const theta = (seg / segments) * Math.PI * 2;
      const sinTheta = Math.sin(theta);
      const cosTheta = Math.cos(theta);
      
      const x = center.x + radius * sinPhi * cosTheta;
      const y = center.y + radius * sinPhi * sinTheta;
      const z = center.z + radius * cosPhi;
      
      positions.push(x, y, z);
      colors.push(color[0], color[1], color[2]);
    }
  }
  
  // Generate sphere indices
  for (let ring = 0; ring < rings; ring += 1) {
    const ringStart = indexOffset + ring * (segments + 1);
    const nextRingStart = indexOffset + (ring + 1) * (segments + 1);
    
    for (let seg = 0; seg < segments; seg += 1) {
      const current = ringStart + seg;
      const next = ringStart + seg + 1;
      const below = nextRingStart + seg;
      const belowNext = nextRingStart + seg + 1;
      
      indices.push(current, below, next);
      indices.push(next, below, belowNext);
    }
  }
}
