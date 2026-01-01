// @ts-check

/** @typedef {import("./types.js").SimulationState} SimulationState */

import { exportStateToFile, importStateFromFile } from "./persistence.js";
import { normalizeState } from "./state.js";

/**
 * @typedef {Object} UIHandles
 * @property {HTMLButtonElement} modeToggle
 * @property {HTMLButtonElement} outputToggle
 * @property {HTMLButtonElement} playToggle
 * @property {HTMLButtonElement} resetBtn
 * @property {HTMLButtonElement} exportBtn
 * @property {HTMLButtonElement} importBtn
 * @property {HTMLInputElement} importInput
 * @property {HTMLDivElement} viewportStatus
 * @property {HTMLButtonElement[]} toolButtons
 * @property {HTMLButtonElement} sourceSettingsBtn
 * @property {HTMLInputElement} domainWidthInput
 * @property {HTMLInputElement} domainHeightInput
 * @property {HTMLInputElement} snapToShapesCheckbox
 * @property {HTMLDivElement} sourceList
 * @property {HTMLDivElement} shapeList
 * @property {HTMLDivElement} propertiesPane
 */

/**
 * @returns {UIHandles}
 */
function getUIHandles() {
  const modeToggle = document.querySelector("#modeToggle");
  const outputToggle = document.querySelector("#outputToggle");
  const playToggle = document.querySelector("#playToggle");
  const resetBtn = document.querySelector("#resetSim");
  const exportBtn = document.querySelector("#exportBtn");
  const importBtn = document.querySelector("#importBtn");
  const importInput = document.querySelector("#importInput");
  const viewportStatus = document.querySelector("#viewportStatus");
  const toolButtons = Array.from(document.querySelectorAll("button[data-tool]"));
  const sourceSettingsBtn = document.querySelector("#sourceSettingsBtn");
  const domainWidthInput = document.querySelector("#domainWidthInput");
  const domainHeightInput = document.querySelector("#domainHeightInput");
  const snapToShapesCheckbox = document.querySelector("#snapToShapesCheckbox");
  const sourceList = document.querySelector("#sourceList");
  const shapeList = document.querySelector("#shapeList");
  const propertiesPane = document.querySelector("#propertiesPane");

  if (
    !(modeToggle instanceof HTMLButtonElement) ||
    !(outputToggle instanceof HTMLButtonElement) ||
    !(playToggle instanceof HTMLButtonElement) ||
    !(resetBtn instanceof HTMLButtonElement) ||
    !(exportBtn instanceof HTMLButtonElement) ||
    !(importBtn instanceof HTMLButtonElement) ||
    !(importInput instanceof HTMLInputElement) ||
    !(viewportStatus instanceof HTMLDivElement) ||
    !(sourceSettingsBtn instanceof HTMLButtonElement) ||
    !(domainWidthInput instanceof HTMLInputElement) ||
    !(domainHeightInput instanceof HTMLInputElement) ||
    !(snapToShapesCheckbox instanceof HTMLInputElement) ||
    !(sourceList instanceof HTMLDivElement) ||
    !(shapeList instanceof HTMLDivElement) ||
    !(propertiesPane instanceof HTMLDivElement)
  ) {
    throw new Error("UI elements not found.");
  }

  return {
    modeToggle,
    outputToggle,
    playToggle,
    resetBtn,
    exportBtn,
    importBtn,
    importInput,
    viewportStatus,
    toolButtons,
    sourceSettingsBtn,
    domainWidthInput,
    domainHeightInput,
    snapToShapesCheckbox,
    sourceList,
    shapeList,
    propertiesPane
  };
}

/**
 * @param {{
 *  getState: () => SimulationState,
 *  setState: (state: SimulationState, options?: { touch?: boolean }) => void,
 *  updateState: (updater: (draft: SimulationState) => SimulationState) => void
 * }} store
 * @param {{ onReset?: () => void }} [options]
 */
