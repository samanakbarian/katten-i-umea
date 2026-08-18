import * as THREE from "three";
import { furTexture, radialSprite } from "./textures";
import { clamp, damp, lerp } from "./utils";

export interface CatPose {
  /** 0 = still, 1 = flat-out sprint. */
  speed01: number;
  grounded: boolean;
  verticalVelocity: number;
  crouch: number;
  climbing: boolean;
  /** Seconds since the last meow, or a large number. */
  meowAge: number;
  /** Sideways lean from turning, -1..1. */
  turn: number;
}

// A white cat. Kept just off-white so the tone mapper has somewhere to go,
// with barely-there grey ghost markings for form.
const FUR = "#ebe8e2";
const FUR_DARK = "#bdbab1";

/**
 * The cat is built from primitives at runtime: 4 jointed legs, a spring of a
 * spine, a nine-bone tail, ears that swivel and eyes that blink.
 */
export class Cat {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly head = new THREE.Group();

  private spine = new THREE.Group();
  private ears: THREE.Group[] = [];
  private tail: THREE.Group[] = [];
  private legs: { hip: THREE.Group; knee: THREE.Group; front: boolean; side: number }[] = [];
  private eyes: THREE.Mesh[] = [];
  private eyeLids: THREE.Mesh[] = [];
  private shadow: THREE.Mesh;

  private gait = 0;
  private blinkTimer = 2;
  private blink = 0;
  private earTwitch = 0;
  private earTimer = 3;
  private breathe = 0;

