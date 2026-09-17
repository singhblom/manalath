import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { woodTexture, WALNUT } from './wood.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { cells, hexToPlane, N } from '@manalath/shared/hex.js';
import { BaseRenderer } from './base.js';

// Two 3D themes rendered with Three.js: a warm marble/wood set, and a neon void.
export const THREE_THEMES = {
  marble: {
    label: 'Marble Hall',
    colors: { p1: '#f3ead8', p2: '#1d1a1f' },
    background: 0x1e130c,
    fog: null,
    // ivory / marble: matte, low specular, with a warm sheen standing in for subsurface scatter
    tile: { color: 0xe6d9c1, roughness: 0.62, metalness: 0.0, physical: { specularIntensity: 0.3, sheen: 0.55, sheenRoughness: 0.75, sheenColor: 0xf2dcc0, clearcoat: 0.08, clearcoatRoughness: 0.6 } },
    tileShades: [0xf0e6d2, 0xdccbaa, 0xc4ad88], // proper 3-colouring of the hex tiling: ivory, pale sand, warm tan
    tileJitter: 0.035, // radians of rotational wobble per tile
    camera: [5.5, 15, 17], // ~40° elevation: side-on enough to show the dishes and stone shadows
    concave: 0.06,     // dish depth at the tile centre
    dropPhysics: true, // stones fall, bounce and roll to the bottom of the dish
    hover: 0x8a5a2a,
    winTile: 0x3f7a2c,
    loseTile: 0x8a2222,
    pieceShape: 'sphere',
    p1: { color: 0xf5eee0, roughness: 0.35, metalness: 0.0 },
    p2: { color: 0x17141b, roughness: 0.32, metalness: 0.05 },
    lastRing: 0xc98a3a,
    shadows: true,
  },
  terraces: {
    label: 'Quartz',
    colors: { p1: '#e9c46a', p2: '#3d5a80' },
    background: 0xbfd9ee,
    fog: null,
    tile: { color: 0x9aa39c, roughness: 0.85, metalness: 0.0 },
    tileShades: [0xa4ada4, 0x97a196, 0x8a948b],
    hover: 0x333333,
    winTile: 0xd4a017,
    loseTile: 0xb0202a,
    pieceShape: 'sphere',
    p1: { color: 0xe9c46a, roughness: 0.8 },
    p2: { color: 0x3d5a80, roughness: 0.8 },
    lastRing: 0xffffff,
    shadows: true,
  },
  goban: {
    label: 'Goban',
    colors: { p1: '#f4efe4', p2: '#1c1b20' },
    background: 0x2a2620,
    fog: null,
    tile: { color: 0x000000, roughness: 1, metalness: 0, opacity: 0 },
    hover: 0x000000,
    winTile: 0xc9a227,
    loseTile: 0xb0202a,
    pieceShape: 'sphere',
    p1: { color: 0xf4efe4 },
    p2: { color: 0x1c1b20 },
    lastRing: 0x2b2118,
    shadows: true,
  },
  mercury: {
    label: 'Quintessence',
    colors: { p1: '#d8dee8', p2: '#7a3fc4' },
    background: 0x0b0e14,
    fog: null,
    tile: { color: 0x000000, roughness: 1, metalness: 0, opacity: 0 },
    hover: 0x000000,
    winTile: 0xe6b422,
    loseTile: 0xc0202c,
    pieceShape: 'sphere',
    p1: { color: 0xd8dee8 },
    p2: { color: 0x7a3fc4 },
    lastRing: 0xffffff,
    liveIcons: true,
  },
  neon: {
    label: 'Neon Void',
    colors: { p1: '#ff3bd8', p2: '#25f0ff' },
    background: 0x03040a,
    fog: { color: 0x03040a, density: 0.028 },
    tile: { color: 0x061520, roughness: 0.9, metalness: 0.0, opacity: 0, emissive: 0x00131c },
    lattice: 0x11a8c8,
    hover: 0x0b6f88,
    winTile: 0x1fbf5a,
    loseTile: 0xc91f3a,
    pieceShape: 'poly',
    p1: { color: 0xff3bd8, emissive: 0xff3bd8, emissiveIntensity: 0.55, roughness: 0.35 },
    p2: { color: 0x25f0ff, emissive: 0x25f0ff, emissiveIntensity: 0.55, roughness: 0.35 },
    lastRing: 0xffffff,
    liveIcons: true,
  },
};

