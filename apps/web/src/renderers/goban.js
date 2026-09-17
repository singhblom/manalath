import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { cells, N, step, isStarPoint } from '@manalath/shared/hex.js';
import { ThreeRenderer, OUTCOME_HEX } from './three.js';
import { woodTexture, solidWoodMaterial, rng, CHESTNUT, GRAIN_ANGLE } from './wood.js';

// "Goban": a thick kaya-wood board with straight (masame) grain, an ink-drawn hex grid,
// slate and clamshell stones with a hint of iridescence, placed a little irregularly by hand.

const BOARD_R = 4 * Math.sqrt(3) + Math.sqrt(3) / 2; // circumradius: outermost points plus half a lattice side
const SLAB_H = 3.5;       // thickness — a proper floor goban, not a plank
const TOP_Y = 0.0;        // stones sit on y = 0 (tiles are centred on 0 in the base class)

function tatamiTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#b8b07a'; g.fillRect(0, 0, size, size);
  for (let y = 0; y < size; y += 4) {
    for (let x = 0; x < size; x += 16) {
      const off = (y / 4) % 2 ? 8 : 0;
      g.fillStyle = ((x + off) / 16) % 2 ? 'rgba(90,85,50,0.35)' : 'rgba(230,225,170,0.25)';
      g.fillRect((x + off) % size, y, 14, 3);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(14, 14);
  return tex;
}

// Clamshell: warm white with faint parallel growth lines.
function shellTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#f6f1e6'; g.fillRect(0, 0, size, size);
  const rand = rng(99);
  for (let k = 0; k < 26; k++) {
    g.strokeStyle = `rgba(200,185,160,${0.15 + rand() * 0.25})`;
    g.lineWidth = 1 + rand() * 2;
    g.beginPath();
    const y = (k / 26) * size + (rand() - 0.5) * 6;
    g.moveTo(0, y); g.bezierCurveTo(size * 0.3, y + rand() * 12 - 6, size * 0.7, y + rand() * 12 - 6, size, y);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class GobanRenderer extends ThreeRenderer {
  constructor(container, handlers) {
    super(container, handlers, 'goban');
    for (const t of this.tiles) { t.material.depthWrite = false; t.material.colorWrite = false; }
    this.controls.minDistance = 8;
    this.camera.position.set(6.4, 11.6, 16.7); // ~33° elevation: a seated player's view across the board
    this.buildEnvironment();
    this.buildStoneMaterials();
    this.buildBoard3D();
    this.buildOutlines();
    this.lastRing.material.opacity = 0.55;
    this.lastRing.geometry.dispose();
    this.lastRing.geometry = new THREE.TorusGeometry(0.2, 0.035, 8, 32);
  }

  buildLights() {
    const s = this.scene;
    // sun-dominated: enough fill to read the wood, little enough that the slab and bowls throw real shadows on the mat
    s.add(new THREE.HemisphereLight(0xfff4e4, 0x5a4a30, 0.3));
    const key = new THREE.DirectionalLight(0xfff1dc, 3.4);
    key.position.set(-6, 15, 9);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = key.shadow.camera.bottom = -18;
    key.shadow.camera.right = key.shadow.camera.top = 18;
    key.shadow.camera.near = 1; key.shadow.camera.far = 60;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 4;
    s.add(key);
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.25);
    fill.position.set(10, 8, -6);
    s.add(fill);
  }

  buildEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.envTex;
    this.scene.environmentIntensity = 0.18;
  }

  buildBoard3D() {
    const s = this.scene;
    // tatami floor
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ map: tatamiTexture(), roughness: 1 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -SLAB_H - 1.9; floor.receiveShadow = true;
    s.add(floor);
    // tatami border (heri) strips
    const heri = new THREE.MeshStandardMaterial({ color: 0x1f2a3a, roughness: 0.9 });
    for (const x of [-16, 16]) { const m = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.02, 80), heri); m.position.set(x, -SLAB_H - 1.89, 0); s.add(m); }

    // slab: hexagonal prism with a wood texture; sides get the grain, top gets grain + ink grid
    // One log for the whole board: a solid-wood shader samples world position against noisy concentric growth
    // tubes. The trunk axis runs along the grain direction, just above the top face and off-centre, so the top
    // is a near-radial cut (straight masame lines) while the angled side faces cut across the tubes (arcs).
    const ga = GRAIN_ANGLE * Math.PI / 180;
    const axisDir = new THREE.Vector3(Math.cos(ga), 0, Math.sin(ga));
    const axisOrigin = new THREE.Vector3(0, 0.35, 5.5);
    const woodOpts = { axisOrigin, axisDir, ringSpacing: 0.21, early: '#dfb56c', late: '#c08d48', seed: 3.7, fibre: 0.5 };
    // ink grid as a plain multiply map (white where there is no ink)
    const gridCanvas = document.createElement('canvas'); gridCanvas.width = gridCanvas.height = 1024;
    const gg = gridCanvas.getContext('2d'); gg.fillStyle = '#ffffff'; gg.fillRect(0, 0, 1024, 1024);
    this.drawGrid(gg, 1024);
    const gridTex = new THREE.CanvasTexture(gridCanvas); gridTex.colorSpace = THREE.SRGBColorSpace; gridTex.anisotropy = 8;
    const bodyMat = solidWoodMaterial({ ...woodOpts, flatShading: true, roughness: 0.55 });
    const topMat = solidWoodMaterial({ ...woodOpts, map: gridTex, roughness: 0.42 });
    topMat.side = THREE.DoubleSide;
    const bodyGeo = new THREE.CylinderGeometry(BOARD_R, BOARD_R, SLAB_H, 6, 1, true);
    bodyGeo.rotateY(Math.PI / 6); // board outline has its points on ±x; cylinder hexes point along ±z
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = -SLAB_H / 2 - 0.02;
    body.castShadow = true; body.receiveShadow = true;
    s.add(body);
    // top plate (hexagon) with planar UVs
    const shape = new THREE.Shape();
    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 180 * (60 * k); // points on ±x, matching the cell pattern
      const x = BOARD_R * Math.cos(a), z = BOARD_R * Math.sin(a);
      k === 0 ? shape.moveTo(x, z) : shape.lineTo(x, z);
    }
    shape.closePath();
    const topGeo = new THREE.ShapeGeometry(shape, 1);
    // ShapeGeometry uvs are raw x,y; normalise to 0..1 over the slab
    const uv = topGeo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / (2 * BOARD_R) + 0.5, uv.getY(i) / (2 * BOARD_R) + 0.5);
    topGeo.rotateX(-Math.PI / 2); // shape lies in xy, facing +z; rotate so it faces +y (shape y -> world -z)
    const top = new THREE.Mesh(topGeo, topMat);
    top.position.y = -0.02 + 0.001;
    top.receiveShadow = true;
    top.castShadow = true; // the slab's silhouette on the tatami comes from the top and bottom plates
    s.add(top);
    // bottom plate
    const bottomGeo = new THREE.CylinderGeometry(BOARD_R, BOARD_R, 0.05, 6);
    bottomGeo.rotateY(Math.PI / 6);
    const bottom = new THREE.Mesh(bottomGeo, bodyMat);
    bottom.position.y = -SLAB_H;
    bottom.castShadow = true;
    s.add(bottom);
    // feet: six turned feet, one under each corner, shaped like inverted truncated cones (wide at the board, narrow at the floor)
    // narrow at the floor, widening toward the board, with a rounded belly just under the slab
    const footProfile = [
      [0, 0], [0.62, 0], [0.7, 0.06], [0.76, 0.35], [0.9, 0.9], [1.08, 1.45], [1.16, 1.75], [1.12, 1.9], [0, 1.9],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const footGeo = new THREE.LatheGeometry(footProfile, 40);
    const footMat = solidWoodMaterial({ ...woodOpts, roughness: 0.6 }); // turned from the same log
    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 180 * (60 * k);           // board outline has its points on ±x
      const r = BOARD_R * 0.72;
      const foot = new THREE.Mesh(footGeo, footMat);
      foot.position.set(Math.cos(a) * r, -SLAB_H - 1.9, Math.sin(a) * r);
      foot.rotation.y = k * 0.7;
      foot.castShadow = true; foot.receiveShadow = true;
      s.add(foot);
    }
    this.buildBowls();
  }

  // Go bowls (gosu): lathe-turned reddish wood with a rounded belly and an inward-curving rim, heaped with
  // stones, each with its upturned lid beside it holding a handful of stones.
  buildBowls() {
    const s = this.scene;
    const floorY = -SLAB_H - 1.9;
    const tex = woodTexture(1024, 31, null, 2, CHESTNUT);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.center.set(0.5, 0.5); tex.rotation = Math.PI / 2; // grain runs up the side of a turned bowl
    tex.repeat.set(2, 1);
    const bowlMat = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.38, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.3, envMapIntensity: 0.6 });
    // profile: outer wall up from the foot, over the rim and back down the inner wall to the inner floor
    const bowlProfile = [
      [0, 0], [1.25, 0], [1.9, 0.12], [2.35, 0.55], [2.6, 1.15], [2.55, 1.75], [2.3, 2.2], [1.95, 2.42], [1.8, 2.45],
      [1.75, 2.4], [2.05, 2.1], [2.28, 1.6], [2.28, 1.1], [2.0, 0.6], [1.3, 0.38], [0, 0.34],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const bowlGeo = new THREE.LatheGeometry(bowlProfile, 48);
    const lidProfile = [
      [0, 0], [1.6, 0], [2.25, 0.2], [2.55, 0.5], [2.6, 0.62], [2.45, 0.6], [2.15, 0.36], [1.5, 0.17], [0, 0.14],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const lidGeo = new THREE.LatheGeometry(lidProfile, 48);

    const heap = (mat, count, radius, baseY, dome, rand) => {
      const inst = new THREE.InstancedMesh(this.stoneGeo, mat, count);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
      for (let k = 0; k < count; k++) {
        const a = rand() * Math.PI * 2, r = radius * Math.sqrt(rand());
        const layer = Math.floor(rand() * 2.2);
        p.set(Math.cos(a) * r, baseY + dome * (1 - (r / radius) ** 2) + layer * 0.55 + rand() * 0.1, Math.sin(a) * r);
        e.set((rand() - 0.5) * 0.9, rand() * Math.PI * 2, (rand() - 0.5) * 0.9);
        q.setFromEuler(e);
        m.compose(p, q, sc);
        inst.setMatrixAt(k, m);
      }
      inst.castShadow = true; inst.receiveShadow = true;
      return inst;
    };

    for (const [x, z, c] of [[-11.6, -2.0, 1], [11.6, 2.0, 2]]) {
      const rand = rng(c * 77 + 5);
      const stoneMat = c === 1 ? this.shellMat : this.slateMat;
      const bowl = new THREE.Mesh(bowlGeo, bowlMat);
      bowl.position.set(x, floorY, z);
      bowl.scale.setScalar(1.22);
      bowl.rotation.y = rand() * Math.PI;
      bowl.castShadow = true; bowl.receiveShadow = true;
      s.add(bowl);
      const stones = heap(stoneMat, 64, 2.15, 0.8, 1.05, rand);
      stones.position.set(x, floorY, z);
      s.add(stones);
      // lid, upturned in front of the bowl, with a few stones in it
      const lx = x + (c === 1 ? 0.4 : -0.4), lz = z + 6.6;
      const lid = new THREE.Mesh(lidGeo, bowlMat);
      lid.position.set(lx, floorY, lz);
      lid.scale.setScalar(1.22);
      lid.rotation.y = rand() * Math.PI;
      lid.castShadow = true; lid.receiveShadow = true;
      s.add(lid);
      const few = heap(stoneMat, 7, 1.35, 0.4, 0.14, rand);
      few.position.set(lx, floorY, lz);
      s.add(few);
      // a few stray stones on the mat around the bowl
      for (let k = 0; k < 5; k++) {
        const a = rand() * Math.PI * 2, d = 3.6 + rand() * 2.4;
        const st = new THREE.Mesh(this.stoneGeo, stoneMat);
        st.position.set(x + Math.cos(a) * d * (c === 1 ? 1 : 1) * (Math.cos(a) > 0 === (c === 1) ? 0.6 : 1), floorY + 0.33, z + Math.sin(a) * d);
        st.rotation.set((rand() - 0.5) * 0.08, rand() * Math.PI * 2, (rand() - 0.5) * 0.08);
        st.castShadow = true; st.receiveShadow = true;
        s.add(st);
      }
    }
  }

  // Ink grid on the top texture. Shape y maps to world -z, so v = -z/(2R)+0.5; canvas rows run top-down (flipY).
  drawGrid(g, size) {
    const toPx = (x, z) => [(x / (2 * BOARD_R) + 0.5) * size, (1 - (-z / (2 * BOARD_R) + 0.5)) * size];
    // The dual of the hex cells: a triangular lattice. Stones sit on the intersections.
    g.strokeStyle = 'rgba(20,14,10,0.92)';
    g.lineWidth = size / 640;
    g.lineCap = 'round';
    for (const c of cells) {
      const a = this.tiles[c.i].position;
      for (let d = 0; d < 3; d++) {
        const j = step[c.i][d];
        if (j === -1) continue;
        const b = this.tiles[j].position;
        const [x1, y1] = toPx(a.x, a.z), [x2, y2] = toPx(b.x, b.z);
        g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
      }
    }
    // hoshi-like dots at the centre and the six "corner" cells
    g.fillStyle = 'rgba(20,14,10,0.9)';
    for (const c of cells) {
      if (isStarPoint(c.i)) {
        const t = this.tiles[c.i].position;
        const [px, py] = toPx(t.x, t.z);
        g.beginPath(); g.arc(px, py, size / 230, 0, Math.PI * 2); g.fill();
      }
    }
  }

  buildOutlines() {
    this.outlines = [];
    const pts = [];
    for (let k = 0; k <= 48; k++) { const a = (k / 48) * Math.PI * 2; pts.push(new THREE.Vector3(0.86 * Math.cos(a), 0, 0.86 * Math.sin(a))); }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    for (let i = 0; i < N; i++) {
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0 }));
      const t = this.tiles[i].position;
      line.position.set(t.x, 0.02, t.z);
      this.scene.add(line);
      this.outlines.push(line);
    }
  }

  buildStoneMaterials() {
    this.shellMat = new THREE.MeshPhysicalMaterial({
      map: shellTexture(), color: 0xffffff, roughness: 0.18, metalness: 0.0,
      clearcoat: 1.0, clearcoatRoughness: 0.12,
      iridescence: 0.45, iridescenceIOR: 1.35, iridescenceThicknessRange: [120, 420],
      sheen: 0.3, sheenColor: new THREE.Color(0xffe9d0), envMapIntensity: 0.8,
    });
    this.slateMat = new THREE.MeshPhysicalMaterial({
      color: 0x15151a, roughness: 0.38, metalness: 0.05, clearcoat: 0.45, clearcoatRoughness: 0.35, envMapIntensity: 0.6,
    });
    this.stoneGeo = new THREE.SphereGeometry(0.8, 56, 36);
    this.stoneGeo.scale(1, 0.42, 1); // lens-shaped stone, nearly touching its neighbours (spacing is 1.73)
    this.ghostMats = [
      this.shellMat.clone(), this.slateMat.clone(),
    ];
    for (const m of this.ghostMats) { m.transparent = true; m.opacity = 0.4; m.depthWrite = false; }
  }

  iconMesh(player) {
    const m = new THREE.Mesh(this.stoneGeo, player === 1 ? this.shellMat : this.slateMat);
    m.rotation.set(0.55, 0.3, 0.1); // tilted so the lens profile reads
    return m;
  }

  makePiece(player, i) {
    const mesh = new THREE.Mesh(this.stoneGeo, player === 1 ? this.shellMat : this.slateMat);
    const t = this.tiles[i].position;
    const rand = rng(i * 131 + (this.game?.moveCount || 0) * 17 + player);
    const jitter = 0.05;
    mesh.position.set(t.x + (rand() - 0.5) * 2 * jitter, 0.33, t.z + (rand() - 0.5) * 2 * jitter);
    mesh.rotation.y = rand() * Math.PI * 2;
    mesh.rotation.x = (rand() - 0.5) * 0.06;
    mesh.rotation.z = (rand() - 0.5) * 0.06;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.spawn = performance.now();
    mesh.userData.player = player;
    mesh.userData.restY = 0.33;
    mesh.userData.phase = 0;
    return mesh;
  }

  refreshTiles() {
    if (!this.game || !this.outlines) return;
    const t = this.theme;
    const line = new Set(this.game.line || []);
    const quart = new Set();
    if (!this.game.isOver) for (const g of this.game.groups()) if (g.size === 4) for (const c of g.cells) quart.add(c);
    const sel = this.handlers.selectedColor?.() ?? this.game.player;
    const canPlay = !this.game.isOver && this.handlers.canPlay?.();
    const pv = this.hover >= 0 ? this.handlers.previewOutcome?.(this.hover) : null;
    for (let i = 0; i < N; i++) {
      const m = this.outlines[i].material;
      m.opacity = 0;
      if (line.has(i)) { m.color.setHex(this.game.status === 'won' ? t.winTile : t.loseTile); m.opacity = 1; }
      else if (quart.has(i)) { m.color.setHex(t.loseTile); m.opacity = 0.9; }
      else if (i === this.hover && canPlay && this.game.isLegal(i, sel)) { m.color.setHex(pv?.result ? OUTCOME_HEX[pv.result] : 0x000000); m.opacity = 0.9; }
      else if (canPlay && this.game.board[i] === 0 && !this.game.isLegal(i, sel)) { m.color.setHex(0x8a2a2a); m.opacity = 0.35; }
    }
    if (this.ghost) { this.scene.remove(this.ghost); this.ghost = null; }
    if (this.hover >= 0 && canPlay && this.game.isLegal(this.hover, sel)) {
      const gm = this.ghostMats[sel - 1];
      const g = new THREE.Mesh(this.stoneGeo, gm);
      const p = this.tiles[this.hover].position;
      g.position.set(p.x, 0.33, p.z);
      this.ghost = g;
      this.scene.add(g);
    }
  }

  loop() {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.homeDist) this.fitCamera();
    const now = performance.now();
    for (let i = 0; i < N; i++) {
      const m = this.pieces[i];
      if (!m) continue;
      const age = (now - m.userData.spawn) / 380;
      if (age < 1) {
        // drop from the hand and settle with a tiny bounce
        const fall = 1 - Math.pow(1 - Math.min(age, 1), 2);
        const bounce = age > 0.75 ? Math.sin((age - 0.75) / 0.25 * Math.PI) * 0.05 : 0;
        m.position.y = m.userData.restY + (1 - fall) * 2.2 + bounce;
        m.scale.setScalar(1);
      } else m.position.y = m.userData.restY;
    }
    if (this.lastRing.visible) {
      const lm = this.game?.lastMove;
      if (lm >= 0 && this.pieces[lm]) { const p = this.pieces[lm].position; this.lastRing.position.set(p.x, 0.7, p.z); }
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  destroy() {
    this.envTex?.dispose();
    super.destroy();
  }
}
