// Procedural tile dioramas: props (trees, houses, sheep...) and one builder per terrain, plus bake().
import * as THREE from 'three';






import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toWorld, distOrigin, neighborKeys } from '../core/hex.js';


import { TOP, WORLD_MAT, WORLD_DEPTH, M, SM, G, mesh } from './materials.js';
import { iconSprite } from './sprites.js';


export function pointsInHex(rng, n, { rMax = 0.68, minD = 0.2, avoidCenter = 0 } = {}) {
  const pts = [];
  let tries = 0;
  while (pts.length < n && tries++ < 300) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * rMax;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (r < avoidCenter) continue;
    if (pts.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < minD * minD)) continue;
    pts.push({ x, z });
  }
  return pts;
}

// ---------- props ----------
export function tree(rng, scale = 1) {
  const g = new THREE.Group();
  g.add(mesh(G.cyl(6), M(0x8a5a36), 0, 0.08, 0, 0.04, 0.16, 0.04));
  const greens = [0x3e9d45, 0x4fb24e, 0x2f8a3f, 0x58b846];
  const green = greens[Math.floor(rng() * greens.length)];
  if (rng() < 0.45) {
    const c = SM('pine', green);
    g.add(mesh(G.cone(8), c, 0, 0.3, 0, 0.2, 0.34, 0.2));
    g.add(mesh(G.cone(8), c, 0, 0.47, 0, 0.14, 0.26, 0.14));
  } else {
    const c = SM('leaf', green);
    g.add(mesh(G.blob(), c, 0, 0.3, 0, 0.19, 0.2, 0.19));
    g.add(mesh(G.blob(), c, 0.06, 0.4, 0.02, 0.12));
  }
  g.scale.setScalar(scale * (0.8 + rng() * 0.45));
  g.rotation.y = rng() * 6;
  g.userData.sway = rng() * 10;
  return g;
}

export function house(w, h, d, wall, roof) {
  const g = new THREE.Group();
  g.add(mesh(G.box(), M(wall), 0, h / 2, 0, w, h, d));
  const sy = w * 0.5;
  g.add(mesh(G.prism(), M(roof), 0, h + 0.5 * sy, 0, (w * 0.64) / 0.866, sy, d * 1.14));
  g.add(mesh(G.box(), M(0x6b4226), 0, h * 0.3, d / 2 + 0.002, w * 0.22, h * 0.6, 0.01));
  return g;
}

export function sheep(rng) {
  const g = new THREE.Group();
  g.add(mesh(G.blob(), M(0xfbf8f0), 0, 0.09, 0, 0.09, 0.075, 0.07));
  g.add(mesh(G.blob(), M(0x3a3230), 0.09, 0.11, 0, 0.038));
  g.rotation.y = rng() * 6;
  return g;
}

export function fenceRing(r, color = 0xa8784a) {
  const g = new THREE.Group();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.add(mesh(G.box(), M(color), Math.cos(a) * r, 0.06, Math.sin(a) * r, 0.03, 0.12, 0.03));
    const b = mesh(G.box(), M(color), Math.cos(a + 0.26) * r, 0.08, Math.sin(a + 0.26) * r, 0.02, 0.025, (2 * Math.PI * r) / 12);
    b.rotation.y = -(a + 0.26);
    g.add(b);
  }
  return g;
}

export function flag(color, h = 0.8) {
  const g = new THREE.Group();
  g.add(mesh(G.cyl(5), M(0x6b4a2b), 0, h / 2, 0, 0.018, h, 0.018));
  g.add(mesh(G.sphere(), M(0xf0c040), 0, h + 0.02, 0, 0.03));
  const pivot = new THREE.Group();
  pivot.add(mesh(G.box(), M(color), 0.13, h - 0.12, 0, 0.24, 0.18, 0.015));
  pivot.userData.dynamic = 'flap';
  pivot.userData.phase = Math.random() * 6;
  g.add(pivot);
  return g;
}

export function figure(color) {
  const g = new THREE.Group();
  g.add(mesh(G.cyl(8), M(color), 0, 0.07, 0, 0.04, 0.14, 0.04));
  g.add(mesh(G.sphere(), M(0xf5d0a8), 0, 0.18, 0, 0.042));
  g.add(mesh(G.sphere(), M(0xc9ced6), 0, 0.205, 0, 0.044, 0.028, 0.044));
  return g;
}