  constructor() {
    const fur = new THREE.MeshStandardMaterial({
      map: furTexture(FUR, FUR_DARK),
      roughness: 0.92,
      metalness: 0,
    });
    const dark = new THREE.MeshStandardMaterial({ color: "#cdc9c0", roughness: 0.9 });
    const pink = new THREE.MeshStandardMaterial({ color: "#e79b9b", roughness: 0.75 });
    const white = new THREE.MeshStandardMaterial({ color: "#fdfcf8", roughness: 0.88 });
    // White cats and blue eyes belong together.
    const eyeMat = new THREE.MeshStandardMaterial({
      color: "#2c6ba8",
      emissive: new THREE.Color("#8fd0ff"),
      emissiveIntensity: 0.5,
      roughness: 0.2,
    });
    const pupil = new THREE.MeshBasicMaterial({ color: "#0a0d0a" });

    this.root.add(this.body);
    this.body.position.y = 0.3;
    this.body.add(this.spine);

    // --- torso ---------------------------------------------------------------
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.112, 0.2, 6, 16), fur);
    torso.rotation.x = Math.PI / 2;
    torso.castShadow = true;
    this.spine.add(torso);

    const chest = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 12), fur);
    chest.position.set(0, 0.004, 0.13);
    chest.scale.set(1, 0.98, 1.05);
    chest.castShadow = true;
    this.spine.add(chest);

    const hips = new THREE.Mesh(new THREE.SphereGeometry(0.118, 14, 12), fur);
    hips.position.set(0, 0.012, -0.14);
    hips.scale.set(1.02, 1.02, 1.0);
    hips.castShadow = true;
    this.spine.add(hips);

    // Cream underside and chest bib.
    const belly = new THREE.Mesh(new THREE.CapsuleGeometry(0.086, 0.24, 5, 12), white);
    belly.rotation.x = Math.PI / 2;
    belly.position.set(0, -0.045, 0.01);
    belly.scale.set(1, 1, 0.72);
    this.spine.add(belly);

    const bib = new THREE.Mesh(new THREE.SphereGeometry(0.062, 12, 10), white);
    bib.position.set(0, -0.042, 0.185);
    bib.scale.set(0.95, 1.05, 0.8);
    this.spine.add(bib);

    // --- head ----------------------------------------------------------------
    this.head.position.set(0, 0.06, 0.26);
    this.spine.add(this.head);

    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.101, 16, 14), fur);
    skull.scale.set(1, 0.94, 0.98);
    skull.castShadow = true;
    this.head.add(skull);

    const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.048, 12, 10), white);
    muzzle.position.set(0, -0.036, 0.078);
    muzzle.scale.set(1.2, 0.72, 0.85);
    this.head.add(muzzle);

    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), pink);
    nose.position.set(0, -0.02, 0.122);
    nose.scale.set(1.2, 0.8, 0.8);
    this.head.add(nose);

    for (const side of [-1, 1]) {
      // Ears: outer cone plus a pink inner cone.
      const ear = new THREE.Group();
      ear.position.set(side * 0.055, 0.079, -0.005);
      ear.rotation.z = side * 0.22;
      const outer = new THREE.Mesh(new THREE.ConeGeometry(0.042, 0.075, 4), fur);
      outer.rotation.y = Math.PI / 4;
      outer.position.y = 0.035;
      outer.castShadow = true;
      ear.add(outer);
      const inner = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.055, 4), pink);
      inner.rotation.y = Math.PI / 4;
      inner.position.set(0, 0.03, 0.014);
      ear.add(inner);
      this.head.add(ear);
      this.ears.push(ear);

      // Eyes, with a lid that slides down for blinking.
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.024, 12, 10), eyeMat);
      eye.position.set(side * 0.044, 0.016, 0.081);
      this.head.add(eye);
      this.eyes.push(eye);

      const slit = new THREE.Mesh(new THREE.SphereGeometry(0.0125, 8, 8), pupil);
      slit.scale.set(0.32, 1.05, 0.4);
      slit.position.set(side * 0.044, 0.016, 0.1);
      this.head.add(slit);

      const lid = new THREE.Mesh(new THREE.SphereGeometry(0.0265, 10, 8), fur);
      lid.position.set(side * 0.044, 0.05, 0.079);
      lid.scale.set(1, 0.1, 1);
      this.head.add(lid);
      this.eyeLids.push(lid);

      // Whiskers.
      for (let i = 0; i < 3; i++) {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.0009, 0.0009, 0.085, 3), white);
        w.position.set(side * 0.052, -0.022 + i * 0.014, 0.087);
        w.rotation.z = side * (Math.PI / 2 - 0.25);
        w.rotation.x = (i - 1) * 0.18;
        this.head.add(w);
      }
    }

    // --- legs ----------------------------------------------------------------
    const legDefs = [
      { x: -0.062, z: 0.15, front: true, side: -1 },
      { x: 0.062, z: 0.15, front: true, side: 1 },
      { x: -0.07, z: -0.16, front: false, side: -1 },
      { x: 0.07, z: -0.16, front: false, side: 1 },
    ];
    for (const def of legDefs) {
      const hip = new THREE.Group();
      hip.position.set(def.x, -0.02, def.z);
      this.spine.add(hip);

      const upperLen = def.front ? 0.13 : 0.14;
      const upper = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.033, upperLen * 0.8, 4, 8),
        fur,
      );
      upper.position.y = -upperLen / 2;
      upper.castShadow = true;
      hip.add(upper);

      const knee = new THREE.Group();
      knee.position.y = -upperLen;
      hip.add(knee);

      const lowerLen = def.front ? 0.11 : 0.12;
      const lower = new THREE.Mesh(new THREE.CapsuleGeometry(0.024, lowerLen * 0.75, 4, 8), fur);
      lower.position.y = -lowerLen / 2;
      lower.castShadow = true;
      knee.add(lower);

      const paw = new THREE.Mesh(new THREE.SphereGeometry(0.033, 10, 8), white);
      paw.position.set(0, -lowerLen - 0.005, 0.012);
      paw.scale.set(0.95, 0.7, 1.25);
      knee.add(paw);

      this.legs.push({ hip, knee, front: def.front, side: def.side });
    }

    // --- tail ----------------------------------------------------------------
    let parent: THREE.Object3D = this.spine;
    for (let i = 0; i < 9; i++) {
      const seg = new THREE.Group();
      seg.position.set(0, i === 0 ? 0.03 : 0, i === 0 ? -0.24 : -0.048);
      const mesh = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.028 - i * 0.0022, 0.04, 4, 7),
        i > 6 ? dark : fur,
      );
      mesh.rotation.x = Math.PI / 2;
      mesh.position.z = -0.024;
      mesh.castShadow = true;
      seg.add(mesh);
      parent.add(seg);
      parent = seg;
      this.tail.push(seg);
    }

    // --- contact shadow ------------------------------------------------------
    const shadowMat = new THREE.MeshBasicMaterial({
      map: radialSprite("rgba(0,0,0,0.55)", "rgba(0,0,0,0)"),
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      opacity: 0.5,
    });
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 2;
    this.root.add(this.shadow);
  }

  /** Where the cat is looking from, for the camera and for meow effects. */
  get headWorldPosition() {
    return this.head.getWorldPosition(new THREE.Vector3());
  }

  update(dt: number, pose: CatPose) {
    const s = clamp(pose.speed01, 0, 1);
    this.breathe += dt * (1.6 + s * 6);

    // Gait speeds up with the cat and stops when it does.
    this.gait += dt * (4 + s * 16) * (s > 0.02 ? 1 : 0);

    const airborne = !pose.grounded && !pose.climbing;
    const air = airborne ? clamp(-pose.verticalVelocity * 0.09, -0.5, 0.6) : 0;

    // --- spine ---------------------------------------------------------------
    const bob = pose.grounded ? Math.sin(this.gait * 2) * 0.012 * s : 0;
    const crouch = pose.crouch * 0.085;
    this.body.position.y = damp(
      this.body.position.y,
      0.3 + bob - crouch + (airborne ? 0.02 : 0),
      18,
      dt,
    );
    // Breathing when idle, a running arch when not.
    const arch = Math.sin(this.gait * 2 + 0.6) * 0.14 * s;
    this.spine.rotation.x = damp(
      this.spine.rotation.x,
      (airborne ? -air * 0.5 : arch * 0.35) + pose.crouch * 0.12,
      12,
      dt,
    );
    this.spine.rotation.z = damp(this.spine.rotation.z, -pose.turn * 0.22, 8, dt);
    this.spine.scale.y = 1 + Math.sin(this.breathe) * (0.012 - s * 0.008);
    if (pose.climbing) {
      this.spine.rotation.x = damp(this.spine.rotation.x, -1.15, 10, dt);
    }

    // --- legs ----------------------------------------------------------------
    for (let i = 0; i < this.legs.length; i++) {
      const leg = this.legs[i];
      // Diagonal pairs, with the front legs a quarter-cycle ahead — a cat bound.
      const phase = this.gait + (leg.front ? 0 : Math.PI * 0.62) + (leg.side > 0 ? Math.PI : 0);
      const swing = Math.sin(phase) * (0.45 + s * 0.75) * s;
      const lift = Math.max(0, Math.cos(phase)) * (0.25 + s * 0.65) * s;

      let hipTarget = swing;
      let kneeTarget = -lift * (leg.front ? 0.9 : 1.25) - 0.18;

      if (pose.climbing) {
        // Reaching up the wall, alternating.
        const cp = this.gait * 0.9 + (leg.front ? 0 : Math.PI) + (leg.side > 0 ? Math.PI / 2 : 0);
        hipTarget = -1.0 + Math.sin(cp) * 0.7;
        kneeTarget = -0.5 + Math.cos(cp) * 0.35;
      } else if (airborne) {
        // Tuck on the way up, reach for the ground on the way down.
        const t = clamp(pose.verticalVelocity * 0.16, -1, 1);
        hipTarget = leg.front ? -0.9 * t - 0.25 : 0.8 * t + 0.15;
        kneeTarget = -0.9 + t * 0.4;
      } else if (pose.crouch > 0.05) {
        hipTarget = lerp(hipTarget, leg.front ? 0.35 : -0.4, pose.crouch);
        kneeTarget = lerp(kneeTarget, -0.85, pose.crouch);
      } else if (s < 0.02) {
        hipTarget = 0;
        kneeTarget = -0.12 + Math.sin(this.breathe + i) * 0.01;
      }

      leg.hip.rotation.x = damp(leg.hip.rotation.x, hipTarget, 20, dt);
      leg.knee.rotation.x = damp(leg.knee.rotation.x, kneeTarget, 20, dt);
    }

    // --- tail ----------------------------------------------------------------
    // Idle: a slow question-mark curl. Running: streaming out behind for balance.
    for (let i = 0; i < this.tail.length; i++) {
      const t = i / (this.tail.length - 1);
      const wave = Math.sin(this.breathe * 0.9 - i * 0.55) * (0.13 - s * 0.07);
      const upCurl = lerp(-0.26, 0.06, s) + (airborne ? -0.16 : 0);
      const meow = pose.meowAge < 0.6 ? Math.sin(pose.meowAge * 22) * 0.12 * (1 - pose.meowAge / 0.6) : 0;
      const seg = this.tail[i];
      seg.rotation.x = damp(seg.rotation.x, upCurl * (1 - t * 0.35) + meow, 10, dt);
      seg.rotation.y = damp(seg.rotation.y, wave + pose.turn * 0.1 * (1 - t), 9, dt);
    }

    // --- head, ears, eyes ----------------------------------------------------
    this.head.rotation.x = damp(
      this.head.rotation.x,
      (airborne ? air * 0.35 : -arch * 0.3) + pose.crouch * 0.2 + (pose.climbing ? 0.9 : 0),
      10,
      dt,
    );
    this.head.rotation.y = damp(this.head.rotation.y, -pose.turn * 0.3, 8, dt);
    this.head.rotation.z = damp(this.head.rotation.z, pose.turn * 0.12, 8, dt);

    this.earTimer -= dt;
    if (this.earTimer <= 0) {
      this.earTimer = 1.6 + Math.random() * 4;
      this.earTwitch = 1;
    }
    this.earTwitch = Math.max(0, this.earTwitch - dt * 4);
    const meowEar = pose.meowAge < 0.5 ? 0.25 : 0;
    for (let i = 0; i < this.ears.length; i++) {
      const side = i === 0 ? -1 : 1;
      const flat = s * 0.35 + meowEar; // ears go back at speed and when yelling
      this.ears[i].rotation.x = damp(this.ears[i].rotation.x, -flat + this.earTwitch * 0.35, 12, dt);
      this.ears[i].rotation.z = damp(
        this.ears[i].rotation.z,
        side * (0.22 + flat * 0.5) + this.earTwitch * side * 0.2,
        12,
        dt,
      );
    }

    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blinkTimer = 2.5 + Math.random() * 4;
      this.blink = 1;
    }
    this.blink = Math.max(0, this.blink - dt * 7);
    const lidDrop = Math.sin(this.blink * Math.PI);
    for (const lid of this.eyeLids) {
      lid.position.y = lerp(0.05, 0.013, lidDrop);
      lid.scale.y = lerp(0.1, 1.05, lidDrop);
    }

    // Meow opens the jaw a touch — muzzle stretches forward.
    const m = pose.meowAge < 0.45 ? Math.sin((pose.meowAge / 0.45) * Math.PI) : 0;
    this.head.scale.set(1, 1 + m * 0.06, 1 + m * 0.1);

    // --- contact shadow ------------------------------------------------------
    this.shadow.visible = pose.grounded || pose.verticalVelocity < 6;
    const height = clamp(this.root.userData.heightAboveGround ?? 0, 0, 7);
    this.shadow.position.y = 0.02 - height;
    const shrink = clamp(1 - height / 7, 0.25, 1);
    this.shadow.scale.setScalar(shrink);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.5 * shrink;
  }
}
