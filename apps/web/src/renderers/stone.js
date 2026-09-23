import * as THREE from 'three';
import { rng } from './wood.js';

// Procedural polished marble for the Marble Hall cafe table: a pink-beige stone with soft mottling, fine pale
// veins wandering across it, and small brown-rimmed fossil inclusions (the look of Rosso Verona / Jura-style
// bistro table tops).
export function marbleTexture(size = 2048, seed = 11) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const rand = rng(seed);
  const base = g.createLinearGradient(0, 0, size, size);
  base.addColorStop(0, '#d5c2b1'); base.addColorStop(0.5, '#cfbaa8'); base.addColorStop(1, '#dac8b7');
  g.fillStyle = base; g.fillRect(0, 0, size, size);
  // broad clouds: pink and grey, very translucent
  for (let k = 0; k < 420; k++) {
    const x = rand() * size, y = rand() * size, r = size * (0.02 + rand() * 0.08);
    const pink = rand() < 0.55;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, pink ? `rgba(214,168,142,${0.05 + rand() * 0.09})` : `rgba(160,148,138,${0.04 + rand() * 0.07})`);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  // fossil inclusions: small ellipses with a brown rim, a few with a paler centre
  for (let k = 0; k < 320; k++) {
    const x = rand() * size, y = rand() * size, r = size * (0.002 + rand() * 0.007), ar = 0.6 + rand() * 0.6;
    g.save(); g.translate(x, y); g.rotate(rand() * Math.PI); g.scale(1, ar);
    g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2);
    g.fillStyle = rand() < 0.5 ? `rgba(196,150,120,${0.10 + rand() * 0.15})` : `rgba(226,206,190,${0.15 + rand() * 0.2})`;
    g.fill();
    g.lineWidth = size * (0.0006 + rand() * 0.0009);
    g.strokeStyle = `rgba(140,88,56,${0.25 + rand() * 0.35})`;
    g.stroke();
    g.restore();
  }
  // veins: random walks with occasional branches, pale with a grey shadow line beside them
  const vein = (x, y, ang, len, w, alpha, depth) => {
    g.beginPath(); g.moveTo(x, y);
    let a = ang;
    for (let s = 0; s < len; s++) {
      a += (rand() - 0.5) * 0.5;
      x += Math.cos(a) * size * 0.006; y += Math.sin(a) * size * 0.006;
      g.lineTo(x, y);
      if (depth > 0 && rand() < 0.02) vein(x, y, a + (rand() < 0.5 ? 0.9 : -0.9), len * 0.4, w * 0.6, alpha * 0.8, depth - 1);
    }
    g.lineWidth = w; g.strokeStyle = `rgba(246,240,234,${alpha})`; g.stroke();
  };
  for (let k = 0; k < 26; k++) {
    g.lineJoin = 'round';
    vein(rand() * size, rand() * size, rand() * Math.PI * 2, 60 + rand() * 160, size * (0.0005 + rand() * 0.0012), 0.35 + rand() * 0.45, 2);
  }
  // a few thin grey fissures
  for (let k = 0; k < 14; k++) {
    let x = rand() * size, y = rand() * size, a = rand() * Math.PI * 2;
    g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 120; s++) { a += (rand() - 0.5) * 0.35; x += Math.cos(a) * size * 0.005; y += Math.sin(a) * size * 0.005; g.lineTo(x, y); }
    g.lineWidth = size * 0.0004; g.strokeStyle = `rgba(110,100,95,${0.25 + rand() * 0.3})`; g.stroke();
  }
  // fine speckle
  for (let k = 0; k < 12000; k++) {
    g.fillStyle = rand() < 0.5 ? `rgba(120,90,70,${rand() * 0.10})` : `rgba(255,250,245,${rand() * 0.12})`;
    g.fillRect(rand() * size, rand() * size, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// Lime plaster: near-flat cream with the faintest trowel mottling, so a large wall does not read as a flat fill.
export function plasterTexture(size = 512, seed = 3) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const rand = rng(seed);
  g.fillStyle = '#efe6d9'; g.fillRect(0, 0, size, size);
  for (let k = 0; k < 900; k++) {
    const x = rand() * size, y = rand() * size, r = 6 + rand() * 40;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, rand() < 0.5 ? `rgba(255,250,242,${rand() * 0.10})` : `rgba(205,190,170,${rand() * 0.08})`);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