// ---------- tile content ----------
export function buildForest(rng, t, g) {
  const n = t.building === 'lumber' ? 6 : t.poi ? 7 : 14;
  for (const p of pointsInHex(rng, n, { rMax: 0.78, minD: 0.17, avoidCenter: t.building || t.poi ? 0.38 : 0 })) {
    const tr = tree(rng, 0.72);
    tr.position.set(p.x, TOP, p.z);
    g.add(tr);
  }
  if (t.building === 'lumber') {
    const h = house(0.3, 0.2, 0.26, 0xc9955e, 0x8a4a2e);
    h.position.set(t.poi ? -0.5 : -0.1, TOP, t.poi ? 0.3 : 0.05);
    g.add(h);
    for (let i = 0; i < 3; i++) {
      const log = mesh(G.cyl(8), M(0xa0683a), 0.2, TOP + 0.04 + (i === 2 ? 0.06 : 0), -0.05 + (i === 2 ? 0 : (i - 0.5) * 0.09), 0.04, 0.3, 0.04);
      log.rotation.z = Math.PI / 2;
      g.add(log);
    }
    if (t.upgraded) {
      // sawmill: second shed with a saw blade
      const saw = house(0.24, 0.16, 0.2, 0xd9a86a, 0x6b4a2b);
      saw.position.set(0.12, TOP, 0.4);
      g.add(saw);
      const blade = mesh(G.cyl(12), M(0xc9ced6), 0.26, TOP + 0.14, 0.4, 0.09, 0.01, 0.09);
      blade.rotation.x = Math.PI / 2;
      g.add(blade);
    }
  }
}

export function buildMeadow(rng, t, g) {
  for (const p of pointsInHex(rng, 7, { minD: 0.15 })) {
    g.add(mesh(G.cone(5), SM('grass', 0x6cc043), p.x, TOP + 0.04, p.z, 0.045, 0.09, 0.045));
  }
  const flowers = [0xffffff, 0xffd84a, 0xff7fb0, 0xc49bff];
  for (const p of pointsInHex(rng, 7, { minD: 0.1 })) {
    g.add(mesh(G.blob(), M(flowers[Math.floor(rng() * 4)]), p.x, TOP + 0.02, p.z, 0.028));
  }
  if (t.building === 'pen') {
    const f = fenceRing(0.5);
    f.position.y = TOP;
    g.add(f);
    const h = house(0.22, 0.14, 0.2, 0xf6e7c8, 0xc0563a);
    h.position.set(0, TOP, 0.62);
    g.add(h);
    if (t.upgraded) {
      const shed = house(0.26, 0.16, 0.22, 0xf6e7c8, 0x4a86d0);
      shed.position.set(-0.55, TOP, 0.2);
      shed.rotation.y = 1.2;
      g.add(shed);
    }
  }
  const nSheep = t.poi ? 0 : t.building === 'pen' ? 4 : t.owner != null ? 1 : 0;
  for (const p of pointsInHex(rng, nSheep, { rMax: t.building === 'pen' ? 0.35 : 0.6 })) {
    const s = sheep(rng);
    s.position.set(p.x, TOP, p.z);
    g.add(s);
  }
}

export function lerpColor(a, b, k) {
  return new THREE.Color(a).lerp(new THREE.Color(b), k).getHex();
}

