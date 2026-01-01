# WiFi Wave Simulator (EM FDTD)

A web-based, interactive **2D/3D electromagnetic wave (WiFi-like) visualization** tool built with a **2D TEz FDTD-style solver**. Designed for educational and schematic use: you can place multiple sources, draw obstacles, and observe qualitative propagation effects like reflection, diffraction through openings, and attenuation.

> Note: This is a **2D EM simulation** (fields evolve on an x–y plane) with a **WebGL 3D surface visualization** of the same data. It is not a full 3D volumetric EM solver, and “WiFi” frequency is **scaled** for real-time browser performance.

---

## Features

### Simulation (EM)
- **2D TEz FDTD-style EM model** (fields: `Ex`, `Ey`, `Hz`)
- **Multiple sources** with editable parameters:
  - Waveform: **CW**, **Gaussian pulse**, **Ricker wavelet**
  - Injection: **Soft** / **Hard**
  - Excitation: **Hz**, **Ex**, **Ey**, or **E (rotated)**
  - Polarization angle (for rotated E)
- **Materials / obstacles** (rectangles, circles) with presets + custom:
  - Presets: Air, Drywall, Concrete, Metal, Custom (εr, σ)
- **Diffraction** through apertures and propagation around obstacles (qualitative)
- **Attenuation** support (to resemble distance weakening)

### Visualization & UI
- **2D planar view** (canvas heatmap/field view)
- **3D WebGL view** (surface heightfield of the same simulation)
- **X-ray walls** in 3D (transparent walls to see wave energy inside)
- **Source + shape management**
  - Add multiple sources
  - Move sources interactively (drag)
  - Draw rectangles/circles
  - Resize shapes via handles with optional snapping
- **Properties panel**
  - Edit selected source/shape values
  - “Apply” button with dirty/applied feedback
- **Export / Import state**
  - Save/load full simulation scene as JSON

---

## Tech Stack
- **Vanilla JavaScript (ES Modules)**
- **Canvas 2D** for the 2D view
- **WebGL** for the 3D surface renderer
- No build system required (static files)

---

## Getting Started (Local)

### Option A: Open with a local web server (recommended)
ES modules typically require HTTP. Use one of these:

#### Python
python3 -m http.server 5173#### Node (http-server)
npx http-server -p 5173Then open:
- `http://localhost:5173/`

### Option B: Direct file open (may fail)
Some browsers block module imports from `file://`. If you see import errors, use Option A.

---

## Hosting on GitHub Pages

1. Push the project to a GitHub repository.
2. In GitHub:
   - **Settings → Pages**
   - Source: **Deploy from a branch**
   - Branch: `main`
   - Folder: `/ (root)`
3. Your site will be available at:
   - `https://YOUR_USERNAME.github.io/YOUR_REPO_NAME/`

---

## How to Use

### Views
- **Mode: 2D / 3D**
  - Switch between planar view and WebGL surface view.
- **Output: Instant / Averaged**
  - Instant: raw field magnitude per frame
  - Averaged: smoothed magnitude (more stable but hides short pulses)

### Sources
- Use **Place Source** tool (2D mode).
- Drag sources to reposition.
- Edit a source in the **Properties** panel:
  - **Amplitude**: strength of emission
  - **Frequency (scaled)**: controls wavelength (λ ≈ speed / frequency)
  - **Phase**: phase shift (time offset for sinusoid)
  - **Waveform**:
    - **CW**: continuous emission
    - **Gaussian / Ricker**: transient pulses
  - **Pulse width / Pulse delay**:
    - Used for Gaussian/Ricker only
    - Tip: if you don’t see a pulse, **Reset Simulation** and set delay to a future time (e.g., 0.5s)
  - **Injection**:
    - Soft = adds to field
    - Hard = overwrites the field at the source cell
  - **Excite / Pol angle** (EM-specific):
    - Select which field component is driven
    - Pol angle applies to rotated E only

### Shapes (Obstacles / Materials)
- Draw **Rectangle** or **Circle** in 2D mode.
- Set parameters in the dialog (size, height, rotation, material).
- Drag and resize shapes; optionally snap to nearby shape features.

---

## Notes on Physical Meaning / Limitations

