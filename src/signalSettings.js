// @ts-check

/** @typedef {import("./types.js").SimulationState} SimulationState */

/**
 * @param {{
 *  getState: () => SimulationState,
 *  updateState: (updater: (draft: SimulationState) => SimulationState) => void
 * }} store
 */
export function initSignalSettings(store) {
  const backdrop = document.querySelector("#signalModalBackdrop");
  const form = document.querySelector("#signalModalForm");
  const frequencyInput = document.querySelector("#signalFrequency");
  const amplitudeInput = document.querySelector("#signalAmplitude");
  const phaseInput = document.querySelector("#signalPhase");
  const waveformSelect = document.querySelector("#signalWaveform");
  const pulseWidthField = document.querySelector("#signalPulseWidthField");
  const pulseDelayField = document.querySelector("#signalPulseDelayField");
  const pulseWidthInput = document.querySelector("#signalPulseWidth");
  const pulseDelayInput = document.querySelector("#signalPulseDelay");
  const injectionSelect = document.querySelector("#signalInjection");
  const exciteSelect = document.querySelector("#signalExcite");
  const polarizationAngleField = document.querySelector(
    "#signalPolarizationAngleField"
  );
  const polarizationAngleInput = document.querySelector(
    "#signalPolarizationAngle"
  );
  const cancelBtn = document.querySelector("#signalCancel");
  const applyAllBtn = document.querySelector("#signalApplyAll");
  const openBtn = document.querySelector("#sourceSettingsBtn");

  if (
    !(backdrop instanceof HTMLDivElement) ||
    !(form instanceof HTMLFormElement) ||
    !(frequencyInput instanceof HTMLInputElement) ||
    !(amplitudeInput instanceof HTMLInputElement) ||
    !(phaseInput instanceof HTMLInputElement) ||
    !(waveformSelect instanceof HTMLSelectElement) ||
    !(pulseWidthField instanceof HTMLElement) ||
    !(pulseDelayField instanceof HTMLElement) ||
    !(pulseWidthInput instanceof HTMLInputElement) ||
    !(pulseDelayInput instanceof HTMLInputElement) ||
    !(injectionSelect instanceof HTMLSelectElement) ||
    !(exciteSelect instanceof HTMLSelectElement) ||
    !(polarizationAngleField instanceof HTMLElement) ||
    !(polarizationAngleInput instanceof HTMLInputElement) ||
    !(cancelBtn instanceof HTMLButtonElement) ||
    !(applyAllBtn instanceof HTMLButtonElement) ||
    !(openBtn instanceof HTMLButtonElement)
  ) {
    throw new Error("Signal settings elements not found.");
  }

  const frequencyLabel =
    frequencyInput.closest("label")?.querySelector("span") || null;

  function updateDynamicEnablement() {
    const isPulse = waveformSelect.value !== "cw";
    // Keep fields visible for clarity; disable when not applicable.
    pulseWidthInput.disabled = !isPulse;
    pulseDelayInput.disabled = !isPulse;
    polarizationAngleInput.disabled = exciteSelect.value !== "e";
    pulseWidthField.style.opacity = isPulse ? "1" : "0.6";
    pulseDelayField.style.opacity = isPulse ? "1" : "0.6";
    polarizationAngleField.style.opacity = exciteSelect.value === "e" ? "1" : "0.6";
  }

  function syncFromState() {
    const state = store.getState();
    const defaults = state.simulation.sourceDefaults;
    frequencyInput.value = String(defaults.frequency);
    amplitudeInput.value = String(defaults.amplitude);
    phaseInput.value = String(defaults.phase);
    waveformSelect.value = defaults.waveform || "cw";
    pulseWidthInput.value = String(defaults.pulseWidth ?? 0.4);
    pulseDelayInput.value = String(defaults.pulseDelay ?? 0);
    injectionSelect.value = defaults.injection || "soft";
    exciteSelect.value = defaults.excite || "hz";
    polarizationAngleInput.value = String(defaults.polarizationAngle ?? 0);

    updateDynamicEnablement();

    // Model-specific hinting
    if (frequencyLabel instanceof HTMLElement) {
      frequencyLabel.textContent =
        state.simulation.model === "em2d" ? "Frequency (scaled)" : "Frequency";
    }
    frequencyInput.title =
      state.simulation.model === "em2d"
        ? "EM mode uses a scaled frequency for real-time visualization. Wavelength ≈ speed / frequency."
        : "Scalar wave frequency (arbitrary units).";
  }

  function openModal() {
    syncFromState();
    backdrop.hidden = false;
    frequencyInput.focus();
  }

  function closeModal() {
    backdrop.hidden = true;
  }

  openBtn.addEventListener("click", () => {
    openModal();
  });

  // Changing selects should NOT overwrite the user's in-progress edits.
  // Only update enablement/visibility on change; syncFromState() is used on open.
  waveformSelect.addEventListener("change", () => updateDynamicEnablement());
  exciteSelect.addEventListener("change", () => updateDynamicEnablement());

  function readSettingsFromForm() {
    const state = store.getState();
    const isEm = state.simulation.model === "em2d";
    const frequency = clamp(
      readNumber(frequencyInput, isEm ? 5 : 1.5),
      isEm ? 0.01 : 0.1,
      isEm ? 50 : 6
    );
    const amplitude = clamp(readNumber(amplitudeInput, 1), 0, 10);
    const phase = clamp(readNumber(phaseInput, 0), -Math.PI, Math.PI);
    const waveformRaw = waveformSelect.value;
    const waveform =
      waveformRaw === "gaussian" || waveformRaw === "ricker" ? waveformRaw : "cw";
    const pulseWidth = clamp(readNumber(pulseWidthInput, 0.4), 0.001, 20);
    const pulseDelay = clamp(readNumber(pulseDelayInput, 0), 0, 20);
    const injection = injectionSelect.value === "hard" ? "hard" : "soft";
    const exciteRaw = exciteSelect.value;
    const excite =
      exciteRaw === "ex" || exciteRaw === "ey" || exciteRaw === "e" || exciteRaw === "hz"
        ? exciteRaw
        : "hz";
    const polarizationAngle = clamp(readNumber(polarizationAngleInput, 0), -180, 180);
    return {
      frequency,
      amplitude,
      phase,
      waveform,
      pulseWidth,
      pulseDelay,
      injection,
      excite,
      polarizationAngle
    };
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const settings = readSettingsFromForm();

    store.updateState((draft) => {
      draft.simulation.sourceDefaults = settings;
      return draft;
    });

    closeModal();
  });

  applyAllBtn.addEventListener("click", () => {
    const settings = readSettingsFromForm();
    store.updateState((draft) => {
      draft.simulation.sourceDefaults = settings;
      draft.sources = (draft.sources || []).map((s) => ({
        ...s,
        amplitude: settings.amplitude,
        frequency: settings.frequency,
        phase: settings.phase,
        waveform: settings.waveform,
        pulseWidth: settings.pulseWidth,
        pulseDelay: settings.pulseDelay,
        injection: settings.injection,
        excite: settings.excite,
        polarizationAngle: settings.polarizationAngle
      }));
      return draft;
    });
    closeModal();
  });

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

  return {
    openModal,
    closeModal
  };
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