export function buildField(rng, t, g, game) {
  g.add(mesh(G.disc(6), M(0x9a6a44), 0, TOP + 0.01, 0, 0.8, 0.03, 0.8));
  const rows = [-0.45, -0.22, 0, 0.22, 0.45];
  const grow = t.crop ? game.growTime(t) : 1;
  const k = t.crop ? Math.min(1, (t.crop.progress + 0.35) / grow) : 0;
  const ripe = t.crop && t.crop.progress >= grow - 1;
  for (const z of rows) {
    const half = Math.sqrt(Math.max(0, 0.6 - z * z)) * 0.95;
    const clearMid = t.poi && Math.abs(z) < 0.3; // leave the middle free for a ruin or mill
    if (!t.crop) {
      if (clearMid) {
        const seg = half - 0.34;
        if (seg > 0.05) for (const sx of [-1, 1]) g.add(mesh(G.box(), M(0x7a4e2e), sx * (0.34 + seg / 2), TOP + 0.035, z, seg, 0.035, 0.07));
      } else g.add(mesh(G.box(), M(0x7a4e2e), 0, TOP + 0.035, z, half * 2, 0.035, 0.07));
      continue;
    }
    const type = t.crop.type;
    const n = Math.max(2, Math.round(half * 8));
    for (let i = 0; i < n; i++) {
      const x = -half + (i + 0.5) * ((half * 2) / n);
      if (clearMid && Math.abs(x) < 0.34) continue;
      if (type === 'wheat') {
        const h = 0.05 + 0.22 * k;
        g.add(mesh(G.box(), M(lerpColor(0x7cc84a, 0xf2cf4a, ripe ? 1 : k * 0.6)), x, TOP + 0.03 + h / 2, z, 0.08, h, 0.08));
      } else if (type === 'carrot') {
        g.add(mesh(G.cone(5), M(0x5cb03a), x, TOP + 0.05 + 0.04 * k, z, 0.05, 0.08 + 0.1 * k, 0.05));
        if (ripe) g.add(mesh(G.cone(6), M(0xff8a24), x, TOP + 0.03, z + 0.05, 0.028, 0.05, 0.028));
      } else {
        g.add(mesh(G.blob(), M(0x4a9a35), x, TOP + 0.04, z, 0.05));
        if (k > 0.3 && i % 2 === 0) {
          g.add(mesh(G.sphere(), M(ripe ? 0xff8a1a : 0xe2c04a), x, TOP + 0.06, z, 0.03 + 0.06 * k, 0.025 + 0.05 * k, 0.03 + 0.06 * k));
        }
      }
    }
  }
  if (t.building === 'barn') {
    const b = house(0.32, 0.24, 0.26, 0xd9483a, 0xf2eadb);
    b.position.set(0.52, TOP, -0.2);
    b.rotation.y = 0.5;
    g.add(b);
    if (t.upgraded) {
      // granary silo
      g.add(mesh(G.cyl(12), M(0xefe6d2), 0.3, TOP + 0.2, -0.55, 0.09, 0.4, 0.09));
      g.add(mesh(G.cone(12), M(0xd9483a), 0.3, TOP + 0.47, -0.55, 0.11, 0.14, 0.11));
    }
  }
}

export function buildMountain(rng, t, g) {
  const peaks = t.building === 'quarry' || t.poi ? 2 : 3;
  // a ruin or mill owns the middle of the tile, so the peaks step aside to the rim
  const pts = t.poi
    ? pointsInHex(rng, peaks, { rMax: 0.72, minD: 0.45, avoidCenter: 0.5 })
    : pointsInHex(rng, peaks, { rMax: 0.4, minD: 0.3 });
  pts.forEach((p, i) => {
    const r = (t.poi ? 0.2 : 0.32) + rng() * (t.poi ? 0.1 : 0.18);
    const h = (t.poi ? 0.45 : i === 0 ? 0.9 : 0.55) + rng() * (t.poi ? 0.2 : 0.35);
    const grey = [0xa89f92, 0x988f84, 0xb4ac9f][i % 3];
    const m = mesh(G.cone(7), SM('rock', grey), p.x, TOP + h / 2, p.z, r, h, r);
    m.rotation.y = rng() * 3;
    g.add(m);
    const hs = h * 0.34;
    const s = mesh(G.cone(7), M(0xffffff), p.x, TOP + h - hs / 2 + 0.005, p.z, r * 0.36, hs, r * 0.36);
    s.rotation.y = m.rotation.y;
    g.add(s);
  });
  for (const p of pointsInHex(rng, 4, { rMax: 0.75, avoidCenter: 0.5 })) {
    g.add(mesh(G.blob(), SM('rock', 0xa09a8e), p.x, TOP + 0.04, p.z, 0.06 + rng() * 0.05));
  }
  if (t.building === 'quarry') {
    for (let i = 0; i < 5; i++) {
      g.add(mesh(G.box(), M(0xe0dccf), 0.35 + (i % 3) * 0.13, TOP + 0.05 + Math.floor(i / 3) * 0.1, 0.35, 0.12, 0.1, 0.12));
    }
    g.add(mesh(G.box(), M(0x9a6a3e), -0.2, TOP + 0.07, 0.5, 0.2, 0.08, 0.13));
    if (t.upgraded) {
      // deep quarry: wooden crane
      g.add(mesh(G.box(), M(0x8a5a36), 0.55, TOP + 0.3, 0.1, 0.04, 0.6, 0.04));
      const arm = mesh(G.box(), M(0x8a5a36), 0.42, TOP + 0.58, 0.1, 0.3, 0.035, 0.035);
      g.add(arm);
    }
  }
}

