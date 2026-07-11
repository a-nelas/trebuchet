/* ============================================================================
 * Trebuchet Simulator — simulation.js
 * ----------------------------------------------------------------------------
 * Educational counterweight-trebuchet simulator. Vanilla JS, no dependencies.
 *
 * The file is organised into self-contained "modules" (plain objects/classes):
 *   CONFIG            — single source of truth for every parameter
 *   Utils             — math/formatting helpers
 *   Validation        — human-readable configuration checks
 *   TrebuchetModel    — throw phase: quasi-static energy balance (documented)
 *   FlightModel       — projectile flight: numerical integration
 *   Simulator         — orchestrates validate → throw → flight → metrics
 *   AppState          — parameters, persistence, JSON + URL codecs
 *   SceneRenderer     — canvas side view of the machine
 *   ChartRenderer     — canvas trajectory chart with hover readout
 *   AnimationController — timeline playback/scrubbing over precomputed frames
 *   ConfigSearch      — chunked grid search for target-hitting configurations
 *   Sensitivity       — small-perturbation analysis
 *   Presets           — six model-tuned starting points
 *   SelfTest          — in-page assertions on the physics core
 *   UI                — builds controls and wires everything together
 *
 * PHYSICS DISCLAIMER: everything here is a deliberate approximation for
 * education. It is not a structural-engineering or construction tool.
 * All internal quantities are SI (m, kg, s, rad); degrees appear only at the
 * UI boundary.
 * ==========================================================================*/

'use strict';

/* ============================================================================
 * CONFIG — parameter definitions
 * Every control, bound, step, unit, tooltip, URL key and randomize rule lives
 * here so the UI, validation, JSON import and URL codec can never disagree.
 * ==========================================================================*/

const CONFIG = [
  /* ------------------------------ projectile ---------------------------- */
  { key: 'massP', group: 'projectile', label: 'Projectile mass', unit: 'kg',
    min: 0.5, max: 1.5, step: 0.01, def: 1.0, url: 'm', randomize: true,
    tip: 'Mass of the thrown projectile. The 20–25 m goal in this app assumes 0.5–1.5 kg.' },
  { key: 'diameter', group: 'projectile', label: 'Projectile diameter', unit: 'm',
    min: 0.05, max: 0.20, step: 0.005, def: 0.10, url: 'd', randomize: true,
    tip: 'Used for the aerodynamic cross-section A = π·(d/2)² in drag mode.' },
  { key: 'dragCoeff', group: 'projectile', label: 'Drag coefficient (Cd)', unit: '–',
    min: 0.1, max: 1.2, step: 0.01, def: 0.47, url: 'cd', randomize: true,
    tip: 'Dimensionless drag coefficient. ≈0.47 for a smooth sphere; higher for irregular shapes.' },
  { key: 'airDensity', group: 'projectile', label: 'Air density', unit: 'kg/m³',
    min: 0.9, max: 1.4, step: 0.005, def: 1.225, url: 'rho', randomize: false,
    tip: 'Sea-level standard air is 1.225 kg/m³. Lower at altitude or high temperature.' },

  /* ------------------------------- geometry ----------------------------- */
  { key: 'longArm', group: 'geometry', label: 'Long arm (pivot → sling)', unit: 'm',
    min: 1.0, max: 4.0, step: 0.05, def: 2.2, url: 'l1', randomize: true,
    tip: 'Distance from the pivot axle to the sling attachment at the throwing tip.' },
  { key: 'shortArm', group: 'geometry', label: 'Short arm (pivot → CW)', unit: 'm',
    min: 0.2, max: 1.5, step: 0.05, def: 0.6, url: 'l2', randomize: true,
    tip: 'Distance from the pivot axle to the counterweight attachment.' },
  { key: 'slingLength', group: 'geometry', label: 'Sling length', unit: 'm',
    min: 0.5, max: 3.0, step: 0.05, def: 1.6, url: 'ls', randomize: true,
    tip: 'Length of the sling from arm tip to pouch. Longer slings raise launch speed but demand clearance.' },
  { key: 'pivotHeight', group: 'geometry', label: 'Pivot height', unit: 'm',
    min: 0.5, max: 3.0, step: 0.05, def: 2.0, url: 'h', randomize: true,
    tip: 'Height of the pivot axle above the ground.' },
  { key: 'armAngle0', group: 'geometry', label: 'Initial arm angle', unit: '°',
    min: 20, max: 80, step: 1, def: 42, url: 'a0', randomize: true,
    tip: 'Cocked position: how far the long arm points below horizontal (on the side away from the target).' },
  { key: 'slingAngle0', group: 'geometry', label: 'Initial sling angle', unit: '°',
    min: 0, max: 120, step: 1, def: 45, url: 's0', randomize: true,
    tip: 'Fold-back angle between the sling and the arm’s outward direction at the cocked position. 0° = sling extends straight beyond the tip.' },
  { key: 'releaseAngle', group: 'geometry', label: 'Release angle', unit: '°',
    min: 10, max: 80, step: 0.5, def: 40, url: 'ra', randomize: true,
    tip: 'Release-pin equivalent: launch elevation above horizontal. In this simplified geometry the pin lets go when the arm+sling line reaches 90° + this angle.' },
  { key: 'armMass', group: 'geometry', label: 'Arm mass', unit: 'kg',
    min: 2, max: 40, step: 0.5, def: 8, url: 'am', randomize: true,
    tip: 'Mass of the beam. Heavier arms soak up counterweight energy as rotational inertia.' },
  { key: 'armCom', group: 'geometry', label: 'Arm centre of mass', unit: 'm',
    min: -1.0, max: 2.0, step: 0.05, def: 0.4, url: 'ac', randomize: true,
    tip: 'Signed distance of the arm’s centre of mass from the pivot; positive toward the long (throwing) end.' },

  /* ----------------------------- counterweight -------------------------- */
  { key: 'cwMass', group: 'counterweight', label: 'Counterweight mass', unit: 'kg',
    min: 10, max: 300, step: 1, def: 120, url: 'cw', randomize: true,
    tip: 'Mass of the falling counterweight — the machine’s energy source.' },
  { key: 'cwMode', group: 'counterweight', label: 'Counterweight mode', unit: '',
    type: 'select', options: [['hinged', 'Hinged (hanging)'], ['fixed', 'Fixed to arm']],
    def: 'hinged', url: 'cm', randomize: false,
    tip: 'A hinged (hanging) counterweight falls more vertically and wastes less energy in its own rotation. Modeled by a reduced inertia coupling factor — a stated approximation.' },
  { key: 'cwDropAuto', group: 'counterweight', label: 'Drop height from geometry', unit: '',
    type: 'checkbox', def: true, url: 'da', randomize: false,
    tip: 'When checked, the drop height is derived from the arm sweep. Uncheck to limit it manually (emulating a stop or ground contact).' },
  { key: 'cwDrop', group: 'counterweight', label: 'Counterweight drop height', unit: 'm',
    min: 0.1, max: 4.0, step: 0.05, def: 1.5, url: 'dh', randomize: false,
    tip: 'Vertical distance the counterweight falls. Values above what the geometry allows are clamped.' },
  { key: 'cwEfficiency', group: 'counterweight', label: 'Counterweight efficiency', unit: '%',
    min: 0, max: 100, step: 1, def: 85, url: 'ce', randomize: true,
    tip: 'Fraction of counterweight potential energy that enters the throw at all (captures rigging and constraint losses not modeled explicitly).' },

  /* --------------------------- losses & environment --------------------- */
  { key: 'frictionLoss', group: 'losses', label: 'Pivot friction loss', unit: '%',
    min: 0, max: 30, step: 0.5, def: 5, url: 'fl', randomize: true,
    tip: 'Energy percentage lost at the axle, applied as a flat factor rather than a friction torque.' },
  { key: 'slingLoss', group: 'losses', label: 'Sling/release loss', unit: '%',
    min: 0, max: 30, step: 0.5, def: 5, url: 'sl', randomize: true,
    tip: 'Speed lost at release (pouch friction, pin scrub). Applied to the projectile’s launch speed.' },
  { key: 'flexLoss', group: 'losses', label: 'Structural flex loss', unit: '%',
    min: 0, max: 30, step: 0.5, def: 5, url: 'xl', randomize: true,
    tip: 'Energy percentage absorbed by frame and arm bending.' },
  { key: 'windSpeed', group: 'losses', label: 'Wind speed (+ = tailwind)', unit: 'm/s',
    min: -10, max: 10, step: 0.1, def: 0, url: 'w', randomize: false,
    tip: 'Horizontal wind along the throw direction. Positive pushes the projectile down-range. Only affects drag mode.' },
  { key: 'gravity', group: 'losses', label: 'Gravity', unit: 'm/s²',
    min: 1.0, max: 15.0, step: 0.01, def: 9.81, url: 'g', randomize: false,
    tip: 'Gravitational acceleration. 9.81 m/s² on Earth.' },
  { key: 'timeStep', group: 'losses', label: 'Simulation time step', unit: 's',
    min: 0.0005, max: 0.02, step: 0.0005, def: 0.002, url: 'dt', randomize: false,
    tip: 'Integration step for the flight phase. Smaller = more accurate and slower.' },
  { key: 'flightMode', group: 'losses', label: 'Flight mode', unit: '',
    type: 'select', options: [['drag', 'Aerodynamic drag'], ['vacuum', 'Vacuum']],
    def: 'drag', url: 'fm', randomize: false,
    tip: 'Primary flight model. The chart always shows the vacuum curve for comparison.' },

  /* -------------------------------- target ------------------------------ */
  { key: 'targetDistance', group: 'target', label: 'Target distance', unit: 'm',
    min: 20, max: 25, step: 0.1, def: 22.5, url: 'td', randomize: false,
    tip: 'Horizontal distance from the pivot to the target.' },
  { key: 'targetTolerance', group: 'target', label: 'Target tolerance', unit: 'm',
    min: 0.1, max: 5.0, step: 0.1, def: 1.0, url: 'tt', randomize: false,
    tip: 'A landing within ± this distance of the target counts as “on target”.' },
  { key: 'targetHeight', group: 'target', label: 'Target height', unit: 'm',
    min: 0, max: 2.0, step: 0.05, def: 0, url: 'th', randomize: false,
    tip: 'Optional raised landing plane. Flight stops when the projectile descends through this height.' },
];

const CONFIG_BY_KEY = Object.fromEntries(CONFIG.map(p => [p.key, p]));

function defaultParams() {
  const o = {};
  for (const p of CONFIG) o[p.key] = p.def;
  return o;
}

/* ============================================================================
 * Utils — small pure helpers
 * ==========================================================================*/

const Utils = {
  DEG: Math.PI / 180,

  clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); },

  lerp(a, b, t) { return a + (b - a) * t; },

  /** Snap a value onto a parameter's min/step lattice and clamp to bounds. */
  quantize(v, p) {
    if (p.type === 'select' || p.type === 'checkbox') return v;
    if (!Number.isFinite(v)) return p.def;
    const snapped = p.min + Math.round((v - p.min) / p.step) * p.step;
    // Round away float dust like 0.30000000000000004
    const decimals = Math.max(0, Math.ceil(-Math.log10(p.step)) + 1);
    return Utils.clamp(Number(snapped.toFixed(decimals)), p.min, p.max);
  },

  /** Format a number to a sensible precision for display. */
  fmt(v, digits) {
    if (!Number.isFinite(v)) return '—';
    if (digits !== undefined) return v.toFixed(digits);
    const a = Math.abs(v);
    if (a >= 100) return v.toFixed(0);
    if (a >= 10) return v.toFixed(1);
    return v.toFixed(2);
  },

  /** "Nice" axis ticks covering [min,max] with roughly n steps. */
  ticks(min, max, n) {
    const span = max - min;
    if (!(span > 0)) return [min];
    const rawStep = span / Math.max(1, n);
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
    let step = mag;
    for (const m of [1, 2, 5, 10]) { if (mag * m >= rawStep) { step = mag * m; break; } }
    const out = [];
    for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) {
      out.push(Number(v.toFixed(10)));
    }
    return out;
  },

  isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); },
};