- This is a **2D TEz** EM simulation:
  - Fields evolve in x–y.
  - The 3D view is a visualization of that 2D field, not true 3D EM.
- “WiFi frequency” is **scaled** (lowered) so waves can be visualized and computed in real time in-browser.
- Boundary absorption and numerical dispersion depend on resolution and settings:
  - If you see strong edge reflections, increase domain size and/or adjust settings.

---

## File Structure (Quick Tour)
- `index.html` — UI and layout
- `style.css` — styling
- `src/app.js` — app bootstrap + main loop
- `src/state.js` — default state + normalization
- `src/ui.js` — UI wiring + properties panel
- `src/signalSettings.js` — signal defaults modal
- `src/solver.js` — EM solver + source injection logic
- `src/renderer2d.js` — 2D rendering + editor interactions
- `src/renderer3d.js` — WebGL surface renderer + x-ray walls
- `src/modal.js` — shape creation modal

---

## Export / Import
Use the **Export** button to download a JSON save-state.  
Use **Import** to restore a saved scene later.

---

## Browser Support
Works best on modern Chromium-based browsers (Chrome/Edge) and Firefox with WebGL enabled.

---

## License
Add your preferred license (MIT is common for open-source). If this work is client-owned, keep the repository private or add a suitable proprietary license.

---

## Credits / References
This project uses concepts from Finite-Difference Time-Domain (FDTD) methods and TEz polarization commonly used in educational EM simulations.

## How to Use

### Views
- **Mode: 2D / 3D**
  - Switch between planar view and WebGL surface view.
- **Output: Instant / Averaged**
  - Instant: raw field magnitude per frame
  - Averaged: smoothed magnitude (more stable but hides short pulses)

### Sources
- Use **Place Source** tool (2D mode).
- Drag sources to reposition.
- Edit a source in the **Properties** panel:
  - **Amplitude**: strength of emission
  - **Frequency (scaled)**: controls wavelength (λ ≈ speed / frequency)
  - **Phase**: phase shift (time offset for sinusoid)
  - **Waveform**:
    - **CW**: continuous emission
    - **Gaussian / Ricker**: transient pulses
  - **Pulse width / Pulse delay**:
    - Used for Gaussian/Ricker only
    - Tip: if you don’t see a pulse, **Reset Simulation** and set delay to a future time (e.g., 0.5s)
  - **Injection**:
    - Soft = adds to field
    - Hard = overwrites the field at the source cell
  - **Excite / Pol angle** (EM-specific):
    - Select which field component is driven
    - Pol angle applies to rotated E only

### Shapes (Obstacles / Materials)
- Draw **Rectangle** or **Circle** in 2D mode.
- Set parameters in the dialog (size, height, rotation, material).
- Drag and resize shapes; optionally snap to nearby shape features.

---

## Notes on Physical Meaning / Limitations

- This is a **2D TEz** EM simulation:
  - Fields evolve in x–y.
  - The 3D view is a visualization of that 2D field, not true 3D EM.
- “WiFi frequency” is **scaled** (lowered) so waves can be visualized and computed in real time in-browser.
- Boundary absorption and numerical dispersion depend on resolution and settings:
  - If you see strong edge reflections, increase domain size and/or adjust settings.

---

## File Structure (Quick Tour)
- `index.html` — UI and layout
- `style.css` — styling
- `src/app.js` — app bootstrap + main loop
- `src/state.js` — default state + normalization
- `src/ui.js` — UI wiring + properties panel
- `src/signalSettings.js` — signal defaults modal
- `src/solver.js` — EM solver + source injection logic
- `src/renderer2d.js` — 2D rendering + editor interactions
- `src/renderer3d.js` — WebGL surface renderer + x-ray walls
- `src/modal.js` — shape creation modal

---

## Export / Import
Use the **Export** button to download a JSON save-state.  
Use **Import** to restore a saved scene later.

---

## Browser Support
Works best on modern Chromium-based browsers (Chrome/Edge) and Firefox with WebGL enabled.

---

## License
Add your preferred license (MIT is common for open-source). If this work is client-owned, keep the repository private or add a suitable proprietary license.

---

## Credits / References
This project uses concepts from Finite-Difference Time-Domain (FDTD) methods and TEz polarization commonly used in educational EM simulations.
