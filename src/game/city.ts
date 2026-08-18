import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  ColliderGrid,
  Rng,
  box,
  clamp,
  cylinder,
  makeCollider,
  mulberry32,
  paint,
  pick,
  rand,
  randInt,
  scaleUV,
} from "./utils";
import {
  birchTexture,
  cobbleTexture,
  facadeTextures,
  glassTextures,
  groundTexture,
  radialSprite,
  roadTexture,
  snowTexture,
  waterNormalTexture,
} from "./textures";

/**
 * A compressed, affectionate model of central Umeå in January.
 *
 *   z < 40    the city centre on the north bank
 *   z 40-115  Umeälven, frozen at the edges with an open channel mid-stream
 *   z > 115   Teg on the south bank
 *
 * Everything is one unit = one metre, and the cat is 60 cm long.
 */

export interface Landmark {
  name: string;
  blurb: string;
  position: THREE.Vector3;
  radius: number;
  found: boolean;
}

export const RIVER = { north: 40, south: 115, iceN: 62, iceS: 93 };
export const BOUNDS = { minX: -180, maxX: 200, minZ: -170, maxZ: 205 };

const FACADE_COLORS = [
  "#e8d9b8", // Umeå ochre
  "#d9c9a8",
  "#c9a98d",
  "#b8705f", // falu-ish red plaster
  "#8f9aa6",
  "#e3e6ea",
  "#cbb89a",
  "#a8845e",
  "#9fb0b8",
  "#e0c7a1",
];

export class World {
  readonly group = new THREE.Group();
  readonly colliders = new ColliderGrid();
  readonly landmarks: Landmark[] = [];
  readonly fishSpots: THREE.Vector3[] = [];
  readonly birdSpots: THREE.Vector3[] = [];
  readonly lampLights: THREE.Vector3[] = [];
  readonly spawn = new THREE.Vector3(-26, 0, 12);

  private waterMat!: THREE.MeshStandardMaterial;
  private flagMeshes: { mesh: THREE.Mesh; phase: number }[] = [];

  constructor(private quality: "low" | "high") {
    const rng = mulberry32(20250109);
    this.buildGround(rng);
    this.buildRiver();
    this.buildStreets();
    const buckets = new GeometryBuckets();
    this.buildBlocks(rng, buckets);
    this.buildLandmarks(buckets);
    this.buildProps(rng, buckets);
    this.buildTrees(rng);
    buckets.commit(this.group, this.quality);
    this.placeCollectibles(rng);
  }

  // ---------------------------------------------------------------- terrain

  /** Ground is flat except for the ramp down to the frozen river. */
  groundHeightAt(x: number, z: number): number {
    void x;
    const bankDrop = -0.7;
    const ramp = 5;
    if (z > RIVER.north - ramp && z < RIVER.south + ramp) {
      if (z < RIVER.north) return bankDrop * ((z - (RIVER.north - ramp)) / ramp);
      if (z > RIVER.south) return bankDrop * (1 - (z - RIVER.south) / ramp);
      return bankDrop;
    }
    return 0;
  }

  isOverOpenWater(x: number, z: number) {
    void x;
    return z > RIVER.iceN && z < RIVER.iceS;
  }

  isOverIce(x: number, z: number) {
    void x;
    return z > RIVER.north - 1 && z < RIVER.south + 1;
  }