export function initUI(store, options = {}) {
  const handles = getUIHandles();
  const onReset = options.onReset || null;

  handles.modeToggle.addEventListener("click", () => {
    store.updateState((draft) => {
      const nextMode = draft.visualization.mode === "2d" ? "3d" : "2d";
      draft.visualization.mode = nextMode;
      if (nextMode === "3d" && draft.editor.activeTool !== "select") {
        draft.editor.activeTool = "select";
      }
      return draft;
    });
  });

  handles.outputToggle.addEventListener("click", () => {
    store.updateState((draft) => {
      draft.visualization.output =
        draft.visualization.output === "instantaneous"
          ? "averaged"
          : "instantaneous";
      return draft;
    });
  });

  handles.playToggle.addEventListener("click", () => {
    store.updateState((draft) => {
      draft.simulation.running = !draft.simulation.running;
      return draft;
    });
  });

  handles.resetBtn.addEventListener("click", () => {
    if (typeof onReset === "function") {
      onReset();
    }
  });

  const applyDomainSize = () => {
    const widthValue = parseFloat(handles.domainWidthInput.value);
    const heightValue = parseFloat(handles.domainHeightInput.value);
    const fallback = store.getState().domain.worldSize;
    const width = clamp(
      Number.isFinite(widthValue) ? widthValue : fallback.x,
      2,
      200
    );
    const height = clamp(
      Number.isFinite(heightValue) ? heightValue : fallback.y,
      2,
      200
    );

    handles.domainWidthInput.value = String(width);
    handles.domainHeightInput.value = String(height);

    store.updateState((draft) => {
      const prevWidth = draft.domain.worldSize.x;
      const prevHeight = draft.domain.worldSize.y;
      if (prevWidth === width && prevHeight === height) {
        return draft;
      }

      const dx = computeTargetCellSize(draft);
      // grid.nx/ny store sample counts, so add 1 to keep dx near target.
      let nextNx = Math.max(2, Math.round(width / dx) + 1);
      let nextNy = Math.max(2, Math.round(height / dx) + 1);
      // Keep it interactive in the browser.
      const MAX_GRID = 512;
      if (nextNx > MAX_GRID || nextNy > MAX_GRID) {
        const scale = Math.max(nextNx / MAX_GRID, nextNy / MAX_GRID);
        nextNx = Math.max(2, Math.round(nextNx / scale));
        nextNy = Math.max(2, Math.round(nextNy / scale));
      }

      draft.domain.worldSize.x = width;
      draft.domain.worldSize.y = height;
      draft.domain.grid.nx = nextNx;
      draft.domain.grid.ny = nextNy;

      clampObjectsToDomain(draft);
      return draft;
    });
  };

  handles.domainWidthInput.addEventListener("change", applyDomainSize);
  handles.domainHeightInput.addEventListener("change", applyDomainSize);

  handles.toolButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const tool = button.getAttribute("data-tool");
      if (!tool) {
        return;
      }
      store.updateState((draft) => {
        draft.editor.activeTool = /** @type {SimulationState["editor"]["activeTool"]} */ (tool);
        return draft;
      });
    });
  });

  handles.snapToShapesCheckbox.addEventListener("change", (event) => {
    const checked = event.currentTarget instanceof HTMLInputElement && event.currentTarget.checked;
    store.updateState((draft) => {
      draft.editor.snapToShapes = checked;
      return draft;
    });
  });

  // Sync checkbox with state on initialization
  handles.snapToShapesCheckbox.checked = store.getState().editor.snapToShapes ?? true;

  handles.exportBtn.addEventListener("click", () => {
    exportStateToFile(store.getState());
  });

  handles.importBtn.addEventListener("click", () => {
    handles.importInput.click();
  });

  handles.importInput.addEventListener("change", async (event) => {
    const target = event.currentTarget;
    if (!(target instanceof HTMLInputElement) || !target.files?.length) {
      return;
    }

    try {
      const file = target.files[0];
      const importedState = await importStateFromFile(file);
      store.setState(normalizeState(importedState), { touch: false });
    } catch (error) {
      console.error(error);
      alert("Unable to import state. Please select a valid JSON file.");
    } finally {
      target.value = "";
    }
  });

  renderUI(store.getState(), handles, store);

  return (state) => renderUI(state, handles, store);
}

