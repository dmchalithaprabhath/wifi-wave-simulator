// @ts-check

export function buildPalette() {
  const stops = [
    { t: 0, color: [8, 10, 20] },
    { t: 0.25, color: [0, 64, 128] },
    { t: 0.5, color: [0, 180, 180] },
    { t: 0.75, color: [255, 210, 64] },
    { t: 1, color: [255, 80, 32] }
  ];

  const palette = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i += 1) {
    const t = i / 255;
    const { lower, upper } = findStops(stops, t);
    const span = upper.t - lower.t || 1;
    const localT = (t - lower.t) / span;
    const color = interpolateColor(lower.color, upper.color, localT);
    palette[i * 4] = color[0];
    palette[i * 4 + 1] = color[1];
    palette[i * 4 + 2] = color[2];
    palette[i * 4 + 3] = 255;
  }
  return palette;
}

/**
 * @param {Uint8ClampedArray} palette
 * @param {number} t
 * @returns {[number, number, number]}
 */
export function samplePalette(palette, t) {
  const index = Math.min(255, Math.max(0, Math.floor(t * 255)));
  const offset = index * 4;
  return [palette[offset], palette[offset + 1], palette[offset + 2]];
}

/**
 * @param {{ t: number, color: number[] }[]} stops
 * @param {number} t
 */
function findStops(stops, t) {
  let lower = stops[0];
  let upper = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i += 1) {
    if (t >= stops[i].t && t <= stops[i + 1].t) {
      lower = stops[i];
      upper = stops[i + 1];
      break;
    }
  }
  return { lower, upper };
}

/**
 * @param {number[]} a
 * @param {number[]} b
 * @param {number} t
 */
function interpolateColor(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t)
  ];
}
