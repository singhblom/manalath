import * as THREE from 'three';
import { cells, N, step, isStarPoint } from '@manalath/shared/hex.js';
import { ThreeRenderer, OUTCOME_HEX } from './three.js';

// "Neon Void" on the dual lattice: glowing lines between neighbouring points, a node at each point,
// crystals floating over the intersections.
export class NeonRenderer extends ThreeRenderer {
  constructor(container, handlers) {
    super(container, handlers, 'neon');
    for (const t of this.tiles) { t.material.depthWrite = false; t.material.colorWrite = false; }
    this.buildLattice();
    this.refreshTiles();
  }

  buildLattice() {
    const pts = [];
    for (const c of cells) {
      const a = this.tiles[c.i].position;
      for (let d = 0; d < 3; d++) {
        const j = step[c.i][d];
        if (j === -1) continue;
        const b = this.tiles[j].position;
        pts.push(a.x, 0.16, a.z, b.x, 0.16, b.z);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.lattice = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: this.theme.lattice, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending }));
    this.scene.add(this.lattice);
    // nodes and per-point rings (hover / quart / decisive)
    this.nodes = [];
    this.rings = [];
    // plain intersections are just where the lines cross; only the star points get a small node
    const starGeo = new THREE.SphereGeometry(0.075, 12, 8);
    const starMat = new THREE.MeshBasicMaterial({ color: 0xaef4ff });
    const ringPts = [];
    for (let k = 0; k <= 40; k++) { const a = (k / 40) * Math.PI * 2; ringPts.push(new THREE.Vector3(0.62 * Math.cos(a), 0, 0.62 * Math.sin(a))); }
    const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPts);
    for (let i = 0; i < N; i++) {
      const p = this.tiles[i].position;
      if (isStarPoint(i)) {
        const n = new THREE.Mesh(starGeo, starMat);
        n.position.set(p.x, 0.16, p.z);
        this.scene.add(n); this.nodes.push(n);
      }
      const r = new THREE.Line(ringGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending }));
      r.position.set(p.x, 0.18, p.z);
      this.scene.add(r); this.rings.push(r);
    }
  }

  update(game) {
    super.update(game);
    this.groupSize = new Int8Array(N);
    this.groupId = new Int16Array(N);
    let gid = 1;
    for (const g of game.groups()) { for (const i of g.cells) { this.groupSize[i] = g.size; this.groupId[i] = gid; } gid++; }
  }

  // Spin intensity grows with group size; a quart jolts angrily at random; a quint turns as one, slow and in unison.
  loop() {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.homeDist) this.fitCamera();
    const now = performance.now();
    const tsec = now / 1000;
    const dt = Math.min(0.05, (now - (this.lastFrame || now)) / 1000);
    this.lastFrame = now;
    for (let i = 0; i < N; i++) {
      const m = this.pieces[i];
      if (!m) continue;
      const u = m.userData;
      const age = (now - u.spawn) / 320;
      m.scale.setScalar(age < 1 ? 1 - Math.pow(1 - age, 3) : 1);
      const size = this.groupSize ? this.groupSize[i] : 1;
      const t0 = this.tiles[i].position;
      if (u.spin === undefined) { u.spin = u.phase; u.tilt = 0; u.jv = 0; u.jx = 0; u.jz = 0; u.jvx = 0; u.jvz = 0; u.nextJolt = tsec + Math.random(); }
      if (size === 5) {
        // harmonised: every stone in the quint shares one slow, perfectly phased twirl
        const target = tsec * 0.5;
        u.spin += Math.sin(target - u.spin) * 4 * dt; // ease toward the shared phase
        u.spin += 0.5 * dt;
        u.tilt += (Math.sin(tsec * 0.8) * 0.25 - u.tilt) * 3 * dt;
        u.jx += (0 - u.jx) * 6 * dt; u.jz += (0 - u.jz) * 6 * dt;
        m.position.set(t0.x + u.jx, 0.16 + 0.06 + Math.sin(tsec * 1.2) * 0.05, t0.z + u.jz);
      } else if (size === 4) {
        // angry: fast spin with random jolts in rotation and position
        if (tsec > u.nextJolt) {
          u.jv += (Math.random() - 0.5) * 40;
          u.jvx += (Math.random() - 0.5) * 6; u.jvz += (Math.random() - 0.5) * 6;
          u.nextJolt = tsec + 0.15 + Math.random() * 0.6;
        }
        u.jv -= u.jv * 6 * dt;
        u.jvx += (-u.jx * 120 - u.jvx * 8) * dt; u.jvz += (-u.jz * 120 - u.jvz * 8) * dt;
        u.jx += u.jvx * dt; u.jz += u.jvz * dt;
        u.spin += (3.2 + u.jv) * dt;
        u.tilt = Math.sin(tsec * 9 + u.phase) * 0.35 + u.jv * 0.01;
        m.position.set(t0.x + u.jx, 0.16 + Math.abs(Math.sin(tsec * 7 + u.phase)) * 0.08, t0.z + u.jz);
      } else {
        const rate = [0, 0.35, 0.9, 1.7][size] ?? 0.6;
        u.spin += rate * dt;
        u.tilt += (Math.sin(tsec * 0.4 + u.phase) * 0.3 - u.tilt) * 2 * dt;
        u.jx += (0 - u.jx) * 6 * dt; u.jz += (0 - u.jz) * 6 * dt;
        m.position.set(t0.x + u.jx, 0.16 + Math.sin(tsec * 1.6 + u.phase) * 0.04, t0.z + u.jz);
      }
      m.rotation.set(u.tilt, u.spin, 0);
    }
    if (this.ghost) this.ghost.rotation.y = tsec * 0.6;
    if (this.game?.line && this.lastRing.visible) this.lastRing.material.opacity = 0.6 + 0.4 * Math.sin(tsec * 4);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  // Reservoir portraits: the crystal alone (a tighter glow so it fills the frame), turning slowly while it is
  // the colour in play or nothing is held; when the other colour is picked up it freezes in place.
  iconMesh(player) {
    const mesh = new THREE.Mesh(this.pieceGeo[player - 1], this.pieceMat[player - 1]);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: player === 1 ? this.theme.p1.color : this.theme.p2.color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    sprite.scale.set(1.25, 1.25, 1);
    mesh.add(sprite);
    return mesh;
  }

  animateIcon(mesh, t, player) {
    if (!this._iconSpin) this._iconSpin = { 1: { a: 0.6, last: t }, 2: { a: 2.1, last: t } };
    const st = this._iconSpin[player];
    const dt = Math.min(0.1, Math.max(0, t - st.last));
    st.last = t;
    const sel = this.handlers.selectedColor?.() ?? 0;
    if (!sel || sel === player) st.a += 0.9 * dt;   // the held colour keeps turning; the other stops
    mesh.rotation.set(0.35 + Math.sin(st.a * 0.7) * 0.12, st.a, 0);
  }

  refreshTiles() {
    if (!this.game || !this.rings) return;
    const t = this.theme;
    const line = new Set(this.game.line || []);
    const quart = new Set();
    if (!this.game.isOver) for (const g of this.game.groups()) if (g.size === 4) for (const c of g.cells) quart.add(c);
    const sel = this.handlers.selectedColor?.() ?? this.game.player;
    const canPlay = !this.game.isOver && this.handlers.canPlay?.();
    const pv = this.hover >= 0 ? this.handlers.previewOutcome?.(this.hover) : null;
    for (let i = 0; i < N; i++) {
      const m = this.rings[i].material;
      m.opacity = 0;
      if (line.has(i)) { m.color.setHex(this.game.status === 'won' ? t.winTile : t.loseTile); m.opacity = 1; }
      else if (quart.has(i)) { m.color.setHex(t.loseTile); m.opacity = 0.9; }
      else if (i === this.hover && canPlay && this.game.isLegal(i, sel)) { m.color.setHex(pv?.result ? OUTCOME_HEX[pv.result] : (sel === 1 ? t.p1.color : t.p2.color)); m.opacity = 1; }
      else if (canPlay && this.game.board[i] === 0 && !this.game.isLegal(i, sel)) { m.color.setHex(0x8a2030); m.opacity = 0.35; }
    }
    // ghost crystal
    if (this.ghost) { this.scene.remove(this.ghost); this.ghost = null; }
    if (this.hover >= 0 && canPlay && this.game.isLegal(this.hover, sel)) {
      const gm = this.ghostMat[sel - 1].clone();
      if (pv?.result) { gm.color.setHex(OUTCOME_HEX[pv.result]); gm.emissive.setHex(OUTCOME_HEX[pv.result]); }
      const g = new THREE.Mesh(this.pieceGeo[sel - 1], gm);
      const p = this.tiles[this.hover].position;
      g.position.set(p.x, 0.16, p.z);
      this.ghost = g;
      this.scene.add(g);
    }
  }
}