/* ============================================================================
 * Validation — configuration checks with human-readable messages
 * Returns { errors: string[], warnings: string[] }. Never throws.
 * ==========================================================================*/

const Validation = {
  check(params) {
    const errors = [];
    const warnings = [];
    const P = params;
    const a0 = P.armAngle0 * Utils.DEG;      // cocked angle below horizontal
    const alpha = P.releaseAngle * Utils.DEG; // launch elevation

    for (const p of CONFIG) {
      const v = P[p.key];
      if (p.type === 'select') {
        if (!p.options.some(o => o[0] === v)) errors.push(`“${p.label}” has an unknown value.`);
      } else if (p.type === 'checkbox') {
        if (typeof v !== 'boolean') errors.push(`“${p.label}” must be true or false.`);
      } else if (!Number.isFinite(v)) {
        errors.push(`“${p.label}” is not a number.`);
      }
    }
    if (errors.length) return { errors, warnings };

    // Long-arm tip must clear the ground in the cocked position.
    const tipClearance = P.pivotHeight - P.longArm * Math.sin(a0);
    if (tipClearance < 0.02) {
      errors.push('The long-arm tip is underground at the cocked position — raise the pivot, shorten the long arm, or reduce the initial arm angle.');
    }

    // Counterweight must clear the ground at its lowest point in the sweep
    // (lowest at the release angle; hinged mode hangs ~0.3·L2 lower).
    const hang = P.cwMode === 'hinged' ? 0.3 * P.shortArm : 0;
    const cwLowest = P.pivotHeight - P.shortArm * Math.cos(alpha) - hang;
    if (cwLowest < 0.05) {
      errors.push('The counterweight would hit the ground during the swing — raise the pivot or shorten the short arm.');
    }

    // Raised landing plane must sit below the release point.
    const releaseY = P.pivotHeight + (P.longArm + P.slingLength) * Math.cos(alpha);
    if (P.targetHeight >= releaseY) {
      errors.push('The target height is above the release point — lower the target or enlarge the machine.');
    }

    if (P.cwMass / P.massP < 15) {
      warnings.push('Counterweight-to-projectile mass ratio is below 15:1 — real trebuchets usually need far heavier counterweights to throw efficiently.');
    }
    if (P.timeStep > 0.01) {
      warnings.push('A coarse time step (> 0.01 s) reduces the accuracy of the flight integration.');
    }
    return { errors, warnings };
  },
};

/* ============================================================================
 * TrebuchetModel — throw phase
 * ----------------------------------------------------------------------------
 * Geometry (side view, SI units, radians):
 *   x is positive down-range (toward the target), y is up, ground at y = 0.
 *   The pivot sits at (0, H). The long-arm direction is measured CCW from +x.
 *     cocked:  θ0   = π   + armAngle0   (tip low, on the up-range side)
 *     release: θrel = π/2 + releaseAngle (tip up, tilted up-range)
 *   The arm rotates clockwise (θ decreases). At θrel the tip velocity of the
 *   arm+sling line points at exactly `releaseAngle` above horizontal, so the
 *   user's release angle IS the launch elevation.
 *
 * Energy model (quasi-static): at each arm angle θ we assume all kinetic
 * energy is described by a single angular speed ω of the rigid arm with the
 * counterweight and projectile coupled to it:
 *
 *   M·g·drop(θ)·η = ½·I_total·ω²(θ) + m_p·g·Δh_p(θ) + m_arm·g·Δh_arm(θ)
 *
 *   η = cwEfficiency · (1 − frictionLoss) · (1 − flexLoss)
 *
 * Inertia about the pivot:
 *   I_arm = (1/12)·m_arm·(L1+L2)²  +  m_arm·d_com²   (uniform beam + parallel axis)
 *   I_cw  = M·L2²          (fixed)   or   0.5·M·L2²  (hinged — crude coupling factor)
 *   I_p   = m_p·(L1+Ls)²   (sling assumed taut and arm-aligned at release)
 *
 * The sling angle is NOT dynamic: its fold-back angle relative to the arm is
 * interpolated (with a 1.5-power ease so it stays folded early) from the
 * initial sling angle down to 0 at release. This affects the pouch position
 * (and so the projectile's potential-energy term and the animation), and is
 * clearly an approximation of real whip dynamics.
 * ==========================================================================*/

const HINGED_COUPLING = 0.5;   // effective inertia fraction for a hanging CW (approximation)
const STALL_TOLERANCE_J = 0.05; // energy deficit (J) treated as a genuine stall, not rounding
const MAX_THROW_TIME_S = 30;    // a swing slower than this counts as a stall

const TrebuchetModel = {
  /** Geometric drop of the CW attachment point over the full sweep (m). */
  geometricDrop(P) {
    const a0 = P.armAngle0 * Utils.DEG;
    const alpha = P.releaseAngle * Utils.DEG;
    // h_cw(θ) = H − L2·sinθ;  sin(θ0) = −sin(a0), sin(θrel) = cos(α)
    return P.shortArm * (Math.cos(alpha) + Math.sin(a0));
  },

  /** Combined rotational inertia about the pivot (kg·m²). */
  totalInertia(P) {
    const beamLen = P.longArm + P.shortArm;
    const iArm = (1 / 12) * P.armMass * beamLen * beamLen + P.armMass * P.armCom * P.armCom;
    const k = P.cwMode === 'hinged' ? HINGED_COUPLING : 1;
    const iCw = k * P.cwMass * P.shortArm * P.shortArm;
    const rp = P.longArm + P.slingLength;
    const iProj = P.massP * rp * rp;
    return { iArm, iCw, iProj, iTotal: iArm + iCw + iProj };
  },

  /**
   * Sweep the arm from cocked to release, solving the energy balance at each
   * angle. Returns null-free structured data or { stalled: true, reason }.
   * `steps` trades animation smoothness for speed (search uses few steps).
   */
  sweep(P, steps) {
    const N = Math.max(8, steps | 0);
    const a0 = P.armAngle0 * Utils.DEG;
    const alpha = P.releaseAngle * Utils.DEG;
    const theta0 = Math.PI + a0;
    const thetaRel = Math.PI / 2 + alpha;
    const H = P.pivotHeight;
    const L1 = P.longArm, L2 = P.shortArm, Ls = P.slingLength;
    const rp = L1 + Ls;
    const rProj = P.diameter / 2;
    const g = P.gravity;
    const eta = (P.cwEfficiency / 100) * (1 - P.frictionLoss / 100) * (1 - P.flexLoss / 100);
    const { iTotal, iArm, iCw, iProj } = this.totalInertia(P);
    const delta0 = P.slingAngle0 * Utils.DEG;

    const geomDrop = this.geometricDrop(P);
    // Manual drop override models a stop: energy input saturates at that drop.
    const dropLimit = P.cwDropAuto ? geomDrop : Math.min(P.cwDrop, geomDrop);

    const pouchAt = (theta, u) => {
      // u = remaining fraction of the sweep (1 at cocked → 0 at release).
      // Fold-back eases with u^1.5 so the sling stays trailing early on.
      const delta = delta0 * Math.pow(Math.max(0, u), 1.5);
      const sigma = theta - delta;                 // absolute sling direction
      const tipX = L1 * Math.cos(theta);
      const tipY = H + L1 * Math.sin(theta);
      const px = tipX + Ls * Math.cos(sigma);
      const py = Math.max(rProj, tipY + Ls * Math.sin(sigma)); // pouch can rest on the ground
      return { tipX, tipY, px, py, sigma };
    };

    const start = pouchAt(theta0, 1);
    const sinTheta0 = Math.sin(theta0);

    const thetas = new Float64Array(N + 1);
    const omegas = new Float64Array(N + 1);
    const times = new Float64Array(N + 1);
    const pouchX = new Float64Array(N + 1);
    const pouchY = new Float64Array(N + 1);

    for (let i = 0; i <= N; i++) {
      const f = i / N;
      const theta = theta0 + (thetaRel - theta0) * f;
      const u = 1 - f;
      const pos = pouchAt(theta, u);
      // Per-angle CW drop, saturated at the drop limit (monotonic over this sweep).
      const drop = Math.min(L2 * (Math.sin(theta) - sinTheta0), dropLimit);
      const eIn = P.cwMass * g * drop * eta;
      const dPEproj = P.massP * g * (pos.py - start.py);
      const dPEarm = P.armMass * g * P.armCom * (Math.sin(theta) - sinTheta0);
      const surplus = eIn - dPEproj - dPEarm;
      if (surplus < -STALL_TOLERANCE_J && i > N * 0.02) {
        return { stalled: true, reason: 'The counterweight cannot drive the arm through the swing — add counterweight mass or drop height, or lighten the projectile and arm.' };
      }
      thetas[i] = theta;
      omegas[i] = Math.sqrt(Math.max(0, 2 * surplus / iTotal));
      pouchX[i] = pos.px;
      pouchY[i] = pos.py;
      if (i > 0) {
        const dTheta = Math.abs(thetas[i] - thetas[i - 1]);
        const omegaMid = Math.max((omegas[i] + omegas[i - 1]) / 2, 1e-3);
        times[i] = times[i - 1] + dTheta / omegaMid;
      }
    }

    const tRelease = times[N];
    if (!Number.isFinite(tRelease) || tRelease > MAX_THROW_TIME_S) {
      return { stalled: true, reason: 'The arm barely moves — the configuration cannot complete a throw in a reasonable time.' };
    }

    const omegaRel = omegas[N];
    if (!(omegaRel > 0)) {
      return { stalled: true, reason: 'No angular speed remains at the release angle — the counterweight energy is fully consumed lifting the arm and projectile.' };
    }

    /* --- Release state -------------------------------------------------- */
    const slingFactor = 1 - P.slingLoss / 100;
    const v0 = omegaRel * rp * slingFactor;
    // Clockwise rotation: velocity of a point at angle θrel is along (sinθ, −cosθ).
    const vx = v0 * Math.sin(thetaRel);
    const vy = -v0 * Math.cos(thetaRel);
    const relX = rp * Math.cos(thetaRel);
    const relY = H + rp * Math.sin(thetaRel);

    /* --- Energy audit (all terms at the release instant, J) ------------- */
    const dropTotal = Math.min(L2 * (Math.sin(thetaRel) - sinTheta0), dropLimit);
    const eGross = P.cwMass * g * dropTotal;              // CW potential energy spent
    const eFactorLoss = eGross * (1 - eta);               // efficiency/friction/flex
    const endPos = pouchAt(thetaRel, 0);
    const ePEproj = P.massP * g * (endPos.py - start.py); // projectile lifted
    const ePEarm = P.armMass * g * P.armCom * (Math.sin(thetaRel) - sinTheta0);
    const keArm = 0.5 * iArm * omegaRel * omegaRel;
    const keCw = 0.5 * iCw * omegaRel * omegaRel;
    const keProjBefore = 0.5 * iProj * omegaRel * omegaRel;
    const eSlingLoss = keProjBefore * (1 - slingFactor * slingFactor);
    const keProj = keProjBefore - eSlingLoss;             // = ½·m_p·v0²

    return {
      stalled: false,
      theta0, thetaRel, omegaRel, tRelease,
      timeline: { thetas, omegas, times, pouchX, pouchY, N },
      release: { x: relX, y: relY, vx, vy, speed: v0, angleDeg: Math.atan2(vy, vx) / Utils.DEG },
      inertia: { iArm, iCw, iProj, iTotal },
      energy: {
        eGross, eFactorLoss, ePEproj, ePEarm, keArm, keCw, eSlingLoss, keProj,
        eta, dropUsed: dropTotal, geomDrop,
      },
      armTipSpeed: omegaRel * L1,
    };
  },
};

