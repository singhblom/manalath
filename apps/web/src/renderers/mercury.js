import * as THREE from 'three';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { cells, N, step } from '@manalath/shared/hex.js';
import { ThreeRenderer, OUTCOME_HEX } from './three.js';
import { makeNoise } from './terraces.js';

// "Quintessence" (formerly Mercury): groups are pools of liquid metal (Player 1) and dark oil (Player 2) built from
// marching-cubes metaballs, so adjacent stones physically flow into one blob. The board is a
// dark pool running a 2D wave simulation: every placement sends ripples across the surface.

const RES = 56;                 // marching cubes grid resolution
const FIELD = { x: 10.5, y: 4.2, z: 10.5 };  // half extents of the metaball field in world units
const BALL_Y = 0.45;
const R_WORLD = 0.9;            // metaball iso-radius in the horizontal plane
const SUBTRACT = 10;
const STRENGTH = Math.pow(R_WORLD / (2 * FIELD.x), 2) * (80 + SUBTRACT);

const POOL = { size: 24, segs: 96, radius: 10.8 }; // the liquid is a circular pool; waves reflect off the rim


export class MercuryRenderer extends ThreeRenderer {
  constructor(container, handlers) {
    super(container, handlers, 'mercury');
    this.camera.position.set(5.8, 15.8, 17.9); // ~40° elevation: a side-on view that shows the ripples
    this.controls.maxPolarAngle = Math.PI * 0.44;
    this.spring = Array.from({ length: N }, () => ({ s: 0, v: 0, ox: 0, oz: 0, vx: 0, vz: 0, phase: Math.random() * 6.28, present: false, obj: 0 }));
    this.frame = 0;
    this.initialized = false;
    this.lastT = performance.now();
    for (const t of this.tiles) { t.material.depthWrite = false; t.material.colorWrite = false; }
    this.buildEnvironment();
    this.buildNebula();
    this.buildPool();
    this.buildOutlines();
    this.buildMetaballs();
  }

  // A grey-and-purple nebula on a sky sphere around the pool: layered noise clouds, wisps and a few stars.
  buildNebula() {
    const w = 2048, h = 1024;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    const img = g.createImageData(w, h);
    const n1 = makeNoise(11), n2 = makeNoise(23), n3 = makeNoise(37);
    const fbm = (n, x, y, oct = 5) => { let v = 0, a = 0.5, f = 1; for (let o = 0; o < oct; o++) { v += n(x * f, y * f) * a; a *= 0.5; f *= 2.05; } return v; };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h;
      // wrap horizontally by sampling on a circle so the seam disappears
      const ang = u * Math.PI * 2, cx = Math.cos(ang) * 1.6, sy = Math.sin(ang) * 1.6;
      const cloud = fbm(n1, cx + v * 2.2, sy + v * 3.1);              // large purple clouds
      const wisp = fbm(n2, cx * 2.5 + v * 5, sy * 2.5 - v * 4, 6);     // finer grey wisps
      const warp = fbm(n3, cx * 1.2, sy * 1.2 + v * 2, 3);
      const p = Math.max(0, cloud + warp * 0.35 - 0.05) * 1.6;          // purple density
      const gr = Math.max(0, Math.abs(wisp) * 1.5 - 0.15);              // grey wisp density
      // v = 1 is straight up (what the pool mirrors at the default view): keep the nebula dense overhead,
      // fade only toward the underside of the sky sphere
      const horizon = v >= 0.5 ? 1 + (v - 0.5) * 1.8 : 1 - Math.pow((0.5 - v) * 2, 1.5) * 0.7;
      let r = 9 + (150 * p + 105 * gr) * horizon;
      let gg = 8 + (62 * p + 112 * gr) * horizon;
      let b = 16 + (215 * p + 130 * gr) * horizon;
      const i = (y * w + x) * 4;
      img.data[i] = Math.min(255, r); img.data[i + 1] = Math.min(255, gg); img.data[i + 2] = Math.min(255, b); img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    // stars
    const rand = (() => { let a = 99; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
    for (let k = 0; k < 1600; k++) {
      const sx = rand() * w, sy = rand() * h, r = rand();
      g.fillStyle = `rgba(${220 + rand() * 35 | 0},${215 + rand() * 40 | 0},255,${0.2 + r * 0.6})`;
      g.beginPath(); g.arc(sx, sy, r < 0.93 ? 0.5 + rand() * 0.5 : 1.1 + rand() * 0.6, 0, Math.PI * 2); g.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const sky = new THREE.Mesh(new THREE.SphereGeometry(120, 64, 32), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false }));
    sky.rotation.y = Math.PI * 0.3;
    this.scene.add(sky);
    this.scene.background = null;
    // the nebula is also what everything reflects: the bowl, the pool surface and the liquid metal
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.roomEnv = this.envTex;                    // keep the bright studio map for the chrome
    this.nebulaEnv = pmrem.fromEquirectangular(tex).texture;
    pmrem.dispose();
    this.scene.environment = this.nebulaEnv;       // bowl, pool and oil reflect the (darkened) nebula
    this.scene.environmentRotation?.set(0, Math.PI * 0.3, 0); // line up with the visible sky
    this.scene.environmentIntensity = 1.4;
  }

  buildLights() {
    const s = this.scene;
    s.add(new THREE.AmbientLight(0x404a5a, 0.5));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(6, 12, 8);
    s.add(key);
    const rim = new THREE.DirectionalLight(0x8fb4ff, 0.8);
    rim.position.set(-8, 6, -10);
    s.add(rim);
  }

  buildEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.envTex;
  }

