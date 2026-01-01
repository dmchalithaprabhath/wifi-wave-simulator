// @ts-check

/** @typedef {import("./types.js").SimulationState} SimulationState */
/** @typedef {import("./types.js").ShapeObject} ShapeObject */

/**
 * @typedef {Object} DraftShape
 * @property {"rectangle" | "circle"} shapeKind
 * @property {{ x: number, y: number }} center
 * @property {{ width: number, height: number } | null} size
 * @property {number | null} radius
 * @property {{ x?: number, y?: number, z?: number }} [angles]
 * @property {import("./types.js").MaterialSettings} [material]
 */

/**
 * @param {{
 *  getState: () => SimulationState,
 *  updateState: (updater: (draft: SimulationState) => SimulationState) => void
 * }} store
 * @param {{ onDraftChange?: (draft: DraftShape | null) => void }} [options]
 */
export function initModal(store, options = {}) {
  const backdropEl = document.querySelector("#modalBackdrop");
  const formEl = document.querySelector("#modalForm");
  const shapeSummaryEl = document.querySelector("#modalShapeSummary");
  const nameInputEl = document.querySelector("#modalName");
  const lengthFieldEl = document.querySelector("#modalLengthField");
  const lengthInputEl = document.querySelector("#modalLength");
  const widthFieldEl = document.querySelector("#modalWidthField");
  const widthInputEl = document.querySelector("#modalWidth");
  const radiusFieldEl = document.querySelector("#modalRadiusField");
  const radiusInputEl = document.querySelector("#modalRadius");
  const heightInputEl = document.querySelector("#modalHeight");
  const anglesFieldEl = document.querySelector("#modalAnglesField");
  const angleZInputEl = document.querySelector("#modalAngleZ");
  const materialPresetSelectEl = document.querySelector("#modalMaterialPreset");
  const materialCustomRowEl = document.querySelector("#modalMaterialCustomRow");
  const materialEpsRInputEl = document.querySelector("#modalMaterialEpsR");
  const materialSigmaInputEl = document.querySelector("#modalMaterialSigma");
  const cancelBtnEl = document.querySelector("#modalCancel");
  const applyBtnEl = document.querySelector("#modalApply");
  const errorTextEl = document.querySelector("#modalError");

  if (!(backdropEl instanceof HTMLDivElement)) throw new Error("Modal elements not found.");
  if (!(formEl instanceof HTMLFormElement)) throw new Error("Modal elements not found.");
  if (!(shapeSummaryEl instanceof HTMLParagraphElement)) throw new Error("Modal elements not found.");
  if (!(nameInputEl instanceof HTMLInputElement)) throw new Error("Modal elements not found.");
  if (!(lengthFieldEl instanceof HTMLLabelElement)) throw new Error("Modal elements not found.");
  if (!(lengthInputEl instanceof HTMLInputElement)) throw new Error("Modal elements not found.");
  if (!(widthFieldEl instanceof HTMLLabelElement)) throw new Error("Modal elements not found.");
  if (!(widthInputEl instanceof HTMLInputElement)) throw new Error("Modal elements not found.");
  if (!(radiusFieldEl instanceof HTMLLabelElement)) throw new Error("Modal elements not found.");
  if (!(radiusInputEl instanceof HTMLInputElement)) throw new Error("Modal elements not found.");
  if (!(heightInputEl instanceof HTMLInputElement)) throw new Error("Modal elements not found.");
  if (!(anglesFieldEl instanceof HTMLLabelElement)) throw new Error("Modal elements not found.");
  if (!(angleZInputEl instanceof HTMLInputElement)) throw new Error("Modal elements not found.");
  if (!(materialPresetSelectEl instanceof HTMLSelectElement)) throw new Error("Modal elements not found.");
  if (!(materialCustomRowEl instanceof HTMLDivElement)) throw new Error("Modal elements not found.");
  if (!(materialEpsRInputEl instanceof HTMLInputElement)) throw new Error("Modal elements not found.");
  if (!(materialSigmaInputEl instanceof HTMLInputElement)) throw new Error("Modal elements not found.");
  if (!(cancelBtnEl instanceof HTMLButtonElement)) throw new Error("Modal elements not found.");
  if (!(applyBtnEl instanceof HTMLButtonElement)) throw new Error("Modal elements not found.");
  if (!(errorTextEl instanceof HTMLParagraphElement)) throw new Error("Modal elements not found.");

  const backdrop = backdropEl;
  const form = formEl;
  const shapeSummary = shapeSummaryEl;
  const nameInput = nameInputEl;
  const lengthField = lengthFieldEl;
  const lengthInput = lengthInputEl;
  const widthField = widthFieldEl;
  const widthInput = widthInputEl;
  const radiusField = radiusFieldEl;
  const radiusInput = radiusInputEl;
  const heightInput = heightInputEl;
  const anglesField = anglesFieldEl;
  const angleZInput = angleZInputEl;
  const materialPresetSelect = materialPresetSelectEl;
  const materialCustomRow = materialCustomRowEl;
  const materialEpsRInput = materialEpsRInputEl;
  const materialSigmaInput = materialSigmaInputEl;
  const cancelBtn = cancelBtnEl;
  const applyBtn = applyBtnEl;
  const errorText = errorTextEl;

  /** @type {DraftShape | null} */
  let draft = null;
  let maxHalf = 0;
  let domainMaxSize = 1;
  const onDraftChange =
    typeof options.onDraftChange === "function" ? options.onDraftChange : null;

  /**
   * @param {DraftShape} newDraft
   */
  function openModal(newDraft) {
    draft = newDraft;
    const state = store.getState();
    maxHalf = computeMaxHalf(state, newDraft.center);
    domainMaxSize = Math.max(state.domain.worldSize.x, state.domain.worldSize.y, 0.01);
    shapeSummary.textContent = describeDraft(newDraft);
    nameInput.value = getDefaultName(state, newDraft.shapeKind);
    heightInput.value = String(1);
    anglesField.hidden = newDraft.shapeKind !== "rectangle";
    angleZInput.value = String(newDraft.shapeKind === "rectangle" ? (newDraft.angles?.z ?? 0) : 0);

    // Default material (applied to both rectangle and circle shapes)
    const material = newDraft.material || {
      preset: "drywall",
      epsR: 2.7,
      sigma: 0.02
    };
    materialPresetSelect.value = material.preset;
    materialEpsRInput.value = String(material.epsR);
    materialSigmaInput.value = String(material.sigma);
    materialCustomRow.hidden = materialPresetSelect.value !== "custom";

    if (newDraft.shapeKind === "rectangle") {
      lengthField.hidden = false;
      widthField.hidden = false;
      radiusField.hidden = true;
      // Round to 2 decimal places to match step="0.01", use toFixed for exact precision
      const lengthValue = newDraft.size?.width ?? 1;
      const widthValue = newDraft.size?.height ?? 1;
      lengthInput.value = (Math.round(lengthValue * 100) / 100).toFixed(2);
      widthInput.value = (Math.round(widthValue * 100) / 100).toFixed(2);
      radiusInput.value = String(1);
    } else {
      lengthField.hidden = true;
      widthField.hidden = true;
      radiusField.hidden = false;
      lengthInput.value = String(1);
      widthInput.value = String(1);
      // Round to 2 decimal places to match step="0.01", use toFixed for exact precision
      const radiusValue = newDraft.radius ?? 1;
      radiusInput.value = (Math.round(radiusValue * 100) / 100).toFixed(2);
    }

    backdrop.hidden = false;
    nameInput.focus();
    nameInput.select();
    updatePreview();
  }

  function closeModal() {
    draft = null;
    backdrop.hidden = true;
    if (onDraftChange) {
      onDraftChange(null);
    }
  }

  function applyModal() {
    if (!draft || !isFormValid()) {
      return;
    }

    const state = store.getState();
    const maxSize = Math.max(state.domain.worldSize.x, state.domain.worldSize.y, 0.01);

    const name = nameInput.value.trim();
    const height = clamp(readNumber(heightInput, 1), 0.1, 10);
    const updatedDraft = buildPreviewDraft(draft);
    const angles = updatedDraft.angles || readAngles();
    const shape = createShapeFromDraft(updatedDraft, {
      name,
      height,
      angles,
      maxSize
    });

    store.updateState((state) => {
      state.shapes.push(shape);
      state.editor.selection = { type: "shape", id: shape.id };
      return state;
    });

    closeModal();
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    applyModal();
  });

  nameInput.addEventListener("input", () => updatePreview());
  lengthInput.addEventListener("input", () => updatePreview());
  widthInput.addEventListener("input", () => updatePreview());
  radiusInput.addEventListener("input", () => updatePreview());
  heightInput.addEventListener("input", () => updatePreview());
  angleZInput.addEventListener("input", () => updatePreview());
  materialPresetSelect.addEventListener("change", () => {
    materialCustomRow.hidden = materialPresetSelect.value !== "custom";
    updatePreview();
  });
  materialEpsRInput.addEventListener("input", () => updatePreview());
  materialSigmaInput.addEventListener("input", () => updatePreview());

  cancelBtn.addEventListener("click", () => {
    closeModal();
  });

  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) {
      closeModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !backdrop.hidden) {
      closeModal();
    }
  });

  function updatePreview() {
    if (!draft) {
      return;
    }
    if (draft.shapeKind === "rectangle") {
      lengthField.hidden = false;
      widthField.hidden = false;
      radiusField.hidden = true;
      anglesField.hidden = false;
    } else {
      lengthField.hidden = true;
      widthField.hidden = true;
      radiusField.hidden = false;
      anglesField.hidden = true;
    }
    const validation = validateForm();
    if (!validation.valid) {
      errorText.textContent = validation.message;
      errorText.hidden = false;
      applyBtn.disabled = true;
      if (onDraftChange) {
        onDraftChange(null);
      }
      return;
    }

    errorText.hidden = true;
    applyBtn.disabled = false;
    const preview = buildPreviewDraft(draft);
    shapeSummary.textContent = describeDraft(preview);
    if (onDraftChange) {
      onDraftChange(preview);
    }
  }

  function validateForm() {
    const name = nameInput.value.trim();
    if (!name) {
      return { valid: false, message: "Name is required." };
    }

    if (draft?.shapeKind === "rectangle") {
      const length = readNumber(lengthInput, NaN);
      const width = readNumber(widthInput, NaN);
      if (!Number.isFinite(length) || length <= 0) {
        return { valid: false, message: "Length must be greater than 0." };
      }
      if (!Number.isFinite(width) || width <= 0) {
        return { valid: false, message: "Width must be greater than 0." };
      }
    } else if (draft?.shapeKind === "circle") {
      const radius = readNumber(radiusInput, NaN);
      if (!Number.isFinite(radius) || radius <= 0) {
        return { valid: false, message: "Radius must be greater than 0." };
      }
    }

    const height = readNumber(heightInput, NaN);
    if (!Number.isFinite(height) || height <= 0) {
      return { valid: false, message: "Height (Z) must be greater than 0." };
    }

    if (!anglesAreValid()) {
      return { valid: false, message: "Angles must be numbers." };
    }

    return { valid: true, message: "" };
  }

  function isFormValid() {
    return validateForm().valid;
  }

  function anglesAreValid() {
    if (draft?.shapeKind !== "rectangle") {
      return true;
    }
    return Number.isFinite(readNumber(angleZInput, NaN));
  }

  function readAngles() {
    if (draft?.shapeKind !== "rectangle") {
      return { x: 0, y: 0, z: 0 };
    }
    return {
      x: 0,
      y: 0,
      z: clamp(readNumber(angleZInput, 0), -180, 180)
    };
  }

  /**
   * @returns {import("./types.js").MaterialSettings}
   */
  function readMaterial() {
    const preset = materialPresetSelect.value;
    /** @type {Record<string, { epsR: number, sigma: number }>} */
    const defaults = {
      air: { epsR: 1, sigma: 0 },
      drywall: { epsR: 2.7, sigma: 0.02 },
      concrete: { epsR: 6, sigma: 0.2 },
      metal: { epsR: 1, sigma: 50 },
      custom: { epsR: 2.7, sigma: 0.02 }
    };
    const base = defaults[preset] || defaults.drywall;
    const epsR =
      preset === "custom"
        ? clamp(readNumber(materialEpsRInput, base.epsR), 1, 20)
        : base.epsR;
    const sigma =
      preset === "custom"
        ? clamp(readNumber(materialSigmaInput, base.sigma), 0, 200)
        : base.sigma;
    return {
      preset: /** @type {import("./types.js").MaterialSettings["preset"]} */ (preset),
      epsR,
      sigma
    };
  }

  /**
   * @param {DraftShape} baseDraft
   */
  function buildPreviewDraft(baseDraft) {
    const sizeLimits = Math.max(domainMaxSize, 0.01);
    const material = readMaterial();
    if (baseDraft.shapeKind === "rectangle") {
      const length = clamp(readNumber(lengthInput, 1), 0.01, sizeLimits);
      const width = clamp(readNumber(widthInput, 1), 0.01, sizeLimits);
      return {
        ...baseDraft,
        size: { width: length, height: width },
        radius: null,
        angles: readAngles(),
        material
      };
    }

    const radius = clamp(readNumber(radiusInput, 1), 0.01, sizeLimits);
    return {
      ...baseDraft,
      size: null,
      radius,
      angles: readAngles(),
      material
    };
  }

  return {
    openModal,
    closeModal
  };
}