/* ============================================================================
 * FlightModel — projectile flight after release
 * ----------------------------------------------------------------------------
 * Semi-implicit Euler integration of
 *   a = (0, −g) − (½·ρ·Cd·A/m)·|v_rel|·v_rel        (drag mode)
 * with v_rel = v − (wind, 0). Vacuum mode drops the drag term. Integration
 * stops when the projectile descends through the landing plane (ground or the
 * optional target height); the exact crossing is linearly interpolated.
 * The closed-form range formula is never the primary result — it is only a
 * cross-check inside SelfTest.
 * ==========================================================================*/

const MAX_FLIGHT_TIME_S = 60;
const MAX_FLIGHT_X_M = 2000;
const SAMPLE_INTERVAL_S = 0.004; // trajectory sample spacing kept for chart/animation

const FlightModel = {
  /**
   * @param release {x, y, vx, vy}
   * @param P parameter object
   * @param useDrag override for drag vs vacuum (defaults to P.flightMode)
   * @param dt override time step
   */
  integrate(release, P, useDrag, dt) {
    const g = P.gravity;
    const step = Number.isFinite(dt) ? dt : P.timeStep;
    const drag = useDrag === undefined ? P.flightMode === 'drag' : useDrag;
    const area = Math.PI * (P.diameter / 2) * (P.diameter / 2);
    const kDrag = drag ? 0.5 * P.airDensity * P.dragCoeff * area / P.massP : 0;
    const wind = drag ? P.windSpeed : 0;
    const plane = P.targetHeight;

    let x = release.x, y = release.y, vx = release.vx, vy = release.vy, t = 0;
    const samples = [{ t, x, y, vx, vy }];
    const keepEvery = Math.max(1, Math.round(SAMPLE_INTERVAL_S / step));
    let maxY = y;
    const maxSteps = Math.ceil(MAX_FLIGHT_TIME_S / step);

    for (let i = 1; i <= maxSteps; i++) {
      const prevX = x, prevY = y, prevVx = vx, prevVy = vy, prevT = t;

      let ax = 0, ay = -g;
      if (kDrag > 0) {
        const rvx = vx - wind, rvy = vy;
        const speedRel = Math.hypot(rvx, rvy);
        ax -= kDrag * speedRel * rvx;
        ay -= kDrag * speedRel * rvy;
      }
      vx += ax * step;                 // semi-implicit: velocity first,
      vy += ay * step;
      x += vx * step;                  // then position with the new velocity
      y += vy * step;
      t = i * step;

      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(vx) || !Number.isFinite(vy)) {
        return { ok: false, reason: 'The flight integration produced a non-finite value — try a smaller time step.' };
      }
      if (y > maxY) maxY = y;

      if (y <= plane && vy < 0) {
        // Interpolate the plane crossing between the previous and current step.
        const f = (prevY - plane) / (prevY - y);
        const impact = {
          t: prevT + (t - prevT) * f,
          x: prevX + (x - prevX) * f,
          y: plane,
          vx: prevVx + (vx - prevVx) * f,
          vy: prevVy + (vy - prevVy) * f,
        };
        samples.push({ t: impact.t, x: impact.x, y: impact.y, vx: impact.vx, vy: impact.vy });
        return {
          ok: true, samples, impact, maxY,
          impactSpeed: Math.hypot(impact.vx, impact.vy),
          impactAngleDeg: Math.atan2(-impact.vy, impact.vx) / Utils.DEG,
          flightTime: impact.t,
        };
      }
      if (i % keepEvery === 0) samples.push({ t, x, y, vx, vy });
      if (x > MAX_FLIGHT_X_M) {
        return { ok: false, reason: 'The projectile flew beyond the simulation window (2 km) — check the configuration.' };
      }
    }
    return { ok: false, reason: 'The flight exceeded the 60 s simulation window without landing.' };
  },

  /** Closed-form vacuum range from a release state — SelfTest cross-check only. */
  closedFormVacuumRange(release, g, plane) {
    const h = release.y - plane;
    const disc = release.vy * release.vy + 2 * g * h;
    if (disc < 0) return NaN;
    const tLand = (release.vy + Math.sqrt(disc)) / g;
    return release.x + release.vx * tLand;
  },
};

/* ============================================================================
 * Simulator — orchestration and metrics
 * ==========================================================================*/

const Simulator = {
  /**
   * Run the full pipeline. opts: { sweepSteps, flightDt, needVacuum }
   * Returns a result object whose `status` is one of
   * 'ok' | 'invalid'; UI-facing labels (Short/On target/Long) live in metrics.
   */
  run(params, opts = {}) {
    const P = params;
    const { errors, warnings } = Validation.check(P);
    if (errors.length) {
      return { status: 'invalid', errors, warnings };
    }

    const sweep = TrebuchetModel.sweep(P, opts.sweepSteps || 240);
    if (sweep.stalled) {
      return { status: 'invalid', errors: [sweep.reason], warnings };
    }

    if (!P.cwDropAuto && P.cwDrop > sweep.energy.geomDrop + 1e-9) {
      warnings.push(`Manual drop height exceeds what the geometry allows — clamped to ${Utils.fmt(sweep.energy.geomDrop)} m.`);
    }

    const flight = FlightModel.integrate(sweep.release, P, undefined, opts.flightDt);
    if (!flight.ok) {
      return { status: 'invalid', errors: [flight.reason], warnings };
    }

    let vacuum = null;
    if (opts.needVacuum !== false) {
      const v = FlightModel.integrate(sweep.release, P, false, opts.flightDt);
      if (v.ok) vacuum = v;
    }

    const range = flight.impact.x;
    const err = range - P.targetDistance;
    const withinTol = Math.abs(err) <= P.targetTolerance;
    const label = withinTol ? 'On target' : (err < 0 ? 'Short' : 'Long');
    const E = sweep.energy;
    const totalEfficiency = E.eGross > 0 ? E.keProj / E.eGross : 0;

    const metrics = {
      range, rangeError: err, label, withinTol,
      inBand2025: range >= 20 && range <= 25,
      launchSpeed: sweep.release.speed,
      releaseAngleDeg: sweep.release.angleDeg,
      releaseHeight: sweep.release.y,
      maxHeight: flight.maxY,
      flightTime: flight.flightTime,
      impactSpeed: flight.impactSpeed,
      impactAngleDeg: flight.impactAngleDeg,
      cwPotentialEnergy: E.eGross,
      projectileKE: E.keProj,
      totalEfficiency,
      energyLost: E.eGross - E.keProj,
      armTipSpeed: sweep.armTipSpeed,
      throwTime: sweep.tRelease,
    };

    if (!Number.isFinite(range) || !Number.isFinite(metrics.launchSpeed)) {
      return { status: 'invalid', errors: ['The model produced a non-finite result for this configuration.'], warnings };
    }

    return { status: 'ok', errors: [], warnings, sweep, flight, vacuum, metrics };
  },
};

/* ============================================================================
 * AppState — parameters, persistence, JSON and URL codecs
 * ==========================================================================*/

const STORAGE_KEY = 'trebsim.params.v1';
const THEME_KEY = 'trebsim.theme';

class AppState {
  constructor() {
    this.params = defaultParams();
    this.listeners = [];
  }

  subscribe(fn) { this.listeners.push(fn); }

  notify(changedKeys) { for (const fn of this.listeners) fn(changedKeys); }

  get(key) { return this.params[key]; }

  set(key, value, { silent = false } = {}) {
    const p = CONFIG_BY_KEY[key];
    if (!p) return false;
    let v = value;
    if (p.type === 'checkbox') v = Boolean(v);
    else if (p.type === 'select') v = p.options.some(o => o[0] === v) ? v : p.def;
    else v = Utils.quantize(Number(v), p);
    if (this.params[key] === v) return false;
    this.params[key] = v;
    if (!silent) this.notify([key]);
    return true;
  }

  setMany(obj, { silent = false } = {}) {
    const changed = [];
    for (const [k, v] of Object.entries(obj)) {
      if (this.set(k, v, { silent: true })) changed.push(k);
    }
    if (changed.length && !silent) this.notify(changed);
    return changed;
  }

  reset() {
    this.setMany(defaultParams());
  }

  toJSON() {
    return JSON.stringify({ app: 'trebuchet-simulator', version: 1, params: { ...this.params } }, null, 2);
  }

  /** Import a JSON string. Returns { ok, error?, applied? }. Clamps everything. */
  fromJSON(text) {
    let doc;
    try { doc = JSON.parse(text); } catch (e) {
      return { ok: false, error: 'That is not valid JSON.' };
    }
    const src = Utils.isObject(doc) && Utils.isObject(doc.params) ? doc.params
      : Utils.isObject(doc) ? doc : null;
    if (!src) return { ok: false, error: 'Expected an object with a "params" map.' };
    const known = {};
    for (const [k, v] of Object.entries(src)) if (CONFIG_BY_KEY[k]) known[k] = v;
    if (!Object.keys(known).length) return { ok: false, error: 'No recognised parameters found in that JSON.' };
    const applied = this.setMany(known);
    return { ok: true, applied };
  }

  /** Encode only non-default params into a compact URL hash string. */
  toHash() {
    const parts = [];
    for (const p of CONFIG) {
      const v = this.params[p.key];
      if (v === p.def) continue;
      parts.push(`${p.url}=${encodeURIComponent(p.type === 'checkbox' ? (v ? 1 : 0) : v)}`);
    }
    return parts.join('&');
  }

  fromHash(hash) {
    const clean = (hash || '').replace(/^#/, '');
    if (!clean) return false;
    const byUrl = Object.fromEntries(CONFIG.map(p => [p.url, p]));
    const next = {};
    for (const piece of clean.split('&')) {
      const [k, raw] = piece.split('=');
      const p = byUrl[k];
      if (!p || raw === undefined) continue;
      const val = decodeURIComponent(raw);
      next[p.key] = p.type === 'checkbox' ? val === '1' || val === 'true'
        : p.type === 'select' ? val : Number(val);
    }
    if (!Object.keys(next).length) return false;
    this.setMany(next);
    return true;
  }

  save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.params)); } catch (e) { /* private mode */ }
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const obj = JSON.parse(raw);
      if (!Utils.isObject(obj)) return false;
      this.setMany(obj, { silent: true });
      return true;
    } catch (e) { return false; }
  }
}

/* ============================================================================
 * Presets — six starting points tuned by running this exact model
 * (see README: scripts/tune via the grid search). Ranges shown in the UI are
 * always re-simulated live — never trusted from these notes.
 * ==========================================================================*/

const Presets = [
  // Geometry/counterweight values were found by running this file's own grid
  // search (ConfigSearch.runSync) for each projectile+target pair and keeping a
  // low-sensitivity finalist. Every preset is re-simulated live in the UI, so
  // the displayed range always reflects the current model — never these notes.
  { id: 'p05-20', name: '0.5 kg → 20 m',
    over: { massP: 0.5, targetDistance: 20, cwMass: 120, longArm: 2.0, shortArm: 1.0, slingLength: 0.8, releaseAngle: 52.5 } },
  { id: 'p05-25', name: '0.5 kg → 25 m',
    over: { massP: 0.5, targetDistance: 25, cwMass: 40, longArm: 2.4, shortArm: 1.0, slingLength: 1.2, releaseAngle: 37.5 } },
  { id: 'p10-20', name: '1.0 kg → 20 m',
    over: { massP: 1.0, targetDistance: 20, cwMass: 60, longArm: 2.4, shortArm: 0.6, slingLength: 0.8, releaseAngle: 45 } },
  { id: 'p10-25', name: '1.0 kg → 25 m',
    over: { massP: 1.0, targetDistance: 25, cwMass: 40, longArm: 2.0, shortArm: 1.0, slingLength: 2.0, releaseAngle: 37.5 } },
  { id: 'p15-20', name: '1.5 kg → 20 m',
    over: { massP: 1.5, targetDistance: 20, cwMass: 120, longArm: 1.2, shortArm: 0.8, slingLength: 1.2, releaseAngle: 45 } },
  { id: 'p15-25', name: '1.5 kg → 25 m',
    over: { massP: 1.5, targetDistance: 25, cwMass: 90, longArm: 1.2, shortArm: 0.6, slingLength: 1.6, releaseAngle: 30 } },
];

