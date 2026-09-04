import * as THREE from "three";
import { World } from "./city";
import { clamp, damp, mulberry32, rand } from "./utils";
import { PathTrail } from "./trail";
import { radialSprite } from "./textures";

/**
 * Små söta apor. Twelve of them are hiding around Umeå, and a cat who finds one
 * acquires a friend for the rest of the night: rescued monkeys trail along
 * behind in a little conga line.
 *
 * Every monkey is the same procedural rig — big head, bigger eyes, a tail that
 * curls — sharing one set of geometries and materials so the whole troop costs
 * about as much as one of them.
 */

interface MonkeyRig {
  group: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  arms: THREE.Group[];
  legs: THREE.Group[];
  ears: THREE.Mesh[];
  tail: THREE.Group[];
  lids: THREE.Mesh[];
}

interface Monkey extends MonkeyRig {
  home: THREE.Vector3;
  /** Waiting to be found, or following the cat. */
  rescued: boolean;
  phase: number;
  scratch: number;
  scratchTimer: number;
  blink: number;
  blinkTimer: number;
  look: number;
  lookTimer: number;
  hop: number;
  /** Smoothed world position while in the parade. */
  pos: THREE.Vector3;
  facing: number;
  /** Place in the line, fixed once rescued. */
  paradeIndex: number;
}

/** How far apart the monkeys sit along the cat's path. */
const SPACING = 0.55;

const tmpPrev = new THREE.Vector3();

/** Shared geometry + material set, built once. */
function buildParts() {
  const fur = new THREE.MeshStandardMaterial({ color: "#9c6a41", roughness: 0.9 });
  const furDark = new THREE.MeshStandardMaterial({ color: "#5f3c22", roughness: 0.9 });
  const face = new THREE.MeshStandardMaterial({ color: "#f2d7b0", roughness: 0.8 });
  const eyeWhite = new THREE.MeshStandardMaterial({
    color: "#2a1c12",
    roughness: 0.25,
    emissive: new THREE.Color("#3a2a1a"),
    emissiveIntensity: 0.3,
  });
  const shine = new THREE.MeshBasicMaterial({ color: "#ffffff" });

  return {
    mats: { fur, furDark, face, eyeWhite, shine },
    geos: {
      belly: new THREE.SphereGeometry(0.062, 14, 12),
      skull: new THREE.SphereGeometry(0.058, 16, 14),
      face: new THREE.SphereGeometry(0.044, 14, 12),
      brow: new THREE.SphereGeometry(0.03, 10, 8),
      ear: new THREE.SphereGeometry(0.026, 10, 8),
      eye: new THREE.SphereGeometry(0.014, 10, 8),
      shine: new THREE.SphereGeometry(0.005, 6, 5),
      lid: new THREE.SphereGeometry(0.016, 8, 6),
      limb: new THREE.CapsuleGeometry(0.017, 0.05, 3, 7),
      hand: new THREE.SphereGeometry(0.021, 8, 7),
      tail: new THREE.CapsuleGeometry(0.011, 0.03, 3, 6),
    },
  };
}

type Parts = ReturnType<typeof buildParts>;