/**
 * @param {SimulationState} state
 * @param {UIHandles} handles
 * @param {{ updateState: (updater: (draft: SimulationState) => SimulationState) => void }} store
 */
function renderUI(state, handles, store) {
  const modeLabel = state.visualization.mode === "2d" ? "Mode: 2D" : "Mode: 3D";
  handles.modeToggle.textContent = modeLabel;
  handles.modeToggle.setAttribute(
    "aria-pressed",
    String(state.visualization.mode === "3d")
  );

  const isAveraged = state.visualization.output === "averaged";
  const outputLabel = isAveraged ? "Output: Averaged" : "Output: Instant";
  handles.outputToggle.textContent = outputLabel;
  handles.outputToggle.setAttribute(
    "aria-pressed",
    String(isAveraged)
  );

  const isRunning = state.simulation.running !== false;
  handles.playToggle.textContent = isRunning ? "Pause" : "Play";
  handles.playToggle.setAttribute("aria-pressed", String(isRunning));

  renderObjectList(handles.sourceList, state.sources, "source", state, store);
  renderObjectList(handles.shapeList, state.shapes, "shape", state, store);
  renderPropertiesPane(handles.propertiesPane, state, store);

  // Hide snap-to-shapes in 3D (it only applies to the 2D editor).
  const snapLabel = handles.snapToShapesCheckbox.closest("label");
  if (snapLabel instanceof HTMLElement) {
    snapLabel.style.display =
      state.visualization.mode === "2d" ? "inline-flex" : "none";
  } else {
    handles.snapToShapesCheckbox.style.display =
      state.visualization.mode === "2d" ? "inline-flex" : "none";
  }

  handles.toolButtons.forEach((button) => {
    const tool = button.getAttribute("data-tool");
    const isActive = tool === state.editor.activeTool;
    button.dataset.active = String(isActive);
    if (tool === "draw-rectangle" || tool === "draw-circle" || tool === "place-source") {
      button.style.display = state.visualization.mode === "2d" ? "inline-flex" : "none";
    } else {
      button.style.display = "inline-flex";
    }
  });

  handles.sourceSettingsBtn.style.display =
    state.visualization.mode === "2d" ? "inline-flex" : "none";
  handles.domainWidthInput.value = String(state.domain.worldSize.x);
  handles.domainHeightInput.value = String(state.domain.worldSize.y);

  const status = [
    "Viewport (placeholder)",
    `Active tool: ${state.editor.activeTool}`,
    `Mode: ${state.visualization.mode.toUpperCase()}`
  ];
  handles.viewportStatus.textContent = status.join("\n");
}

/**
 * @param {HTMLDivElement} container
 * @param {SimulationState} state
 * @param {{ updateState: (updater: (draft: SimulationState) => SimulationState) => void }} store
 */
function renderPropertiesPane(container, state, store) {
  container.textContent = "";
  const sel = state.editor.selection;
  if (!sel || !sel.type || !sel.id) {
    const empty = document.createElement("div");
    empty.className = "props-empty";
    empty.textContent = "Select a source or shape to edit its properties.";
    container.appendChild(empty);
    return;
  }

  if (sel.type === "source") {
    const source = state.sources.find((s) => s.id === sel.id) || null;
    if (!source) {
      const empty = document.createElement("div");
      empty.className = "props-empty";
      empty.textContent = "Selected source not found.";
      container.appendChild(empty);
      return;
    }
    renderSourceEditor(container, source, store);
    return;
  }

  if (sel.type === "shape") {
    const shape = state.shapes.find((s) => s.id === sel.id) || null;
    if (!shape) {
      const empty = document.createElement("div");
      empty.className = "props-empty";
      empty.textContent = "Selected shape not found.";
      container.appendChild(empty);
      return;
    }
    renderShapeEditor(container, shape, store);
    return;
  }

  const empty = document.createElement("div");
  empty.className = "props-empty";
  empty.textContent = "Select a source or shape to edit its properties.";
  container.appendChild(empty);
}

