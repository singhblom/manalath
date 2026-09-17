import * as THREE from 'three';
import { cells, hexToPlane, N } from '@manalath/shared/hex.js';
import { ThreeRenderer, OUTCOME_HEX } from './three.js';

// "Quartz" (formerly Terraces): a 3D landscape where every group rises as one plateau. Height = group size,
// so a quart (4) looms as a red cliff and a quint (5) crowns the board in gold.
// Procedural meadow: a colour map with patchy grass tones and a matching bump map from layered value noise.
export function makeNoise(seedIn = 1337) {
  return (() => {
    const perm = new Uint8Array(512), p = [];
    for (let i = 0; i < 256; i++) p.push(i);
    let seed = seedIn;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
    const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
    const grad = (h, x, y) => { switch (h & 3) { case 0: return x + y; case 1: return -x + y; case 2: return x - y; default: return -x - y; } };
    return (x, y) => {
      const X = Math.floor(x) & 255, Y = Math.floor(y) & 255; x -= Math.floor(x); y -= Math.floor(y);
      const u = fade(x), v = fade(y);
      const a = perm[X] + Y, b = perm[X + 1] + Y;
      const l = (s, e, t) => s + t * (e - s);
      return l(l(grad(perm[a], x, y), grad(perm[b], x - 1, y), u), l(grad(perm[a + 1], x, y - 1), grad(perm[b + 1], x - 1, y - 1), u), v);
    };
  })();
}

// Layered stone: a neutral, near-white base (so the owner's colour tints it), sediment striations running
// horizontally, grain noise and dark flecks. Returns colour + bump maps; each tile gets its own offset.
function stoneTextures(size = 512) {
  const noise = makeNoise(4242);
  const fbm = (x, y) => { let v = 0, amp = 0.5, f = 1; for (let o = 0; o < 5; o++) { v += noise(x * f, y * f) * amp; amp *= 0.5; f *= 2.0; } return v; };
  const col = document.createElement('canvas'), bump = document.createElement('canvas');
  col.width = col.height = bump.width = bump.height = size;
  const cg = col.getContext('2d'), bg = bump.getContext('2d');
  const ci = cg.createImageData(size, size), bi = bg.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    // striations: bands along v, wobbling slightly with u
    const band = Math.sin((v * 34 + fbm(u * 3, v * 3) * 1.6) * Math.PI * 2);
    const layers = Math.pow(Math.abs(band), 6) * (0.5 + 0.5 * fbm(u * 8, v * 40));
    const grain = fbm(u * 24, v * 24);
    const fleck = fbm(u * 120, v * 120) > 0.42 ? -0.25 : 0;
    const shade = 0.93 - layers * 0.16 + grain * 0.07 + fleck;
    const i = (y * size + x) * 4;
    const c = Math.max(0, Math.min(255, shade * 255));
    ci.data[i] = c; ci.data[i + 1] = c; ci.data[i + 2] = c * 0.985; ci.data[i + 3] = 255;
    const h = Math.max(0, Math.min(255, 128 - layers * 140 + grain * 60 + fleck * 120));
    bi.data[i] = bi.data[i + 1] = bi.data[i + 2] = h; bi.data[i + 3] = 255;
  }
  cg.putImageData(ci, 0, 0); bg.putImageData(bi, 0, 0);
  const mk = (c, srgb) => { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; };
  return { map: mk(col, true), bumpMap: mk(bump, false) };
}

function meadowTextures(size = 512) {
  const noise = makeNoise(1337);
  const fbm = (x, y) => { let v = 0, amp = 0.5, f = 1; for (let o = 0; o < 5; o++) { v += noise(x * f, y * f) * amp; amp *= 0.5; f *= 2.1; } return v; };
  const col = document.createElement('canvas'), bump = document.createElement('canvas');
  col.width = col.height = bump.width = bump.height = size;
  const cg = col.getContext('2d'), bg = bump.getContext('2d');
  const ci = cg.createImageData(size, size), bi = bg.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const big = fbm(u * 6, v * 6);            // patches of lusher / drier grass
    const fine = fbm(u * 60, v * 60);         // blade-scale texture
    const i = (y * size + x) * 4;
    const t = 0.5 + big * 0.5;
    const r = 96 + t * 45 + fine * 18, g = 140 + t * 40 + fine * 22, b = 60 + t * 20 + fine * 10;
    ci.data[i] = r; ci.data[i + 1] = g; ci.data[i + 2] = b; ci.data[i + 3] = 255;
    const h = 128 + (big * 0.35 + fine * 0.65) * 110;
    bi.data[i] = bi.data[i + 1] = bi.data[i + 2] = h; bi.data[i + 3] = 255;
  }
  cg.putImageData(ci, 0, 0); bg.putImageData(bi, 0, 0);
  const mk = (c, srgb) => { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 6); t.anisotropy = 8; return t; };
  return { map: mk(col, true), bumpMap: mk(bump, false) };
}

const BASE_H = 0.3;
const STEP_H = 0.28; // lower towers so a quart in front does not hide the stones behind it



export class TerracesRenderer extends ThreeRenderer {
  constructor(container, handlers) {
    super(container, handlers, 'terraces');
    this.targetH = new Float32Array(N).fill(BASE_H);
    this.curH = new Float32Array(N).fill(BASE_H);
    this.owner = new Int8Array(N);
    this.camera.position.set(6.0, 16.3, 18.5); // ~40° elevation: shows the plateau heights
    this.dressTiles();
  }