  buildPool() {
    const { size, segs, radius } = POOL;
    this.poolGeo = new THREE.PlaneGeometry(size, size, segs, segs);
    this.poolGeo.rotateX(-Math.PI / 2);
    const n = (segs + 1) * (segs + 1);
    this.h = new Float32Array(n);
    this.hv = new Float32Array(n);
    // clip the square grid to a disc: vertices beyond the rim are pulled onto it and held still,
    // so the simulation's fixed boundary is the circle and ripples bounce back from it
    this.inside = new Uint8Array(n);
    const pos = this.poolGeo.attributes.position.array;
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3], z = pos[i * 3 + 2], r = Math.hypot(x, z);
      if (r <= radius) this.inside[i] = 1;
      else { const k = radius / r; pos[i * 3] = x * k; pos[i * 3 + 2] = z * k; }
    }
    this.pool = new THREE.Mesh(this.poolGeo, new THREE.MeshPhysicalMaterial({
      color: 0xa2a8b6, metalness: 1.0, roughness: 0.06, clearcoat: 0, envMapIntensity: 1.5, // a dark-grey liquid mirror: shows the nebula even when viewed from straight above
    }));
    this.pool.position.y = -0.02;
    this.scene.add(this.pool);
    // the vessel: a shallow spherical bowl whose rim is the pool's edge, in the same dark metal as the rim ring
    const Rs = radius * 1.08, theta = Math.asin(radius / Rs); // nearly a full hemisphere
    const bowl = new THREE.Mesh(
      new THREE.SphereGeometry(Rs, 96, 32, 0, Math.PI * 2, Math.PI - theta, theta),
      new THREE.MeshStandardMaterial({ color: 0x2a2f3a, metalness: 0.8, roughness: 0.35, side: THREE.DoubleSide, envMapIntensity: 1.2 })
    );
    bowl.position.y = Rs * Math.cos(theta) - 0.05;
    this.scene.add(bowl);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(radius + 0.2, 0.35, 16, 96), new THREE.MeshStandardMaterial({ color: 0x2a2f3a, metalness: 0.8, roughness: 0.35, envMapIntensity: 1.2 }));
    rim.rotation.x = Math.PI / 2; rim.position.y = 0.05;
    this.scene.add(rim);
  }

  // world (x,z) -> heightfield index
  poolIndex(x, z) {
    const { size, segs } = POOL;
    const ix = Math.round((x / size + 0.5) * segs), iz = Math.round((z / size + 0.5) * segs);
    if (ix < 1 || iz < 1 || ix >= segs || iz >= segs) return -1;
    return iz * (segs + 1) + ix;
  }

  disturb(x, z, amount) {
    const { segs } = POOL;
    const c = this.poolIndex(x, z);
    if (c < 0) return;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const d2 = dx * dx + dz * dz;
      this.hv[c + dz * (segs + 1) + dx] += amount * (1 - d2 / 3);
    }
  }

  stepPool() {
    const { segs } = POOL;
    const w = segs + 1, h = this.h, v = this.hv;
    for (let z = 1; z < segs; z++) for (let x = 1; x < segs; x++) {
      const i = z * w + x;
      const lap = h[i - 1] + h[i + 1] + h[i - w] + h[i + w] - 4 * h[i];
      v[i] = (v[i] + lap * 0.42) * 0.975; // stiffer -> faster waves; a touch more damping
    }
    const pos = this.poolGeo.attributes.position.array, inside = this.inside;
    for (let i = 0; i < h.length; i++) {
      if (inside[i]) h[i] += v[i]; else { h[i] = 0; v[i] = 0; }
      pos[i * 3 + 1] = h[i];
    }
    this.poolGeo.attributes.position.needsUpdate = true;
    this.poolGeo.computeVertexNormals();
  }

  buildOutlines() {
    this.outlines = [];
    const pts = [];
    for (let k = 0; k <= 6; k++) { const a = Math.PI / 180 * (60 * k + 30); pts.push(new THREE.Vector3(0.9 * Math.cos(a), 0, 0.9 * Math.sin(a))); }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    for (let i = 0; i < N; i++) {
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x6f7f96, transparent: true, opacity: 0.9 }));
      const t = this.tiles[i].position;
      line.position.set(t.x, 0.2, t.z);
      this.scene.add(line);
      this.outlines.push(line);
    }
  }

  buildMetaballs() {
    const mk = (mat) => {
      const mc = new MarchingCubes(RES, mat, false, false, 60000);
      mc.isolation = 80;
      mc.scale.set(FIELD.x, FIELD.y, FIELD.z);
      mc.position.y = 0;
      this.scene.add(mc);
      return mc;
    };
    this.mc = [
      mk(new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1.0, roughness: 0.14, envMapIntensity: 1.1, envMap: this.roomEnv || null })), // chrome keeps its own bright studio reflection
      mk(new THREE.MeshPhysicalMaterial({ color: 0x5a2a94, metalness: 0.15, roughness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.15, envMapIntensity: 0.9, envMap: this.roomEnv || null })), // same studio light as the chrome
      mk(new THREE.MeshStandardMaterial({ color: 0xc0202c, emissive: 0x7a0a12, metalness: 0.9, roughness: 0.15, envMap: this.roomEnv || null })),
      mk(new THREE.MeshStandardMaterial({ color: 0xe6b422, emissive: 0x5a4008, metalness: 0.9, roughness: 0.15, envMap: this.roomEnv || null })),
    ];
  }

  iconMesh(player) {
    if (!this._iconGeo) { this._iconGeo = new THREE.SphereGeometry(0.8, 64, 40); this._iconGeo.scale(1, 0.42, 1); this._iconBase = this._iconGeo.attributes.position.array.slice(); }
    // the portrait renderer is a separate GL context: give it a copy of the material bound to its own env map
    if (!this._iconMats) this._iconMats = {};
    if (!this._iconMats[player]) {
      const mat = this.mc[player - 1].material.clone();
      mat.envMap = ThreeRenderer.preview().env;
      this._iconMats[player] = mat;
    }
    const m = new THREE.Mesh(this._iconGeo, this._iconMats[player]);
    m.rotation.x = 0.25;
    return m;
  }

  // A drop of liquid at rest is never still: slow surface waves ripple across it and it squashes and stretches.
  animateIcon(mesh, t, player) {
    const pos = this._iconGeo.attributes.position, base = this._iconBase;
    const ph = player * 1.7;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3], y = base[i * 3 + 1], z = base[i * 3 + 2];
      const top = Math.max(0, y / 0.336);            // 0 at the equator/underside, 1 at the crown
      const wave = Math.sin(x * 6 + t * 3.1 + ph) * 0.5 + Math.sin(z * 7 - t * 2.3 + ph) * 0.5;
      pos.setXYZ(i, x, y + wave * 0.035 * top, z);
    }
    pos.needsUpdate = true;
    this._iconGeo.computeVertexNormals();
    const s = 1 + Math.sin(t * 2.2 + ph) * 0.06;
    mesh.scale.set(s, 1 / (s * s), 1 + Math.cos(t * 1.9 + ph) * 0.06);
    mesh.rotation.y = Math.sin(t * 0.7 + ph) * 0.4;
  }

  update(game) {
    const prevGame = this.game;
    this.game = game;
    const present = new Uint8Array(N);
    this.groupSize = new Int8Array(N);
    const line = new Set(game.line || []);
    for (const g of game.groups()) for (const i of g.cells) { present[i] = 1; this.groupSize[i] = g.size; }
    for (let i = 0; i < N; i++) {
      const sp = this.spring[i];
      const c = game.board[i];
      if (present[i] && !sp.present) {
        sp.present = true;
        if (this.initialized) { sp.s = 0.05; sp.v = 6; } else { sp.s = 1; sp.v = 0; }
        const t = this.tiles[i].position;
        if (this.initialized) this.disturb(t.x, t.z, 0.5);
        for (let d = 0; d < 6 && this.initialized; d++) {
          const j = step[i][d];
          if (j !== -1 && game.board[j] === c) {
            const n = this.spring[j], tj = this.tiles[j].position;
            n.vx += (tj.x - t.x) * 0.9; n.vz += (tj.z - t.z) * 0.9;
          }
        }
      } else if (!present[i] && sp.present) {
        sp.present = false; sp.s = 0; sp.v = 0;
      }
      sp.obj = c === 0 ? -1 : (line.has(i) || this.groupSize[i] === 4) ? 2 : c - 1;
    }
    // highlight colour: gold for a winning quint, red otherwise
    const hl = this.mc[2].material;
    if (game.status === 'won') { hl.color.setHex(0xe6b422); hl.emissive.setHex(0x5a4008); }
    else { hl.color.setHex(0xc0202c); hl.emissive.setHex(0x7a0a12); }

    if (game.lastMove >= 0) {
      const p = this.tiles[game.lastMove].position;
      this.lastRing.position.set(p.x, 0.1, p.z);
      this.lastRing.visible = true;
    } else this.lastRing.visible = false;
    this.initialized = true;
    this.rebuildMetaballs(performance.now() / 1000);
    this.refreshTiles();
  }

  refreshTiles() {
    if (!this.game || !this.outlines) return;
    const sel = this.handlers.selectedColor?.() ?? this.game.player;
    const canPlay = !this.game.isOver && this.handlers.canPlay?.();
    for (let i = 0; i < N; i++) {
      const m = this.outlines[i].material;
      if (this.game.board[i] !== 0) { m.color.setHex(0x2a3344); m.opacity = 0.5; continue; }
      const legal = this.game.isLegal(i, sel);
      if (i === this.hover && canPlay && legal) {
        const pv = this.handlers.previewOutcome?.(i);
        m.color.setHex(pv?.result ? OUTCOME_HEX[pv.result] : (sel === 1 ? 0xffffff : 0xb07aff)); m.opacity = 1;
      }
      else if (canPlay && !legal) { m.color.setHex(0x5a1e24); m.opacity = 0.7; }
      else { m.color.setHex(0x6f7f96); m.opacity = 0.9; }
    }
    if (this.ghost) { this.scene.remove(this.ghost); this.ghost = null; }
  }

  rebuildMetaballs(tsec) {
    for (const mc of this.mc) mc.reset();
    const toN = (w, half) => (w / half + 1) / 2;
    for (let i = 0; i < N; i++) {
      const sp = this.spring[i];
      if (!sp.present || sp.obj < 0) continue;
      const t = this.tiles[i].position;
      const wob = 0.05 * Math.sin(tsec * 1.7 + sp.phase);
      const x = t.x + sp.ox + wob, z = t.z + sp.oz + 0.05 * Math.cos(tsec * 1.3 + sp.phase);
      const breathe = 1 + 0.06 * Math.sin(tsec * 2.1 + sp.phase);
      const hi = this.poolIndex(x, z);
      const lift = hi >= 0 ? this.h[hi] * 0.9 : 0, surge = hi >= 0 ? this.hv[hi] * 1.5 : 0;
      this.mc[sp.obj].addBall(toN(x, FIELD.x), toN(BALL_Y + lift, FIELD.y), toN(z, FIELD.z), STRENGTH * sp.s * breathe * (1 + surge), SUBTRACT);
    }
    // gooey preview of the hovered placement
    const g = this.game;
    if (g && this.hover >= 0 && !g.isOver && this.handlers.canPlay?.()) {
      const sel = this.handlers.selectedColor?.() ?? g.player;
      if (g.isLegal(this.hover, sel)) {
        const t = this.tiles[this.hover].position;
        const pulse = 0.55 + 0.1 * Math.sin(tsec * 5);
        const pv = this.handlers.previewOutcome?.(this.hover);
        const obj = pv?.result === 'lose' || pv?.result === 'check' ? 2 : pv?.result === 'win' ? 3 : sel - 1;
        this.mc[obj].addBall(toN(t.x, FIELD.x), toN(BALL_Y, FIELD.y), toN(t.z, FIELD.z), STRENGTH * pulse, SUBTRACT);
      }
    }
    for (const mc of this.mc) mc.update();
  }

  loop() {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.homeDist) this.fitCamera();
    const now = performance.now();
    const tsec = now / 1000;
    const dt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;
    for (let i = 0; i < N; i++) {
      const sp = this.spring[i];
      if (!sp.present) continue;
      // radius spring (overshooting spawn)
      const a = (1 - sp.s) * 90 - sp.v * 7;
      sp.v += a * dt; sp.s += sp.v * dt;
      // offset spring (jiggle)
      sp.vx += (-sp.ox * 70 - sp.vx * 6) * dt; sp.ox += sp.vx * dt;
      sp.vz += (-sp.oz * 70 - sp.vz * 6) * dt; sp.oz += sp.vz * dt;
    }
    if ((this.frame++ & 1) === 0) this.rebuildMetaballs(tsec);
    this.stepPool();
    if (this.lastRing.visible) this.lastRing.material.opacity = 0.5 + 0.4 * Math.sin(tsec * 4);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  destroy() {
    for (const mc of this.mc) { this.scene.remove(mc); }
    this.envTex?.dispose();
    this.nebulaEnv?.dispose();
    super.destroy();
  }
}