  private buildGround(rng: Rng) {
    const tex = groundTexture();
    tex.repeat.set(90, 90);
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      color: 0xffffff,
      roughness: 0.92,
      metalness: 0.0,
    });
    const geo = new THREE.PlaneGeometry(900, 900, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const ground = new THREE.Mesh(geo, mat);
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    this.group.add(ground);

    // Snow drifts so the flat plane is not perfectly flat to the eye.
    const drift: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 240; i++) {
      const x = rand(rng, BOUNDS.minX, BOUNDS.maxX);
      const z = rand(rng, BOUNDS.minZ, BOUNDS.maxZ);
      if (z > RIVER.north - 8 && z < RIVER.south + 8) continue;
      const g = new THREE.SphereGeometry(rand(rng, 1.2, 3.6), 8, 5, 0, Math.PI * 2, 0, Math.PI / 2);
      g.scale(1, rand(rng, 0.12, 0.3), rand(rng, 0.6, 1.4));
      g.translate(x, -0.05, z);
      paint(g, 0xffffff);
      drift.push(g);
    }
    const driftMesh = new THREE.Mesh(
      mergeGeometries(drift, false)!,
      new THREE.MeshStandardMaterial({
        map: snowTexture(),
        vertexColors: true,
        roughness: 0.85,
        color: 0xf2f6ff,
      }),
    );
    driftMesh.receiveShadow = true;
    this.group.add(driftMesh);
  }

  private buildRiver() {
    const normal = waterNormalTexture();
    normal.repeat.set(30, 12);
    this.waterMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color("#0a1526"),
      roughness: 0.15,
      metalness: 0.8,
      normalMap: normal,
      normalScale: new THREE.Vector2(0.35, 0.35),
      envMapIntensity: 1.0,
    });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(900, RIVER.south - RIVER.north, 1, 1), this.waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, -0.72, (RIVER.north + RIVER.south) / 2);
    this.group.add(water);

    // Ice shelves reaching out from both banks, with a ragged edge.
    const iceMat = new THREE.MeshStandardMaterial({
      map: snowTexture(9),
      color: 0xdfe9fa,
      roughness: 0.42,
      metalness: 0.12,
      envMapIntensity: 0.9,
      vertexColors: true,
    });
    const parts: THREE.BufferGeometry[] = [];
    const rng = mulberry32(4242);
    for (const [z0, z1] of [
      [RIVER.north - 0.5, RIVER.iceN],
      [RIVER.iceS, RIVER.south + 0.5],
    ]) {
      for (let x = -460; x < 460; x += 12) {
        const jitter = rand(rng, -3.5, 3.5);
        const near = z0 === RIVER.iceS ? z0 - jitter : z0;
        const far = z0 === RIVER.iceS ? z1 : z1 + jitter;
        const g = new THREE.BoxGeometry(12.4, 0.18, Math.max(2, far - near));
        g.translate(x + 6, -0.62, (near + far) / 2);
        scaleUV(g, 2, 2);
        paint(g, 0xffffff);
        parts.push(g);
      }
    }
    const ice = new THREE.Mesh(mergeGeometries(parts, false)!, iceMat);
    ice.receiveShadow = true;
    this.group.add(ice);
  }

  private buildStreets() {
    const road = roadTexture();
    road.repeat.set(1, 1);
    const roadMat = new THREE.MeshStandardMaterial({ map: road, roughness: 0.85, color: 0xdadfe8 });
    const parts: THREE.BufferGeometry[] = [];

    const addRoad = (x: number, z: number, w: number, d: number) => {
      const g = new THREE.PlaneGeometry(w, d);
      g.rotateX(-Math.PI / 2);
      g.translate(x, 0.015, z);
      scaleUV(g, w / 8, d / 8);
      paint(g, 0xffffff);
      parts.push(g);
    };

    for (const z of STREETS_EW) addRoad(0, z, 340, 11);
    for (const x of STREETS_NS) addRoad(x, -60, 11, 210);
    // Strandgatan along the quay and the riverside promenade.
    addRoad(0, 32, 340, 9);
    // Teg, on the south bank.
    addRoad(0, 132, 340, 11);
    addRoad(-60, 160, 10, 70);
    addRoad(30, 160, 10, 70);
    // The road out to the university.
    addRoad(120, -40, 200, 11);

    const mesh = new THREE.Mesh(mergeGeometries(parts, false)!, roadMat);
    mesh.receiveShadow = true;
    this.group.add(mesh);

    // Rådhustorget — the cobbled market square.
    const cob = cobbleTexture();
    cob.repeat.set(10, 8);
    const sq = new THREE.Mesh(
      new THREE.PlaneGeometry(46, 34),
      new THREE.MeshStandardMaterial({ map: cob, roughness: 0.8 }),
    );
    sq.rotation.x = -Math.PI / 2;
    sq.position.set(-26, 0.02, 12);
    sq.receiveShadow = true;
    this.group.add(sq);
  }

  // ---------------------------------------------------------------- blocks

  private buildBlocks(rng: Rng, b: GeometryBuckets) {
    for (let ix = 0; ix < STREETS_NS.length - 1; ix++) {
      for (let iz = 0; iz < STREETS_EW.length - 1; iz++) {
        const x0 = STREETS_NS[ix] + 7;
        const x1 = STREETS_NS[ix + 1] - 7;
        const z0 = STREETS_EW[iz] + 7;
        const z1 = STREETS_EW[iz + 1] - 7;
        if (x1 - x0 < 8 || z1 - z0 < 8) continue;
        if (RESERVED.some((r) => x0 < r.x1 && x1 > r.x0 && z0 < r.z1 && z1 > r.z0)) continue;
        this.buildBlock(rng, b, x0, z0, x1, z1);
      }
    }

    // Teg: lower, sparser wooden houses across the river.
    for (let i = 0; i < 26; i++) {
      const x = rand(rng, -150, 150);
      const z = rand(rng, 124, 190);
      if (Math.abs(x + 60) < 9 || Math.abs(x - 30) < 9) continue;
      if (Math.abs(z - 132) < 10) continue;
      this.house(b, rng, x, z, rand(rng, 8, 13), rand(rng, 7, 11));
    }
  }

  /** Fill a city block with a perimeter of connected houses around a courtyard. */
  private buildBlock(rng: Rng, b: GeometryBuckets, x0: number, z0: number, x1: number, z1: number) {
    const depth = 12;
    const runs: [number, number, number, number][] = [
      [x0, z0, x1, z0 + depth],
      [x0, z1 - depth, x1, z1],
      [x0, z0 + depth, x0 + depth, z1 - depth],
      [x1 - depth, z0 + depth, x1, z1 - depth],
    ];
    for (const [ax0, az0, ax1, az1] of runs) {
      const along = ax1 - ax0 > az1 - az0;
      const length = along ? ax1 - ax0 : az1 - az0;
      if (length < 6) continue;
      let t = 0;
      while (t < length - 4) {
        const seg = Math.min(rand(rng, 11, 19), length - t);
        const floors = randInt(rng, 3, 6);
        const h = 3.6 + floors * 3.3;
        const cx = along ? ax0 + t + seg / 2 : (ax0 + ax1) / 2;
        const cz = along ? (az0 + az1) / 2 : az0 + t + seg / 2;
        const w = along ? seg : ax1 - ax0;
        const d = along ? az1 - az0 : seg;
        this.apartment(b, rng, cx, cz, w, d, h);
        t += seg;
      }
    }
    // Something small in the courtyard: a shed, a sandbox, a snowman.
    if (rng() > 0.45) {
      const cx = (x0 + x1) / 2 + rand(rng, -4, 4);
      const cz = (z0 + z1) / 2 + rand(rng, -4, 4);
      b.plain.push(box(4, 2.4, 3, cx, 0, cz, "#7d4a3a"));
      b.snow.push(box(4.4, 0.3, 3.4, cx, 2.4, cz, 0xffffff));
      this.colliders.add(makeCollider(cx, cz, 4, 2.7, 3));
      this.birdSpots.push(new THREE.Vector3(cx, 2.7, cz));
    }
  }

  private apartment(
    b: GeometryBuckets,
    rng: Rng,
    x: number,
    z: number,
    w: number,
    d: number,
    h: number,
  ) {
    const color = pick(rng, FACADE_COLORS);
    b.facade.push(walls(w, h, d, x, z, color));
    // Snow-capped roof with a small parapet the cat can perch on.
    b.snow.push(roofSlab(w, d, x, h, z));
    b.snow.push(box(w, 0.5, 0.4, x, h, z + d / 2 - 0.2, 0xffffff));
    b.snow.push(box(w, 0.5, 0.4, x, h, z - d / 2 + 0.2, 0xffffff));
    b.snow.push(box(0.4, 0.5, d, x + w / 2 - 0.2, h, z, 0xffffff));
    b.snow.push(box(0.4, 0.5, d, x - w / 2 + 0.2, h, z, 0xffffff));
    // Chimney and a ventilation box or two.
    const chx = x + rand(rng, -w / 3, w / 3);
    const chz = z + rand(rng, -d / 3, d / 3);
    b.plain.push(box(1.1, 1.8, 1.1, chx, h, chz, "#7a6a63"));
    b.snow.push(box(1.3, 0.25, 1.3, chx, h + 1.8, chz, 0xffffff));
    this.colliders.add(makeCollider(chx, chz, 1.1, 2.05, 1.1, h));
    if (rng() > 0.6) {
      const vx = x + rand(rng, -w / 3, w / 3);
      const vz = z + rand(rng, -d / 3, d / 3);
      b.metal.push(box(1.6, 1.0, 1.2, vx, h, vz, "#6f7780"));
      this.colliders.add(makeCollider(vx, vz, 1.6, 1.0, 1.2, h));
    }
    // Ground-floor shop with a warm lit sign.
    if (rng() > 0.45) {
      const sw = Math.min(w * 0.55, 6);
      b.glow.push(box(sw, 0.55, 0.25, x, 3.4, z + d / 2 + 0.15, pick(rng, SIGN_COLORS)));
      b.plain.push(box(sw + 1.2, 0.35, 1.1, x, 3.0, z + d / 2 + 0.5, "#2c3038"));
      b.snow.push(box(sw + 1.2, 0.18, 1.1, x, 3.35, z + d / 2 + 0.5, 0xffffff));
    }
    this.colliders.add(makeCollider(x, z, w, h + 0.5, d));
    this.birdSpots.push(new THREE.Vector3(x, h + 0.6, z));
    if (rng() > 0.75) this.fishSpots.push(new THREE.Vector3(x, h + 1.1, z));
  }

  /** A little wooden Teg house with a pitched roof. */
  private house(b: GeometryBuckets, rng: Rng, x: number, z: number, w: number, d: number) {
    const h = rand(rng, 3.2, 5.2);
    const color = pick(rng, ["#a8342c", "#d9c9a8", "#e8d9b8", "#5d6f5a", "#f0ece2"]);
    b.facade.push(walls(w, h, d, x, z, color));
    const rise = 2.2;
    b.snow.push(gable(w, d, rise, x, h, z));
    this.colliders.add(makeCollider(x, z, w, h + rise * 0.6, d));
    b.plain.push(box(0.8, 1.4, 0.8, x + w / 4, h + rise * 0.5, z, "#6d5b52"));
    // Porch light.
    b.glow.push(box(0.3, 0.3, 0.3, x, 2.4, z + d / 2 + 0.2, "#ffd08a"));
    this.lampLights.push(new THREE.Vector3(x, 2.4, z + d / 2 + 0.3));
    if (rng() > 0.7) this.fishSpots.push(new THREE.Vector3(x, h + rise + 0.4, z));
  }

  // ------------------------------------------------------------- landmarks

  private landmark(name: string, blurb: string, x: number, y: number, z: number, radius: number) {
    this.landmarks.push({
      name,
      blurb,
      position: new THREE.Vector3(x, y, z),
      radius,
      found: false,
    });
  }

  private buildLandmarks(b: GeometryBuckets) {
    this.buildRadhuset(b);
    this.buildVaven(b);
    this.buildSara(b);
    this.buildChurch(b);
    this.buildOpera(b);
    this.buildUniversity(b);
    this.buildBridge(b, -60, "Kyrkbron");
    this.buildBridge(b, 44, "Tegsbron");
  }

  /** Rådhuset, 1890: ochre plaster, dark roof, clock tower over the river. */
  private buildRadhuset(b: GeometryBuckets) {
    const x = -26;
    const z = 30;
    const w = 34;
    const d = 15;
    const h = 12.5;
    b.facade.push(walls(w, h, d, x, z, "#e6c98a"));
    b.plain.push(gable(w, d, 3.4, x, h, z, "#3a3f47"));
    b.snow.push(gable(w * 0.99, d * 1.02, 3.2, x, h + 0.3, z, 0xffffff));
    this.colliders.add(makeCollider(x, z, w, h + 2.4, d));

    // Central tower.
    const tw = 8;
    b.facade.push(walls(tw, h + 7, tw, x, z, "#e6c98a"));
    this.colliders.add(makeCollider(x, z, tw, h + 7, tw));
    b.plain.push(box(tw + 1, 0.6, tw + 1, x, h + 7, z, "#3a3f47"));
    const spire = new THREE.ConeGeometry(tw * 0.78, 7, 4);
    spire.rotateY(Math.PI / 4);
    spire.translate(x, h + 11.1, z);
    paint(spire, "#2f343b");
    b.plain.push(spire);
    this.colliders.add(makeCollider(x, z, tw + 1, 1.2, tw + 1, h + 7));
    // Clock faces.
    for (const [dx, dz, ry] of [
      [0, tw / 2 + 0.1, 0],
      [0, -tw / 2 - 0.1, Math.PI],
      [tw / 2 + 0.1, 0, Math.PI / 2],
      [-tw / 2 - 0.1, 0, -Math.PI / 2],
    ] as const) {
      const c = new THREE.CircleGeometry(1.5, 20);
      c.rotateY(ry);
      c.translate(x + dx, h + 3.6, z + dz);
      paint(c, "#ffe9b8");
      b.glow.push(c);
    }
    // Steps down to the river.
    for (let i = 0; i < 5; i++) {
      b.snow.push(box(12, 0.3, 1.2, x, i * 0.3, z + d / 2 + 1 + i * 1.2, 0xffffff));
      this.colliders.add(makeCollider(x, z + d / 2 + 1 + i * 1.2, 12, i * 0.3 + 0.3, 1.2));
    }
    this.landmark(
      "Rådhuset",
      "Umeå city hall from 1890, ochre plaster on the riverbank. Excellent tower for a cat.",
      x,
      h + 8,
      z,
      22,
    );
    this.fishSpots.push(new THREE.Vector3(x, h + 8.2, z));
    this.birdSpots.push(new THREE.Vector3(x + 6, h + 3, z));
  }

  /** Väven: the culture house, all glass and stacked slabs on the quay. */
  private buildVaven(b: GeometryBuckets) {
    const x = 16;
    const z = 26;
    const levels = [
      { w: 40, d: 20, h: 6, off: 0 },
      { w: 36, d: 22, h: 6, off: 2 },
      { w: 42, d: 18, h: 6, off: -3 },
      { w: 34, d: 20, h: 6, off: 1 },
    ];
    let y = 0;
    for (const l of levels) {
      b.glass.push(walls(l.w, l.h, l.d, x + l.off, z, "#dfe9f5", 4.5));
      b.plain.push(box(l.w + 1.2, 0.7, l.d + 1.2, x + l.off, y + l.h - 0.35, z, "#f0f2f5"));
      this.colliders.add(makeCollider(x + l.off, z, l.w, l.h, l.d, y, false));
      y += l.h;
    }
    b.snow.push(roofSlab(34, 20, x + 1, y, z));
    this.colliders.add(makeCollider(x + 1, z, 34, 0.4, 20, y, false));
    this.landmark(
      "Väven",
      "The culture house on the quay — library, cinema and a very warm foyer.",
      x,
      y,
      z,
      24,
    );
    this.fishSpots.push(new THREE.Vector3(x + 1, y + 1.1, z));
  }

  /** Sara Kulturhus: twenty storeys of cross-laminated timber. The big climb. */
  private buildSara(b: GeometryBuckets) {
    const x = 62;
    const z = 6;
    let y = 0;
    const stack = [
      { w: 26, d: 24, h: 14 },
      { w: 20, d: 20, h: 16 },
      { w: 17, d: 18, h: 16 },
      { w: 15, d: 16, h: 14 },
      { w: 13, d: 14, h: 12 },
    ];
    let i = 0;
    for (const s of stack) {
      const ox = i % 2 ? 1.5 : -1.5;
      b.wood.push(walls(s.w, s.h, s.d, x + ox, z, i % 2 ? "#c99a5e" : "#b8874d", 3.6));
      // Glazed band between the timber volumes.
      b.glass.push(walls(s.w + 0.4, 2.4, s.d + 0.4, x + ox, z, "#cfe0f2", 4));
      const bandGeo = b.glass[b.glass.length - 1];
      bandGeo.translate(0, s.h - 2.6, 0);
      this.colliders.add(makeCollider(x + ox, z, s.w, s.h, s.d, y));
      b.plain.push(box(s.w + 1, 0.5, s.d + 1, x + ox, y + s.h - 0.25, z, "#8c6a44"));
      y += s.h;
      i++;
    }
    b.snow.push(roofSlab(13, 14, x - 1.5, y, z));
    this.colliders.add(makeCollider(x - 1.5, z, 13, 0.4, 14, y));
    // Aviation light on top.
    b.glow.push(box(0.16, 0.16, 0.16, x - 5, y + 0.5, z - 5, "#ff4d4d"));
    this.landmark(
      "Sara Kulturhus",
      "One of the tallest timber buildings in the world. Twenty floors. You climbed it.",
      x,
      y,
      z,
      26,
    );
    this.fishSpots.push(new THREE.Vector3(x - 1.5, y + 1.2, z));
  }

  /** Umeå stads kyrka, white with a copper-green spire. */
  private buildChurch(b: GeometryBuckets) {
    const x = -96;
    const z = 24;
    b.facade.push(walls(16, 11, 30, x, z, "#f4f1ea"));
    b.plain.push(gable(16, 30, 4, x, 11, z, "#4a4f56"));
    b.snow.push(gable(15.8, 30.4, 3.8, x, 11.3, z, 0xffffff));
    this.colliders.add(makeCollider(x, z, 16, 14, 30));

    b.facade.push(walls(9, 22, 9, x, z - 18, "#f4f1ea"));
    this.colliders.add(makeCollider(x, z - 18, 9, 22, 9));
    const spire = new THREE.ConeGeometry(6.4, 16, 4);
    spire.rotateY(Math.PI / 4);
    spire.translate(x, 30, z - 18);
    paint(spire, "#3f7a63");
    b.plain.push(spire);
    b.glow.push(cylinder(0.25, 0.25, 3, x, 38, z - 18, "#ffe6b0", 6));
    this.landmark(
      "Umeå stads kyrka",
      "The city church by Kyrkbron. The bells are loud; the ledges are excellent.",
      x,
      24,
      z - 10,
      22,
    );
    this.fishSpots.push(new THREE.Vector3(x, 22.3, z - 18));
  }

  private buildOpera(b: GeometryBuckets) {
    const x = -4;
    const z = -20;
    b.facade.push(walls(30, 16, 22, x, z, "#8f2f3c"));
    b.glass.push(walls(20, 9, 12, x, z + 12, "#cfe0f2", 4));
    this.colliders.add(makeCollider(x, z, 30, 16, 22));
    this.colliders.add(makeCollider(x, z + 12, 20, 9, 12, 0, false));
    b.snow.push(roofSlab(30, 22, x, 16, z));
    b.snow.push(roofSlab(20, 12, x, 9, z + 12));
    b.glow.push(box(9, 0.9, 0.3, x, 10.2, z + 18.1, "#ffcf6b"));
    this.landmark(
      "Norrlandsoperan",
      "Opera, jazz and dance in the middle of town. Somebody is rehearsing brass.",
      x,
      16,
      z,
      20,
    );
    this.fishSpots.push(new THREE.Vector3(x, 16.6, z));
  }

  private buildUniversity(b: GeometryBuckets) {
    const cx = 150;
    const cz = -58;
    // Universitetsdammen, frozen over.
    const pond = new THREE.Mesh(
      new THREE.CircleGeometry(26, 40),
      new THREE.MeshStandardMaterial({
        color: 0xbcd2ec,
        roughness: 0.18,
        metalness: 0.5,
        envMapIntensity: 1.1,
      }),
    );
    pond.rotation.x = -Math.PI / 2;
    pond.position.set(cx, 0.03, cz);
    this.group.add(pond);

    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.4;
      const x = cx + Math.cos(a) * 42;
      const z = cz + Math.sin(a) * 42;
      const h = 10 + (i % 3) * 3.5;
      b.facade.push(walls(22, h, 16, x, z, i % 2 ? "#a8574a" : "#d9c9a8"));
      b.snow.push(roofSlab(22, 16, x, h, z));
      this.colliders.add(makeCollider(x, z, 22, h + 0.4, 16));
      if (i === 0) this.fishSpots.push(new THREE.Vector3(x, h + 1.1, z));
    }

    // Bildmuseet: a dark timber box looking over the water.
    const bx = cx - 34;
    const bz = cz + 26;
    b.wood.push(walls(20, 18, 14, bx, bz, "#4a3b30", 4));
    b.glass.push(walls(20.4, 5, 14.4, bx, bz, "#cfe0f2", 4.5));
    b.glass[b.glass.length - 1].translate(0, 12, 0);
    b.snow.push(roofSlab(20, 14, bx, 18, bz));
    this.colliders.add(makeCollider(bx, bz, 20, 18.4, 14));
    this.landmark(
      "Bildmuseet",
      "Contemporary art on the Konstnärligt campus, seven floors of quiet.",
      bx,
      18,
      bz,
      20,
    );
    this.landmark(
      "Universitetsdammen",
      "The campus pond. Frozen solid, and the ducks have opinions about that.",
      cx,
      1,
      cz,
      28,
    );
    this.fishSpots.push(new THREE.Vector3(bx, 19.2, bz));
    this.fishSpots.push(new THREE.Vector3(cx, 0.6, cz));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      this.birdSpots.push(new THREE.Vector3(cx + Math.cos(a) * 20, 0.2, cz + Math.sin(a) * 20));
    }
  }

  /** A stepped arch bridge the cat can run over — or under, on the ice. */
  private buildBridge(b: GeometryBuckets, x: number, name: string) {
    const zN = RIVER.north - 22;
    const zS = RIVER.south + 22;
    const steps = 44;
    const peak = 9.5;
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      const z = zN + (zS - zN) * t;
      const y = Math.sin(t * Math.PI) * peak;
      const len = (zS - zN) / steps + 0.6;
      b.plain.push(box(13, 0.6, len, x, y, z, "#5b5f68"));
      b.snow.push(box(12.4, 0.16, len, x, y + 0.6, z, 0xffffff));
      this.colliders.add(makeCollider(x, z, 13, 0.76, len, y));
      // Railings.
      b.metal.push(box(0.25, 1.3, len, x - 6.4, y + 0.6, z, "#2f3238"));
      b.metal.push(box(0.25, 1.3, len, x + 6.4, y + 0.6, z, "#2f3238"));
      if (i % 6 === 0 && y > 1) {
        b.plain.push(cylinder(0.4, 0.7, y, x - 5.6, 0, z, "#4d515a", 8));
        b.plain.push(cylinder(0.4, 0.7, y, x + 5.6, 0, z, "#4d515a", 8));
      }
      if (i % 8 === 4) {
        this.lamppost(b, x - 6.9, z);
        this.lamppost(b, x + 6.9, z);
      }
    }
    this.landmark(name, `${name} over Umeälven. Mind the ice below.`, x, peak + 2, 77, 26);
    this.fishSpots.push(new THREE.Vector3(x, peak + 1.4, 77));
  }

  // ----------------------------------------------------------------- props

  private lamppost(b: GeometryBuckets, x: number, z: number, y = 0) {
    b.metal.push(cylinder(0.09, 0.14, 5.2, x, y, z, "#23262b", 6));
    b.metal.push(box(1.2, 0.16, 0.16, x, y + 5.1, z, "#23262b"));
    b.glow.push(box(0.7, 0.28, 0.34, x + 0.45, y + 4.95, z, "#ffdca8"));
    this.lampLights.push(new THREE.Vector3(x + 0.45, y + 4.9, z));
    this.colliders.add(makeCollider(x, z, 0.3, 5.2, 0.3, y));
  }

  private buildProps(rng: Rng, b: GeometryBuckets) {
    // Street lighting down every street.
    for (const z of STREETS_EW) {
      for (let x = -160; x <= 160; x += 26) {
        if (RESERVED.some((r) => x > r.x0 - 4 && x < r.x1 + 4 && z > r.z0 - 4 && z < r.z1 + 4)) continue;
        this.lamppost(b, x + 6, z + 6.2);
      }
    }
    for (const x of STREETS_NS) {
      for (let z = -150; z <= 30; z += 26) {
        this.lamppost(b, x + 6.2, z + 6);
      }
    }
    for (let x = -150; x <= 150; x += 22) this.lamppost(b, x, 36.5);

    // Parked cars with snow on the roof.
    const carColors = ["#1f2a3a", "#8c1f27", "#e9eaec", "#2f4f3f", "#4a4f57", "#6d7f92"];
    for (let i = 0; i < 90; i++) {
      const onEW = rng() > 0.5;
      const x = onEW ? rand(rng, -155, 155) : pick(rng, STREETS_NS) + (rng() > 0.5 ? 4.4 : -4.4);
      const z = onEW ? pick(rng, STREETS_EW) + (rng() > 0.5 ? 4.4 : -4.4) : rand(rng, -150, 30);
      if (Math.abs(x) > 165 || z > 34) continue;
      this.car(b, rng, x, z, onEW ? Math.PI / 2 : 0, pick(rng, carColors));
    }

    // Rådhustorget: the winter market, and the fish stall the cat has plans for.
    const sq = { x: -26, z: 12 };
    for (let i = 0; i < 8; i++) {
      const sx = sq.x - 16 + (i % 4) * 10.5;
      const sz = sq.z - 7 + Math.floor(i / 4) * 13;
      b.plain.push(box(4.4, 2.2, 3.2, sx, 0, sz, "#3d4a5c"));
      b.snow.push(box(5.2, 0.35, 4, sx, 2.2, sz, 0xffffff));
      b.plain.push(box(5.2, 0.2, 4, sx, 2.15, sz, i % 2 ? "#b03a3a" : "#2f6f4f"));
      b.glow.push(box(3.6, 0.14, 0.14, sx, 2.05, sz + 1.7, "#ffd9a0"));
      this.colliders.add(makeCollider(sx, sz, 4.4, 2.55, 3.2));
      this.birdSpots.push(new THREE.Vector3(sx, 2.6, sz));
      if (i === 2 || i === 5) this.fishSpots.push(new THREE.Vector3(sx, 3.1, sz));
    }
    // Strings of advent lights across the square.
    for (let i = 0; i < 5; i++) {
      const z = sq.z - 12 + i * 6;
      for (let j = 0; j < 22; j++) {
        const t = j / 21;
        const x = sq.x - 20 + t * 40;
        const y = 6.5 - Math.sin(t * Math.PI) * 1.6;
        b.glow.push(box(0.085, 0.085, 0.085, x, y, z, j % 3 === 0 ? "#ffb960" : "#ffd9a8"));
      }
    }

    // Benches, bins and bus shelters.
    for (let i = 0; i < 60; i++) {
      const x = rand(rng, -150, 150);
      const z = rand(rng, -145, 34);
      if (RESERVED.some((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1)) continue;
      const rot = rng() > 0.5 ? Math.PI / 2 : 0;
      b.wood.push(box(2.4, 0.12, 0.6, x, 0.45, z, "#6b4a33", rot));
      b.wood.push(box(2.4, 0.5, 0.12, x, 0.55, z - 0.25, "#6b4a33", rot));
      b.metal.push(box(0.12, 0.45, 0.5, x - 1, 0, z, "#2b2e34", rot));
      b.metal.push(box(0.12, 0.45, 0.5, x + 1, 0, z, "#2b2e34", rot));
      b.snow.push(box(2.5, 0.09, 0.66, x, 0.57, z, 0xffffff, rot));
      this.colliders.add(makeCollider(x, z, 2.4, 0.6, 0.7));
      this.birdSpots.push(new THREE.Vector3(x, 0.7, z));
    }

    // Snowmen, because children have been busy.
    for (let i = 0; i < 14; i++) {
      const x = rand(rng, -150, 150);
      const z = rand(rng, -145, 30);
      if (RESERVED.some((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1)) continue;
      b.snow.push(sphere(0.75, x, 0.65, z, 0xffffff));
      b.snow.push(sphere(0.52, x, 1.65, z, 0xffffff));
      b.snow.push(sphere(0.36, x, 2.35, z, 0xffffff));
      b.plain.push(box(0.7, 0.35, 0.7, x, 2.6, z, "#2b2e34"));
      b.glow.push(cylinder(0.05, 0.12, 0.35, x, 2.35, z, "#e8703a", 6));
      this.colliders.add(makeCollider(x, z, 1.5, 2.4, 1.5));
    }

    // A pair of Ultra city buses at the stop.
    this.bus(b, -60, 6.2, Math.PI / 2);
    this.bus(b, 24, -21.5, Math.PI / 2);
  }

  private car(b: GeometryBuckets, rng: Rng, x: number, z: number, rot: number, color: string) {
    b.plain.push(box(4.3, 0.75, 1.85, x, 0.35, z, color, rot));
    b.glass.push(box(2.3, 0.72, 1.75, x, 1.1, z, "#1a2430", rot));
    b.snow.push(box(2.4, 0.14, 1.8, x, 1.82, z, 0xffffff, rot));
    b.snow.push(box(4.36, 0.1, 1.9, x, 1.1, z, 0xffffff, rot));
    b.metal.push(box(4.4, 0.36, 1.9, x, 0.1, z, "#1a1c20", rot));
    b.glow.push(box(0.2, 0.18, 1.5, x + Math.cos(rot) * 2.1, 0.75, z - Math.sin(rot) * 2.1, "#b03030", rot));
    this.colliders.add(makeCollider(x, z, rot ? 1.9 : 4.4, 1.9, rot ? 4.4 : 1.9));
    if (rng() > 0.85) this.fishSpots.push(new THREE.Vector3(x, 2.2, z));
    this.birdSpots.push(new THREE.Vector3(x, 2.0, z));
  }

  private bus(b: GeometryBuckets, x: number, z: number, rot: number) {
    b.plain.push(box(12, 2.6, 2.6, x, 0.5, z, "#1f4f8f", rot));
    b.glass.push(box(11.4, 1.1, 2.66, x, 1.7, z, "#101a26", rot));
    b.glow.push(box(2.4, 0.4, 0.06, x - 4, 2.5, z + 1.34, "#ffcf6b", rot));
    b.metal.push(box(12, 0.5, 2.7, x, 0.1, z, "#15171a", rot));
    b.snow.push(box(11.8, 0.12, 2.6, x, 3.1, z, 0xffffff, rot));
    this.colliders.add(makeCollider(x, z, rot ? 2.7 : 12, 3.2, rot ? 12 : 2.7));
    this.fishSpots.push(new THREE.Vector3(x + 2, 3.6, z));
  }

  // ----------------------------------------------------------------- trees

  /** Umeå is Björkarnas stad — the city of birches. Planted after the 1888 fire. */
  private buildTrees(rng: Rng) {
    const trunkParts: THREE.BufferGeometry[] = [];
    const trunk = new THREE.CylinderGeometry(0.13, 0.26, 9, 8, 1, true);
    trunk.translate(0, 4.5, 0);
    scaleUV(trunk, 1, 3);
    paint(trunk, 0xffffff);
    trunkParts.push(trunk);
    const branchRng = mulberry32(808);
    for (let i = 0; i < 14; i++) {
      const t = 0.35 + (i / 14) * 0.62;
      const a = branchRng() * Math.PI * 2;
      const len = rand(branchRng, 1.4, 3.4);
      const g = new THREE.CylinderGeometry(0.015, 0.06, len, 5, 1, true);
      g.translate(0, len / 2, 0);
      g.rotateZ(rand(branchRng, 0.55, 1.15));
      g.rotateY(a);
      g.translate(0, t * 9, 0);
      paint(g, 0xf0f4ff);
      trunkParts.push(g);
      // Snow resting in the crook of the branch.
      const s = new THREE.SphereGeometry(0.16, 6, 4);
      s.scale(1.8, 0.5, 1.8);
      s.translate(Math.cos(a) * len * 0.5, t * 9 + len * 0.42, Math.sin(a) * len * 0.5);
      paint(s, 0xffffff);
      trunkParts.push(s);
    }
    const geo = mergeGeometries(trunkParts, false)!;
    const bark = birchTexture();
    const mat = new THREE.MeshStandardMaterial({
      map: bark,
      vertexColors: true,
      roughness: 0.85,
      side: THREE.DoubleSide,
    });

    const spots: THREE.Vector3[] = [];
    // The birch alley down Rådhusesplanaden and along the quay.
    for (let z = -150; z < 28; z += 7) {
      spots.push(new THREE.Vector3(-12 - 6.6, 0, z));
      spots.push(new THREE.Vector3(-12 + 6.6, 0, z));
    }
    for (let x = -150; x < 150; x += 8) spots.push(new THREE.Vector3(x, 0, 38.5));
    // Broparken and the parks either side.
    for (let i = 0; i < 260; i++) {
      const x = rand(rng, BOUNDS.minX + 10, BOUNDS.maxX - 10);
      const z = rand(rng, BOUNDS.minZ + 10, BOUNDS.maxZ - 10);
      if (z > RIVER.north - 4 && z < RIVER.south + 4) continue;
      if (RESERVED.some((r) => x > r.x0 - 3 && x < r.x1 + 3 && z > r.z0 - 3 && z < r.z1 + 3)) continue;
      if (STREETS_NS.some((s) => Math.abs(x - s) < 7) && z < 34 && z > -150) continue;
      if (STREETS_EW.some((s) => Math.abs(z - s) < 7) && x > -160 && x < 160) continue;
      spots.push(new THREE.Vector3(x, 0, z));
    }
    // A dense birch forest ringing the map, so the edge feels like Västerbotten.
    for (let i = 0; i < 420; i++) {
      const edge = randInt(rng, 0, 3);
      const t = rng();
      let x = 0;
      let z = 0;
      if (edge === 0) {
        x = BOUNDS.minX + rand(rng, -26, 10);
        z = BOUNDS.minZ + t * 375;
      } else if (edge === 1) {
        x = BOUNDS.maxX + rand(rng, -10, 26);
        z = BOUNDS.minZ + t * 375;
      } else if (edge === 2) {
        x = BOUNDS.minX + t * 380;
        z = BOUNDS.minZ + rand(rng, -26, 8);
      } else {
        x = BOUNDS.minX + t * 380;
        z = BOUNDS.maxZ + rand(rng, -8, 26);
      }
      if (z > RIVER.north - 4 && z < RIVER.south + 4) continue;
      spots.push(new THREE.Vector3(x, 0, z));
    }

    const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
    mesh.castShadow = this.quality === "high";
    mesh.receiveShadow = false;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    spots.forEach((sp, i) => {
      const scale = rand(rng, 0.72, 1.5);
      p.copy(sp);
      q.setFromEuler(new THREE.Euler(rand(rng, -0.03, 0.03), rng() * Math.PI * 2, rand(rng, -0.03, 0.03)));
      s.set(scale, scale * rand(rng, 0.85, 1.25), scale);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
      this.colliders.add(makeCollider(sp.x, sp.z, 0.5, 9 * scale, 0.5, 0, true));
      if (i % 23 === 0) this.birdSpots.push(new THREE.Vector3(sp.x, 6 * scale, sp.z));
      if (i % 97 === 0) this.fishSpots.push(new THREE.Vector3(sp.x, 7.4 * scale, sp.z));
    });
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
  }

  // ----------------------------------------------------------- collectibles

  private placeCollectibles(rng: Rng) {
    // Hand-placed hero spots first, then whatever the city offered up.
    const hero = [
      // A first herring a few metres from the spawn, in plain sight.
      new THREE.Vector3(-26, 0, 17),
      new THREE.Vector3(-60, 9.9, 77),
      new THREE.Vector3(0, 0, -60),
      new THREE.Vector3(-12, 0, -110),
      new THREE.Vector3(100, 0, -40),
      new THREE.Vector3(-120, 0, 150),
      new THREE.Vector3(20, -0.6, 50),
      new THREE.Vector3(-90, -0.6, 100),
    ];
    this.fishSpots.unshift(...hero);
    // Shuffle the tail so a replay is not the same route.
    for (let i = this.fishSpots.length - 1; i > hero.length; i--) {
      const j = hero.length + Math.floor(rng() * (i - hero.length));
      [this.fishSpots[i], this.fishSpots[j]] = [this.fishSpots[j], this.fishSpots[i]];
    }
  }

  // ---------------------------------------------------------------- update

  update(dt: number, time: number) {
    const n = this.waterMat.normalMap;
    if (n) {
      n.offset.x = time * 0.012;
      n.offset.y = time * 0.03;
    }
    for (const f of this.flagMeshes) f.mesh.rotation.z = Math.sin(time * 2 + f.phase) * 0.08;
    void dt;
  }
}

// --------------------------------------------------------------- internals

const STREETS_EW = [22, 0, -22, -46, -70, -96, -124, -152];
const STREETS_NS = [-150, -120, -90, -60, -30, 0, 30, 60, 90, 120];

/** Blocks kept clear for the landmarks and the square. */
const RESERVED = [
  { x0: -50, z0: -2, x1: -2, z1: 40 }, // Rådhustorget + Rådhuset
  { x0: -6, z0: 12, x1: 42, z1: 40 }, // Väven
  { x0: 44, z0: -10, x1: 80, z1: 22 }, // Sara Kulturhus
  { x0: -112, z0: 2, x1: -80, z1: 42 }, // Church
  { x0: -22, z0: -34, x1: 14, z1: -6 }, // Norrlandsoperan
  { x0: 88, z0: -110, x1: 200, z1: -6 }, // University campus
  { x0: -70, z0: 10, x1: -50, z1: 40 }, // Kyrkbron approach
  { x0: 34, z0: 10, x1: 54, z1: 40 }, // Tegsbron approach
];

const SIGN_COLORS = ["#ff8a3d", "#63d2ff", "#ffd166", "#ff5f8a", "#8affc1"];

/** Four wall planes with window-scaled UVs, based at y = 0. */
function walls(
  w: number,
  h: number,
  d: number,
  x: number,
  z: number,
  color: THREE.ColorRepresentation,
  bay = 3.2,
) {
  const parts: THREE.BufferGeometry[] = [];
  const uh = Math.max(1, Math.round(h / bay));
  const uw = Math.max(1, Math.round(w / bay));
  const ud = Math.max(1, Math.round(d / bay));

  const front = new THREE.PlaneGeometry(w, h);
  scaleUV(front, uw, uh);
  front.translate(0, h / 2, d / 2);
  parts.push(front);

  const back = new THREE.PlaneGeometry(w, h);
  scaleUV(back, uw, uh);
  back.rotateY(Math.PI);
  back.translate(0, h / 2, -d / 2);
  parts.push(back);

  const right = new THREE.PlaneGeometry(d, h);
  scaleUV(right, ud, uh);
  right.rotateY(Math.PI / 2);
  right.translate(w / 2, h / 2, 0);
  parts.push(right);

  const left = new THREE.PlaneGeometry(d, h);
  scaleUV(left, ud, uh);
  left.rotateY(-Math.PI / 2);
  left.translate(-w / 2, h / 2, 0);
  parts.push(left);

  const geo = mergeGeometries(parts, false)!;
  geo.translate(x, 0, z);
  paint(geo, color);
  return geo;
}

function roofSlab(w: number, d: number, x: number, y: number, z: number) {
  const g = new THREE.BoxGeometry(w, 0.4, d);
  scaleUV(g, Math.max(1, w / 4), Math.max(1, d / 4));
  g.translate(x, y + 0.2, z);
  paint(g, 0xffffff);
  return g;
}

function gable(
  w: number,
  d: number,
  rise: number,
  x: number,
  y: number,
  z: number,
  color: THREE.ColorRepresentation = 0xffffff,
) {
  const half = w / 2;
  const slope = Math.sqrt(half * half + rise * rise);
  const angle = Math.atan2(rise, half);
  const parts: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const g = new THREE.BoxGeometry(slope + 0.3, 0.3, d + 0.5);
    scaleUV(g, slope / 3, d / 3);
    g.rotateZ(s * angle);
    g.translate((s * -half) / 2, rise / 2, 0);
    parts.push(g);
  }
  // Gable ends.
  for (const s of [-1, 1]) {
    const tri = new THREE.BufferGeometry();
    const v = new Float32Array([-half, 0, 0, half, 0, 0, 0, rise, 0]);
    tri.setAttribute("position", new THREE.BufferAttribute(v, 3));
    tri.setAttribute("normal", new THREE.BufferAttribute(new Float32Array([0, 0, s, 0, 0, s, 0, 0, s]), 3));
    tri.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0.5, 1]), 2));
    // Indexed, so it can merge with the box geometries beside it.
    tri.setIndex([0, 1, 2]);
    if (s < 0) tri.rotateY(Math.PI);
    tri.translate(0, 0, (s * (d + 0.5)) / 2);
    parts.push(tri);
  }
  const geo = mergeGeometries(parts, false)!;
  geo.translate(x, y, z);
  paint(geo, color);
  return geo;
}

