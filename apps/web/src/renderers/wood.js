import * as THREE from 'three';

// Procedural wood shared by the Goban (kaya) and Marble Hall (grey oak room; its walnut joinery uses solidWoodMaterial) themes.
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Kaya wood: warm honey base with fine, slightly wavy straight grain.
export const GRAIN_ANGLE = 4.5; // degrees between the grain and the board's long axis, as on a real plank

export const KAYA = {
  base: ['#c48a3a', '#cf9744', '#bd8235'],
  band: (r) => `rgba(${120 + r() * 40 | 0},${70 + r() * 30 | 0},${20 + r() * 20 | 0},${0.06 + r() * 0.08})`,
  dark: (r) => `rgba(80,45,15,${0.28 + r() * 0.28})`,
  light: (r) => `rgba(105,65,25,${0.07 + r() * 0.14})`,
  speck: (r) => `rgba(80,50,20,${r() * 0.08})`,
};
// Reddish turned-wood for go bowls (chestnut / cherry): strong grain, warm glow.
export const CHESTNUT = {
  base: ['#a4522a', '#b86538', '#93451f'],
  band: (r) => `rgba(${120 + r() * 50 | 0},${40 + r() * 25 | 0},${15 + r() * 15 | 0},${0.10 + r() * 0.12})`,
  dark: (r) => `rgba(70,25,8,${0.30 + r() * 0.30})`,
  light: (r) => `rgba(220,140,80,${0.06 + r() * 0.12})`,
  speck: (r) => `rgba(60,20,5,${r() * 0.10})`,
};
// Grey-brown oak, as on cafe wall panelling and parquet: muted, low-contrast grain.
export const OAK = {
  base: ['#84776a', '#8e8174', '#7a6d60'],
  band: (r) => `rgba(${90 + r() * 30 | 0},${75 + r() * 25 | 0},${60 + r() * 20 | 0},${0.08 + r() * 0.10})`,
  dark: (r) => `rgba(70,56,44,${0.22 + r() * 0.25})`,
  light: (r) => `rgba(195,180,160,${0.06 + r() * 0.10})`,
  speck: (r) => `rgba(50,38,28,${r() * 0.06})`,
};

