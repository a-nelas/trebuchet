# Trebuchet Simulator

An interactive, browser-only **counterweight trebuchet** physics simulator. It
helps you explore geometry, counterweight, and loss settings that launch a
**0.5–1.5 kg projectile** to a **20–25 m** target, watch the throw and flight
animate, and compare configurations.

It is an **educational physics toy**, not a structural-engineering or
construction tool. See [Disclaimer](#disclaimer).

Everything runs locally: plain **HTML + CSS + vanilla JavaScript** with an HTML5
Canvas for the animation and the trajectory chart. There is **no backend, no
build step, no dependencies, and no network access** — open the page and it
works.

---

## Features

- **Live simulation** — every parameter change re-runs the model and updates the
  diagram, chart, and results.
- **Animated side view** on Canvas: ground, frame, pivot, long/short arms,
  counterweight (fixed or hinged), sling, projectile, target marker, the flight
  path, and the release-velocity vector. Phases: cocked → counterweight drop →
  arm rotation → sling whip → release → ballistic flight → impact.
- **Transport controls** — play/pause, step, restart, 0.1×/0.25×/0.5×/1× speed,
  a scrubbable timeline, and a live simulation-time readout.
- **Trajectory chart** on Canvas — height vs. distance, the 20–25 m target band,
  the target marker with tolerance whiskers, the drag trajectory, a vacuum
  comparison curve, apex and impact markers, and a hover readout of distance,
  height, speed, and time.
- **Full results panel** — range, error vs. target, launch speed/angle/height,
  max height, flight time, impact speed/angle, counterweight potential energy,
  projectile kinetic energy at release, total modeled efficiency, energy lost,
  arm-tip speed, and an On target / Short / Long / Invalid status.
- **Find configurations** — a bounded grid search (run in chunks so the page
  stays responsive) that returns the best target-hitting setups, ranked by range
  error, then counterweight mass, launch energy, and sensitivity.
- **Sensitivity analysis** — perturbs key parameters by ±1% and ±5% (wind by
  ±0.1 / ±0.5 m/s) and flags configurations too twitchy to reproduce in reality.
- **Six presets** (0.5/1.0/1.5 kg × 20/25 m), tuned with the model itself and
  re-simulated live so the shown range is always honest.
- **Config portability** — copy/import JSON and a shareable URL hash that encodes
  the configuration.
- **UX** — synchronized sliders + numeric fields (each showing unit, min, max,
  step, and value), keyboard-accessible controls, ARIA labels, live regions,
  reduced-motion support, light/dark themes, `localStorage` persistence,
  tooltips, inline validation messages (never a raw JS error), and a built-in
  self-test panel.

---

## Run it locally

Because the project is fully static you have two options.

### Option A — open the file directly

Open `index.html` in any modern browser. Everything works, including
`localStorage`; only the clipboard "Copy/Share" buttons may be restricted by the
browser on the `file://` scheme, in which case a fallback copy is attempted.

### Option B — a simple static HTTP server (recommended)

From the project folder:

```bash
# Python 3
python -m http.server 8080

# or Node
npx serve .

# or PHP
php -S localhost:8080
```

Then visit <http://localhost:8080/>.

### Running the physics self-tests outside the browser (optional)

`simulation.js` exports its physics core under Node, so the same assertions the
in-page **Run tests** button uses can run headless:

```bash
node -e "const m=require('./simulation.js');
const r=m.SelfTest.run();
const f=r.filter(x=>!x.pass);
console.log((r.length-f.length)+'/'+r.length+' pass');
f.forEach(x=>console.log('FAIL',x.name,x.detail));"
```

---

## Deploy with GitHub Pages

1. Push the files to a GitHub repository (for example `trebuchet-simulator`).
2. Open the repository **Settings**.
3. Open **Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select the **`main`** branch and the **`/root`** folder, then **Save**.
6. Wait for the build to finish and open the resulting URL, e.g.
   `https://username.github.io/trebuchet-simulator/`.

All asset paths in `index.html` are **relative** (`./styles.css`,
`./simulation.js`), so the site works from a project subdirectory without any
configuration. The included empty **`.nojekyll`** file tells GitHub Pages to
serve the files as-is (no Jekyll processing).

---

## Physics model overview

All internal math is in **SI units** (metres, kilograms, seconds, radians);
units are converted only for display. Everything below is a **transparent
approximation** — the same equations appear as comments in `simulation.js` and
in the on-page "Physics assumptions & equations" section.

### Throw phase — quasi-static energy balance

The arm is a rigid body rotating about the pivot. Instead of integrating a stiff
multi-body ODE, the model sweeps the arm from the cocked angle to the release
angle and, at each arm angle θ, balances energy:

```
M·g·drop(θ)·η  =  ½·I_total·ω²(θ)  +  m_p·g·Δh_p(θ)  +  m_arm·g·Δh_arm(θ)
η = cwEfficiency · (1 − frictionLoss) · (1 − flexLoss)
```

Solving for ω(θ) gives the arm's angular speed everywhere; integrating
`dt = dθ/ω` yields the throw timing used by the animation. **Counterweight
potential energy is never handed entirely to the projectile** — the arm, the
counterweight's coupled motion, and the projectile share it through the combined
rotational inertia.

Rotational inertia about the pivot:

```
I_arm = (1/12)·m_arm·(L1+L2)²  +  m_arm·d_com²     (uniform beam + parallel axis)
I_cw  = M·L2²         (fixed)   or   0.5·M·L2²      (hinged coupling factor)
I_p   = m_p·(L1+Ls)²                                (sling taut & arm-aligned)
```

The sling is **kinematic, not dynamic**: its fold-back angle relative to the arm
eases from the initial sling angle to fully aligned at release. Launch speed is
`v = ω_release·(L1+Ls)·(1 − slingLoss)`, directed perpendicular to the arm+sling
line; the chosen release angle is the launch elevation.

### Flight phase — numerical integration (the primary result)

After release the projectile is integrated with **semi-implicit Euler** at the
user's time step. Drag mode uses quadratic drag with wind in the relative
velocity:

```
F_drag = ½·ρ·Cd·A·|v_rel|²        v_rel = v − (wind, 0)
```

Vacuum mode drops the drag term. Integration stops when the projectile crosses
the landing plane (ground, or the optional target height), and the exact impact
point is linearly interpolated between the last two steps. The closed-form range
equation is used **only** as a cross-check inside the self-tests — never as the
reported result.

---

## Configuration-search algorithm

The **Find configurations** feature holds your current projectile, loss, and
environment settings fixed and searches a bounded grid of the four geometry
levers plus counterweight mass:

- counterweight mass — 10 values (20…300 kg)
- long arm — 6 values (1.2…3.2 m)
- short arm — 4 values (0.4…1.0 m)
- sling length — 5 values (0.8…2.4 m)
- release angle — 5 values (30…60°)

≈ 6,000 combinations. To stay fast and accurate it runs in two passes:

1. **Coarse pass** — every combination is simulated with a large time step and a
   short energy sweep (release speed depends only on the sweep endpoints, so this
   stays faithful). The best ~30 by range error advance.
2. **Fine pass** — finalists are re-simulated at the fine time step and each is
   given a **sensitivity score**: the largest range shift when counterweight mass
   and sling length each wobble ±2%.

Final ranking: **|range error| → counterweight mass → input energy →
sensitivity**. The top 8 appear in a table; click **Load** to push a result into
the simulator.

The work is chunked through `requestAnimationFrame` (≈250 evaluations per frame)
with a progress bar and a working **Cancel** button, so the browser never
freezes — no Web Worker required at this grid size.

---

## Modifying parameter ranges

Every control is defined once in the **`CONFIG`** array at the top of
`simulation.js`. Each entry looks like:

```js
{ key: 'cwMass', group: 'counterweight', label: 'Counterweight mass', unit: 'kg',
  min: 10, max: 300, step: 1, def: 46, url: 'cw', randomize: true, part: 'counterweight',
  tip: 'Mass of the falling counterweight — the machine’s energy source.' },
```

- **`min` / `max` / `step` / `def`** — bounds, granularity, and default. The
  sliders, numeric fields, quantization, randomizer, JSON import clamping, and
  URL codec all read these, so changing them here changes the whole app
  consistently.
- **`url`** — the short key used in the shareable URL hash (keep these unique).
- **`randomize`** — whether **Randomize** may move this parameter.
- **`unit` / `label` / `tip`** — display text and the tooltip.

To change the **search grid**, edit the `SEARCH_GRID` object further down in
`simulation.js`. To adjust what counts as "on target," change the **Target
distance/tolerance** controls in the UI (or their defaults in `CONFIG`).

If you widen a range so far that a preset no longer hits its target, the preset
row simply reports the honest live result — presets are always re-simulated, not
hard-coded.

---

## Known limitations

This model deliberately trades physical completeness for transparency and speed.
It does **not** capture:

- True multi-body dynamics of arm + hinged counterweight + sling (replaced by the
  energy balance and a fixed hinge-coupling factor).
- Sling tension, whip dynamics, and release-pin geometry (replaced by an
  interpolated sling angle plus a user-set release angle and loss percentage).
- Frame compliance, wheel/base motion, and axle friction modeled as a torque
  (friction enters only as an energy-loss percentage).
- Air resistance on the arm and sling, projectile spin / the Magnus effect,
  vertical wind, gusts, and altitude-dependent air density.
- **Material strength** — the simulator will happily "launch" configurations that
  would destroy a real machine.

Treat all outputs as **rough estimates**, useful for building intuition and
comparing configurations, not as engineering predictions.

---

## Project structure

| File            | Purpose                                                        |
| --------------- | ------------------------------------------------------------- |
| `index.html`    | Single-page app markup and the physics-assumptions text.      |
| `styles.css`    | Engineering-dashboard styling, light/dark themes, responsive. |
| `simulation.js` | Physics core, rendering, animation, search, UI (see modules). |
| `README.md`     | This file.                                                    |
| `.nojekyll`     | Disables Jekyll on GitHub Pages so files are served as-is.    |

`simulation.js` is organized into commented modules: `CONFIG`, `Utils`,
`Validation`, `TrebuchetModel`, `FlightModel`, `Simulator`, `AppState`,
`SceneRenderer`, `ChartRenderer`, `AnimationController`, `ConfigSearch`,
`Sensitivity`, `Presets`, `SelfTest`, and `UI`. The physics core is
Node-importable so it can be tested headlessly.

---

## Disclaimer

This simulator is for **education and exploration only**. It is a simplified
physical approximation and is **not** a substitute for professional structural
analysis, engineering design, or physical testing. Real-world results depend on
friction, structural flexibility, release mechanics, sling behaviour,
aerodynamics, material strength, construction quality, and safety factors that
this model does not fully represent. Do not rely on it to design or build a real
machine. If you build a physical trebuchet, follow appropriate engineering
practice and safety precautions.