export const LAKE_MAT = new THREE.MeshStandardMaterial({ color: 0x4fc6ec, roughness: 0.12, metalness: 0.05 });
export function buildLake(rng, t, g) {
  const water = new THREE.Mesh(G.disc(18), LAKE_MAT);
  water.position.set(0, TOP + 0.005, 0);
  water.scale.set(0.72, 0.03, 0.72);
  water.receiveShadow = true;
  water.userData.dynamic = 'static';
  g.add(water);
  for (const p of pointsInHex(rng, 5, { rMax: 0.82, avoidCenter: 0.74, minD: 0.1 })) {
    g.add(mesh(G.cyl(4), M(0x5e9a34), p.x, TOP + 0.08, p.z, 0.014, 0.16, 0.014));
  }
  for (const p of pointsInHex(rng, 2, { rMax: 0.5, minD: 0.3 })) {
    g.add(mesh(G.disc(8), M(0x5cb03a), p.x, TOP + 0.025, p.z, 0.07, 0.01, 0.07));
  }
  if (t.building === 'dock') {
    const d = mesh(G.box(), M(0xb3834f), 0.35, TOP + 0.04, 0.25, 0.14, 0.03, 0.5);
    d.rotation.y = 0.7;
    g.add(d);
    const boat = new THREE.Group();
    boat.add(mesh(G.box(), M(0x9a5a2e), 0, 0.03, 0, 0.26, 0.06, 0.1));
    boat.add(mesh(G.cyl(4), M(0x6b4a2b), 0, 0.17, 0, 0.01, 0.26, 0.01));
    boat.add(mesh(G.prism(), M(0xfff6e6), 0.05, 0.18, 0, 0.06, 0.16, 0.01));
    boat.position.set(-0.15, TOP + 0.01, -0.1);
    boat.userData.dynamic = 'bob';
    boat.userData.phase = rng() * 6;
    g.add(boat);
    if (t.upgraded) {
      // harbour: little lighthouse
      g.add(mesh(G.cyl(10), M(0xffffff), -0.55, TOP + 0.25, 0.3, 0.07, 0.5, 0.08));
      g.add(mesh(G.cyl(10), M(0xd9483a), -0.55, TOP + 0.3, 0.3, 0.075, 0.08, 0.085));
      g.add(mesh(G.cone(10), M(0xd9483a), -0.55, TOP + 0.57, 0.3, 0.09, 0.12, 0.09));
    }
  }
}

// Haven: a walled town of seven hexes in the middle of the map. The centre holds the keep,
// the six districts around it each get their own landmark, and one outer wall rings them all.
export function havenWalls(t, g, T) {
  const wallC = M(0xd6ccb4);
  const roof = M(0x3f6fb8);
  const me = toWorld(t.key);
  for (const n of neighborKeys(t.key)) {
    if (distOrigin(n) < 2) continue;
    const o = toWorld(n);
    const dx = (o.x - me.x) / Math.sqrt(3);
    const dz = (o.z - me.z) / Math.sqrt(3);
    const mx = dx * 0.83;
    const mz = dz * 0.83;
    const wall = mesh(G.box(), wallC, mx, T + 0.1, mz, 0.06, 0.2, 0.96);
    wall.rotation.y = Math.atan2(dx, dz) + Math.PI / 2;
    g.add(wall);
    // one tower per wall segment, always on the same (clockwise) end, so every corner of the
    // ring gets exactly one tower instead of two overlapping ones
    const tx = mx - dz * 0.48;
    const tz = mz + dx * 0.48;
    g.add(mesh(G.cyl(10), wallC, tx, T + 0.16, tz, 0.08, 0.32, 0.08));
    g.add(mesh(G.cone(10), roof, tx, T + 0.38, tz, 0.1, 0.14, 0.1));
  }
}