/**
 * @param {HTMLDivElement} container
 * @param {import("./types.js").SourceObject} source
 * @param {{ updateState: (updater: (draft: SimulationState) => SimulationState) => void }} store
 */
function renderSourceEditor(container, source, store) {
  const form = document.createElement("form");
  form.className = "props-form";

  const nameInput = createTextField("Name", source.name);
  const pos = createVec2Fields("Position (x, y)", source.position.x, source.position.y);
  const ampInput = createNumberField("Amplitude", source.amplitude, 0.1);
  const freqInput = createNumberField("Frequency", source.frequency, 0.1);
  const phaseInput = createNumberField("Phase", source.phase, 0.1);

  const waveform = createSelectField("Waveform", source.waveform || "cw", [
    ["cw", "CW"],
    ["gaussian", "Gaussian"],
    ["ricker", "Ricker"]
  ]);
  const pulseWidth = createNumberField("Pulse width", source.pulseWidth ?? 0.4, 0.01);
  const pulseDelay = createNumberField("Pulse delay", source.pulseDelay ?? 0, 0.01);
  const injection = createSelectField("Injection", source.injection || "soft", [
    ["soft", "Soft"],
    ["hard", "Hard"]
  ]);
  const excite = createSelectField("Excite", source.excite || "hz", [
    ["hz", "Hz"],
    ["ex", "Ex"],
    ["ey", "Ey"],
    ["e", "E (rotated)"]
  ]);
  const polAngle = createNumberField(
    "Pol angle (deg)",
    source.polarizationAngle ?? 0,
    1
  );

  const activeField = document.createElement("div");
  activeField.className = "props-field";
  const activeLabel = document.createElement("label");
  activeLabel.textContent = "Active";
  const activeInput = document.createElement("input");
  activeInput.type = "checkbox";
  activeInput.checked = source.active !== false;
  activeLabel.appendChild(activeInput);
  activeField.appendChild(activeLabel);

  // Keep fields visible; disable + dim when not applicable (matches Signal Settings).
  function updateDynamicEnablement() {
    const isPulse = waveform.input.value !== "cw";
    pulseWidth.input.disabled = !isPulse;
    pulseDelay.input.disabled = !isPulse;
    polAngle.input.disabled = excite.input.value !== "e";
    pulseWidth.field.style.opacity = isPulse ? "1" : "0.6";
    pulseDelay.field.style.opacity = isPulse ? "1" : "0.6";
    polAngle.field.style.opacity = excite.input.value === "e" ? "1" : "0.6";
  }
  updateDynamicEnablement();
  waveform.input.addEventListener("change", () => updateDynamicEnablement());
  excite.input.addEventListener("change", () => updateDynamicEnablement());

  form.appendChild(nameInput.field);
  form.appendChild(pos.field);
  form.appendChild(ampInput.field);
  form.appendChild(freqInput.field);
  form.appendChild(phaseInput.field);
  form.appendChild(waveform.field);
  form.appendChild(pulseWidth.field);
  form.appendChild(pulseDelay.field);
  form.appendChild(injection.field);
  form.appendChild(excite.field);
  form.appendChild(polAngle.field);
  form.appendChild(activeField);

  const actions = document.createElement("div");
  actions.className = "props-actions";
  const apply = document.createElement("button");
  apply.type = "submit";
  apply.textContent = "Apply";
  apply.dataset.variant = "apply";
  actions.appendChild(apply);
  form.appendChild(actions);

  const dirty = setupApplyDirtyTracking(
    apply,
    `source:${source.id}`,
    [
      nameInput.input,
      pos.xInput,
      pos.yInput,
      ampInput.input,
      freqInput.input,
      phaseInput.input,
      waveform.input,
      pulseWidth.input,
      pulseDelay.input,
      injection.input,
      excite.input,
      polAngle.input,
      activeInput
    ]
  );

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    store.updateState((draft) => {
      const s = draft.sources.find((x) => x.id === source.id);
      if (!s) return draft;
      s.name = nameInput.input.value.trim() || s.name;
      s.position.x = readNumber(pos.xInput, s.position.x);
      s.position.y = readNumber(pos.yInput, s.position.y);
      s.amplitude = readNumber(ampInput.input, s.amplitude);
      s.frequency = readNumber(freqInput.input, s.frequency);
      s.phase = readNumber(phaseInput.input, s.phase);
      s.waveform =
        waveform.input.value === "gaussian" || waveform.input.value === "ricker"
          ? waveform.input.value
          : "cw";
      s.pulseWidth = readNumber(pulseWidth.input, s.pulseWidth ?? 0.4);
      s.pulseDelay = readNumber(pulseDelay.input, s.pulseDelay ?? 0);
      s.injection = injection.input.value === "hard" ? "hard" : "soft";
      s.excite =
        excite.input.value === "ex" ||
        excite.input.value === "ey" ||
        excite.input.value === "e" ||
        excite.input.value === "hz"
          ? excite.input.value
          : "hz";
      s.polarizationAngle = readNumber(polAngle.input, s.polarizationAngle ?? 0);
      s.active = activeInput.checked;
      return draft;
    });
    dirty.commitApplied();
  });

  container.appendChild(form);
}