function buildMonkey(parts: Parts): MonkeyRig {
  const { mats, geos } = parts;
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  // --- torso, sitting up ----------------------------------------------------
  const torso = new THREE.Mesh(geos.belly, mats.fur);
  torso.position.y = 0.072;
  torso.scale.set(1, 1.08, 0.92);
  torso.castShadow = true;
  body.add(torso);

  const tummy = new THREE.Mesh(geos.face, mats.face);
  tummy.position.set(0, 0.062, 0.035);
  tummy.scale.set(0.92, 1.05, 0.6);
  body.add(tummy);

  // --- head -----------------------------------------------------------------
  const head = new THREE.Group();
  head.position.y = 0.163;
  body.add(head);

  const skull = new THREE.Mesh(geos.skull, mats.fur);
  skull.castShadow = true;
  head.add(skull);

  // Flat pale face disc, and a brow ridge over it.
  const faceDisc = new THREE.Mesh(geos.face, mats.face);
  faceDisc.position.set(0, -0.004, 0.031);
  faceDisc.scale.set(1.02, 1.06, 0.55);
  head.add(faceDisc);

  const brow = new THREE.Mesh(geos.brow, mats.fur);
  brow.position.set(0, 0.032, 0.03);
  brow.scale.set(1.5, 0.55, 0.9);
  head.add(brow);

  const muzzle = new THREE.Mesh(geos.brow, mats.face);
  muzzle.position.set(0, -0.026, 0.046);
  muzzle.scale.set(1.15, 0.7, 0.7);
  head.add(muzzle);

  const ears: THREE.Mesh[] = [];
  const lids: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    // Big round ears, sticking straight out sideways.
    const ear = new THREE.Mesh(geos.ear, mats.fur);
    ear.position.set(side * 0.057, 0.004, -0.002);
    ear.scale.set(0.45, 1, 1);
    ear.castShadow = true;
    head.add(ear);
    ears.push(ear);
    const inner = new THREE.Mesh(geos.ear, mats.face);
    inner.position.set(side * 0.064, 0.004, 0);
    inner.scale.set(0.22, 0.68, 0.68);
    head.add(inner);

    const eye = new THREE.Mesh(geos.eye, mats.eyeWhite);
    eye.position.set(side * 0.021, 0.006, 0.055);
    head.add(eye);
    const glint = new THREE.Mesh(geos.shine, mats.shine);
    glint.position.set(side * 0.021 + 0.005, 0.011, 0.066);
    head.add(glint);

    const lid = new THREE.Mesh(geos.lid, mats.fur);
    lid.position.set(side * 0.021, 0.026, 0.05);
    lid.scale.set(1, 0.12, 0.8);
    head.add(lid);
    lids.push(lid);
  }

  // --- arms and legs --------------------------------------------------------
  const arms: THREE.Group[] = [];
  const legs: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(side * 0.052, 0.105, 0.012);
    arm.rotation.z = side * 0.5;
    const limb = new THREE.Mesh(geos.limb, mats.fur);
    limb.position.y = -0.042;
    limb.castShadow = true;
    arm.add(limb);
    const hand = new THREE.Mesh(geos.hand, mats.face);
    hand.position.y = -0.082;
    hand.scale.set(1, 0.85, 1);
    arm.add(hand);
    body.add(arm);
    arms.push(arm);

    // Legs, folded forward as though sitting on a kerb.
    const leg = new THREE.Group();
    leg.position.set(side * 0.036, 0.045, 0.01);
    leg.rotation.x = -1.15;
    const shin = new THREE.Mesh(geos.limb, mats.fur);
    shin.position.y = -0.04;
    shin.castShadow = true;
    leg.add(shin);
    const foot = new THREE.Mesh(geos.hand, mats.face);
    foot.position.set(0, -0.078, 0.012);
    foot.scale.set(1, 0.7, 1.3);
    leg.add(foot);
    body.add(leg);
    legs.push(leg);
  }

  // --- tail, curling up behind ---------------------------------------------
  const tail: THREE.Group[] = [];
  let parent: THREE.Object3D = body;
  for (let i = 0; i < 7; i++) {
    const seg = new THREE.Group();
    seg.position.set(0, i === 0 ? 0.05 : 0, i === 0 ? -0.05 : -0.03);
    const mesh = new THREE.Mesh(geos.tail, i > 5 ? mats.face : mats.furDark);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.z = -0.015;
    seg.add(mesh);
    parent.add(seg);
    parent = seg;
    tail.push(seg);
  }

  return { group, body, head, arms, legs, ears, tail, lids };
}

export class Monkeys {
  readonly group = new THREE.Group();
  private monkeys: Monkey[] = [];
  private parade: Monkey[] = [];
  private beacons: THREE.Sprite[] = [];
  private trail = new PathTrail();
  rescued = 0;
  readonly total: number;