export function buildDistrict(rng, t, g, T) {
  const roofs = [0xe0503a, 0xf07a3a, 0xc2402e, 0x4a86d0];
  const d = t.district;
  // houses fill the inner half of every district
  for (const p of pointsInHex(rng, 4, { rMax: 0.55, minD: 0.3, avoidCenter: 0.12 })) {
    const h = house(0.2 + rng() * 0.06, 0.16 + rng() * 0.08, 0.18, 0xfbefd6, roofs[Math.floor(rng() * roofs.length)]);
    h.position.set(p.x, T, p.z);
    h.rotation.y = Math.floor(rng() * 6) * (Math.PI / 3);
    g.add(h);
  }
  if (d === 1) {
    // market square
    g.add(mesh(G.disc(16), M(0xf1e7cf), 0, T + 0.012, 0, 0.26, 0.01, 0.26));
    [0xf0c040, 0xe0503a, 0x4a86d0, 0x4f9e38].forEach((c, i) => {
      const a = (i / 4) * Math.PI * 2;
      g.add(mesh(G.box(), M(0xa8784a), Math.cos(a) * 0.14, T + 0.05, Math.sin(a) * 0.14, 0.1, 0.08, 0.08));
      g.add(mesh(G.prism(), M(c), Math.cos(a) * 0.14, T + 0.12, Math.sin(a) * 0.14, 0.08, 0.05, 0.11));
    });
  } else if (d === 2) {
    // windmill
    g.add(mesh(G.cyl(10), M(0xfbefd6), 0, T + 0.3, 0, 0.12, 0.6, 0.12));
    g.add(mesh(G.cone(10), M(0xe0503a), 0, T + 0.7, 0, 0.16, 0.2, 0.16));
    const blades = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const holder = new THREE.Group();
      holder.rotation.z = (i / 4) * Math.PI * 2;
      holder.add(mesh(G.box(), M(0xfff6e6), 0, 0.2, 0, 0.07, 0.4, 0.01));
      blades.add(holder);
    }
    blades.position.set(0, T + 0.55, 0.15);
    blades.userData.dynamic = 'spin';
    g.add(blades);
  } else if (d === 3) {
    // harbour pond with boats
    g.add(mesh(G.disc(18), M(0x4fc6ec), 0, T + 0.01, 0, 0.34, 0.01, 0.34));
    const boat = new THREE.Group();
    boat.add(mesh(G.box(), M(0x9a5a2e), 0, 0.03, 0, 0.2, 0.05, 0.08));
    boat.add(mesh(G.prism(), M(0xfff6e6), 0.03, 0.14, 0, 0.05, 0.13, 0.01));
    boat.position.set(0.05, T + 0.01, 0.05);
    boat.userData.dynamic = 'bob';
    boat.userData.phase = rng() * 6;
    g.add(boat);
  } else if (d === 4) {
    // chapel
    g.add(mesh(G.box(), M(0xefe6d2), 0, T + 0.15, 0, 0.2, 0.3, 0.32));
    g.add(mesh(G.prism(), M(0x5a7ec0), 0, T + 0.36, 0, 0.14, 0.12, 0.34));
    g.add(mesh(G.box(), M(0xefe6d2), 0, T + 0.4, 0.13, 0.1, 0.5, 0.1));
    g.add(mesh(G.cone(4), M(0x5a7ec0), 0, T + 0.78, 0.13, 0.1, 0.26, 0.1));
  } else if (d === 5) {
    // orchard
    for (const p of pointsInHex(rng, 5, { rMax: 0.3, minD: 0.14 })) {
      const tr = tree(rng, 0.6);
      tr.position.set(p.x, T, p.z);
      g.add(tr);
    }
  } else {
    // garrison with a banner
    g.add(mesh(G.box(), M(0xd6ccb4), 0, T + 0.12, 0, 0.36, 0.24, 0.26));
    for (const x of [-0.14, 0, 0.14]) g.add(mesh(G.box(), M(0xd6ccb4), x, T + 0.27, 0.12, 0.06, 0.06, 0.03));
    const fl = flag(0xf0c040, 0.6);
    fl.position.set(0.12, T + 0.24, -0.06);
    g.add(fl);
  }
}