function presetParams(preset) {
  return Object.assign(defaultParams(), preset.over);
}

/* ============================================================================
 * ConfigSearch — chunked grid search
 * ----------------------------------------------------------------------------
 * Coarse pass: every combination of the candidate values below is simulated
 * with a large time step and a short energy sweep (the release speed only
 * depends on the sweep endpoints, so this stays accurate). The best ~30 by
 * range error are re-simulated finely and given a sensitivity score (range
 * spread under ±2% counterweight mass and sling length). Final ranking:
 * |error| → counterweight mass → input energy → sensitivity.
 * Work is chunked through requestAnimationFrame so the page never freezes.
 * ==========================================================================*/

const SEARCH_GRID = {
  cwMass: [20, 40, 60, 90, 120, 150, 180, 220, 260, 300],
  longArm: [1.2, 1.6, 2.0, 2.4, 2.8, 3.2],
  shortArm: [0.4, 0.6, 0.8, 1.0],
  slingLength: [0.8, 1.2, 1.6, 2.0, 2.4],
  releaseAngle: [30, 37.5, 45, 52.5, 60],
};
const SEARCH_COARSE = { sweepSteps: 16, flightDt: 0.005, needVacuum: false };
const SEARCH_FINE = { sweepSteps: 64, flightDt: 0.002, needVacuum: false };
const SEARCH_FINALISTS = 30;
const SEARCH_RESULTS = 8;
const SEARCH_CHUNK = 250; // coarse evaluations per animation frame

const ConfigSearch = {
  /** Build the flat list of candidate override objects. */
  buildCandidates() {
    const out = [];
    for (const cw of SEARCH_GRID.cwMass)
      for (const l1 of SEARCH_GRID.longArm)
        for (const l2 of SEARCH_GRID.shortArm)
          for (const ls of SEARCH_GRID.slingLength)
            for (const ra of SEARCH_GRID.releaseAngle)
              out.push({ cwMass: cw, longArm: l1, shortArm: l2, slingLength: ls, releaseAngle: ra });
    return out;
  },

  evaluate(base, over, opts) {
    const P = Object.assign({}, base, over);
    const res = Simulator.run(P, opts);
    if (res.status !== 'ok') return null;
    return {
      over,
      range: res.metrics.range,
      err: Math.abs(res.metrics.rangeError),
      signedErr: res.metrics.rangeError,
      v0: res.metrics.launchSpeed,
      eIn: res.metrics.cwPotentialEnergy,
      eff: res.metrics.totalEfficiency,
    };
  },

  /** Range spread when CW mass and sling length wobble by ±2%. */
  sensitivityScore(base, over) {
    const centre = this.evaluate(base, over, SEARCH_FINE);
    if (!centre) return Infinity;
    let spread = 0;
    for (const [k, f] of [['cwMass', 0.98], ['cwMass', 1.02], ['slingLength', 0.98], ['slingLength', 1.02]]) {
      const tweaked = Object.assign({}, over, { [k]: over[k] * f });
      const r = this.evaluate(base, tweaked, SEARCH_FINE);
      if (!r) return Infinity;
      spread = Math.max(spread, Math.abs(r.range - centre.range));
    }
    return spread;
  },

  /**
   * Asynchronous chunked run. Callbacks: onProgress(done,total), onDone(rows),
   * Returns a handle with cancel(). Synchronous core used by SelfTest/Node.
   */
  start(baseParams, { onProgress, onDone } = {}) {
    const base = { ...baseParams };
    const candidates = this.buildCandidates();
    const results = [];
    let index = 0;
    let cancelled = false;

    const finish = () => {
      if (cancelled) return;
      const rows = this.rank(base, results);
      onDone && onDone(rows);
    };

    const tick = () => {
      if (cancelled) return;
      const end = Math.min(index + SEARCH_CHUNK, candidates.length);
      for (; index < end; index++) {
        const r = this.evaluate(base, candidates[index], SEARCH_COARSE);
        if (r) results.push(r);
      }
      onProgress && onProgress(index, candidates.length);
      if (index < candidates.length) {
        (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => setTimeout(fn, 0))(tick);
      } else {
        finish();
      }
    };
    tick();

    return { cancel() { cancelled = true; } };
  },

  /** Fine re-evaluation + ranking of coarse results (also used synchronously in tests). */
  rank(base, coarseResults) {
    const finalists = coarseResults
      .sort((a, b) => a.err - b.err)
      .slice(0, SEARCH_FINALISTS);
    const rows = [];
    for (const c of finalists) {
      const fine = this.evaluate(base, c.over, SEARCH_FINE);
      if (!fine) continue;
      fine.spread = this.sensitivityScore(base, c.over);
      rows.push(fine);
    }
    rows.sort((a, b) =>
      Math.round(a.err / 0.05) - Math.round(b.err / 0.05) ||
      a.over.cwMass - b.over.cwMass ||
      a.eIn - b.eIn ||
      a.spread - b.spread);
    return rows.slice(0, SEARCH_RESULTS);
  },

  /** Fully synchronous search (used by the preset tuner in Node). */
  runSync(baseParams) {
    const base = { ...baseParams };
    const results = [];
    for (const over of this.buildCandidates()) {
      const r = this.evaluate(base, over, SEARCH_COARSE);
      if (r) results.push(r);
    }
    return this.rank(base, results);
  },
};

/* ============================================================================
 * Sensitivity — small-perturbation analysis of the current configuration
 * ==========================================================================*/

const Sensitivity = {
  // [key, label, mode] — 'rel' perturbs by ±1%/±5%; 'abs' by ±0.1/±0.5 (wind,
  // whose baseline is often 0 so a relative change would be meaningless).
  PARAMS: [
    ['massP', 'Projectile mass', 'rel'],
    ['cwMass', 'Counterweight mass', 'rel'],
    ['slingLength', 'Sling length', 'rel'],
    ['releaseAngle', 'Release angle', 'rel'],
    ['cwEfficiency', 'Efficiency', 'rel'],
    ['windSpeed', 'Wind speed', 'abs'],
  ],

  analyze(params) {
    const baseRes = Simulator.run(params, { sweepSteps: 64, needVacuum: false });
    if (baseRes.status !== 'ok') return { ok: false };
    const baseRange = baseRes.metrics.range;
    const rows = [];
    let anyHigh = false;

    for (const [key, label, mode] of this.PARAMS) {
      const deltas = mode === 'rel' ? [-0.05, -0.01, 0.01, 0.05] : [-0.5, -0.1, 0.1, 0.5];
      const cells = deltas.map(d => {
        const v = mode === 'rel' ? params[key] * (1 + d) : params[key] + d;
        const p = CONFIG_BY_KEY[key];
        const tweaked = Object.assign({}, params, { [key]: Utils.clamp(v, p.min, p.max) });
        const r = Simulator.run(tweaked, { sweepSteps: 64, needVacuum: false });
        return r.status === 'ok' ? r.metrics.range - baseRange : NaN;
      });
      // "Small change" columns are index 1 and 2 (±1% or ±0.1 m/s).
      const smallShift = Math.max(Math.abs(cells[1] || 0), Math.abs(cells[2] || 0));
      const verdict = !Number.isFinite(cells[1]) || !Number.isFinite(cells[2]) ? 'Invalid nearby'
        : smallShift > params.targetTolerance ? 'High'
          : smallShift > params.targetTolerance / 2 ? 'Moderate' : 'Low';
      if (verdict === 'High' || verdict === 'Invalid nearby') anyHigh = true;
      rows.push({ key, label, mode, cells, verdict });
    }
    return { ok: true, baseRange, rows, anyHigh };
  },
};

/* ============================================================================
 * SelfTest — lightweight assertions on the physics core
 * ==========================================================================*/

const SelfTest = {
  run() {
    const results = [];
    const t = (name, fn) => {
      try {
        const msg = fn();
        results.push({ name, pass: msg === undefined, detail: msg });
      } catch (e) {
        results.push({ name, pass: false, detail: String(e && e.message || e) });
      }
    };
    const close = (a, b, rel) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b));

    const base = defaultParams();

    t('Default configuration simulates without errors', () => {
      const r = Simulator.run(base);
      if (r.status !== 'ok') return `status=${r.status}: ${r.errors.join('; ')}`;
    });

    t('Vacuum numerical range matches the closed-form solution within 1%', () => {
      const P = Object.assign({}, base, { flightMode: 'vacuum', timeStep: 0.001, targetHeight: 0 });
      const r = Simulator.run(P);
      if (r.status !== 'ok') return 'simulation failed';
      const cf = FlightModel.closedFormVacuumRange(r.sweep.release, P.gravity, 0);
      if (!close(r.metrics.range, cf, 0.01)) return `numeric ${r.metrics.range.toFixed(3)} vs closed-form ${cf.toFixed(3)}`;
    });

    t('Drag reduces range relative to vacuum', () => {
      const rd = Simulator.run(Object.assign({}, base, { flightMode: 'drag' }));
      const rv = Simulator.run(Object.assign({}, base, { flightMode: 'vacuum' }));
      if (rd.status !== 'ok' || rv.status !== 'ok') return 'simulation failed';
      if (!(rd.metrics.range < rv.metrics.range)) return `drag ${rd.metrics.range} !< vacuum ${rv.metrics.range}`;
    });

    t('Tailwind lengthens and headwind shortens the drag-mode range', () => {
      const calm = Simulator.run(Object.assign({}, base, { windSpeed: 0 })).metrics.range;
      const tail = Simulator.run(Object.assign({}, base, { windSpeed: 5 })).metrics.range;
      const head = Simulator.run(Object.assign({}, base, { windSpeed: -5 })).metrics.range;
      if (!(tail > calm && head < calm)) return `head ${head} / calm ${calm} / tail ${tail}`;
    });

    t('Energy audit closes (input = outputs + losses)', () => {
      const r = Simulator.run(base);
      if (r.status !== 'ok') return 'simulation failed';
      const E = r.sweep.energy;
      const sum = E.eFactorLoss + E.ePEproj + E.ePEarm + E.keArm + E.keCw + E.eSlingLoss + E.keProj;
      if (!close(E.eGross, sum, 1e-6)) return `gross ${E.eGross.toFixed(4)} vs sum ${sum.toFixed(4)}`;
    });

    t('Counterweight PE is never fully assigned to the projectile', () => {
      const r = Simulator.run(base);
      if (r.status !== 'ok') return 'simulation failed';
      if (!(r.metrics.projectileKE < r.metrics.cwPotentialEnergy * 0.95)) {
        return `KE ${r.metrics.projectileKE.toFixed(1)} J vs PE ${r.metrics.cwPotentialEnergy.toFixed(1)} J`;
      }
    });

    t('An undersized counterweight is reported as invalid, not NaN', () => {
      const P = Object.assign({}, base, { cwMass: 10, massP: 1.5, armMass: 40, armCom: 2.0 });
      const r = Simulator.run(P);
      if (r.status !== 'invalid') return `status=${r.status} range=${r.metrics && r.metrics.range}`;
      if (!r.errors.length) return 'no explanatory message';
    });

    t('Geometry that buries the arm tip is rejected with a message', () => {
      const P = Object.assign({}, base, { pivotHeight: 0.5, longArm: 4.0, armAngle0: 80 });
      const r = Simulator.run(P);
      if (r.status !== 'invalid') return `status=${r.status}`;
    });

    t('Hinged counterweight throws faster than fixed (same setup)', () => {
      const rh = Simulator.run(Object.assign({}, base, { cwMode: 'hinged' }));
      const rf = Simulator.run(Object.assign({}, base, { cwMode: 'fixed' }));
      if (rh.status !== 'ok' || rf.status !== 'ok') return 'simulation failed';
      if (!(rh.metrics.launchSpeed > rf.metrics.launchSpeed)) return 'hinged not faster';
    });

    t('Flight stops exactly on the landing plane', () => {
      const r = Simulator.run(base);
      if (r.status !== 'ok') return 'simulation failed';
      const last = r.flight.samples[r.flight.samples.length - 1];
      if (Math.abs(last.y - base.targetHeight) > 1e-9) return `final y=${last.y}`;
    });

    t('JSON round-trip preserves every parameter', () => {
      const s = new AppState();
      s.setMany({ massP: 0.75, cwMass: 199, cwMode: 'fixed', cwDropAuto: false, windSpeed: -3.2 });
      const text = s.toJSON();
      const s2 = new AppState();
      const res = s2.fromJSON(text);
      if (!res.ok) return res.error;
      for (const p of CONFIG) {
        if (s2.params[p.key] !== s.params[p.key]) return `${p.key}: ${s2.params[p.key]} != ${s.params[p.key]}`;
      }
    });

    t('URL-hash round-trip preserves changed parameters', () => {
      const s = new AppState();
      s.setMany({ massP: 1.25, slingLength: 2.4, cwMode: 'fixed', cwDropAuto: false });
      const hash = s.toHash();
      const s2 = new AppState();
      s2.fromHash(hash);
      for (const p of CONFIG) {
        if (s2.params[p.key] !== s.params[p.key]) return `${p.key}: ${s2.params[p.key]} != ${s.params[p.key]}`;
      }
    });

    t('Import clamps out-of-range values instead of crashing', () => {
      const s = new AppState();
      const res = s.fromJSON('{"params":{"massP":99,"cwMass":-5,"junkKey":1}}');
      if (!res.ok) return res.error;
      if (s.params.massP !== CONFIG_BY_KEY.massP.max) return `massP=${s.params.massP}`;
      if (s.params.cwMass !== CONFIG_BY_KEY.cwMass.min) return `cwMass=${s.params.cwMass}`;
    });

    t('All six presets produce finite results', () => {
      for (const preset of Presets) {
        const r = Simulator.run(presetParams(preset));
        if (r.status !== 'ok' || !Number.isFinite(r.metrics.range)) return `${preset.name}: ${r.status}`;
      }
    });

    return results;
  },
};