export function woodTexture(size = 1024, seed = 7, withGrid = null, angleDeg = GRAIN_ANGLE, palette = KAYA) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const rand = rng(seed);
  const base = g.createLinearGradient(0, 0, size, 0);
  base.addColorStop(0, palette.base[0]); base.addColorStop(0.5, palette.base[1]); base.addColorStop(1, palette.base[2]);
  g.fillStyle = base; g.fillRect(0, 0, size, size);
  // everything grain-related is drawn slightly rotated, over an oversized area, so it stays a few degrees off the edges
  g.save();
  g.translate(size / 2, size / 2);
  g.rotate(angleDeg * Math.PI / 180);
  g.translate(-size / 2, -size / 2);
  const ext = size * 0.6;
  // broad tonal bands
  for (let k = 0; k < 14; k++) {
    g.fillStyle = palette.band(rand);
    const y = rand() * size, h = 20 + rand() * 90;
    g.fillRect(-ext, y, size + 2 * ext, h);
  }
  // fine grain lines running along x, gently waving
  const lines = 900;
  for (let k = 0; k < lines; k++) {
    const y0 = (k / lines) * (size + 2 * ext) - ext + (rand() - 0.5) * 3;
    const dark = rand() < 0.15;
    g.strokeStyle = dark ? palette.dark(rand) : palette.light(rand);
    g.lineWidth = dark ? 0.9 + rand() * 1.1 : 0.5 + rand() * 0.8;
    g.beginPath();
    const amp = 1 + rand() * 3, freq = 0.002 + rand() * 0.004, ph = rand() * 10;
    for (let x = -ext; x <= size + ext; x += 8) {
      const y = y0 + Math.sin(x * freq + ph) * amp + Math.sin(x * freq * 3.7 + ph) * amp * 0.3;
      x === -ext ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.stroke();
  }
  g.restore();
  // subtle speckle
  for (let k = 0; k < 6000; k++) {
    g.fillStyle = palette.speck(rand);
    g.fillRect(rand() * size, rand() * size, 1.5, 1.5);
  }
  if (withGrid) withGrid(g, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}


// End-grain / flat-sawn face: the growth rings show as large concentric arcs (as on the sides of a kaya goban)
// rather than the straight lines of the top face. Rings are centred well outside the face, spaced unevenly,
// and gently warped so they bow and wander like real timber.
export function ringTexture(size = 1024, seed = 5, palette = KAYA, aspect = 2) {
  // canvas is `aspect` times wider than tall, covering two adjacent faces side by side
  const w = Math.round(size * aspect), h = size; // integer width: the pixel loop indexes by w
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const rand = rng(seed);
  const base = g.createLinearGradient(0, 0, w, h);
  base.addColorStop(0, palette.base[1]); base.addColorStop(0.5, palette.base[0]); base.addColorStop(1, palette.base[2]);
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  const wob = []; for (let k = 0; k < 6; k++) wob.push([rand() * 6.28, 0.8 + rand() * 1.6, rand() * 0.6 + 0.4]);
  const warp = (x, y) => { let v = 0; for (const [ph, f, a] of wob) v += Math.sin(x * f + ph) * Math.cos(y * f * 0.7 - ph) * a; return v / 6; };
  // two ring centres (one per face), well below the faces, so each face shows big upward-bowing arcs
  const faceW = aspect / 2; // width of one face in units of face height
  const centres = [[faceW * 0.5 + (rand() - 0.5) * 0.4, 1.9 + rand() * 0.5], [faceW * 1.5 + (rand() - 0.5) * 0.4, 2.1 + rand() * 0.5]];
  const img = g.getImageData(0, 0, w, h);
  const px = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = (x / h), v = y / h;                 // both in units of face height, so circles stay circular
    const [cx, cy] = centres[u < faceW ? 0 : 1];
    const d = Math.hypot(u - cx, v - cy) + warp(u * 2, v * 2) * 0.06;
    const phase = d * 15 + Math.sin(d * 5) * 0.9;    // ~15 rings per face height, unevenly spaced
    const ring = Math.sin(phase * Math.PI * 2);
    const line = Math.pow(Math.max(0, ring), 3);           // soft latewood lines
    const band = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2 + 1.0);
    const speck = (Math.sin(u * 900 + v * 700) + Math.sin(u * 1300 - v * 500)) * 0.015;
    const i = (y * w + x) * 4;
    const shade = 1 - line * 0.13 - band * 0.05 + speck;   // subtle: the arcs read as figure, not stripes
    px[i] *= shade; px[i + 1] *= shade * (1 - line * 0.05); px[i + 2] *= shade * (1 - line * 0.12);
  }
  g.putImageData(img, 0, 0);
  // a few faint vertical hairlines (fibre direction), not enough to read as stripes
  for (let k = 0; k < 90; k++) {
    g.strokeStyle = palette.light(rand);
    g.globalAlpha = 0.5;
    g.lineWidth = 0.6 + rand() * 0.8;
    const x0 = rand() * w, drift = (rand() - 0.5) * 40;
    g.beginPath(); g.moveTo(x0, 0); g.lineTo(x0 + drift, h); g.stroke();
  }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// Solid wood as a shader: the timber is modelled as concentric growth tubes around a trunk axis, perturbed by