export function buildVillage(rng, t, g) {
  const centre = !t.district;
  const lift = centre ? 0.14 : 0.06;
  const T = TOP + lift;
  // plinth sits just inside the tile edge so its sides never coincide with the tile's own sides
  g.add(mesh(G.soil(), [M(0xcfc2a4), M(0xcfc2a4), M(0xcfc2a4)], 0, TOP - 0.2 + lift, 0, 0.965, 1, 0.965));
  g.add(mesh(G.disc(6), centre ? M(0xe6dcc2) : SM('grass', 0x9fd26a), 0, T + 0.002, 0, 0.955, 0.006, 0.955));
  if (!centre) g.add(mesh(G.box(), M(0xe6dcc2), 0, T + 0.008, 0, 0.16, 0.006, 1.6));
  if (!centre) {
    buildDistrict(rng, t, g, T);
    havenWalls(t, g, T);
    return;
  }
  // the keep: plaza, fountain, hall and a tall tower that can be seen from anywhere
  g.add(mesh(G.disc(16), M(0xf1e7cf), 0, T + 0.012, 0.25, 0.3, 0.01, 0.3));
  g.add(mesh(G.cyl(12), M(0xbfb39a), 0, T + 0.04, 0.25, 0.07, 0.06, 0.07));
  g.add(mesh(G.cyl(12), M(0x7fd0f0), 0, T + 0.075, 0.25, 0.055, 0.01, 0.055));
  g.add(mesh(G.box(), M(0xefe6d2), 0, T + 0.22, -0.25, 0.56, 0.44, 0.36));
  g.add(mesh(G.prism(), M(0x3f6fb8), 0, T + 0.52, -0.25, 0.36, 0.16, 0.4));
  for (const x of [-0.3, 0.3]) {
    g.add(mesh(G.cyl(10), M(0xf4ecda), x, T + 0.3, -0.25, 0.09, 0.6, 0.09));
    g.add(mesh(G.cone(10), M(0x3f6fb8), x, T + 0.7, -0.25, 0.12, 0.2, 0.12));
  }
  g.add(mesh(G.cyl(12), M(0xf4ecda), 0, T + 0.62, -0.3, 0.13, 1.24, 0.13));
  g.add(mesh(G.cone(12), M(0x3f6fb8), 0, T + 1.39, -0.3, 0.18, 0.32, 0.18));
  g.add(mesh(G.box(), M(0x6b4226), 0, T + 0.1, -0.06, 0.12, 0.2, 0.01));
  const fl = flag(0xf0c040, 0.55);
  fl.position.set(0, T + 1.53, -0.3);
  g.add(fl);
  g.userData.chimney = new THREE.Vector3(0.3, T + 0.4, 0.3);
  const h = house(0.2, 0.2, 0.18, 0xfbefd6, 0xe0503a);
  h.position.set(0.42, T, 0.3);
  g.add(h);
  const h2 = house(0.2, 0.18, 0.18, 0xfbefd6, 0xf07a3a);
  h2.position.set(-0.42, T, 0.3);
  g.add(h2);
}

