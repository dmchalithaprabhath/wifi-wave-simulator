// @ts-check

/** @typedef {import("./types.js").SimulationState} SimulationState */

import { isSimulationState } from "./state.js";

const STORAGE_KEY = "wifi-wave-sim-state-v1";

/**
 * @param {SimulationState} state
 */
export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error("Failed to save state", error);
  }
}

/**
 * @returns {SimulationState | null}
 */
export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (isSimulationState(parsed)) {
      return parsed;
    }
  } catch (error) {
    console.warn("Failed to load state", error);
  }
  return null;
}

/**
 * @param {SimulationState} state
 */
export function exportStateToFile(state) {
  const payload = JSON.stringify(state, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "wifi-wave-sim-state.json";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * @param {File} file
 * @returns {Promise<SimulationState>}
 */
export async function importStateFromFile(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  if (!isSimulationState(parsed)) {
    throw new Error("Invalid simulation state file.");
  }
  return parsed;
}