/**
 * @param {DraftShape} draft
 * @returns {string}
 */
function describeDraft(draft) {
  if (draft.shapeKind === "rectangle" && draft.size) {
    return `Rectangle L=${draft.size.width.toFixed(2)} x W=${draft.size.height.toFixed(2)}`;
  }
  if (draft.shapeKind === "circle" && draft.radius != null) {
    return `Circle r=${draft.radius.toFixed(2)}`;
  }
  return "Shape";
}

/**
 * @param {DraftShape} draft
 * @param {{ name: string, height: number, angles: { x: number, y: number, z: number }, maxSize: number }} params
 * @returns {ShapeObject}
 */
function createShapeFromDraft(draft, params) {
  const sizeLimit = Math.max(params.maxSize, 0.01);
  const radiusLimit = Math.max(params.maxSize, 0.01);
  const material = draft.material || { preset: "drywall", epsR: 2.7, sigma: 0.02 };
  if (draft.shapeKind === "rectangle") {
    const safeSize = draft.size || { width: 0, height: 0 };
    return {
      id: createId("shape"),
      kind: "rectangle",
      name: params.name,
      center: { x: draft.center.x, y: draft.center.y, z: 0 },
      size: {
        width: clamp(safeSize.width, 0.01, sizeLimit),
        height: clamp(safeSize.height, 0.01, sizeLimit)
      },
      radius: null,
      height: params.height,
      angles: params.angles,
      material,
      tags: []
    };
  }

  return {
    id: createId("shape"),
    kind: "circle",
    name: params.name,
    center: { x: draft.center.x, y: draft.center.y, z: 0 },
    size: null,
    radius: clamp(draft.radius ?? 0, 0.01, radiusLimit),
    height: params.height,
    angles: params.angles,
    material,
    tags: []
  };
}

/**
 * @param {SimulationState} state
 * @param {{ x: number, y: number }} center
 * @returns {number}
 */
function computeMaxHalf(state, center) {
  const { origin, worldSize } = state.domain;
  const maxX = origin.x + worldSize.x;
  const maxY = origin.y + worldSize.y;
  const dx = Math.min(center.x - origin.x, maxX - center.x);
  const dy = Math.min(center.y - origin.y, maxY - center.y);
  return Math.max(0, Math.min(dx, dy));
}

/**
 * @param {SimulationState} state
 * @param {"rectangle" | "circle"} kind
 * @returns {string}
 */
function getDefaultName(state, kind) {
  const label = kind === "circle" ? "Circle" : "Rectangle";
  const count = state.shapes.filter((shape) => shape.kind === kind).length;
  return `${label} ${count + 1}`;
}

/**
 * @param {string} prefix
 * @returns {string}
 */
function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

/**
 * @param {HTMLInputElement} input
 * @param {number} fallback
 */
function readNumber(input, fallback) {
  const value = parseFloat(input.value);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