// 3D noise. Every surface point samples its distance from the axis, so the same log produces straight
// masame lines where a face is cut radially (the top, and faces parallel to the axis) and arcs where a face
// cuts across the tubes. Works on any geometry because it uses world position, no UVs.
export function solidWoodMaterial({
  axisOrigin = new THREE.Vector3(0, 0, 0), axisDir = new THREE.Vector3(1, 0, 0),
  ringSpacing = 0.16, early = '#d4a052', late = '#9e6626', fibre = 0.6, seed = 3.7, flatShading = false, wander = 1.0,
  roughness = 0.55, metalness = 0, map = null, clearcoat = 0, clearcoatRoughness = 0.4,
  pores = 0, streak = 0, streakColor = '#4a3a2c',
} = {}) {
  // a lacquered finish needs the physical material; plain oiled wood does fine with the cheaper standard one
  const mat = clearcoat > 0
    ? new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness, metalness, flatShading, map, clearcoat, clearcoatRoughness })
    : new THREE.MeshStandardMaterial({ color: 0xffffff, roughness, metalness, flatShading, map });
  const uniforms = {
    uAxisOrigin: { value: axisOrigin.clone() },
    uAxisDir: { value: axisDir.clone().normalize() },
    uRingFreq: { value: 1 / ringSpacing },
    uEarly: { value: new THREE.Color(early).convertSRGBToLinear() },
    uLate: { value: new THREE.Color(late).convertSRGBToLinear() },
    uFibre: { value: fibre },
    uSeed: { value: seed },
    uWander: { value: wander }, // 1 = the kaya's irregular rings; lower for straighter, more even timber
    uPores: { value: pores },   // open-grained timbers (walnut, oak): dark pore dashes along the fibre
    uStreak: { value: streak }, // broad colour streaks that follow the trunk and cut across the rings (mineral / heartwood zones)
    uStreakColor: { value: new THREE.Color(streakColor).convertSRGBToLinear() },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWoodPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWoodPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWoodPos;
uniform vec3 uAxisOrigin, uAxisDir, uEarly, uLate, uStreakColor;
uniform float uRingFreq, uFibre, uSeed, uWander, uPores, uStreak;
float whash(vec3 p) { p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3) + uSeed); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float wnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(whash(i), whash(i + vec3(1,0,0)), f.x), mix(whash(i + vec3(0,1,0)), whash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(whash(i + vec3(0,0,1)), whash(i + vec3(1,0,1)), f.x), mix(whash(i + vec3(0,1,1)), whash(i + vec3(1,1,1)), f.x), f.y), f.z) * 2.0 - 1.0;
}
vec3 woodColor(vec3 p) {
  vec3 rel = p - uAxisOrigin;
  float t = dot(rel, uAxisDir);                 // along the trunk
  vec3 radial = rel - t * uAxisDir;              // radial offset from the axis
  float r = length(radial);
  // the log is not a perfect cylinder: slow wander of the rings along the trunk, plus a finer wobble
  r += (wnoise(vec3(t * 0.25, radial.x * 0.35, radial.z * 0.35)) * 0.9 + wnoise(p * 1.7) * 0.06) * uWander;
  // ring spacing itself varies slowly (fast/slow growth years)
  float freq = uRingFreq * (1.0 + 0.25 * uWander * wnoise(vec3(r * 0.5, 3.1, uSeed)));
  float ring = fract(r * freq);
  float late = smoothstep(0.35, 0.7, ring) * (1.0 - smoothstep(0.78, 1.0, ring)); // soft latewood band of each ring
  // fine fibres running along the axis
  float fib = wnoise(vec3(t * 0.6, radial.x * 28.0, radial.z * 28.0)) * 0.5 + wnoise(vec3(t * 1.1, radial.x * 90.0, radial.z * 90.0)) * 0.25;
  // gentle large-scale tonal variation across the piece
  float tone = wnoise(p * 0.12) * 0.08 * uWander;
  vec3 col = mix(uEarly, uLate, late * 0.55);
  // colour zones independent of the rings: long streaks along the trunk, wandering slowly across it
  if (uStreak > 0.0) {
    float zone = wnoise(vec3(t * 0.10, radial.x * 0.7, radial.z * 0.7)) * 0.6 + wnoise(vec3(t * 0.3, radial.x * 2.2, radial.z * 2.2)) * 0.4;
    col = mix(col, uStreakColor, smoothstep(-0.05, 0.6, zone) * uStreak);
    col *= 1.0 + smoothstep(0.1, 0.6, -zone) * 0.12 * uStreak; // and paler zones the other way
  }
  col *= 1.0 + fib * 0.10 * uFibre + tone;
  // open pores: short dark dashes, dense across the grain and stretched along it
  if (uPores > 0.0) {
    float pr = wnoise(vec3(t * 2.5, radial.x * 55.0, radial.z * 55.0)) + wnoise(vec3(t * 6.0, radial.x * 140.0, radial.z * 140.0)) * 0.5;
    float pore = smoothstep(0.45, 0.8, pr) * (0.6 + 0.4 * smoothstep(0.3, 0.7, late)); // more pores in the latewood
    col *= 1.0 - pore * 0.45 * uPores;
  }
  return col;
}`)
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= woodColor(vWoodPos);');
  };
  mat.customProgramCacheKey = () => 'solidwood' + mat.type; // uniforms differ per material, the program is shared per material class
  mat.userData.woodUniforms = uniforms;
  return mat;
}