export function buildHome(rng, t, g, game) {
  const p = game.players[t.owner];
  const main = house(0.42, 0.28, 0.34, 0xfbefd6, p.color);
  main.position.set(-0.05, TOP, 0.05);
  g.add(main);
  g.add(mesh(G.box(), M(0xb0a090), 0.08, TOP + 0.42, 0.1, 0.06, 0.16, 0.06));
  g.userData.chimney = new THREE.Vector3(0.08, TOP + 0.52, 0.1);
  if (t.level >= 2) {
    const barn = house(0.34, 0.26, 0.28, 0xd9483a, 0xf2eadb);
    barn.position.set(0.42, TOP, -0.25);
    barn.rotation.y = -0.6;
    g.add(barn);
    for (let i = 0; i < 3; i++) g.add(mesh(G.cyl(10), M(0xf2cf4a), -0.5 + i * 0.13, TOP + 0.06, -0.4, 0.06, 0.12, 0.06));
  }
  if (t.level >= 3) {
    g.add(mesh(G.cyl(10), M(0xefe6d2), -0.45, TOP + 0.3, 0.35, 0.12, 0.6, 0.12));
    g.add(mesh(G.cone(10), M(p.color), -0.45, TOP + 0.72, 0.35, 0.15, 0.25, 0.15));
    const f = fenceRing(0.78);
    f.position.y = TOP;
    g.add(f);
  }
  const fl = flag(p.color, 1.0);
  fl.position.set(0.35, TOP, 0.35);
  g.add(fl);
  // workshop perks show up as small props around the farm
  const perks = p.perks || [];
  if (perks.includes('cart')) {
    const cart = new THREE.Group();
    cart.add(mesh(G.box(), M(0xb3834f), 0, 0.07, 0, 0.18, 0.06, 0.11));
    for (const z of [-0.06, 0.06]) {
      const w = mesh(G.cyl(10), M(0x6b4a2b), 0, 0.04, z, 0.045, 0.015, 0.045);
      w.rotation.x = Math.PI / 2;
      cart.add(w);
    }
    cart.position.set(0.55, TOP, -0.05);
    cart.rotation.y = 0.8;
    g.add(cart);
  }
  if (perks.includes('watchtower')) {
    for (const [x, z] of [[-0.62, -0.1], [-0.52, -0.1], [-0.62, -0.2], [-0.52, -0.2]]) g.add(mesh(G.box(), M(0x8a5a36), x, TOP + 0.22, z, 0.025, 0.44, 0.025));
    g.add(mesh(G.box(), M(0xa8784a), -0.57, TOP + 0.45, -0.15, 0.16, 0.04, 0.16));
    g.add(mesh(G.cone(4), M(p.color), -0.57, TOP + 0.55, -0.15, 0.13, 0.14, 0.13));
  }
  if (perks.includes('seeds')) g.add(mesh(G.cyl(10), M(0xe6d7a8), 0.15, TOP + 0.06, -0.55, 0.07, 0.12, 0.07));
  if (perks.includes('surveyor')) g.add(mesh(G.cone(3), M(0x6b4a2b), 0.6, TOP + 0.12, 0.3, 0.07, 0.24, 0.07));
  if (perks.includes('guild')) g.add(mesh(G.cyl(12), M(0xf0c040), -0.35, TOP + 0.03, 0.6, 0.06, 0.03, 0.06));
  if (perks.includes('maproom')) {
    const mr = house(0.2, 0.16, 0.18, 0xefe6d2, 0x2f6fd6);
    mr.position.set(0.1, TOP, -0.6);
    g.add(mr);
  }
  for (let i = 0; i < p.guards; i++) {
    const a = 2.3 + i * 0.4;
    const fig = figure(p.color);
    fig.position.set(Math.cos(a) * 0.6, TOP, Math.sin(a) * 0.6);
    g.add(fig);
  }
}

