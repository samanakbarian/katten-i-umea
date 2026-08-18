import * as THREE from "three";

/** Deterministic PRNG so Umeå looks the same on every visit. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = () => number;

export const rand = (rng: Rng, min: number, max: number) => min + rng() * (max - min);
export const randInt = (rng: Rng, min: number, max: number) => Math.floor(rand(rng, min, max + 1));
export const pick = <T,>(rng: Rng, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length) % arr.length];

export const clamp = (v: number, min: number, max: number) => (v < min ? min : v > max ? max : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Frame-rate independent exponential smoothing. */
export const damp = (a: number, b: number, lambda: number, dt: number) =>
  lerp(a, b, 1 - Math.exp(-lambda * dt));

export function shortestAngle(a: number, b: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Axis aligned box collider. Buildings, benches, tree trunks — all of it. */
export interface Collider {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  /** Cats can scramble up rough surfaces (walls, bark) but not glass or ice. */
  climbable: boolean;
}

export function makeCollider(
  cx: number,
  cz: number,
  w: number,
  h: number,
  d: number,
  y = 0,
  climbable = true,
): Collider {
  return {
    minX: cx - w / 2,
    maxX: cx + w / 2,
    minY: y,
    maxY: y + h,
    minZ: cz - d / 2,
    maxZ: cz + d / 2,
    climbable,
  };
}

/**
 * Uniform grid broadphase. The city has a few thousand colliders and the cat
 * only ever touches a handful of them per frame.
 */
export class ColliderGrid {
  private cell = 16;
  private buckets = new Map<number, Collider[]>();
  readonly all: Collider[] = [];

  private key(ix: number, iz: number) {
    return (ix + 4096) * 8192 + (iz + 4096);
  }

  add(c: Collider) {
    this.all.push(c);
    const x0 = Math.floor(c.minX / this.cell);
    const x1 = Math.floor(c.maxX / this.cell);
    const z0 = Math.floor(c.minZ / this.cell);
    const z1 = Math.floor(c.maxZ / this.cell);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = this.key(ix, iz);
        let b = this.buckets.get(k);
        if (!b) {
          b = [];
          this.buckets.set(k, b);
        }
        b.push(c);
      }
    }
  }

  query(minX: number, minZ: number, maxX: number, maxZ: number, out: Collider[]): Collider[] {
    out.length = 0;
    const x0 = Math.floor(minX / this.cell);
    const x1 = Math.floor(maxX / this.cell);
    const z0 = Math.floor(minZ / this.cell);
    const z1 = Math.floor(maxZ / this.cell);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const b = this.buckets.get(this.key(ix, iz));
        if (!b) continue;
        for (const c of b) if (!out.includes(c)) out.push(c);
      }
    }
    return out;
  }
}

/** Multiply a geometry's UVs so a tiling texture keeps a constant world scale. */
export function scaleUV(geo: THREE.BufferGeometry, su: number, sv: number) {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  }
  uv.needsUpdate = true;
  return geo;
}

/** Paint a whole geometry with one colour so many buildings can share a material. */
export function paint(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation) {
  const c = new THREE.Color(color);
  const count = geo.attributes.position.count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Box geometry with its base at y=0, ready to be merged. */
export function box(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  color: THREE.ColorRepresentation,
  rotY = 0,
) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  if (rotY) g.rotateY(rotY);
  g.translate(x, y, z);
  paint(g, color);
  return g;
}

export function cylinder(
  rTop: number,
  rBottom: number,
  h: number,
  x: number,
  y: number,
  z: number,
  color: THREE.ColorRepresentation,
  segments = 10,
) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, segments);
  g.translate(x, y + h / 2, z);
  paint(g, color);
  return g;
}