/* ============================================================================
 * Everything below is browser-only (rendering, animation, UI). The physics
 * core above stays importable in Node for tests and preset tuning.
 * ==========================================================================*/

/* ----------------------------------------------------------------------------
 * Theme-aware canvas colors, read from the CSS custom properties each draw.
 * --------------------------------------------------------------------------*/
function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name) => cs.getPropertyValue(name).trim();
  return {
    surface: v('--surface-2'), ink: v('--ink'), ink2: v('--ink-2'), muted: v('--ink-muted'),
    grid: v('--grid'), baseline: v('--baseline'),
    drag: v('--series-drag'), vacuum: v('--series-vacuum'),
    good: v('--status-good'), critical: v('--status-critical'),
    band: v('--band-fill') || 'rgba(12,163,12,0.10)',
  };
}

/** Keep a canvas's backing store in sync with CSS size and devicePixelRatio. */
function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: canvas.clientWidth, h: canvas.clientHeight };
}

/* ----------------------------------------------------------------------------
 * SceneRenderer — side view of the machine + flight
 * --------------------------------------------------------------------------*/

class SceneRenderer {
  constructor(canvas) {
    this.canvas = canvas;
  }

  /** World window that fits the machine, the flight and the target, aspect-true. */
  worldBounds(P, sim) {
    const reach = P.longArm + P.slingLength;
    const xMin = Math.min(-reach - 0.8, -3);
    let xMax = Math.max(P.targetDistance + P.targetTolerance + 2, 26.5);
    let yMax = Math.max(P.pivotHeight + reach + 0.6, 5);
    if (sim && sim.status === 'ok') {
      xMax = Math.max(xMax, sim.metrics.range + 2);
      yMax = Math.max(yMax, sim.metrics.maxHeight + 1);
    }
    return { xMin, xMax, yMin: -0.6, yMax };
  }

  makeTransform(P, sim, w, h) {
    const b = this.worldBounds(P, sim);
    const pad = 8;
    // Uniform scale so geometry never distorts; content is bottom-anchored.
    const scale = Math.min((w - 2 * pad) / (b.xMax - b.xMin), (h - 2 * pad) / (b.yMax - b.yMin));
    const ox = pad - b.xMin * scale;
    const oy = h - pad + b.yMin * scale;
    return {
      scale,
      x: (wx) => ox + wx * scale,
      y: (wy) => oy - wy * scale,
    };
  }

  /**
   * @param P params
   * @param sim simulator result (may be invalid)
   * @param frame {t, theta, pouch:{x,y}, released, flightPos, done} or null (static cocked)
   */
  draw(P, sim, frame) {
    const { ctx, w, h } = fitCanvas(this.canvas);
    const C = themeColors();
    ctx.clearRect(0, 0, w, h);
    const T = this.makeTransform(P, sim, w, h);
    const px = T.x, py = T.y;

    /* Ground */
    ctx.fillStyle = C.grid;
    ctx.fillRect(0, py(0), w, h - py(0));
    ctx.strokeStyle = C.baseline;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, py(0) + 0.5); ctx.lineTo(w, py(0) + 0.5); ctx.stroke();

    /* Distance ticks every 5 m */
    ctx.fillStyle = C.muted;
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (let m = 0; m <= this.worldBounds(P, sim).xMax; m += 5) {
      ctx.fillRect(px(m) - 0.5, py(0), 1, 4);
      ctx.fillText(`${m}`, px(m), py(0) + 14);
    }