/**
 * @param {HTMLDivElement} container
 * @param {import("./types.js").ShapeObject} shape
 * @param {{ updateState: (updater: (draft: SimulationState) => SimulationState) => void }} store
 */
function renderShapeEditor(container, shape, store) {
  const form = document.createElement("form");
  form.className = "props-form";

  const nameInput = createTextField("Name", shape.name);
  const pos = createVec2Fields("Center (x, y)", shape.center.x, shape.center.y);
  const heightInput = createNumberField("Height (Z)", shape.height ?? 1, 0.1);
  heightInput.input.title = "3D visualization height (does not change 2D physics).";
  const angleZ =
    shape.kind === "rectangle"
      ? createNumberField("Rotation Z (deg)", shape.angles?.z ?? 0, 1)
      : null;
  if (angleZ) {
    angleZ.input.title = "In-plane rotation around Z. Used for 2D rotation.";
  }

  form.appendChild(nameInput.field);
  form.appendChild(pos.field);
  form.appendChild(heightInput.field);
  if (angleZ) {
    form.appendChild(angleZ.field);
  }

  let wField = null;
  let hField = null;
  let rField = null;
  if (shape.kind === "rectangle" && shape.size) {
    wField = createNumberField("Length", shape.size.width, 0.01);
    hField = createNumberField("Width", shape.size.height, 0.01);
    form.appendChild(wField.field);
    form.appendChild(hField.field);
  } else if (shape.kind === "circle") {
    rField = createNumberField("Radius", shape.radius ?? 1, 0.01);
    form.appendChild(rField.field);
  }

  const matDefaults = getMaterialPresetDefaults();
  const mat = shape.material || { preset: "drywall", epsR: 2.7, sigma: 0.02 };
  const preset = createSelectField("Material", mat.preset, [
    ["air", "Air"],
    ["drywall", "Drywall"],
    ["concrete", "Concrete"],
    ["metal", "Metal"],
    ["custom", "Custom…"]
  ]);
  const epsR = createNumberField("εr", mat.epsR, 0.1);
  const sigma = createNumberField("σ", mat.sigma, 0.01);
  const matInline = document.createElement("div");
  matInline.className = "props-inline";
  matInline.appendChild(epsR.input);
  matInline.appendChild(sigma.input);
  epsR.field.textContent = "";
  sigma.field.textContent = "";
  const matInlineField = document.createElement("div");
  matInlineField.className = "props-field";
  const matInlineLabel = document.createElement("span");
  matInlineLabel.textContent = "Custom (εr, σ)";
  matInlineField.appendChild(matInlineLabel);
  matInlineField.appendChild(matInline);
  matInlineField.hidden = preset.input.value !== "custom";
  preset.input.addEventListener("change", () => {
    const v = preset.input.value;
    matInlineField.hidden = v !== "custom";
    if (v !== "custom" && matDefaults[v]) {
      epsR.input.value = String(matDefaults[v].epsR);
      sigma.input.value = String(matDefaults[v].sigma);
    }
  });

  form.appendChild(preset.field);
  form.appendChild(matInlineField);

  const actions = document.createElement("div");
  actions.className = "props-actions";
  const apply = document.createElement("button");
  apply.type = "submit";
  apply.textContent = "Apply";
  apply.dataset.variant = "apply";
  actions.appendChild(apply);
  form.appendChild(actions);

  /** @type {(HTMLInputElement|HTMLSelectElement)[]} */
  const inputs = [
    nameInput.input,
    pos.xInput,
    pos.yInput,
    heightInput.input,
    preset.input,
    epsR.input,
    sigma.input
  ];
  if (angleZ) inputs.push(angleZ.input);
  if (wField) inputs.push(wField.input);
  if (hField) inputs.push(hField.input);
  if (rField) inputs.push(rField.input);

  const dirty = setupApplyDirtyTracking(apply, `shape:${shape.id}`, inputs);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    store.updateState((draft) => {
      const s = draft.shapes.find((x) => x.id === shape.id);
      if (!s) return draft;
      s.name = nameInput.input.value.trim() || s.name;
      s.center.x = readNumber(pos.xInput, s.center.x);
      s.center.y = readNumber(pos.yInput, s.center.y);
      s.height = readNumber(heightInput.input, s.height ?? 1);
      // Rotation only applies to rectangles in 2D.
      if (s.kind === "rectangle" && angleZ) {
        s.angles = s.angles || { x: 0, y: 0, z: 0 };
        s.angles.z = readNumber(angleZ.input, s.angles.z ?? 0);
      } else {
        s.angles = { x: 0, y: 0, z: 0 };
      }

      if (s.kind === "rectangle" && s.size && wField && hField) {
        s.size.width = Math.max(0.01, readNumber(wField.input, s.size.width));
        s.size.height = Math.max(0.01, readNumber(hField.input, s.size.height));
      } else if (s.kind === "circle" && rField) {
        s.radius = Math.max(0.01, readNumber(rField.input, s.radius ?? 1));
      }

      const p = preset.input.value;
      const base = matDefaults[p] || matDefaults.drywall;
      const isCustom = p === "custom";
      const epsVal = isCustom ? readNumber(epsR.input, base.epsR) : base.epsR;
      const sigVal = isCustom ? readNumber(sigma.input, base.sigma) : base.sigma;
      s.material = {
        preset: /** @type {import("./types.js").MaterialSettings["preset"]} */ (p),
        epsR: epsVal,
        sigma: sigVal
      };

      return draft;
    });
    dirty.commitApplied();
  });

  container.appendChild(form);
}

