import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';

// A hexagonal slab with softly rounded edges. Points of the hexagon lie on ±x; the top face is at y = 0 and the
// slab extends down to y = -height. ExtrudeGeometry's bevel follows a quarter-sine profile, so with a few segments
// it reads as a small fillet rather than a chamfer, and the slab loses the razor edges that make a plain prism
// look low-poly. With segments = 1 (and equal thickness and size) the bevel is a plain 45° chamfer instead.
export function filletedHexGeometry(radius, height, fillet = 0.12, segments = 5) {
  const shape = new THREE.Shape();
  const r = radius - fillet; // the bevel grows outward by `fillet`, so the outline ends up at `radius`
  for (let k = 0; k < 6; k++) {
    const a = Math.PI / 3 * k;
    k ? shape.lineTo(r * Math.cos(a), r * Math.sin(a)) : shape.moveTo(r * Math.cos(a), r * Math.sin(a));
  }
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: height - 2 * fillet, bevelEnabled: true, bevelThickness: fillet, bevelSize: fillet, bevelOffset: 0, bevelSegments: segments, curveSegments: 1,
  });
  // extruded along +z from -fillet to depth+fillet; stand it up so it spans y in [-height, 0]
  g.rotateX(-Math.PI / 2);
  g.translate(0, -(height - fillet), 0);
  return g;
}

// A hexagonal slab with crisp edges whose twelve vertex tips (where a side edge meets the top or bottom face) are
// truncated by a tiny triangular facet: the tip is replaced by three points `cut` along the three edges that meet
// there, and the slab is the convex hull of those points. Same placement as filletedHexGeometry (points on ±x,
// top at y = 0, bottom at y = -height).
export function tipCutHexGeometry(radius, height, cut = 0.05) {
  const pts = [];
  for (let k = 0; k < 6; k++) {
    const a = Math.PI / 3 * k, ap = a - Math.PI / 3, an = a + Math.PI / 3;
    const c = new THREE.Vector2(radius * Math.cos(a), radius * Math.sin(a));
    const toP = new THREE.Vector2(radius * Math.cos(ap), radius * Math.sin(ap)).sub(c).setLength(cut);
    const toN = new THREE.Vector2(radius * Math.cos(an), radius * Math.sin(an)).sub(c).setLength(cut);
    for (const [y, dy] of [[0, -cut], [-height, cut]]) {
      pts.push(new THREE.Vector3(c.x + toP.x, y, c.y + toP.y), new THREE.Vector3(c.x + toN.x, y, c.y + toN.y), new THREE.Vector3(c.x, y + dy, c.y));
    }
  }
  return new ConvexGeometry(pts);
}