export const FIRE_MAT = new THREE.MeshBasicMaterial({ color: 0xffa040 });
export function buildPoi(rng, t, g) {
  const poi = t.poi;
  if (!poi) return;
  if (poi.type === 'ruins') {
    const stoneC = poi.repaired ? 0xfffaf0 : 0xc9c2b2;
    g.add(mesh(G.box(), M(stoneC), 0, TOP + 0.03, 0, 0.62, 0.06, 0.46));
    const cols = [[-0.24, -0.15], [0, -0.15], [0.24, -0.15], [-0.24, 0.15], [0, 0.15], [0.24, 0.15]];
    cols.forEach(([x, z], i) => {
      const h = poi.repaired ? 0.36 : [0.3, 0.12, 0.22, 0.08, 0.28, 0.16][i];
      g.add(mesh(G.cyl(10), M(stoneC), x, TOP + 0.06 + h / 2, z, 0.05, h, 0.05));
    });
    if (poi.repaired) {
      g.add(mesh(G.box(), M(stoneC), 0, TOP + 0.44, 0, 0.64, 0.05, 0.44));
      g.add(mesh(G.prism(), M(0x5a86c8), 0, TOP + 0.5, 0, 0.36, 0.1, 0.46));
    } else {
      const fallen = mesh(G.cyl(10), M(stoneC), 0.3, TOP + 0.05, 0.38, 0.05, 0.3, 0.05);
      fallen.rotation.z = Math.PI / 2;
      fallen.rotation.y = 0.6;
      g.add(fallen);
    }
  } else if (poi.type === 'mill') {
    const c = poi.repaired ? 0xfbefd6 : 0xa89c88;
    g.add(mesh(G.cyl(10), M(c), 0, TOP + 0.3, 0, 0.13, 0.6, 0.13));
    g.add(mesh(G.cone(10), M(poi.repaired ? 0xe0503a : 0x6a5a48), 0, TOP + 0.7, 0, 0.17, 0.22, 0.17));
    const blades = new THREE.Group();
    const n = poi.repaired ? 4 : 2;
    for (let i = 0; i < n; i++) {
      const holder = new THREE.Group();
      holder.rotation.z = (i / 4) * Math.PI * 2 + (poi.repaired ? 0 : 0.4);
      holder.add(mesh(G.box(), M(poi.repaired ? 0xfff6e6 : 0x8a7a66), 0, 0.2, 0, 0.07, 0.4, 0.01));
      blades.add(holder);
    }
    blades.position.set(0, TOP + 0.55, 0.17);
    if (poi.repaired) blades.userData.dynamic = 'spin';
    g.add(blades);
  } else if (poi.type === 'bandits') {
    [[-0.3, -0.2], [0.3, -0.25], [0, 0.35]].forEach(([x, z], i) => {
      const tt = mesh(G.cone(4), M([0x6a4a36, 0x5a3e2e, 0x7a563c][i]), x, TOP + 0.14, z, 0.2, 0.28, 0.2);
      tt.rotation.y = i;
      g.add(tt);
    });
    g.add(mesh(G.cyl(8), M(0x4a3a2a), 0, TOP + 0.02, 0, 0.12, 0.04, 0.12));
    const fire = new THREE.Mesh(G.cone(6), FIRE_MAT);
    fire.position.set(0, TOP + 0.1, 0);
    fire.scale.set(0.07, 0.16, 0.07);
    fire.userData.dynamic = 'flicker';
    g.add(fire);
    const f = flag(0x1a1a1a, 0.9);
    f.position.set(-0.45, TOP, 0.25);
    g.add(f);
    const skull = iconSprite('skull', 0.4, '#8a2a1a');
    skull.position.set(0, TOP + 1.05, 0);
    g.add(skull);
    for (let i = 0; i < poi.strength; i++) {
      const fig = figure(0x333333);
      const a = i * 1.4 + 0.5;
      fig.position.set(Math.cos(a) * 0.5, TOP, Math.sin(a) * 0.5);
      g.add(fig);
    }
  }
}

// ---------- baking: collapse a tile's static meshes into one geometry ----------
const _inv = new THREE.Matrix4();
const _mtx = new THREE.Matrix4();
export function bake(root) {
  root.updateMatrixWorld(true);
  _inv.copy(root.matrixWorld).invert();
  const geos = [];
  const keep = [];
  const visit = (o, sway) => {
    if (o !== root && (o.userData.dynamic || o.isSprite)) { keep.push(o); return; }
    const sw = o.userData.sway != null ? o.userData.sway : sway;
    if (o.isMesh) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      g.applyMatrix4(_mtx.multiplyMatrices(_inv, o.matrixWorld));
      const n = g.attributes.position.count;
      const col = new Float32Array(n * 3);
      const sea = new Float32Array(n);
      const swa = new Float32Array(n * 2);
      const groups = g.groups.length ? g.groups : [{ start: 0, count: n, materialIndex: 0 }];
      for (const gr of groups) {
        const m = mats[gr.materialIndex] || mats[0];
        for (let i = gr.start; i < Math.min(n, gr.start + gr.count); i++) {
          col[i * 3] = m.color.r;
          col[i * 3 + 1] = m.color.g;
          col[i * 3 + 2] = m.color.b;
          sea[i] = m.userData.season || 0;
        }
      }
      if (sw != null) {
        const pos = g.attributes.position;
        for (let i = 0; i < n; i++) {
          swa[i * 2] = Math.max(0, pos.getY(i) - TOP);
          swa[i * 2 + 1] = sw;
        }
      }
      g.clearGroups();
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('aSeason', new THREE.BufferAttribute(sea, 1));
      g.setAttribute('aSway', new THREE.BufferAttribute(swa, 2));
      geos.push(g);
    }
    for (const c of o.children) visit(c, sw);
  };
  visit(root, null);
  const out = new THREE.Group();
  if (geos.length) {
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    const m = new THREE.Mesh(merged, WORLD_MAT);
    m.customDepthMaterial = WORLD_DEPTH;
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.baked = true;
    out.add(m);
  }
  for (const k of keep) out.attach(k);
  out.userData.dyn = keep.filter((k) => ['flap', 'spin', 'flicker', 'bob'].includes(k.userData.dynamic));
  return out;
}