    /* Target tolerance band + flag */
    const t0 = P.targetDistance - P.targetTolerance, t1 = P.targetDistance + P.targetTolerance;
    ctx.fillStyle = C.band;
    ctx.fillRect(px(t0), py(P.targetHeight) - 3, px(t1) - px(t0), 6);
    ctx.strokeStyle = C.good;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px(P.targetDistance), py(P.targetHeight));
    ctx.lineTo(px(P.targetDistance), py(P.targetHeight) - 22);
    ctx.stroke();
    ctx.fillStyle = C.good;
    ctx.beginPath();
    ctx.moveTo(px(P.targetDistance), py(P.targetHeight) - 22);
    ctx.lineTo(px(P.targetDistance) + 10, py(P.targetHeight) - 18);
    ctx.lineTo(px(P.targetDistance), py(P.targetHeight) - 14);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = C.ink2;
    ctx.textAlign = 'center';
    ctx.fillText(`${Utils.fmt(P.targetDistance, 1)} m`, px(P.targetDistance), py(P.targetHeight) - 27);

    const H = P.pivotHeight;

    /* Frame: simple A-frame under the pivot */
    ctx.strokeStyle = C.ink2;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    const spread = Math.max(0.35 * H, 0.3);
    ctx.beginPath();
    ctx.moveTo(px(-spread), py(0)); ctx.lineTo(px(0), py(H));
    ctx.lineTo(px(spread), py(0));
    ctx.stroke();

    if (sim && sim.status !== 'ok') {
      // Invalid config: draw machine at cocked pose + a notice.
      this.drawArm(ctx, T, P, Math.PI + P.armAngle0 * Utils.DEG, null, C);
      ctx.fillStyle = C.critical;
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('Invalid configuration — see messages above the controls.', 12, 22);
      return;
    }

    const sweep = sim.sweep;
    const f = frame || { t: 0, theta: sweep.theta0, pouch: { x: sweep.timeline.pouchX[0], y: sweep.timeline.pouchY[0] }, released: false };

    /* Full flight path, faint, so the outcome is visible without playing */
    ctx.strokeStyle = C.drag;
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 1.5;
    this.tracePath(ctx, T, sim.flight.samples, sim.flight.samples.length);
    ctx.globalAlpha = 1;

    /* Trace flown so far (solid) */
    if (f.released) {
      const upto = sim.flight.samples.filter(s => s.t <= f.t - sweep.tRelease).length;
      ctx.strokeStyle = C.drag;
      ctx.lineWidth = 2;
      this.tracePath(ctx, T, sim.flight.samples, Math.max(upto, 2));
    }

    /* Machine */
    this.drawArm(ctx, T, P, f.theta, f, C);

    /* Release velocity vector (shown from the moment of release onward) */
    if (f.released) {
      const r = sweep.release;
      const len = Math.min(0.35 * r.speed, 6); // world metres, capped for layout
      const ex = r.x + (r.vx / r.speed) * len, ey = r.y + (r.vy / r.speed) * len;
      ctx.strokeStyle = C.ink;
      ctx.fillStyle = C.ink;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(px(r.x), py(r.y)); ctx.lineTo(px(ex), py(ey)); ctx.stroke();
      const ang = Math.atan2(py(ey) - py(r.y), px(ex) - px(r.x));
      ctx.beginPath();
      ctx.moveTo(px(ex), py(ey));
      ctx.lineTo(px(ex) - 8 * Math.cos(ang - 0.42), py(ey) - 8 * Math.sin(ang - 0.42));
      ctx.lineTo(px(ex) - 8 * Math.cos(ang + 0.42), py(ey) - 8 * Math.sin(ang + 0.42));
      ctx.closePath(); ctx.fill();
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = C.ink2;
      ctx.fillText(`v₀ = ${Utils.fmt(r.speed, 1)} m/s`, px(ex) + 6, py(ey) - 4);
    }

    /* Projectile */
    const pos = f.released ? f.flightPos : f.pouch;
    if (pos) {
      const rPix = Math.max(3, (P.diameter / 2) * T.scale);
      ctx.fillStyle = C.drag;
      ctx.strokeStyle = C.surface;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px(pos.x), py(pos.y), rPix, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }

    /* Impact cross at the very end */
    if (f.done) {
      const imp = sim.flight.impact;
      ctx.strokeStyle = C.critical;
      ctx.lineWidth = 2;
      const s = 6;
      ctx.beginPath();
      ctx.moveTo(px(imp.x) - s, py(imp.y) - s); ctx.lineTo(px(imp.x) + s, py(imp.y) + s);
      ctx.moveTo(px(imp.x) - s, py(imp.y) + s); ctx.lineTo(px(imp.x) + s, py(imp.y) - s);
      ctx.stroke();
      ctx.fillStyle = C.ink2;
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${Utils.fmt(imp.x, 2)} m`, px(imp.x), py(imp.y) - 10);
    }
  }

  tracePath(ctx, T, samples, count) {
    if (!samples.length || count < 2) return;
    ctx.beginPath();
    ctx.moveTo(T.x(samples[0].x), T.y(samples[0].y));
    for (let i = 1; i < Math.min(count, samples.length); i++) {
      ctx.lineTo(T.x(samples[i].x), T.y(samples[i].y));
    }
    ctx.stroke();
  }

  /** Arm, counterweight and sling at arm angle theta. frame may carry pouch pos. */
  drawArm(ctx, T, P, theta, frame, C) {
    const px = T.x, py = T.y;
    const H = P.pivotHeight;
    const tipX = P.longArm * Math.cos(theta), tipY = H + P.longArm * Math.sin(theta);
    const cwX = -P.shortArm * Math.cos(theta), cwY = H - P.shortArm * Math.sin(theta);

    /* Arm — long segment slightly thicker */
    ctx.strokeStyle = C.ink;
    ctx.lineCap = 'round';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(px(0), py(H)); ctx.lineTo(px(tipX), py(tipY)); ctx.stroke();
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(px(0), py(H)); ctx.lineTo(px(cwX), py(cwY)); ctx.stroke();

    /* Counterweight */
    const cwSide = Math.max(8, Math.min(26, 6 + Math.sqrt(P.cwMass)));
    ctx.fillStyle = C.ink;
    if (P.cwMode === 'hinged') {
      const hang = 0.3 * P.shortArm;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px(cwX), py(cwY)); ctx.lineTo(px(cwX), py(cwY - hang)); ctx.stroke();
      ctx.fillRect(px(cwX) - cwSide / 2, py(cwY - hang), cwSide, cwSide);
    } else {
      ctx.fillRect(px(cwX) - cwSide / 2, py(cwY) - cwSide / 2, cwSide, cwSide);
    }

    /* Pivot */
    ctx.fillStyle = C.ink2;
    ctx.strokeStyle = C.surface;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px(0), py(H), 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

    /* Sling (only until release) */
    if (frame && !frame.released && frame.pouch) {
      ctx.strokeStyle = C.ink2;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(px(tipX), py(tipY)); ctx.lineTo(px(frame.pouch.x), py(frame.pouch.y)); ctx.stroke();
    }
  }
}

/* ----------------------------------------------------------------------------
 * ChartRenderer — trajectory chart (distance vs height) with hover readout
 * --------------------------------------------------------------------------*/

class ChartRenderer {
  constructor(canvas, tipEl) {
    this.canvas = canvas;
    this.tipEl = tipEl;
    this.sim = null;
    this.P = null;
    this.plot = null; // cached plot-area transform for hover

    canvas.addEventListener('pointermove', (e) => this.onHover(e));
    canvas.addEventListener('pointerleave', () => this.hideTip());
  }

  setData(P, sim) {
    this.P = P;
    this.sim = sim;
    this.draw();
  }

  draw() {
    const { ctx, w, h } = fitCanvas(this.canvas);
    const C = themeColors();
    ctx.clearRect(0, 0, w, h);
    const P = this.P, sim = this.sim;
    if (!P) return;

    const margin = { l: 44, r: 14, t: 14, b: 30 };
    const pw = w - margin.l - margin.r, ph = h - margin.t - margin.b;
    if (pw < 40 || ph < 40) return;

    const ok = sim && sim.status === 'ok';
    let xMax = Math.max(26.5, P.targetDistance + P.targetTolerance + 1.5);
    let yMax = 4;
    if (ok) {
      xMax = Math.max(xMax, sim.metrics.range + 1.5);
      yMax = Math.max(yMax, sim.metrics.maxHeight + 0.8);
      if (sim.vacuum) {
        xMax = Math.max(xMax, sim.vacuum.impact.x + 1.5);
        yMax = Math.max(yMax, sim.vacuum.maxY + 0.8);
      }
    }
    const X = (v) => margin.l + (v / xMax) * pw;
    const Y = (v) => margin.t + ph - (v / yMax) * ph;
    this.plot = { X, Y, xMax, yMax, margin, pw, ph };

    /* Target band 20–25 m */
    ctx.fillStyle = C.band;
    ctx.fillRect(X(20), margin.t, X(25) - X(20), ph);

    /* Gridlines + ticks */
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = C.muted;
    ctx.font = '10.5px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const tx of Utils.ticks(0, xMax, 8)) {
      ctx.beginPath(); ctx.moveTo(X(tx) + 0.5, margin.t); ctx.lineTo(X(tx) + 0.5, margin.t + ph); ctx.stroke();
      ctx.fillText(String(tx), X(tx), margin.t + ph + 16);
    }
    ctx.textAlign = 'right';
    for (const ty of Utils.ticks(0, yMax, 5)) {
      if (ty === 0) continue;
      ctx.beginPath(); ctx.moveTo(margin.l, Y(ty) + 0.5); ctx.lineTo(margin.l + pw, Y(ty) + 0.5); ctx.stroke();
      ctx.fillText(String(ty), margin.l - 6, Y(ty) + 3.5);
    }
    ctx.save();
    ctx.translate(12, margin.t + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('height (m)', 0, 0);
    ctx.restore();
    ctx.textAlign = 'center';
    ctx.fillText('distance from pivot (m)', margin.l + pw / 2, h - 4);

    /* Ground / axis lines */
    ctx.strokeStyle = C.baseline;
    ctx.beginPath(); ctx.moveTo(margin.l, Y(0) + 0.5); ctx.lineTo(margin.l + pw, Y(0) + 0.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(margin.l + 0.5, margin.t); ctx.lineTo(margin.l + 0.5, margin.t + ph); ctx.stroke();

    /* Target marker + tolerance whiskers */
    ctx.strokeStyle = C.good;
    ctx.lineWidth = 1.5;
    const td = P.targetDistance, tt = P.targetTolerance;
    ctx.beginPath(); ctx.moveTo(X(td), Y(0)); ctx.lineTo(X(td), Y(0) - 14); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(X(td - tt), Y(0) - 5); ctx.lineTo(X(td + tt), Y(0) - 5);
    ctx.stroke();

    if (!ok) {
      ctx.fillStyle = C.muted;
      ctx.font = '12.5px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No trajectory — the current configuration is invalid.', margin.l + pw / 2, margin.t + ph / 2);
      return;
    }

    /* Raised landing plane, if set */
    if (P.targetHeight > 0) {
      ctx.strokeStyle = C.muted;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(margin.l, Y(P.targetHeight)); ctx.lineTo(margin.l + pw, Y(P.targetHeight)); ctx.stroke();
      ctx.setLineDash([]);
    }

    /* Vacuum comparison (dashed) */
    if (sim.vacuum) {
      ctx.strokeStyle = C.vacuum;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      this.path(ctx, sim.vacuum.samples, X, Y);
      ctx.setLineDash([]);
    }

    /* Primary trajectory */
    ctx.strokeStyle = C.drag;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    this.path(ctx, sim.flight.samples, X, Y);

    /* Apex marker */
    let apex = sim.flight.samples[0];
    for (const s of sim.flight.samples) if (s.y > apex.y) apex = s;
    this.marker(ctx, X(apex.x), Y(apex.y), C.drag, C.surface);
    ctx.fillStyle = C.ink2;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`apex ${Utils.fmt(apex.y, 1)} m`, X(apex.x), Y(apex.y) - 10);

    /* Impact marker */
    const imp = sim.flight.impact;
    this.marker(ctx, X(imp.x), Y(imp.y), C.drag, C.surface);
    ctx.fillText(`${Utils.fmt(imp.x, 2)} m`, X(imp.x), Y(imp.y) - 10);
  }

  path(ctx, samples, X, Y) {
    ctx.beginPath();
    ctx.moveTo(X(samples[0].x), Y(samples[0].y));
    for (let i = 1; i < samples.length; i++) ctx.lineTo(X(samples[i].x), Y(samples[i].y));
    ctx.stroke();
  }

  marker(ctx, x, y, fill, ring) {
    ctx.fillStyle = fill;
    ctx.strokeStyle = ring;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }

  onHover(e) {
    if (!this.plot || !this.sim || this.sim.status !== 'ok') return;
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const worldX = (mx - this.plot.margin.l) / this.plot.pw * this.plot.xMax;
    const samples = this.sim.flight.samples;
    if (worldX < samples[0].x || worldX > samples[samples.length - 1].x) { this.hideTip(); return; }
    // Samples are monotone in x until (possibly) strong headwind; nearest-by-x scan is fine.
    let best = samples[0], bd = Infinity;
    for (const s of samples) {
      const d = Math.abs(s.x - worldX);
      if (d < bd) { bd = d; best = s; }
    }
    const spd = Math.hypot(best.vx, best.vy);
    this.tipEl.hidden = false;
    this.tipEl.innerHTML =
      `d = ${Utils.fmt(best.x, 2)} m<br>h = ${Utils.fmt(best.y, 2)} m<br>` +
      `v = ${Utils.fmt(spd, 1)} m/s<br>t = ${Utils.fmt(best.t, 2)} s`;
    const tipX = Math.min(this.plot.X(best.x) + 12, rect.width - this.tipEl.offsetWidth - 4);
    const tipY = Math.max(4, this.plot.Y(best.y) - this.tipEl.offsetHeight - 10);
    this.tipEl.style.left = `${tipX}px`;
    this.tipEl.style.top = `${tipY}px`;
  }

  hideTip() { this.tipEl.hidden = true; }
}

/* ----------------------------------------------------------------------------
 * AnimationController — playback over the precomputed throw + flight frames
 * --------------------------------------------------------------------------*/

class AnimationController {
  constructor(scene, onFrame) {
    this.scene = scene;
    this.onFrame = onFrame;   // (frame) => void — also updates HUD text
    this.sim = null;
    this.P = null;
    this.t = 0;
    this.duration = 0;
    this.playing = false;
    this.speed = 1;
    this.raf = 0;
    this.lastStamp = 0;
    this.reducedMotion = typeof matchMedia === 'function'
      && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  setData(P, sim) {
    this.P = P;
    this.sim = sim;
    this.pause();
    if (sim && sim.status === 'ok') {
      this.duration = sim.sweep.tRelease + sim.flight.flightTime;
      // Reduced motion: land on the final frame instead of inviting playback.
      this.t = this.reducedMotion ? this.duration : 0;
    } else {
      this.duration = 0;
      this.t = 0;
    }
    this.render();
  }

  frameAt(t) {
    const sim = this.sim;
    if (!sim || sim.status !== 'ok') return null;
    const sweep = sim.sweep;
    const tl = sweep.timeline;
    if (t <= sweep.tRelease) {
      // Binary search the throw timeline.
      let lo = 0, hi = tl.N;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (tl.times[mid] <= t) lo = mid; else hi = mid;
      }
      const span = tl.times[hi] - tl.times[lo] || 1;
      const f = Utils.clamp((t - tl.times[lo]) / span, 0, 1);
      return {
        t,
        theta: Utils.lerp(tl.thetas[lo], tl.thetas[hi], f),
        pouch: {
          x: Utils.lerp(tl.pouchX[lo], tl.pouchX[hi], f),
          y: Utils.lerp(tl.pouchY[lo], tl.pouchY[hi], f),
        },
        released: false,
        done: false,
        phase: t === 0 ? 'cocked'
          : (t / sweep.tRelease) < 0.45 ? 'counterweight drop'
            : (t / sweep.tRelease) < 0.9 ? 'arm rotation' : 'sling whip',
      };
    }
    const tf = Math.min(t - sweep.tRelease, sim.flight.flightTime);
    const s = sim.flight.samples;
    let lo = 0, hi = s.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (s[mid].t <= tf) lo = mid; else hi = mid;
    }
    const span = s[hi].t - s[lo].t || 1;
    const f = Utils.clamp((tf - s[lo].t) / span, 0, 1);
    const done = t >= this.duration - 1e-9;
    return {
      t,
      theta: sweep.thetaRel,
      pouch: null,
      released: true,
      done,
      flightPos: { x: Utils.lerp(s[lo].x, s[hi].x, f), y: Utils.lerp(s[lo].y, s[hi].y, f) },
      phase: done ? 'impact' : 'ballistic flight',
    };
  }

  render() {
    const frame = this.frameAt(this.t);
    this.scene.draw(this.P, this.sim, frame);
    this.onFrame(frame, this);
  }

  play() {
    if (!this.sim || this.sim.status !== 'ok') return;
    if (this.t >= this.duration - 1e-9) this.t = 0; // replay from start
    this.playing = true;
    this.lastStamp = 0;
    const loop = (stamp) => {
      if (!this.playing) return;
      if (this.lastStamp) {
        this.t = Math.min(this.t + ((stamp - this.lastStamp) / 1000) * this.speed, this.duration);
      }
      this.lastStamp = stamp;
      this.render();
      if (this.t >= this.duration) { this.pause(); return; }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    this.onFrame(this.frameAt(this.t), this);
  }

  pause() {
    this.playing = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.onFrame && this.sim) this.onFrame(this.frameAt(this.t), this);
  }

  toggle() { this.playing ? this.pause() : this.play(); }

  stepFrame() {
    this.pause();
    this.t = Math.min(this.t + (1 / 60), this.duration);
    this.render();
  }

  restart() {
    this.pause();
    this.t = 0;
    this.render();
  }

  scrubTo(fraction) {
    this.pause();
    this.t = Utils.clamp(fraction, 0, 1) * this.duration;
    this.render();
  }
}

/* ----------------------------------------------------------------------------
 * UI — control construction and event wiring
 * --------------------------------------------------------------------------*/

const UI = {
  state: null,
  scene: null,
  chart: null,
  anim: null,
  sim: null,
  simTimer: 0,
  searchHandle: null,

  $(id) { return document.getElementById(id); },

  init() {
    this.state = new AppState();

    // Priority: URL hash → saved config → defaults.
    const fromUrl = this.state.fromHash(location.hash);
    if (!fromUrl) this.state.load();

    this.buildControls();
    this.wireButtons();
    this.wireTheme();

    this.scene = new SceneRenderer(this.$('sceneCanvas'));
    this.chart = new ChartRenderer(this.$('chartCanvas'), this.$('chartTip'));
    this.anim = new AnimationController(this.scene, (frame, anim) => this.onAnimFrame(frame, anim));

    this.wireTransport();

    this.state.subscribe(() => {
      this.refreshControls();
      this.state.save();
      this.scheduleSimulate();
    });

    const ro = new ResizeObserver(() => {
      if (this.anim) this.anim.render();
      if (this.chart) this.chart.draw();
    });
    ro.observe(this.$('sceneCanvas').parentElement);
    ro.observe(this.$('chartCanvas').parentElement);

    this.buildPresets();
    this.refreshControls();
    this.simulate();
  },

  /* ------------------------- control construction ---------------------- */

  buildControls() {
    const groups = {};
    for (const el of document.querySelectorAll('.ctrl-group')) {
      groups[el.dataset.group] = el.querySelector('.group-body');
    }
    for (const p of CONFIG) {
      const host = groups[p.group];
      if (!host) continue;
      host.appendChild(this.buildRow(p));
    }
    // Group hints: number of controls
    for (const el of document.querySelectorAll('.ctrl-group')) {
      const n = el.querySelectorAll('.ctrl-row').length;
      const hint = el.querySelector('.group-hint');
      if (hint) hint.textContent = `${n} parameters`;
    }
  },

  buildRow(p) {
    const row = document.createElement('div');
    row.className = 'ctrl-row';
    const labelLine = document.createElement('div');
    labelLine.className = 'ctrl-label-line has-tip';

    const label = document.createElement('label');
    label.htmlFor = `in-${p.key}`;
    label.textContent = p.label;
    labelLine.appendChild(label);

    if (p.tip) {
      const info = document.createElement('button');
      info.type = 'button';
      info.className = 'info-btn';
      info.textContent = 'i';
      info.setAttribute('aria-label', `About ${p.label}`);
      info.setAttribute('aria-describedby', `tip-${p.key}`);
      const bubble = document.createElement('span');
      bubble.className = 'tip-bubble';
      bubble.id = `tip-${p.key}`;
      bubble.role = 'tooltip';
      bubble.textContent = p.tip;
      labelLine.appendChild(info);
      labelLine.appendChild(bubble);
    }

    if (p.type !== 'select' && p.type !== 'checkbox') {
      const note = document.createElement('span');
      note.className = 'ctrl-range-note';
      note.textContent = `${p.min}–${p.max}${p.unit && p.unit !== '–' ? ' ' + p.unit : ''} · step ${p.step}`;
      labelLine.appendChild(note);
    }
    row.appendChild(labelLine);

    if (p.type === 'select') {
      const sel = document.createElement('select');
      sel.id = `in-${p.key}`;
      for (const [val, text] of p.options) {
        const o = document.createElement('option');
        o.value = val; o.textContent = text;
        sel.appendChild(o);
      }
      sel.addEventListener('change', () => this.state.set(p.key, sel.value));
      row.appendChild(sel);
      return row;
    }

    if (p.type === 'checkbox') {
      const wrap = document.createElement('div');
      wrap.className = 'check-wrap';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id = `in-${p.key}`;
      cb.addEventListener('change', () => this.state.set(p.key, cb.checked));
      const lab = document.createElement('label');
      lab.htmlFor = cb.id;
      lab.textContent = 'enabled';
      wrap.appendChild(cb); wrap.appendChild(lab);
      row.appendChild(wrap);
      return row;
    }

    const inputs = document.createElement('div');
    inputs.className = 'ctrl-inputs';

    const range = document.createElement('input');
    range.type = 'range';
    range.id = `in-${p.key}`;
    range.min = p.min; range.max = p.max; range.step = p.step;
    range.setAttribute('aria-label', `${p.label}${p.unit ? ` in ${p.unit}` : ''}`);
    range.addEventListener('input', () => this.state.set(p.key, Number(range.value)));

    const numWrap = document.createElement('div');
    numWrap.className = 'num-wrap';
    const num = document.createElement('input');
    num.type = 'number';
    num.id = `num-${p.key}`;
    num.min = p.min; num.max = p.max; num.step = p.step;
    num.setAttribute('aria-label', `${p.label} numeric value${p.unit ? ` in ${p.unit}` : ''}`);
    num.addEventListener('change', () => this.state.set(p.key, Number(num.value)));
    const unit = document.createElement('span');
    unit.className = 'num-unit';
    unit.textContent = p.unit;
    numWrap.appendChild(num); numWrap.appendChild(unit);

    inputs.appendChild(range);
    inputs.appendChild(numWrap);
    row.appendChild(inputs);
    return row;
  },

  refreshControls() {
    for (const p of CONFIG) {
      const v = this.state.get(p.key);
      const main = this.$(`in-${p.key}`);
      if (!main) continue;
      if (p.type === 'select') { main.value = v; continue; }
      if (p.type === 'checkbox') { main.checked = v; continue; }
      main.value = v;
      const num = this.$(`num-${p.key}`);
      if (num && document.activeElement !== num) num.value = v;
    }
    // The drop-height row is driven by geometry while "auto" is on.
    const auto = this.state.get('cwDropAuto');
    const dropRange = this.$('in-cwDrop');
    const dropNum = this.$('num-cwDrop');
    if (dropRange) dropRange.disabled = auto;
    if (dropNum) dropNum.disabled = auto;
  },

  /* ------------------------------ simulate ------------------------------ */

  scheduleSimulate() {
    clearTimeout(this.simTimer);
    this.simTimer = setTimeout(() => this.simulate(), 90);
  },

  simulate() {
    const P = { ...this.state.params };

    // Keep the drop-height control synced with geometry in auto mode.
    if (P.cwDropAuto) {
      const geo = Utils.quantize(TrebuchetModel.geometricDrop(P), CONFIG_BY_KEY.cwDrop);
      if (geo !== P.cwDrop) {
        this.state.set('cwDrop', geo, { silent: true });
        this.state.save();
        P.cwDrop = this.state.get('cwDrop');
        this.refreshControls();
      }
    }

    this.sim = Simulator.run(P);
    this.renderValidation(this.sim);
    this.renderResults(P, this.sim);
    this.chart.setData(P, this.sim);
    this.anim.setData(P, this.sim);
  },

  /* ------------------------------ rendering ----------------------------- */

  renderValidation(sim) {
    const box = this.$('validationBox');
    box.textContent = '';
    for (const msg of sim.errors || []) {
      const div = document.createElement('div');
      div.className = 'v-error';
      div.innerHTML = `<span class="v-icon" aria-hidden="true">✕</span><span></span>`;
      div.lastElementChild.textContent = msg;
      box.appendChild(div);
    }
    for (const msg of sim.warnings || []) {
      const div = document.createElement('div');
      div.className = 'v-warn';
      div.innerHTML = `<span class="v-icon" aria-hidden="true">!</span><span></span>`;
      div.lastElementChild.textContent = msg;
      box.appendChild(div);
    }
  },

  renderResults(P, sim) {
    const grid = this.$('resultsGrid');
    const badge = this.$('statusBadge');
    const ok = sim.status === 'ok';
    const M = ok ? sim.metrics : null;

    badge.className = 'status-badge';
    if (!ok) {
      badge.classList.add('invalid');
      badge.textContent = '✕ Invalid configuration';
    } else if (M.withinTol) {
      badge.classList.add('on-target');
      badge.textContent = '● On target';
    } else if (M.label === 'Short') {
      badge.classList.add('short');
      badge.textContent = '▼ Short';
    } else {
      badge.classList.add('long');
      badge.textContent = '▲ Long';
    }

    const cells = [
      ['Estimated range', M && Utils.fmt(M.range, 2), 'm', M && M.inBand2025 && M.withinTol],
      ['Error vs target', M && (M.rangeError >= 0 ? '+' : '') + Utils.fmt(M.rangeError, 2), 'm'],
      ['Launch speed', M && Utils.fmt(M.launchSpeed, 2), 'm/s'],
      ['Release angle', M && Utils.fmt(M.releaseAngleDeg, 1), '°'],
      ['Release height', M && Utils.fmt(M.releaseHeight, 2), 'm'],
      ['Max height', M && Utils.fmt(M.maxHeight, 2), 'm'],
      ['Flight time', M && Utils.fmt(M.flightTime, 2), 's'],
      ['Impact speed', M && Utils.fmt(M.impactSpeed, 2), 'm/s'],
      ['Impact angle', M && Utils.fmt(M.impactAngleDeg, 1), '° below horiz.'],
      ['CW potential energy', M && Utils.fmt(M.cwPotentialEnergy, 0), 'J'],
      ['Projectile KE at release', M && Utils.fmt(M.projectileKE, 0), 'J'],
      ['Total modeled efficiency', M && Utils.fmt(M.totalEfficiency * 100, 1), '%'],
      ['Energy lost (modeled)', M && Utils.fmt(M.energyLost, 0), 'J'],
      ['Arm tip speed', M && Utils.fmt(M.armTipSpeed, 2), 'm/s'],
      ['Throw duration', M && Utils.fmt(M.throwTime, 2), 's'],
      ['Lands in 20–25 m band', M ? (M.inBand2025 ? 'yes' : 'no') : null, ''],
    ];

    grid.textContent = '';
    for (const [label, value, unit, highlight] of cells) {
      const div = document.createElement('div');
      div.className = 'metric' + (highlight ? ' metric-hit' : '');
      const l = document.createElement('span'); l.className = 'm-label'; l.textContent = label;
      const val = document.createElement('span'); val.className = 'm-value';
      val.textContent = value == null ? '—' : value;
      if (unit && value != null) {
        const u = document.createElement('small'); u.textContent = unit; val.appendChild(u);
      }
      div.appendChild(l); div.appendChild(val);
      grid.appendChild(div);
    }
  },

  onAnimFrame(frame, anim) {
    const btn = this.$('btnPlay');
    btn.innerHTML = anim.playing ? '&#x23F8;' : '&#x25B6;';
    btn.setAttribute('aria-label', anim.playing ? 'Pause animation' : 'Play animation');
    const tl = this.$('timeline');
    if (document.activeElement !== tl || !anim.playing) {
      tl.value = anim.duration > 0 ? Math.round((anim.t / anim.duration) * 1000) : 0;
    }
    this.$('timeReadout').value = `t = ${Utils.fmt(anim.t, 3)} s`;
    this.$('phaseReadout').textContent = frame ? frame.phase : '—';
  },

  /* ------------------------------- wiring ------------------------------- */

  wireTransport() {
    this.$('btnPlay').addEventListener('click', () => this.anim.toggle());
    this.$('btnStepFrame').addEventListener('click', () => this.anim.stepFrame());
    this.$('btnRestart').addEventListener('click', () => this.anim.restart());
    this.$('speedSelect').addEventListener('change', (e) => { this.anim.speed = Number(e.target.value); });
    this.$('timeline').addEventListener('input', (e) => this.anim.scrubTo(Number(e.target.value) / 1000));
  },

  wireButtons() {
    this.$('btnReset').addEventListener('click', () => {
      this.state.reset();
      this.toast('Parameters reset to defaults.');
    });

    this.$('btnRecalc').addEventListener('click', () => this.simulate());

    this.$('btnRandom').addEventListener('click', () => this.randomize());

    this.$('btnCopyJson').addEventListener('click', async () => {
      const ok = await this.copyText(this.state.toJSON());
      this.toast(ok ? 'Configuration JSON copied to the clipboard.' : 'Could not access the clipboard.');
    });

    this.$('btnShare').addEventListener('click', async () => {
      const url = `${location.origin}${location.pathname}#${this.state.toHash()}`;
      const ok = await this.copyText(url);
      this.toast(ok ? 'Shareable URL copied to the clipboard.' : 'Could not access the clipboard.');
    });

    const dialog = this.$('importDialog');
    this.$('btnImportJson').addEventListener('click', () => {
      this.$('importError').textContent = '';
      this.$('importText').value = '';
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else this.toast('This browser does not support the import dialog.');
    });
    this.$('btnImportConfirm').addEventListener('click', () => {
      const res = this.state.fromJSON(this.$('importText').value);
      if (res.ok) {
        dialog.close();
        this.toast(`Imported ${res.applied.length} parameter${res.applied.length === 1 ? '' : 's'}.`);
        if (!res.applied.length) this.simulate();
      } else {
        this.$('importError').textContent = res.error;
      }
    });

    this.$('btnSearch').addEventListener('click', () => this.runSearch());
    this.$('btnCancelSearch').addEventListener('click', () => this.cancelSearch());
    this.$('btnSensitivity').addEventListener('click', () => this.runSensitivity());
    this.$('btnRunTests').addEventListener('click', () => this.runTests());
  },

  wireTheme() {
    this.$('themeToggle').addEventListener('click', () => {
      const cur = document.documentElement.dataset.theme;
      const next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
      this.anim.render();
      this.chart.draw();
    });
  },

  /* ------------------------------ actions ------------------------------- */

  randomize() {
    // Draw random values within bounds; retry until the configuration is
    // valid so "Randomize" never lands the user on an error screen.
    for (let attempt = 0; attempt < 50; attempt++) {
      const draft = { ...this.state.params };
      for (const p of CONFIG) {
        if (!p.randomize) continue;
        draft[p.key] = Utils.quantize(p.min + Math.random() * (p.max - p.min), p);
      }
      const check = Simulator.run(draft, { sweepSteps: 24, flightDt: 0.005, needVacuum: false });
      if (check.status === 'ok') {
        this.state.setMany(draft);
        this.toast('Randomized within safe simulation bounds.');
        return;
      }
    }
    this.toast('Could not find a valid random configuration — try adjusting ranges manually.');
  },

  async copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // Fallback for older browsers / non-secure contexts.
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch (e2) { return false; }
    }
  },

  toastTimer: 0,
  toast(msg) {
    const el = this.$('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  },

  /* ------------------------------- search ------------------------------- */

  runSearch() {
    this.cancelSearch();
    const btn = this.$('btnSearch');
    const cancel = this.$('btnCancelSearch');
    const bar = this.$('searchProgress');
    const status = this.$('searchStatus');
    btn.disabled = true;
    cancel.hidden = false;
    bar.style.width = '0%';
    status.textContent = 'searching…';

    const base = { ...this.state.params };
    this.searchHandle = ConfigSearch.start(base, {
      onProgress: (done, total) => {
        bar.style.width = `${Math.round((done / total) * 100)}%`;
        status.textContent = `evaluated ${done.toLocaleString()} / ${total.toLocaleString()}`;
      },
      onDone: (rows) => {
        btn.disabled = false;
        cancel.hidden = true;
        bar.style.width = '100%';
        status.textContent = rows.length
          ? `done — showing the best ${rows.length}`
          : 'done — no valid configurations found in the grid';
        this.renderSearchRows(base, rows);
        this.searchHandle = null;
      },
    });
  },

  cancelSearch() {
    if (this.searchHandle) {
      this.searchHandle.cancel();
      this.searchHandle = null;
      this.$('btnSearch').disabled = false;
      this.$('btnCancelSearch').hidden = true;
      this.$('searchStatus').textContent = 'cancelled';
    }
  },

  renderSearchRows(base, rows) {
    const table = this.$('searchTable');
    const tbody = table.querySelector('tbody');
    tbody.textContent = '';
    table.hidden = rows.length === 0;
    rows.forEach((r, i) => {
      const tr = document.createElement('tr');
      if (Math.abs(r.signedErr) <= base.targetTolerance && r.range >= 20 && r.range <= 25) tr.classList.add('row-hit');
      const cells = [
        String(i + 1),
        Utils.fmt(base.massP, 2),
        Utils.fmt(base.targetDistance, 1),
        Utils.fmt(r.over.cwMass, 0),
        Utils.fmt(r.over.longArm / r.over.shortArm, 2),
        Utils.fmt(r.over.longArm, 2),
        Utils.fmt(r.over.shortArm, 2),
        Utils.fmt(r.over.slingLength, 2),
        Utils.fmt(r.over.releaseAngle, 1),
        Utils.fmt(r.v0, 2),
        Utils.fmt(r.range, 2),
        (r.signedErr >= 0 ? '+' : '') + Utils.fmt(r.signedErr, 2),
        Utils.fmt(r.eff * 100, 1),
      ];
      for (const c of cells) {
        const td = document.createElement('td');
        td.textContent = c;
        tr.appendChild(td);
      }
      const tdBtn = document.createElement('td');
      const btn = document.createElement('button');
      btn.className = 'btn btn-sm load-btn';
      btn.type = 'button';
      btn.textContent = 'Load';
      btn.setAttribute('aria-label', `Load configuration ${i + 1} into the simulator`);
      btn.addEventListener('click', () => {
        this.state.setMany(r.over);
        this.toast('Configuration loaded into the simulator.');
        window.scrollTo({ top: 0, behavior: this.anim.reducedMotion ? 'auto' : 'smooth' });
      });
      tdBtn.appendChild(btn);
      tr.appendChild(tdBtn);
      tbody.appendChild(tr);
    });
  },

  /* ---------------------------- sensitivity ----------------------------- */

  runSensitivity() {
    const btn = this.$('btnSensitivity');
    btn.disabled = true;
    const summary = this.$('sensSummary');
    summary.textContent = 'evaluating…';
    // Let the label paint before the (fast but noticeable) burst of sims.
    setTimeout(() => {
      const res = Sensitivity.analyze({ ...this.state.params });
      btn.disabled = false;
      const table = this.$('sensTable');
      const tbody = table.querySelector('tbody');
      tbody.textContent = '';
      if (!res.ok) {
        table.hidden = true;
        summary.textContent = 'The current configuration is invalid — fix it before analysing sensitivity.';
        return;
      }
      table.hidden = false;
      summary.innerHTML = res.anyHigh
        ? '<span class="sens-flag">⚠ Highly sensitive:</span> a ±1% change in at least one parameter moves the range more than the target tolerance. This configuration is unlikely to be repeatable with a real machine.'
        : '<span class="sens-ok">✓ Robust:</span> small parameter changes keep the range within the target tolerance.';
      for (const row of res.rows) {
        const tr = document.createElement('tr');
        const name = document.createElement('td');
        name.textContent = row.label + (row.mode === 'abs' ? ' (±0.1 / ±0.5 m/s)' : '');
        tr.appendChild(name);
        for (const c of row.cells) {
          const td = document.createElement('td');
          td.textContent = Number.isFinite(c) ? `${c >= 0 ? '+' : ''}${Utils.fmt(c, 2)} m` : 'invalid';
          tr.appendChild(td);
        }
        const v = document.createElement('td');
        v.textContent = row.verdict;
        v.className = row.verdict === 'High' || row.verdict === 'Invalid nearby' ? 'status-text-critical'
          : row.verdict === 'Moderate' ? 'status-text-warn' : 'status-text-good';
        tr.appendChild(v);
        tbody.appendChild(tr);
      }
    }, 30);
  },

  /* ------------------------------ presets ------------------------------- */

  buildPresets() {
    const host = this.$('presetButtons');
    const tbody = this.$('presetTable').querySelector('tbody');
    host.textContent = '';
    tbody.textContent = '';

    for (const preset of Presets) {
      const P = presetParams(preset);
      const res = Simulator.run(P, { sweepSteps: 64, needVacuum: false });
      const ok = res.status === 'ok';
      const M = ok ? res.metrics : null;
      const liveLabel = ok
        ? `${Utils.fmt(M.range, 1)} m — ${M.label}`
        : 'invalid';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn preset-btn';
      btn.innerHTML = `<span class="p-name"></span><span class="p-live"></span>`;
      btn.querySelector('.p-name').textContent = preset.name;
      btn.querySelector('.p-live').textContent = liveLabel;
      btn.addEventListener('click', () => {
        this.state.setMany(P);
        this.toast(`Preset “${preset.name}” loaded.`);
      });
      host.appendChild(btn);

      const tr = document.createElement('tr');
      if (ok && M.withinTol) tr.classList.add('row-hit');
      const cells = [
        preset.name,
        Utils.fmt(P.massP, 2),
        Utils.fmt(P.targetDistance, 1),
        Utils.fmt(P.cwMass, 0),
        Utils.fmt(P.longArm, 2),
        Utils.fmt(P.slingLength, 2),
        Utils.fmt(P.releaseAngle, 1),
        ok ? Utils.fmt(M.launchSpeed, 2) : '—',
        ok ? Utils.fmt(M.range, 2) : '—',
      ];
      for (const c of cells) {
        const td = document.createElement('td');
        td.textContent = c;
        tr.appendChild(td);
      }
      const st = document.createElement('td');
      st.className = 'row-status ' + (!ok ? 'status-text-critical'
        : M.withinTol ? 'status-text-good'
          : M.label === 'Short' ? 'status-text-warn' : 'status-text-serious');
      st.textContent = ok ? M.label : 'Invalid configuration';
      tr.appendChild(st);
      const tdBtn = document.createElement('td');
      const load = document.createElement('button');
      load.className = 'btn btn-sm load-btn';
      load.type = 'button';
      load.textContent = 'Load';
      load.setAttribute('aria-label', `Load preset ${preset.name}`);
      load.addEventListener('click', () => {
        this.state.setMany(P);
        this.toast(`Preset “${preset.name}” loaded.`);
        window.scrollTo({ top: 0, behavior: this.anim.reducedMotion ? 'auto' : 'smooth' });
      });
      tdBtn.appendChild(load);
      tr.appendChild(tdBtn);
      tbody.appendChild(tr);
    }
  },

  /* ------------------------------- tests -------------------------------- */

  runTests() {
    const list = this.$('testResults');
    list.textContent = '';
    const results = SelfTest.run();
    for (const r of results) {
      const li = document.createElement('li');
      li.className = r.pass ? 'test-pass' : 'test-fail';
      li.textContent = ` ${r.name}${r.pass ? '' : ` — ${r.detail}`}`;
      list.appendChild(li);
    }
    const passed = results.filter(r => r.pass).length;
    const li = document.createElement('li');
    li.textContent = `${passed}/${results.length} checks passed`;
    li.style.fontWeight = '650';
    list.appendChild(li);
  },
};

/* ============================================================================
 * Boot (browser) / exports (Node — used by tests and the preset tuner)
 * ==========================================================================*/

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => UI.init());
  } else {
    UI.init();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CONFIG, CONFIG_BY_KEY, defaultParams, Utils, Validation,
    TrebuchetModel, FlightModel, Simulator, AppState,
    ConfigSearch, Sensitivity, Presets, presetParams, SelfTest,
  };
}