  constructor(world: World, count = 12) {
    const parts = buildParts();
    const rng = mulberry32(9001);

    // Hand-placed so every monkey is somewhere worth going.
    const spots: THREE.Vector3[] = [
      new THREE.Vector3(-26, 0, 4), // Rådhustorget, by the market stalls
      new THREE.Vector3(-26, 22.6, 30), // the Rådhuset tower gallery
      new THREE.Vector3(17, 24.4, 26), // roof of Väven
      new THREE.Vector3(-96, 22, 6), // the church tower
      new THREE.Vector3(-60, 10.1, 62), // Kyrkbron, over the ice
      new THREE.Vector3(44, 4.5, 106), // Tegsbron, south end
      new THREE.Vector3(-4, 16.4, -20), // roof of Norrlandsoperan
      new THREE.Vector3(116, 18.4, -32), // Bildmuseet
      new THREE.Vector3(150, -0.2, -58), // out on the frozen pond
      new THREE.Vector3(-12, 0, -124), // the birch alley, far end
      new THREE.Vector3(-120, 0, 150), // a garden in Teg
      new THREE.Vector3(62, 72.4, 6), // the very top of Sara Kulturhus
    ];
    while (spots.length < count) {
      spots.push(
        new THREE.Vector3(rand(rng, -140, 140), 0, rand(rng, -140, 20)),
      );
    }

    // A soft warm halo so a monkey reads from across a square.
    const beaconMat = new THREE.SpriteMaterial({
      map: radialSprite("rgba(255,208,140,1)", "rgba(255,140,40,0)"),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0.42,
      toneMapped: false,
    });

    for (let i = 0; i < count; i++) {
      const rig = buildMonkey(parts);
      const spot = spots[i];
      rig.group.position.copy(spot);
      rig.group.rotation.y = rng() * Math.PI * 2;
      this.group.add(rig.group);

      const beacon = new THREE.Sprite(beaconMat);
      beacon.position.copy(spot).add(new THREE.Vector3(0, 0.16, 0));
      beacon.scale.setScalar(1.1);
      this.group.add(beacon);
      this.beacons.push(beacon);

      this.monkeys.push({
        ...rig,
        home: spot.clone(),
        rescued: false,
        phase: rng() * 6.28,
        scratch: 0,
        scratchTimer: rand(rng, 1, 6),
        blink: 0,
        blinkTimer: rand(rng, 1, 5),
        look: 0,
        lookTimer: rand(rng, 1, 4),
        hop: 0,
        pos: spot.clone(),
        facing: rig.group.rotation.y,
        paradeIndex: 0,
      });
    }
    this.total = this.monkeys.length;
    void world;
  }

  serialize() {
    return this.monkeys.reduce<number[]>((acc, m, i) => (m.rescued ? (acc.push(i), acc) : acc), []);
  }

  restore(indices: number[], catPos: THREE.Vector3) {
    for (const i of indices ?? []) {
      const m = this.monkeys[i];
      if (!m || m.rescued) continue;
      m.rescued = true;
      m.paradeIndex = this.parade.length;
      m.pos.copy(catPos);
      m.group.position.copy(catPos);
      this.parade.push(m);
      this.beacons[i].visible = false;
      this.rescued++;
    }
  }

  /** Distance of each parade monkey from the cat, for diagnostics. */
  paradeDebug(catPos: THREE.Vector3) {
    return this.parade.map((m) => Math.round(m.pos.distanceTo(catPos) * 100) / 100);
  }

  /** Where the un-rescued monkeys are, for the minimap. */
  get remaining() {
    return this.monkeys.filter((m) => !m.rescued).map((m) => ({ x: m.home.x, z: m.home.z }));
  }