const APPLY_FLASH_MS = 800;
/** @type {Map<string, number>} */
const lastAppliedAt = new Map();

/**
 * Tracks whether form inputs differ from the initial snapshot.
 * - disabled + muted when clean
 * - primary when dirty
 * - brief "Applied" flash when committed
 *
 * @param {HTMLButtonElement} applyBtn
 * @param {string} key
 * @param {(HTMLInputElement|HTMLSelectElement)[]} inputs
 */
function setupApplyDirtyTracking(applyBtn, key, inputs) {
  let baseline = snapshotInputs(inputs);

  function update() {
    const next = snapshotInputs(inputs);
    const isDirty = next.some((v, i) => v !== baseline[i]);
    if (isDirty) {
      applyBtn.disabled = false;
      applyBtn.dataset.state = "dirty";
      applyBtn.textContent = "Apply";
    } else {
      applyBtn.disabled = true;
      applyBtn.dataset.state = "clean";
      applyBtn.textContent = "Apply";
    }
  }

  inputs.forEach((el) => {
    el.addEventListener("input", update);
    el.addEventListener("change", update);
  });

  // Initial state + applied flash (if any).
  const appliedAt = lastAppliedAt.get(key) || 0;
  if (Date.now() - appliedAt < APPLY_FLASH_MS) {
    applyBtn.disabled = true;
    applyBtn.dataset.state = "applied";
    applyBtn.textContent = "Applied";
    window.setTimeout(() => {
      if (!applyBtn.isConnected) return;
      baseline = snapshotInputs(inputs);
      update();
    }, APPLY_FLASH_MS);
  } else {
    update();
  }

  return {
    commitApplied() {
      lastAppliedAt.set(key, Date.now());
      baseline = snapshotInputs(inputs);
      applyBtn.disabled = true;
      applyBtn.dataset.state = "applied";
      applyBtn.textContent = "Applied";
      window.setTimeout(() => {
        if (!applyBtn.isConnected) return;
        update();
      }, APPLY_FLASH_MS);
    }
  };
}