function sphere(r: number, x: number, y: number, z: number, color: THREE.ColorRepresentation) {
  const g = new THREE.SphereGeometry(r, 10, 8);
  g.translate(x, y, z);
  paint(g, color);
  return g;
}

/**
 * Every static surface in the city funnels into one of these buckets and comes
 * out the other side as a single draw call.
 */
class GeometryBuckets {
  facade: THREE.BufferGeometry[] = [];
  glass: THREE.BufferGeometry[] = [];
  snow: THREE.BufferGeometry[] = [];
  plain: THREE.BufferGeometry[] = [];
  wood: THREE.BufferGeometry[] = [];
  metal: THREE.BufferGeometry[] = [];
  glow: THREE.BufferGeometry[] = [];

  commit(parent: THREE.Group, quality: "low" | "high") {
    const facadeTex = facadeTextures();
    const glassTex = glassTextures();

    const add = (
      geos: THREE.BufferGeometry[],
      mat: THREE.Material,
      castShadow: boolean,
      receiveShadow: boolean,
    ) => {
      if (!geos.length) return;
      const merged = mergeGeometries(geos, false);
      if (!merged) return;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = castShadow && quality === "high";
      mesh.receiveShadow = receiveShadow;
      parent.add(mesh);
      geos.forEach((g) => g.dispose());
    };

    add(
      this.facade,
      new THREE.MeshStandardMaterial({
        map: facadeTex.map,
        roughnessMap: facadeTex.roughness,
        emissiveMap: facadeTex.emissive,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 1.35,
        vertexColors: true,
        roughness: 1,
        metalness: 0.02,
        side: THREE.DoubleSide,
      }),
      true,
      true,
    );

    add(
      this.glass,
      new THREE.MeshStandardMaterial({
        map: glassTex.map,
        roughnessMap: glassTex.roughness,
        emissiveMap: glassTex.emissive,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 0.85,
        vertexColors: true,
        roughness: 1,
        metalness: 0.55,
        envMapIntensity: 1.2,
        side: THREE.DoubleSide,
      }),
      true,
      true,
    );

    add(
      this.snow,
      new THREE.MeshStandardMaterial({
        map: snowTexture(),
        vertexColors: true,
        color: 0xf4f8ff,
        roughness: 0.8,
        metalness: 0.0,
      }),
      true,
      true,
    );

    add(
      this.plain,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.05 }),
      true,
      true,
    );

    add(
      this.wood,
      new THREE.MeshStandardMaterial({
        map: facadeTex.map,
        vertexColors: true,
        roughness: 0.72,
        metalness: 0.0,
      }),
      true,
      true,
    );

    add(
      this.metal,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.85, envMapIntensity: 1.1 }),
      true,
      true,
    );

    // Lights and signs are unlit so bloom can take them.
    add(this.glow, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), false, false);
  }
}