  iconMesh(player) {
    const mat = this.tiles[0].material.clone();
    mat.color.setHex(player === 1 ? this.theme.p1.color : this.theme.p2.color);
    mat.emissive.setHex(0x000000);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 1.0, 6), mat);
    m.rotation.set(0.1, 0.4, 0);
    return m;
  }

  dressTiles() {
    const stone = stoneTextures();
    for (let i = 0; i < N; i++) {
      const mat = this.tiles[i].material;
      const map = stone.map.clone(), bump = stone.bumpMap.clone();
      // a different patch of the quarry for every tile, and the odd one turned
      const ox = Math.random(), oy = Math.random(), rot = Math.random() < 0.3 ? Math.PI / 2 : 0;
      for (const t of [map, bump]) { t.offset.set(ox, oy); t.repeat.set(0.45, 0.45); t.rotation = rot; t.center.set(0.5, 0.5); t.needsUpdate = true; }
      mat.map = map; mat.bumpMap = bump; mat.bumpScale = 0.06; mat.roughness = 0.9;
      mat.flatShading = true; // cut stone: every face lit as a plane, with crisp edges
      mat.needsUpdate = true;
      this.tiles[i].castShadow = true;
    }
  }

  buildLights() {
    const s = this.scene;
    // strong low sun, little sky fill: plateaus throw clear shadows onto the meadow and each other
    s.add(new THREE.HemisphereLight(0xdcefff, 0x55703f, 0.6));
    const sun = new THREE.DirectionalLight(0xfff3dc, 3.2);
    sun.position.set(-15, 11, -3); // low sun from the left (~35° up); shadows fall toward ~11°, well off the lattice edge directions (30°, 90°, 150°)
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = sun.shadow.camera.bottom = -13;
    sun.shadow.camera.right = sun.shadow.camera.top = 13;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 50;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 2;
    s.add(sun);
    // meadow ground and a distant mist
    const meadow = meadowTextures();
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(60, 64),
      new THREE.MeshStandardMaterial({ map: meadow.map, bumpMap: meadow.bumpMap, bumpScale: 0.35, roughness: 0.95 })
    );
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.16; ground.receiveShadow = true;
    s.add(ground);
    s.fog = new THREE.Fog(0xbfd9ee, 30, 70);
    // a few low hills on the horizon
    const hillMat = new THREE.MeshStandardMaterial({ color: 0x6f905a, roughness: 1 });
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2 + 0.3;
      const r = 26 + (k % 3) * 5;
      const hill = new THREE.Mesh(new THREE.SphereGeometry(6 + (k % 4) * 2, 24, 12), hillMat);
      hill.position.set(Math.cos(a) * r, -4 - (k % 2), Math.sin(a) * r);
      hill.scale.y = 0.45;
      s.add(hill);
    }
  }

  update(game) {
    this.game = game;
    const t = this.theme;
    this.owner.fill(0);
    this.targetH.fill(BASE_H);
    this.groupSize = new Int8Array(N);
    for (const g of game.groups()) {
      for (const i of g.cells) { this.owner[i] = g.color; this.targetH[i] = BASE_H + g.size * STEP_H; this.groupSize[i] = g.size; }
    }
    if (game.lastMove >= 0) {
      const p = this.tiles[game.lastMove].position;
      this.lastRing.position.set(p.x, this.targetH[game.lastMove] - 0.13, p.z);
      this.lastRing.visible = true;
    } else this.lastRing.visible = false;
    this.refreshTiles();
  }

  refreshTiles() {
    if (!this.game) return;
    const t = this.theme;
    const line = new Set(this.game.line || []);
    const sel = this.handlers.selectedColor?.() ?? this.game.player;
    const p1 = new THREE.Color(t.p1.color), p2 = new THREE.Color(t.p2.color);
    for (let i = 0; i < N; i++) {
      const mat = this.tiles[i].material;
      const o = this.owner ? this.owner[i] : 0;
      mat.color.copy(o === 1 ? p1 : o === 2 ? p2 : mat.userData.baseColor);
      mat.emissive.setHex(0x000000);
      if (line.has(i)) {
        mat.color.setHex(this.game.status === 'won' ? t.winTile : t.loseTile);
        mat.emissive.setHex(this.game.status === 'won' ? t.winTile : t.loseTile);
        mat.emissive.multiplyScalar(0.35);
      } else if (o && this.groupSize?.[i] === 4) {
        mat.color.lerp(new THREE.Color(0xc0202c), 0.55);
      } else if (i === this.hover && !this.game.isOver && this.game.board[i] === 0) {
        if (this.game.isLegal(i, sel) && this.handlers.canPlay?.()) {
          const pv = this.handlers.previewOutcome?.(i);
          if (pv?.result) { mat.color.setHex(OUTCOME_HEX[pv.result]); mat.emissive.setHex(OUTCOME_HEX[pv.result]).multiplyScalar(0.35); }
          else mat.color.lerp(sel === 1 ? p1 : p2, 0.6);
        }
      }
      if (!this.game.isOver && (sel === 1 || sel === 2) && this.game.board[i] === 0 && !this.game.isLegal(i, sel)) mat.color.multiplyScalar(0.6);
    }
    if (this.ghost) { this.scene.remove(this.ghost); this.ghost = null; }
  }

  loop() {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.homeDist) this.fitCamera();
    const tsec = performance.now() / 1000;
    for (let i = 0; i < N; i++) {
      const cur = this.curH[i], tgt = this.targetH[i];
      const h = Math.abs(tgt - cur) < 0.002 ? tgt : cur + (tgt - cur) * 0.14;
      this.curH[i] = h;
      const tile = this.tiles[i];
      tile.scale.y = h / BASE_H;
      tile.position.y = (h - BASE_H) / 2;
    }
    if (this.lastRing.visible) this.lastRing.material.opacity = 0.65 + 0.35 * Math.sin(tsec * 4);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