/**
 * @param {(HTMLInputElement|HTMLSelectElement)[]} inputs
 */
function snapshotInputs(inputs) {
  return inputs.map((el) => {
    if (el instanceof HTMLInputElement && el.type === "checkbox") {
      return el.checked ? "1" : "0";
    }
    return String(el.value);
  });
}

function getMaterialPresetDefaults() {
  return {
    air: { epsR: 1, sigma: 0 },
    drywall: { epsR: 2.7, sigma: 0.02 },
    concrete: { epsR: 6, sigma: 0.2 },
    metal: { epsR: 1, sigma: 50 },
    custom: { epsR: 2.7, sigma: 0.02 }
  };
}

function createTextField(label, value) {
  const field = document.createElement("div");
  field.className = "props-field";
  const l = document.createElement("span");
  l.textContent = label;
  const input = document.createElement("input");
  input.type = "text";
  input.value = String(value ?? "");
  input.title = label;
  field.appendChild(l);
  field.appendChild(input);
  return { field, input };
}

function createNumberField(label, value, step) {
  const field = document.createElement("div");
  field.className = "props-field";
  const l = document.createElement("span");
  l.textContent = label;
  const input = document.createElement("input");
  input.type = "number";
  input.step = String(step ?? "any");
  input.value = String(value ?? 0);
  input.title = label;
  field.appendChild(l);
  field.appendChild(input);
  return { field, input };
}

function createSelectField(label, value, options) {
  const field = document.createElement("div");
  field.className = "props-field";
  const l = document.createElement("span");
  l.textContent = label;
  const input = document.createElement("select");
  input.title = label;
  for (const [v, text] of options) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = text;
    input.appendChild(opt);
  }
  input.value = String(value ?? "");
  field.appendChild(l);
  field.appendChild(input);
  return { field, input };
}

function createVec2Fields(label, x, y) {
  const field = document.createElement("div");
  field.className = "props-field";
  const l = document.createElement("span");
  l.textContent = label;
  const row = document.createElement("div");
  row.className = "props-inline";
  const xInput = document.createElement("input");
  xInput.type = "number";
  xInput.step = "any";
  xInput.value = String(x ?? 0);
  xInput.title = `${label} - X`;
  xInput.placeholder = "x";
  const yInput = document.createElement("input");
  yInput.type = "number";
  yInput.step = "any";
  yInput.value = String(y ?? 0);
  yInput.title = `${label} - Y`;
  yInput.placeholder = "y";
  row.appendChild(xInput);
  row.appendChild(yInput);
  field.appendChild(l);
  field.appendChild(row);
  return { field, xInput, yInput };
}

function readNumber(input, fallback) {
  const value = parseFloat(input.value);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * @param {HTMLDivElement} container
 * @param {Array} items
 * @param {"source" | "shape"} kind
 * @param {SimulationState} state
 * @param {{ updateState: (updater: (draft: SimulationState) => SimulationState) => void }} store
 */
function renderObjectList(container, items, kind, state, store) {
  container.textContent = "";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "object-empty";
    empty.textContent = "None";
    container.appendChild(empty);
    return;
  }

  const selection = state.editor.selection;

  items.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "object-row";
    const selected =
      selection && selection.type === kind && selection.id === item.id;
    row.dataset.selected = String(Boolean(selected));

    const nameBtn = document.createElement("button");
    nameBtn.type = "button";
    nameBtn.className = "object-name";
    nameBtn.textContent = formatItemLabel(item, kind, index);
    nameBtn.addEventListener("click", () => {
      setSelection(store, kind, item.id);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "object-delete";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteItem(store, kind, item.id);
    });

    row.appendChild(nameBtn);
    row.appendChild(deleteBtn);
    container.appendChild(row);
  });
}