  /**
   * Returns how many monkeys joined the parade this frame. catPos is the cat's
   * feet; catYaw is where it is facing.
   */
  update(dt: number, time: number, catPos: THREE.Vector3, catYaw: number) {
    let found = 0;
    if (this.parade.length) this.trail.push(catPos, (this.parade.length + 2) * SPACING + 2);

    for (let i = 0; i < this.monkeys.length; i++) {
      const m = this.monkeys[i];

      // --- idle flourishes, rescued or not ---------------------------------
      m.blinkTimer -= dt;
      if (m.blinkTimer <= 0) {
        m.blinkTimer = 1.5 + Math.random() * 4;
        m.blink = 1;
      }
      m.blink = Math.max(0, m.blink - dt * 6);
      const lidDrop = Math.sin(m.blink * Math.PI);
      for (const lid of m.lids) {
        lid.position.y = 0.026 - lidDrop * 0.021;
        lid.scale.y = 0.12 + lidDrop * 0.95;
      }

      m.scratchTimer -= dt;
      if (m.scratchTimer <= 0) {
        m.scratchTimer = 2.5 + Math.random() * 7;
        m.scratch = 1;
      }
      m.scratch = Math.max(0, m.scratch - dt * 1.1);
      // One arm scratches an ear; the other stays put.
      const scratchSwing = m.scratch > 0 ? Math.sin(m.scratch * 24) * 0.5 : 0;
      m.arms[0].rotation.z = damp(m.arms[0].rotation.z, -0.5 - m.scratch * 1.5, 9, dt);
      m.arms[0].rotation.x = damp(m.arms[0].rotation.x, scratchSwing, 14, dt);
      m.arms[1].rotation.z = damp(m.arms[1].rotation.z, 0.5, 9, dt);

      // Ears flick.
      const flick = Math.sin(time * 1.7 + m.phase) > 0.985 ? 1 : 0;
      for (let e = 0; e < m.ears.length; e++) {
        m.ears[e].scale.x = damp(m.ears[e].scale.x, 0.45 + flick * 0.25, 10, dt);
      }

      // Tail curls in a slow travelling wave.
      for (let t = 0; t < m.tail.length; t++) {
        const k = t / (m.tail.length - 1);
        m.tail[t].rotation.x = damp(
          m.tail[t].rotation.x,
          0.42 + Math.sin(time * 1.4 + m.phase - t * 0.5) * 0.1 * (0.4 + k),
          8,
          dt,
        );
        m.tail[t].rotation.y = damp(
          m.tail[t].rotation.y,
          Math.sin(time * 0.9 + m.phase + t * 0.3) * 0.12,
          7,
          dt,
        );
      }

      if (!m.rescued) {
        // --- waiting to be found -------------------------------------------
        m.lookTimer -= dt;
        if (m.lookTimer <= 0) {
          m.lookTimer = 1.5 + Math.random() * 4;
          m.look = (Math.random() - 0.5) * 1.5;
        }
        m.head.rotation.y = damp(m.head.rotation.y, m.look, 5, dt);
        m.head.rotation.x = damp(m.head.rotation.x, Math.sin(time * 0.7 + m.phase) * 0.08, 5, dt);
        // Breathing bob.
        m.body.position.y = Math.sin(time * 1.9 + m.phase) * 0.006;
        m.body.rotation.z = Math.sin(time * 1.1 + m.phase) * 0.03;
        for (const leg of m.legs) leg.rotation.x = damp(leg.rotation.x, -1.15, 10, dt);

        this.beacons[i].scale.setScalar(1.05 + Math.sin(time * 2.2 + m.phase) * 0.12);

        // The cat notices it. Reach is generous — this is meant to be a joy.
        const dx = m.home.x - catPos.x;
        const dz = m.home.z - catPos.z;
        const dy = m.home.y - catPos.y;
        if (dx * dx + dz * dz < 1.4 * 1.4 && dy < 1.2 && dy > -1.2) {
          m.rescued = true;
          m.pos.copy(m.group.position);
          m.paradeIndex = this.parade.length;
          this.parade.push(m);
          this.beacons[i].visible = false;
          this.rescued++;
          found++;
        }
        continue;
      }

      // --- in the parade ---------------------------------------------------
      const back = (m.paradeIndex + 1) * SPACING;
      const target = (this.trail.travelled >= back ? this.trail.sample(back) : null) ?? m.pos;
      const before = tmpPrev.copy(m.pos);

      // A monkey that somehow ends up on the wrong side of town rejoins rather
      // than sprinting across the map for a minute.
      if (m.pos.distanceToSquared(target) > 400) {
        m.pos.copy(target);
      } else {
        m.pos.x = damp(m.pos.x, target.x, 13, dt);
        m.pos.y = damp(m.pos.y, target.y, 10, dt);
        m.pos.z = damp(m.pos.z, target.z, 13, dt);
      }

      const stepX = m.pos.x - before.x;
      const stepZ = m.pos.z - before.z;
      const step = Math.hypot(stepX, stepZ);
      // Tie the hop to distance covered, so the legs never skate.
      m.hop += step * 7 + dt * 0.6;
      if (step > 0.002) m.facing = Math.atan2(stepX, stepZ);

      const moving = step > 0.004;
      const bounce = moving ? Math.abs(Math.sin(m.hop)) * clamp(step * 12, 0.02, 0.06) : 0;
      m.group.position.set(m.pos.x, m.pos.y + bounce, m.pos.z);
      m.group.rotation.y = damp(m.group.rotation.y, m.facing, 10, dt);
      // Lean into the run, and look back at the cat when idling.
      m.body.rotation.x = damp(m.body.rotation.x, moving ? 0.3 : 0, 8, dt);
      m.body.position.y = moving ? 0 : Math.sin(time * 1.9 + m.phase) * 0.006;
      m.head.rotation.x = damp(m.head.rotation.x, moving ? -0.25 : 0, 8, dt);
      m.head.rotation.y = damp(m.head.rotation.y, moving ? 0 : Math.sin(time + m.phase) * 0.4, 5, dt);
      const swing = Math.sin(m.hop * 2) * 0.6;
      if (moving) {
        // Arms pumping in time with the legs.
        m.arms[0].rotation.x = damp(m.arms[0].rotation.x, swing, 16, dt);
        m.arms[1].rotation.x = damp(m.arms[1].rotation.x, -swing, 16, dt);
      }
      // Unfold out of the sitting pose to scamper, and tuck back when idle.
      for (let g = 0; g < m.legs.length; g++) {
        const target = moving ? -0.25 + (g === 0 ? swing : -swing) * 0.8 : -1.15;
        m.legs[g].rotation.x = damp(m.legs[g].rotation.x, target, 14, dt);
      }
    }

    void catYaw;
    return found;
  }
}
