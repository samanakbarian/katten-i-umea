import * as THREE from "three";
import { radialSprite } from "./textures";
import { World } from "./city";
import { clamp, mulberry32, rand } from "./utils";

/**
 * Things worth chasing: strömming from the market stalls, saucers of cream, and
 * pigeons that have not yet noticed you.
 */

function fishGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const body = new THREE.SphereGeometry(0.16, 14, 10);
  body.scale(0.55, 0.85, 1.6);
  parts.push(body);
  const tail = new THREE.ConeGeometry(0.12, 0.18, 4);
  tail.rotateX(Math.PI / 2);
  tail.rotateZ(Math.PI / 4);
  tail.scale(0.55, 1.4, 1);
  tail.translate(0, 0, -0.31);
  parts.push(tail);
  const fin = new THREE.ConeGeometry(0.07, 0.12, 4);
  fin.rotateZ(Math.PI / 2);
  fin.scale(1, 0.35, 1);
  fin.translate(0, 0.12, 0.02);
  parts.push(fin);
  const g = mergeAll(parts);
  // A herring next to a cat: about a paw and a half long.
  g.scale(0.55, 0.55, 0.55);
  return g;
}

function mergeAll(parts: THREE.BufferGeometry[]) {
  // Small hand-rolled merge: these are tiny and share attribute layouts.
  const geo = new THREE.BufferGeometry();
  let vCount = 0;
  let iCount = 0;
  for (const p of parts) {
    vCount += p.attributes.position.count;
    iCount += p.index ? p.index.count : p.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const idx = new Uint32Array(iCount);
  let vo = 0;
  let io = 0;
  for (const p of parts) {
    const pp = p.attributes.position as THREE.BufferAttribute;
    const pn = p.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < pp.count; i++) {
      pos[(vo + i) * 3] = pp.getX(i);
      pos[(vo + i) * 3 + 1] = pp.getY(i);
      pos[(vo + i) * 3 + 2] = pp.getZ(i);
      nor[(vo + i) * 3] = pn.getX(i);
      nor[(vo + i) * 3 + 1] = pn.getY(i);
      nor[(vo + i) * 3 + 2] = pn.getZ(i);
    }
    if (p.index) {
      for (let i = 0; i < p.index.count; i++) idx[io + i] = p.index.getX(i) + vo;
      io += p.index.count;
    } else {
      for (let i = 0; i < pp.count; i++) idx[io + i] = i + vo;
      io += pp.count;
    }
    vo += pp.count;
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return geo;
}

/**
 * catPos is the cat's feet. Reach generously upward from its chest so a herring
 * bobbing at nose height still counts, without vacuuming up the floor below.
 */
function withinReach(item: THREE.Vector3, catPos: THREE.Vector3, radius = 0.8, up = 0.85) {
  const dx = item.x - catPos.x;
  const dz = item.z - catPos.z;
  if (dx * dx + dz * dz > radius * radius) return false;
  const dy = item.y - (catPos.y + 0.28);
  return dy < up && dy > -0.6;
}

interface Item {
  mesh: THREE.Object3D;
  glow: THREE.Sprite;
  home: THREE.Vector3;
  phase: number;
  taken: boolean;
  pop: number;
}

export class Pickups {
  readonly group = new THREE.Group();
  readonly fish: Item[] = [];
  readonly saucers: Item[] = [];
  fishTaken = 0;
  creamTaken = 0;

  private sparkle: THREE.Points;
  private sparkleLife: Float32Array;
  private sparkleVel: Float32Array;
  private sparkleIndex = 0;
  private readonly sparkleCount = 300;

  constructor(world: World, count = 30) {
    const geo = fishGeometry();
    const mat = new THREE.MeshStandardMaterial({
      color: "#dfe9f2",
      metalness: 0.85,
      roughness: 0.22,
      emissive: new THREE.Color("#7ad0ff"),
      emissiveIntensity: 0.65,
      envMapIntensity: 1.3,
    });
    const glowTex = radialSprite("rgba(150,225,255,1)", "rgba(40,120,255,0)");
    const glowMat = new THREE.SpriteMaterial({
      map: glowTex,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0.75,
      toneMapped: false,
    });

    const spots = world.fishSpots.slice(0, count);
    for (const spot of spots) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = false;
      mesh.position.copy(spot).add(new THREE.Vector3(0, 0.45, 0));
      const glow = new THREE.Sprite(glowMat);
      glow.scale.setScalar(0.9);
      glow.position.copy(mesh.position);
      this.group.add(mesh, glow);
      this.fish.push({
        mesh,
        glow,
        home: mesh.position.clone(),
        phase: Math.random() * 6.28,
        taken: false,
        pop: 0,
      });
    }

    // Saucers of cream, mostly on doorsteps and in courtyards.
    const rng = mulberry32(606);
    const saucerGeo = new THREE.CylinderGeometry(0.22, 0.16, 0.07, 16);
    const saucerMat = new THREE.MeshStandardMaterial({ color: "#f3f6fb", roughness: 0.3, metalness: 0.1 });
    const creamGeo = new THREE.CylinderGeometry(0.19, 0.19, 0.045, 16);
    const creamMat = new THREE.MeshStandardMaterial({
      color: "#fffaf0",
      roughness: 0.5,
      emissive: new THREE.Color("#ffe9c0"),
      emissiveIntensity: 0.5,
    });
    const creamGlow = new THREE.SpriteMaterial({
      map: radialSprite("rgba(255,230,180,1)", "rgba(255,160,60,0)"),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0.5,
      toneMapped: false,
    });
    for (let i = 0; i < 10; i++) {
      const src = world.fishSpots[count + i * 3] ?? new THREE.Vector3(rand(rng, -80, 80), 0, rand(rng, -80, 20));
      const g = new THREE.Group();
      const s = new THREE.Mesh(saucerGeo, saucerMat);
      const c = new THREE.Mesh(creamGeo, creamMat);
      c.position.y = 0.03;
      g.add(s, c);
      g.position.set(src.x, src.y + 0.04, src.z);
      const glow = new THREE.Sprite(creamGlow);
      glow.scale.setScalar(1.1);
      glow.position.copy(g.position).add(new THREE.Vector3(0, 0.1, 0));
      this.group.add(g, glow);
      this.saucers.push({ mesh: g, glow, home: g.position.clone(), phase: 0, taken: false, pop: 0 });
    }

    // Reusable sparkle burst pool for pickups.
    const sp = new Float32Array(this.sparkleCount * 3);
    const sc = new Float32Array(this.sparkleCount * 3);
    this.sparkleLife = new Float32Array(this.sparkleCount);
    this.sparkleVel = new Float32Array(this.sparkleCount * 3);
    for (let i = 0; i < this.sparkleCount; i++) sp[i * 3 + 1] = -999;
    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute("position", new THREE.BufferAttribute(sp, 3));
    sgeo.setAttribute("color", new THREE.BufferAttribute(sc, 3));
    this.sparkle = new THREE.Points(
      sgeo,
      new THREE.PointsMaterial({
        size: 0.09,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        map: radialSprite(),
        toneMapped: false,
      }),
    );
    this.sparkle.frustumCulled = false;
    this.group.add(this.sparkle);
  }

  /** Indices of what has already been collected, for the save file. */
  serialize() {
    const taken = (items: Item[]) =>
      items.reduce<number[]>((acc, item, i) => (item.taken ? (acc.push(i), acc) : acc), []);
    return { fish: taken(this.fish), cream: taken(this.saucers) };
  }

  restore(data: { fish: number[]; cream: number[] }) {
    const hide = (items: Item[], indices: number[]) => {
      for (const i of indices) {
        const item = items[i];
        if (!item) continue;
        item.taken = true;
        item.pop = 0;
        item.mesh.visible = false;
        item.glow.visible = false;
      }
    };
    hide(this.fish, data.fish ?? []);
    hide(this.saucers, data.cream ?? []);
    this.fishTaken = this.fish.filter((f) => f.taken).length;
    this.creamTaken = this.saucers.filter((s) => s.taken).length;
  }

  burst(at: THREE.Vector3, color: THREE.Color, n = 24) {
    const pos = this.sparkle.geometry.attributes.position as THREE.BufferAttribute;
    const col = this.sparkle.geometry.attributes.color as THREE.BufferAttribute;
    for (let i = 0; i < n; i++) {
      const k = this.sparkleIndex++ % this.sparkleCount;
      pos.setXYZ(k, at.x, at.y, at.z);
      col.setXYZ(k, color.r, color.g, color.b);
      this.sparkleLife[k] = 0.9;
      this.sparkleVel[k * 3] = (Math.random() - 0.5) * 3;
      this.sparkleVel[k * 3 + 1] = Math.random() * 3 + 0.5;
      this.sparkleVel[k * 3 + 2] = (Math.random() - 0.5) * 3;
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  /** Returns what the cat picked up this frame. */
  update(dt: number, time: number, catPos: THREE.Vector3) {
    const result = { fish: 0, cream: 0 };

    for (const f of this.fish) {
      if (f.taken) {
        if (f.pop > 0) {
          f.pop -= dt * 3;
          const s = clamp(f.pop, 0, 1);
          f.mesh.scale.setScalar(s * 1.8);
          f.mesh.position.y += dt * 2.4;
          f.glow.scale.setScalar(s * 3);
          f.glow.position.copy(f.mesh.position);
          if (f.pop <= 0) {
            f.mesh.visible = false;
            f.glow.visible = false;
          }
        }
        continue;
      }
      const bob = Math.sin(time * 1.8 + f.phase) * 0.09;
      f.mesh.position.set(f.home.x, f.home.y + bob, f.home.z);
      f.mesh.rotation.y = time * 1.1 + f.phase;
      f.mesh.rotation.z = Math.sin(time * 2.2 + f.phase) * 0.2;
      f.glow.position.copy(f.mesh.position);
      f.glow.scale.setScalar(0.85 + Math.sin(time * 3 + f.phase) * 0.1);
      if (withinReach(f.mesh.position, catPos)) {
        f.taken = true;
        f.pop = 1;
        this.fishTaken++;
        result.fish++;
        this.burst(f.mesh.position, new THREE.Color("#9fe4ff"), 26);
      }
    }

    for (const s of this.saucers) {
      if (s.taken) continue;
      s.glow.scale.setScalar(1 + Math.sin(time * 2.4) * 0.1);
      if (withinReach(s.mesh.position, catPos, 0.75)) {
        s.taken = true;
        s.mesh.visible = false;
        s.glow.visible = false;
        this.creamTaken++;
        result.cream++;
        this.burst(s.mesh.position, new THREE.Color("#ffe6b8"), 18);
      }
    }

    // Sparkles.
    const pos = this.sparkle.geometry.attributes.position as THREE.BufferAttribute;
    let dirty = false;
    for (let i = 0; i < this.sparkleCount; i++) {
      if (this.sparkleLife[i] <= 0) continue;
      this.sparkleLife[i] -= dt;
      this.sparkleVel[i * 3 + 1] -= 6 * dt;
      pos.setXYZ(
        i,
        pos.getX(i) + this.sparkleVel[i * 3] * dt,
        pos.getY(i) + this.sparkleVel[i * 3 + 1] * dt,
        pos.getZ(i) + this.sparkleVel[i * 3 + 2] * dt,
      );
      if (this.sparkleLife[i] <= 0) pos.setY(i, -999);
      dirty = true;
    }
    if (dirty) pos.needsUpdate = true;

    return result;
  }
}

interface Bird {
  group: THREE.Group;
  wings: THREE.Mesh[];
  home: THREE.Vector3;
  state: "idle" | "flee" | "return";
  t: number;
  vel: THREE.Vector3;
  peck: number;
  scared: boolean;
}

/** Pigeons on the market square, gulls on the ice. Both are extremely scareable. */
export class Birds {
  readonly group = new THREE.Group();
  private birds: Bird[] = [];

  constructor(world: World, count = 34) {
    const bodyMat = new THREE.MeshStandardMaterial({ color: "#8d94a3", roughness: 0.85 });
    const gullMat = new THREE.MeshStandardMaterial({ color: "#eef2f8", roughness: 0.8 });
    const beakMat = new THREE.MeshStandardMaterial({ color: "#e2a13d", roughness: 0.6 });
    const bodyGeo = new THREE.SphereGeometry(0.11, 10, 8);
    bodyGeo.scale(0.8, 0.85, 1.35);
    const headGeo = new THREE.SphereGeometry(0.06, 8, 7);
    const beakGeo = new THREE.ConeGeometry(0.022, 0.07, 6);
    beakGeo.rotateX(Math.PI / 2);
    const wingGeo = new THREE.BoxGeometry(0.19, 0.012, 0.12);
    wingGeo.translate(0.095, 0, 0);

    const rng = mulberry32(31337);
    // Ground-level perches only — a pigeon four floors up is a pigeon nobody
    // ever gets to chase.
    const spots = world.birdSpots.filter((s) => s.y < 3.2);
    // A flock loafing on Rådhustorget, right where the cat wakes up.
    const square: THREE.Vector3[] = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r = 6 + (i % 3) * 4;
      square.push(new THREE.Vector3(-26 + Math.cos(a) * r, 0, 14 + Math.sin(a) * r));
    }
    for (let i = 0; i < count; i++) {
      const spot =
        i < square.length ? square[i] : spots[Math.floor(rng() * spots.length)] ?? new THREE.Vector3();
      const gull = rng() > 0.6;
      const g = new THREE.Group();
      const body = new THREE.Mesh(bodyGeo, gull ? gullMat : bodyMat);
      body.castShadow = false;
      const head = new THREE.Mesh(headGeo, gull ? gullMat : bodyMat);
      head.position.set(0, 0.09, 0.1);
      const beak = new THREE.Mesh(beakGeo, beakMat);
      beak.position.set(0, 0.08, 0.17);
      const wings: THREE.Mesh[] = [];
      for (const s of [-1, 1]) {
        const w = new THREE.Mesh(wingGeo, gull ? gullMat : bodyMat);
        w.scale.x = s;
        w.position.set(s * 0.04, 0.03, 0);
        g.add(w);
        wings.push(w);
      }
      g.add(body, head, beak);
      g.position.copy(spot).add(new THREE.Vector3(rand(rng, -1.5, 1.5), 0.11, rand(rng, -1.5, 1.5)));
      g.rotation.y = rng() * Math.PI * 2;
      g.scale.setScalar(gull ? 1.35 : 1);
      this.group.add(g);
      this.birds.push({
        group: g,
        wings,
        home: g.position.clone(),
        state: "idle",
        t: rng() * 4,
        vel: new THREE.Vector3(),
        peck: rng() * 3,
        scared: false,
      });
    }
  }

  /** Returns how many birds were startled this frame. */
  update(
    dt: number,
    time: number,
    catPos: THREE.Vector3,
    meowed: boolean,
    dogPos?: THREE.Vector3,
  ) {
    let startled = 0;
    for (const b of this.birds) {
      // A dog counts as a reason to leave, and from further off than a cat.
      const dDog = dogPos ? b.group.position.distanceTo(dogPos) : Infinity;
      const d = Math.min(b.group.position.distanceTo(catPos), dDog * 0.65);

      if (b.state === "idle") {
        b.peck -= dt;
        if (b.peck < 0) b.peck = 1.2 + Math.random() * 3;
        // Head-bob peck.
        b.group.rotation.x = Math.sin(Math.max(0, b.peck - 1) * 9) * 0.25;
        b.group.position.y = b.home.y + Math.sin(time * 2 + b.t) * 0.01;
        for (const w of b.wings) w.rotation.z = -0.1;

        if (d < 3.2 || (meowed && d < 14)) {
          b.state = "flee";
          b.t = 0;
          const from = dogPos && dDog < b.group.position.distanceTo(catPos) ? dogPos : catPos;
          const away = b.group.position.clone().sub(from).setY(0);
          if (away.lengthSq() < 0.01) away.set(1, 0, 0);
          away.normalize();
          b.vel.set(away.x * 5.5, 6.5, away.z * 5.5);
          if (!b.scared) {
            b.scared = true;
            startled++;
          }
        }
      } else if (b.state === "flee") {
        b.t += dt;
        b.group.position.addScaledVector(b.vel, dt);
        b.vel.y -= 3.4 * dt;
        b.vel.y = Math.max(b.vel.y, 1.6);
        b.group.rotation.y = Math.atan2(b.vel.x, b.vel.z);
        b.group.rotation.x = -0.25;
        const flap = Math.sin(time * 26 + b.t * 4) * 1.05;
        b.wings[0].rotation.z = flap;
        b.wings[1].rotation.z = -flap;
        if (b.t > 3.5) {
          b.state = "return";
          b.t = 0;
          // Reappear somewhere else entirely; it is a big city.
          b.home.set(
            catPos.x + (Math.random() - 0.5) * 90,
            0.11,
            catPos.z + (Math.random() - 0.5) * 90,
          );
        }
      } else {
        b.t += dt;
        if (b.t > 2.5) {
          b.group.position.copy(b.home);
          b.state = "idle";
          b.scared = false;
          b.group.rotation.set(0, Math.random() * 6.28, 0);
        }
      }
    }
    return startled;
  }
}