/**
 * @param {{ updateState: (updater: (draft: SimulationState) => SimulationState) => void }} store
 * @param {"source" | "shape" | null} type
 * @param {string | null} id
 */
function setSelection(store, type, id) {
  store.updateState((draft) => {
    if (!draft.editor.selection) {
      draft.editor.selection = { type: null, id: null };
    }
    draft.editor.selection.type = type;
    draft.editor.selection.id = id;
    return draft;
  });
}

/**
 * @param {{ updateState: (updater: (draft: SimulationState) => SimulationState) => void }} store
 * @param {"source" | "shape"} kind
 * @param {string} id
 */
function deleteItem(store, kind, id) {
  store.updateState((draft) => {
    if (kind === "source") {
      draft.sources = draft.sources.filter((item) => item.id !== id);
    } else {
      draft.shapes = draft.shapes.filter((item) => item.id !== id);
    }
    if (draft.editor.selection?.id === id) {
      draft.editor.selection = { type: null, id: null };
    }
    return draft;
  });
}

/**
 * @param {any} item
 * @param {"source" | "shape"} kind
 * @param {number} index
 */
function formatItemLabel(item, kind, index) {
  if (kind === "source") {
    return item.name || `Source ${index + 1}`;
  }
  return item.name || `${item.kind === "circle" ? "Circle" : "Rectangle"} ${index + 1}`;
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

const CELLS_PER_WAVELENGTH = 16;

/**
 * @param {SimulationState} state
 * @returns {number}
 */
function computeTargetCellSize(state) {
  const isEm = state.simulation.model === "em2d";
  const speed = clamp(
    Number.isFinite(state.simulation.solver.speed)
      ? state.simulation.solver.speed
      : 1,
    0.05,
    isEm ? 50 : 20
  );
  const refFrequency = clamp(
    Number.isFinite(state.simulation.sourceDefaults?.frequency)
      ? state.simulation.sourceDefaults.frequency
      : isEm
        ? 5
      : 1.5,
    isEm ? 0.01 : 0.1,
    isEm ? 50 : 6
  );
  const wavelength = speed / refFrequency;
  const cellsPerLambda = isEm ? 12 : CELLS_PER_WAVELENGTH;
  const dx = wavelength / cellsPerLambda;
  return clamp(dx, 0.01, 10);
}

/**
 * @param {SimulationState} draft
 */
function clampObjectsToDomain(draft) {
  const originX = draft.domain.origin.x;
  const originY = draft.domain.origin.y;
  const maxX = originX + draft.domain.worldSize.x;
  const maxY = originY + draft.domain.worldSize.y;

  draft.sources = draft.sources.map((source) => ({
    ...source,
    position: {
      x: clamp(source.position.x, originX, maxX),
      y: clamp(source.position.y, originY, maxY),
      z: 0
    }
  }));

  draft.shapes = draft.shapes.map((shape) => {
    if (shape.kind === "circle") {
      const radius = Math.max(0, shape.radius ?? 0);
      const clampedX = clampWithPadding(shape.center.x, originX, maxX, radius);
      const clampedY = clampWithPadding(shape.center.y, originY, maxY, radius);
      return {
        ...shape,
        center: { x: clampedX, y: clampedY, z: 0 }
      };
    }

    const halfW = (shape.size?.width ?? 0) * 0.5;
    const halfH = (shape.size?.height ?? 0) * 0.5;
    const padding = Math.hypot(halfW, halfH);
    const clampedX = clampWithPadding(shape.center.x, originX, maxX, padding);
    const clampedY = clampWithPadding(shape.center.y, originY, maxY, padding);
    return {
      ...shape,
      center: { x: clampedX, y: clampedY, z: 0 }
    };
  });
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @param {number} padding
 * @returns {number}
 */
function clampWithPadding(value, min, max, padding) {
  const paddedMin = min + padding;
  const paddedMax = max - padding;
  if (paddedMax < paddedMin) {
    return clamp(value, min, max);
  }
  return clamp(value, paddedMin, paddedMax);
}