// A hexagonal tile top that dips into a shallow dish: concentric rings of vertices following the hex outline,
// lowered by depth * (1 - f^2). The rim sits at y = 0.15, matching the flat prism tiles.
function concaveHexGeometry(R = 0.93, depth = 0.06, rings = 7, segs = 36) {
  const pos = [], idx = [];
  const apothem = R * Math.cos(Math.PI / 6);
  const rHex = (theta) => { const m = ((theta % (Math.PI / 3)) + Math.PI / 3) % (Math.PI / 3); const d = Math.min(m, Math.PI / 3 - m); return apothem / Math.cos(d); };
  pos.push(0, 0.15 - depth, 0);
  for (let k = 1; k <= rings; k++) {
    const f = k / rings;
    for (let j = 0; j < segs; j++) {
      const th = (j / segs) * Math.PI * 2;
      const r = f * rHex(th);
      pos.push(r * Math.cos(th), 0.15 - depth * (1 - f * f), r * Math.sin(th));
    }
  }
  const at = (k, j) => 1 + (k - 1) * segs + (j % segs);
  for (let j = 0; j < segs; j++) idx.push(0, at(1, j + 1), at(1, j));
  for (let k = 1; k < rings; k++) for (let j = 0; j < segs; j++) {
    idx.push(at(k, j), at(k + 1, j + 1), at(k + 1, j));
    idx.push(at(k, j), at(k, j + 1), at(k + 1, j + 1));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export const OUTCOME_HEX = { lose: 0xd8232f, win: 0xe6b422, check: 0xe0912a };

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.3, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export class ThreeRenderer extends BaseRenderer {
  constructor(container, handlers, themeName = 'marble') {
    super(container, handlers);
    this.theme = THREE_THEMES[themeName];
    this.themeName = themeName;
    this.colors = this.theme.colors;
    this.hover = -1;
    this.pieces = new Array(N).fill(null);
    this.ghost = null;
    this.clock = new THREE.Clock();
    this.initScene();
    this.bindEvents();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  initScene() {
    const t = this.theme;
    const w = this.container.clientWidth || 800;
    const h = this.container.clientHeight || 600;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = !!t.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.domElement.classList.add('three-canvas');
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(t.background);
    if (t.fog) this.scene.fog = new THREE.FogExp2(t.fog.color, t.fog.density);

    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 200);
    this.camera.position.set(...(t.camera || [3.2, 21, 9.6])); // ~18° yaw: clearly oblique (0° and 30° both look "aligned" on a hexagon)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 32;
    this.controls.maxPolarAngle = Math.PI * 0.42;
    this.controls.enablePan = false;
    this.controls.target.set(0, 0, 0);
    if (this.themeName === 'neon') { this.controls.autoRotate = true; this.controls.autoRotateSpeed = 0.35; }

    this.buildLights();
    this.buildBoard();
    this.buildPieceGeometry();
  }

  buildLights() {
    const s = this.scene;
    if (this.themeName === 'marble') {
      // a strong, lowish key light and very little ambient so the stones throw clear shadows into the dishes
      s.add(new THREE.HemisphereLight(0xfff1dc, 0x3a2418, 0.2));
      const key = new THREE.DirectionalLight(0xffe6c4, 3.6);
      key.position.set(11, 7.5, 4); // lowish sun: longer, clearer shadows
      key.castShadow = true;
      key.shadow.mapSize.set(4096, 4096);
      key.shadow.camera.left = key.shadow.camera.bottom = -12;
      key.shadow.camera.right = key.shadow.camera.top = 12;
      key.shadow.camera.near = 1; key.shadow.camera.far = 40;
      key.shadow.bias = -0.0003;
      key.shadow.normalBias = 0.02;
      key.shadow.radius = 2;
      s.add(key);
      const fill = new THREE.DirectionalLight(0xc9d8ff, 0.25);
      fill.position.set(-10, 6, -8);
      s.add(fill);
      // soft environment so the brass and polished stones pick up reflections
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
      s.environment = this.envTex;
      s.environmentIntensity = 0.1;
      // Wooden table, a thick walnut board, and a brass inlay sheet the marble tiles sit flush in
      const tableTex = woodTexture(1024, 21, null, 2, WALNUT);
      tableTex.wrapS = tableTex.wrapT = THREE.RepeatWrapping; tableTex.repeat.set(5, 5);
      const table = new THREE.Mesh(
        new THREE.CircleGeometry(40, 64),
        new THREE.MeshPhysicalMaterial({ map: tableTex, color: 0x8a7a6a, roughness: 0.5, metalness: 0.0, clearcoat: 0.3, clearcoatRoughness: 0.35, envMapIntensity: 0.3 }) // lacquered table (the shine comes from the mirror layer)
      );
      table.rotation.x = -Math.PI / 2; table.position.y = -0.9; table.receiveShadow = true;
      s.add(table);
      // real planar reflection of the board and stones in the lacquer: a translucent mirror laid over the wood
      const mirrorShader = {
        name: 'LacquerReflector',
        uniforms: { ...THREE.UniformsUtils.clone(Reflector.ReflectorShader.uniforms), opacity: { value: 0.34 } },
        vertexShader: Reflector.ReflectorShader.vertexShader,
        fragmentShader: Reflector.ReflectorShader.fragmentShader
          .replace('uniform vec3 color;', 'uniform vec3 color;\n\t\tuniform float opacity;')
          .replace('gl_FragColor = vec4( blendOverlay( base.rgb, color ), 1.0 );', 'gl_FragColor = vec4( base.rgb * color, opacity );'),
      };
      this.mirror = new Reflector(new THREE.CircleGeometry(40, 64), { clipBias: 0.003, textureWidth: 1024, textureHeight: 1024, color: 0xffffff, shader: mirrorShader });
      this.mirror.material.transparent = true;
      this.mirror.material.depthWrite = false;
      this.mirror.rotation.x = -Math.PI / 2; this.mirror.position.y = -0.898;
      s.add(this.mirror);
      const boardTex = woodTexture(1024, 7, null, 4.5, WALNUT);
      const wood = new THREE.MeshPhysicalMaterial({ map: boardTex, color: 0xbfb0a0, roughness: 0.48, metalness: 0.0, clearcoat: 0.3, clearcoatRoughness: 0.4, envMapIntensity: 0.4 }); // dark walnut, satin lacquer
      const board = new THREE.Mesh(new THREE.CylinderGeometry(9.2, 9.5, 1.05, 6), wood);
      board.position.y = 0.07 - 1.05 / 2; board.rotation.y = Math.PI / 6; // top face below the bottom of the tile dishes (0.09)
      board.receiveShadow = true; board.castShadow = true;
      s.add(board);
      const brass = new THREE.MeshStandardMaterial({ color: 0x8c6a33, metalness: 0.85, roughness: 0.5, envMapIntensity: 0.9 }); // aged brass
      // brass moulding: one slightly oversized hex prism under every tile. The prisms tile seamlessly, so brass
      // shows only in the gaps between tiles and as a rim of the same width around the outside of the pattern.
      const gap = 1 - 0.93;                    // a tile is inset this much from its cell boundary
      // hollow hex ring: outer edge on the cell boundary (plus the gap, so neighbours overlap seamlessly),
      // inner edge just inside the tile, extruded so its top edge stands a hair proud of the tile faces
      const ring = new THREE.Shape();
      const hole = new THREE.Path();
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 180 * (60 * k + 90);
        const ro = 1 + gap, ri = 0.93 - 0.01;
        k ? ring.lineTo(ro * Math.cos(a), ro * Math.sin(a)) : ring.moveTo(ro * Math.cos(a), ro * Math.sin(a));
        k ? hole.lineTo(ri * Math.cos(a), ri * Math.sin(a)) : hole.moveTo(ri * Math.cos(a), ri * Math.sin(a));
      }
      ring.closePath(); hole.closePath(); ring.holes.push(hole);
      const brassGeo = new THREE.ExtrudeGeometry(ring, { depth: 0.1, bevelEnabled: false });
      brassGeo.rotateX(-Math.PI / 2); // lies in xz, extruded upward
      for (const c of cells) {
        const { x, y } = hexToPlane(c.q, c.r, 1);
        const m = new THREE.Mesh(brassGeo, brass);
        m.position.set(x, 0.15 + 0.012 - 0.1, y); // top edge ~0.012 proud of the tile rims, foot bedded in the wood
        s.add(m);
      }
    } else {
      s.add(new THREE.AmbientLight(0x2030a0, 0.6));
      const a = new THREE.PointLight(0xff3bd8, 40, 40, 1.6); a.position.set(-8, 7, 5); s.add(a);
      const b = new THREE.PointLight(0x25f0ff, 40, 40, 1.6); b.position.set(8, 7, -5); s.add(b);
      const grid = new THREE.GridHelper(80, 80, 0x0b5566, 0x06303c);
      grid.position.y = -1.2;
      s.add(grid);
      this.glowTex = glowTexture();
    }
  }

  buildBoard() {
    const t = this.theme;
    this.tiles = [];
    this.tileGroup = new THREE.Group();
    const geo = t.concave ? concaveHexGeometry(0.93, t.concave) : new THREE.CylinderGeometry(0.93, 0.93, 0.3, 6);
    const sideGeo = t.concave ? new THREE.CylinderGeometry(0.93, 0.93, 0.3, 6, 1, true) : null;
    const edgeGeo = t.edge ? new THREE.EdgesGeometry(geo) : null;
    for (const c of cells) {
      const { x, y } = hexToPlane(c.q, c.r, 1);
      // (q - r) mod 3 gives every hex a class different from all six neighbours
      const shade = ((c.q - c.r) % 3 + 3) % 3;
      const baseColor = t.tileShades ? t.tileShades[shade] : t.tile.color;
      const params = {
        color: baseColor,
        roughness: t.tile.roughness,
        metalness: t.tile.metalness,
        transparent: t.tile.opacity !== undefined,
        opacity: t.tile.opacity ?? 1,
        emissive: t.tile.emissive ?? 0x000000,
      };
      const mat = t.tile.physical ? new THREE.MeshPhysicalMaterial({ ...params, ...t.tile.physical, sheenColor: new THREE.Color(t.tile.physical.sheenColor ?? 0xffffff) }) : new THREE.MeshStandardMaterial(params);
      mat.userData.baseColor = new THREE.Color(baseColor);
      mat.userData.baseEmissive = new THREE.Color(t.tile.emissive ?? 0x000000);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, 0, y);
      if (t.tileJitter) {
        // a hair of rotation and offset per tile: hand-set stone, not machined
        const h = Math.sin(c.i * 12.9898 + 78.233) * 43758.5453, r1 = h - Math.floor(h);
        const h2 = Math.sin(c.i * 39.3467 + 11.135) * 24634.6345, r2 = h2 - Math.floor(h2);
        mesh.rotation.y = (r1 - 0.5) * 2 * t.tileJitter;
        mesh.position.x += (r2 - 0.5) * 0.02; mesh.position.z += (r1 - 0.5) * 0.02;
        // and a tiny tilt, so each face catches the light a little differently (edges stay below the brass lip)
        const h3 = Math.sin(c.i * 7.1234 + 3.7) * 15731.743, r3 = h3 - Math.floor(h3);
        const h4 = Math.sin(c.i * 23.771 + 9.1) * 31337.31, r4 = h4 - Math.floor(h4);
        mesh.rotation.x = (r3 - 0.5) * 2 * 0.009;
        mesh.rotation.z = (r4 - 0.5) * 2 * 0.009;
      }
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.userData.index = c.i;
      if (sideGeo) { const side = new THREE.Mesh(sideGeo, mat); side.receiveShadow = true; mesh.add(side); }
      this.tileGroup.add(mesh);
      this.tiles.push(mesh);
      if (edgeGeo) {
        const edges = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: t.edge, transparent: true, opacity: 0.85 }));
        mesh.add(edges);
      }
    }
    this.scene.add(this.tileGroup);

    // last-move ring
    this.lastRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.62, 0.05, 12, 48),
      new THREE.MeshBasicMaterial({ color: t.lastRing, transparent: true, opacity: 0.9 })
    );
    this.lastRing.rotation.x = Math.PI / 2;
    this.lastRing.visible = false;
    this.scene.add(this.lastRing);
  }

  buildPieceGeometry() {
    const t = this.theme;
    if (t.pieceShape === 'sphere') {
      this.pieceGeo = [new THREE.SphereGeometry(0.46, 40, 28), new THREE.SphereGeometry(0.46, 40, 28)];
    } else {
      this.pieceGeo = [new THREE.OctahedronGeometry(0.5, 0), new THREE.IcosahedronGeometry(0.45, 0)];
    }
    this.pieceMat = [new THREE.MeshStandardMaterial(t.p1), new THREE.MeshStandardMaterial(t.p2)];
    this.ghostMat = [
      new THREE.MeshStandardMaterial({ ...t.p1, transparent: true, opacity: 0.35, depthWrite: false }),
      new THREE.MeshStandardMaterial({ ...t.p2, transparent: true, opacity: 0.35, depthWrite: false }),
    ];
  }

  makePiece(player, i) {
    const mesh = new THREE.Mesh(this.pieceGeo[player - 1], this.pieceMat[player - 1]);
    const tile = this.tiles[i];
    const restY = this.theme.concave ? 0.15 - this.theme.concave + 0.46 : 0.62;
    mesh.position.set(tile.position.x, restY, tile.position.z);
    mesh.userData.restY = restY;
    if (this.theme.dropPhysics && this.initializedPieces) {
      // dropped from the hand a little off-centre: falls, bounces, then rolls to the bottom of the dish
      const a = Math.random() * Math.PI * 2, d = 0.12 + Math.random() * 0.14;
      mesh.userData.phys = { y: restY + 2.2, vy: -1.5, ox: Math.cos(a) * d, oz: Math.sin(a) * d, vx: (Math.random() - 0.5) * 0.6, vz: (Math.random() - 0.5) * 0.6, settled: false };
    }
    mesh.castShadow = true;
    mesh.userData.spawn = performance.now();
    mesh.userData.player = player;
    mesh.userData.phase = Math.random() * Math.PI * 2;
    if (this.glowTex) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.glowTex, color: player === 1 ? this.theme.p1.color : this.theme.p2.color,
        transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      sprite.scale.set(2.2, 2.2, 1);
      mesh.add(sprite);
    }
    return mesh;
  }

  update(game) {
    super.update(game);
    for (let i = 0; i < N; i++) {
      const v = game.board[i];
      const existing = this.pieces[i];
      if (v === 0 && existing) { this.scene.remove(existing); this.pieces[i] = null; }
      else if (v !== 0 && (!existing || existing.userData.player !== v)) {
        if (existing) this.scene.remove(existing);
        const m = this.makePiece(v, i);
        this.scene.add(m);
        this.pieces[i] = m;
      }
    }
    this.initializedPieces = true;
    if (game.lastMove >= 0) {
      const p = this.tiles[game.lastMove].position;
      this.lastRing.position.set(p.x, 0.17, p.z);
      this.lastRing.visible = true;
    } else this.lastRing.visible = false;
    this.refreshTiles();
  }

  refreshTiles() {
    const t = this.theme;
    const line = new Set(this.game?.line || []);
    const status = this.game?.status;
    const quart = new Set();
    if (this.game && !this.game.isOver) for (const g of this.game.groups()) if (g.size === 4) for (const c of g.cells) quart.add(c);
    const pv = (this.hover >= 0 && this.game) ? this.handlers.previewOutcome?.(this.hover) : null;
    for (let i = 0; i < N; i++) {
      const mat = this.tiles[i].material;
      mat.color.copy(mat.userData.baseColor);
      mat.emissive.copy(mat.userData.baseEmissive);
      if (quart.has(i)) {
        mat.emissive.setHex(t.loseTile);
        if (this.themeName === 'marble') mat.color.setHex(t.loseTile).lerp(mat.userData.baseColor, 0.45);
      }
      if (line.has(i)) {
        const c = status === 'won' ? t.winTile : t.loseTile;
        mat.emissive.setHex(c);
        if (this.themeName === 'marble') mat.color.setHex(c).lerp(mat.userData.baseColor, 0.35);
      } else if (i === this.hover && this.game && !this.game.isOver && this.game.board[i] === 0) {
        mat.emissive.setHex(pv?.result ? OUTCOME_HEX[pv.result] : t.hover);
      }
      const selC = this.handlers.selectedColor?.() ?? this.game?.player;
      if (this.game && !this.game.isOver && (selC === 1 || selC === 2) && this.game.board[i] === 0 && !this.game.isLegal(i, selC)) {
        mat.color.multiplyScalar(0.55);
      }
    }
    // ghost piece
    if (this.ghost) { this.scene.remove(this.ghost); this.ghost = null; }
    const sel = this.handlers.selectedColor?.() ?? this.game?.player ?? 1;
    if (this.hover >= 0 && this.game && this.game.isLegal(this.hover, sel) && this.handlers.canPlay?.()) {
      const gm = this.ghostMat[sel - 1].clone();
      if (pv?.result) { gm.color.setHex(OUTCOME_HEX[pv.result]); gm.emissive.setHex(OUTCOME_HEX[pv.result]); gm.emissiveIntensity = 0.6; gm.opacity = 0.6; }
      const g = new THREE.Mesh(this.pieceGeo[sel - 1], gm);
      const p = this.tiles[this.hover].position;
      g.position.set(p.x, this.theme.concave ? 0.15 - this.theme.concave + 0.46 : 0.62, p.z);
      this.ghost = g;
      this.scene.add(g);
    }
  }

  bindEvents() {
    const el = this.renderer.domElement;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    const pick = (ev) => {
      const r = el.getBoundingClientRect();
      this.pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hits = this.raycaster.intersectObjects(this.tiles, false);
      return hits.length ? hits[0].object.userData.index : -1;
    };
    this.onMove = (ev) => {
      const i = pick(ev);
      if (i !== this.hover) { this.hover = i; this.refreshTiles(); }
      el.style.cursor = (i >= 0 && this.game && this.game.board[i] === 0 && !this.game.isOver) ? 'pointer' : 'grab';
    };
    this.onDown = (ev) => { this.downPos = [ev.clientX, ev.clientY]; };
    this.onUp = (ev) => {
      if (!this.downPos) return;
      const dx = ev.clientX - this.downPos[0], dy = ev.clientY - this.downPos[1];
      this.downPos = null;
      if (dx * dx + dy * dy > (ev.pointerType === 'touch' ? 144 : 36)) return; // a finger wobbles more than a mouse
      const i = pick(ev);
      if (i >= 0) this.handlers.onCellClick?.(i, ev.button === 2);
    };
    this.onCtx = (ev) => ev.preventDefault();
    el.addEventListener('contextmenu', this.onCtx);
    this.onLeave = () => { this.hover = -1; this.refreshTiles(); };
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointerleave', this.onLeave);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.container);
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fitCamera();
  }

  // Narrow (portrait) viewports: pull the camera back along its current direction so the board still fits,
  // and push the fog out with it so the scene does not disappear into haze.
  fitCamera() {
    if (!this.homeDist) {
      this.homeDist = this.camera.position.distanceTo(this.controls.target);
      const f = this.scene.fog;
      if (f) this.homeFog = f.isFogExp2 ? { density: f.density } : { near: f.near, far: f.far };
    }
    const aspect = this.camera.aspect || 1;
    const fit = Math.max(1, 0.95 / aspect);
    const want = this.homeDist * fit;
    const cur = this.camera.position.distanceTo(this.controls.target);
    // only override when the user has not orbited/zoomed away from the previously fitted distance
    if (!this.lastFitDist || Math.abs(cur - this.lastFitDist) < 1e-3) {
      const dir = this.camera.position.clone().sub(this.controls.target).normalize();
      this.camera.position.copy(this.controls.target).addScaledVector(dir, want);
    }
    this.lastFitDist = want;
    this.controls.maxDistance = Math.max(this.controls.maxDistance, want * 1.2);
    const f = this.scene.fog;
    if (f && this.homeFog) {
      if (f.isFogExp2) f.density = this.homeFog.density / fit;
      else { f.near = this.homeFog.near * fit; f.far = this.homeFog.far * fit; }
    }
  }

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
      const ph = m.userData.phys;
      if (ph) {
        if (!ph.settled) {
          const rest = m.userData.restY;
          // vertical: gravity + bounce
          ph.vy -= 22 * dt; ph.y += ph.vy * dt;
          if (ph.y < rest) { ph.y = rest; ph.vy = Math.abs(ph.vy) > 0.6 ? -ph.vy * 0.38 : 0; }
          // lateral: the dish pushes the stone toward the centre; a rolling stone loses energy
          const onFloor = ph.y <= rest + 0.001;
          const k = onFloor ? 34 : 0, damp = onFloor ? 5.5 : 0.4;
          ph.vx += (-k * ph.ox - damp * ph.vx) * dt; ph.vz += (-k * ph.oz - damp * ph.vz) * dt;
          ph.ox += ph.vx * dt; ph.oz += ph.vz * dt;
          // the stone rolls as it moves
          m.rotation.z -= ph.vx * dt / 0.46; m.rotation.x += ph.vz * dt / 0.46;
          if (ph.vy === 0 && Math.hypot(ph.vx, ph.vz) < 0.02 && Math.hypot(ph.ox, ph.oz) < 0.004) { ph.settled = true; ph.ox = ph.oz = 0; ph.y = rest; }
          const t0 = this.tiles[i].position;
          m.position.set(t0.x + ph.ox, ph.y, t0.z + ph.oz);
          m.scale.setScalar(1);
        }
        continue;
      }
      const age = (now - m.userData.spawn) / 320;
      const s = age < 1 ? 1 - Math.pow(1 - age, 3) : 1;
      m.scale.setScalar(s);
      if (this.themeName === 'neon') {
        m.position.y = 0.16 + Math.sin(tsec * 1.6 + m.userData.phase) * 0.04;
        m.rotation.y = tsec * 0.6 + m.userData.phase;
        m.rotation.x = Math.sin(tsec * 0.4 + m.userData.phase) * 0.3;
      } else if (age < 1) {
        m.position.y = (m.userData.restY ?? 0.62) + (1 - s) * 3;
      }
    }
    if (this.ghost && this.themeName === 'neon') this.ghost.rotation.y = tsec * 0.6;
    if (this.game?.line && this.lastRing.visible) {
      this.lastRing.material.opacity = 0.6 + 0.4 * Math.sin(tsec * 4);
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  // --- piece portraits for the HUD reservoirs ---
  static preview() {
    if (!ThreeRenderer._pv) {
      const r = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
      r.setSize(192, 192); r.setPixelRatio(1);
      r.toneMapping = THREE.ACESFilmicToneMapping;
      // the preview has its own GL context, so it needs its own environment map for reflective materials
      const pmrem = new THREE.PMREMGenerator(r);
      const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
      ThreeRenderer._pv = { r, scene: new THREE.Scene(), cam: new THREE.PerspectiveCamera(30, 1, 0.01, 100), env };
    }
    return ThreeRenderer._pv;
  }

  // Set up the portrait scene for one player and return the mesh (shared by the static and live paths).
  iconScene(player) {
    const pv = ThreeRenderer.preview();
    pv.scene.clear();
    pv.scene.environment = this.scene.environment ? pv.env : null;
    pv.scene.environmentIntensity = this.scene.environment ? Math.max(0.5, this.scene.environmentIntensity ?? 1) : 1;
    pv.scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(2, 3, 2.5); pv.scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.7); rim.position.set(-2, 1, -2); pv.scene.add(rim);
    const mesh = this.iconMesh(player);
    pv.scene.add(mesh);
    mesh.updateMatrixWorld(true);
    const sphere = new THREE.Box3().setFromObject(mesh).getBoundingSphere(new THREE.Sphere());
    const dist = (sphere.radius / Math.sin(THREE.MathUtils.degToRad(15))) * 0.56;
    const dir = new THREE.Vector3(0.8, 0.85, 1.1).normalize();
    pv.cam.position.copy(sphere.center).addScaledVector(dir, dist);
    pv.cam.lookAt(sphere.center);
    return mesh;
  }

  // Live portraits: themes whose pieces move set theme.liveIcons and implement animateIcon(mesh, t, player).
  get liveIcons() { return !!this.theme.liveIcons; }
  iconFrame(player, ctx, t) {
    const pv = ThreeRenderer.preview();
    if (!this._iconMeshes) this._iconMeshes = {};
    // rebuild the scene for this player (cheap: a few lights and one mesh)
    const mesh = this.iconScene(player);
    this.animateIcon?.(mesh, t, player);
    pv.r.render(pv.scene, pv.cam);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.drawImage(pv.r.domElement, 0, 0, ctx.canvas.width, ctx.canvas.height);
  }

  // The object to portray; subclasses override when their board pieces are not the base spheres.
  iconMesh(player) {
    const mesh = new THREE.Mesh(this.pieceGeo[player - 1], this.pieceMat[player - 1]);
    if (this.glowTex) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: player === 1 ? this.theme.p1.color : this.theme.p2.color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
      sprite.scale.set(2.2, 2.2, 1);
      mesh.add(sprite);
    }
    mesh.rotation.set(0.35, 0.6, 0);
    return mesh;
  }

  // Render the piece alone against transparency from a three-quarter angle and return a data URL.
  pieceIcon(player) {
    const pv = ThreeRenderer.preview();
    this.iconScene(player);
    pv.r.render(pv.scene, pv.cam);
    return pv.r.domElement.toDataURL();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener('pointermove', this.onMove);
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('pointerleave', this.onLeave);
    el.removeEventListener('contextmenu', this.onCtx);
    this.controls.dispose();
    this.scene.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
    });
    this.mirror?.dispose?.();
    this.renderer.dispose();
    el.remove();
  }
}
