// Axial hex coordinates (pointy side along +z, matching THREE.CylinderGeometry with 6 segments)
export const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
export const SIZE = 1;
export const MAP_RADIUS = 8;

export const key = (q, r) => `${q},${r}`;
export const parse = (k) => k.split(',').map(Number);
export const neighborKeys = (k) => {
  const [q, r] = parse(k);
  return DIRS.map(([dq, dr]) => key(q + dq, r + dr));
};
export const distQR = (q1, r1, q2, r2) =>
  (Math.abs(q1 - q2) + Math.abs(r1 - r2) + Math.abs(q1 + r1 - q2 - r2)) / 2;
export const dist = (a, b) => {
  const [q1, r1] = parse(a);
  const [q2, r2] = parse(b);
  return distQR(q1, r1, q2, r2);
};
export const distOrigin = (k) => dist(k, '0,0');
export const inMap = (k) => distOrigin(k) <= MAP_RADIUS;

export function toWorld(k) {
  const [q, r] = parse(k);
  return { x: SIZE * Math.sqrt(3) * (q + r / 2), z: SIZE * 1.5 * r };
}

export function allCells(radius = MAP_RADIUS) {
  const out = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      if (distQR(q, r, 0, 0) <= radius) out.push(key(q, r));
    }
  }
  return out;
}

// Deterministic RNG seeded from a string
export function seededRng(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