/** Soft pools of light under the street lamps — cheap, and they sell the mood. */
export function lampGlow(positions: THREE.Vector3[]) {
  const group = new THREE.Group();
  const tex = radialSprite("rgba(255,214,150,1)", "rgba(255,150,60,0)");

  // Halo around each lamp head.
  const spriteMat = new THREE.SpriteMaterial({
    map: tex,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    opacity: 0.22,
    toneMapped: false,
  });
  for (const p of positions) {
    const s = new THREE.Sprite(spriteMat);
    s.position.copy(p);
    s.scale.setScalar(2.6);
    group.add(s);
  }

  // Pool of light on the snow, merged into a single additive plane mesh.
  const pools: THREE.BufferGeometry[] = [];
  for (const p of positions) {
    if (p.y > 8) continue; // lamps high up on the bridge do not reach the ground
    const g = new THREE.PlaneGeometry(8, 8);
    g.rotateX(-Math.PI / 2);
    g.translate(p.x, clamp(p.y - 4.8, -0.6, 0.08) + 0.07, p.z);
    pools.push(g);
  }
  if (pools.length) {
    const mesh = new THREE.Mesh(
      mergeGeometries(pools, false)!,
      new THREE.MeshBasicMaterial({
        map: tex,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0.14,
        toneMapped: false,
      }),
    );
    mesh.renderOrder = 5;
    group.add(mesh);
  }
  return group;
}
