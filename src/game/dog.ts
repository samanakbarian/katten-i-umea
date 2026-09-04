import * as THREE from "three";
import { World } from "./city";
import { PathTrail } from "./trail";
import { clamp, damp } from "./utils";

/**
 * Simba: a golden dog, bought at Zoobutiken, who then follows the cat for the
 * rest of the night. He walks the cat's own path a couple of metres back, sits
 * down when you stop, wags harder the faster you go, and has opinions about
 * pigeons.
 *
 * He is deliberately bigger than the cat — roughly knee height to a person —
 * so the two read apart instantly at night.
 */

/** How far back along the cat's path Simba trots. */
const FOLLOW = 1.5;

export class Dog {
  readonly group = new THREE.Group();
  readonly position = new THREE.Vector3();
  active = false;

  private body = new THREE.Group();
  private head = new THREE.Group();
  private tail: THREE.Group[] = [];
  private ears: THREE.Group[] = [];
  private legs: { hip: THREE.Group; knee: THREE.Group; front: boolean; side: number }[] = [];
  private lids: THREE.Mesh[] = [];

  private trail = new PathTrail();
  private gait = 0;
  private facing = 0;
  private sit = 0;
  private blink = 0;
  private blinkTimer = 3;
  private pant = 0;
  private barkAge = 99;

  constructor(private world: World) {
    const coat = new THREE.MeshStandardMaterial({ color: "#d0a052", roughness: 0.92 });
    const cream = new THREE.MeshStandardMaterial({ color: "#f0dcb4", roughness: 0.9 });
    const dark = new THREE.MeshStandardMaterial({ color: "#8a6330", roughness: 0.9 });
    const nose = new THREE.MeshStandardMaterial({ color: "#241c18", roughness: 0.45 });
    const collar = new THREE.MeshStandardMaterial({
      color: "#b8323c",
      roughness: 0.6,
      metalness: 0.1,
    });
    const tagMat = new THREE.MeshStandardMaterial({
      color: "#e8c05a",
      metalness: 0.9,
      roughness: 0.25,
      emissive: new THREE.Color("#e8c05a"),
      emissiveIntensity: 0.25,
    });
    const eyeMat = new THREE.MeshStandardMaterial({
      color: "#2a1d14",
      roughness: 0.2,
      emissive: new THREE.Color("#4a3320"),
      emissiveIntensity: 0.35,
    });

    this.group.add(this.body);
    this.body.position.y = 0.5;

    // --- torso ---------------------------------------------------------------
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.34, 6, 16), coat);
    torso.rotation.x = Math.PI / 2;
    torso.castShadow = true;
    this.body.add(torso);

    const chest = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 12), coat);
    chest.position.set(0, -0.01, 0.2);
    chest.castShadow = true;
    this.body.add(chest);

    const rump = new THREE.Mesh(new THREE.SphereGeometry(0.165, 14, 12), coat);
    rump.position.set(0, 0.01, -0.2);
    rump.castShadow = true;
    this.body.add(rump);

    const belly = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.3, 5, 12), cream);
    belly.rotation.x = Math.PI / 2;
    belly.position.set(0, -0.08, 0.02);
    belly.scale.set(1, 1, 0.8);
    this.body.add(belly);

    // --- head ----------------------------------------------------------------
    this.head.position.set(0, 0.15, 0.36);
    this.body.add(this.head);

    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.135, 16, 14), coat);
    skull.scale.set(1, 0.95, 1.02);
    skull.castShadow = true;
    this.head.add(skull);

    const snout = new THREE.Mesh(new THREE.CapsuleGeometry(0.062, 0.1, 5, 12), cream);
    snout.rotation.x = Math.PI / 2;
    snout.position.set(0, -0.04, 0.15);
    this.head.add(snout);

    const snoutTip = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), nose);
    snoutTip.position.set(0, -0.028, 0.225);
    snoutTip.scale.set(1.2, 0.85, 0.8);
    this.head.add(snoutTip);

    // Floppy ears, hinged so they swing with the trot.
    for (const side of [-1, 1]) {
      const ear = new THREE.Group();
      ear.position.set(side * 0.108, 0.055, 0.01);
      const flap = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.12, 4, 8), dark);
      flap.position.y = -0.09;
      flap.scale.set(0.55, 1, 1.1);
      flap.castShadow = true;
      ear.add(flap);
      this.head.add(ear);
      this.ears.push(ear);

      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.026, 12, 10), eyeMat);
      eye.position.set(side * 0.062, 0.03, 0.105);
      this.head.add(eye);

      const brow = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), cream);
      brow.position.set(side * 0.062, 0.062, 0.1);
      brow.scale.set(1.3, 0.5, 0.8);
      this.head.add(brow);

      const lid = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), coat);
      lid.position.set(side * 0.062, 0.058, 0.1);
      lid.scale.set(1, 0.12, 1);
      this.head.add(lid);
      this.lids.push(lid);
    }

    // A red collar with a tag, so he is plainly somebody's dog.
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.06, 16, 1, true), collar);
    band.rotation.x = Math.PI / 2;
    band.position.set(0, 0.05, 0.26);
    this.body.add(band);
    const tag = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.012, 12), tagMat);
    tag.rotation.x = Math.PI / 2;
    tag.position.set(0, -0.07, 0.28);
    this.body.add(tag);

    // --- legs ----------------------------------------------------------------
    for (const def of [
      { x: -0.1, z: 0.2, front: true, side: -1 },
      { x: 0.1, z: 0.2, front: true, side: 1 },
      { x: -0.11, z: -0.21, front: false, side: -1 },
      { x: 0.11, z: -0.21, front: false, side: 1 },
    ]) {
      const hip = new THREE.Group();
      hip.position.set(def.x, -0.04, def.z);
      this.body.add(hip);

      const upperLen = def.front ? 0.22 : 0.23;
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, upperLen * 0.75, 4, 8), coat);
      upper.position.y = -upperLen / 2;
      upper.castShadow = true;
      hip.add(upper);

      const knee = new THREE.Group();
      knee.position.y = -upperLen;
      hip.add(knee);

      const lowerLen = def.front ? 0.19 : 0.2;
      const lower = new THREE.Mesh(new THREE.CapsuleGeometry(0.037, lowerLen * 0.7, 4, 8), cream);
      lower.position.y = -lowerLen / 2;
      lower.castShadow = true;
      knee.add(lower);

      const paw = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), cream);
      paw.position.set(0, -lowerLen - 0.01, 0.02);
      paw.scale.set(1, 0.7, 1.25);
      knee.add(paw);

      this.legs.push({ hip, knee, front: def.front, side: def.side });
    }

    // --- tail, which is the whole point of a dog -----------------------------
    let parent: THREE.Object3D = this.body;
    for (let i = 0; i < 5; i++) {
      const seg = new THREE.Group();
      seg.position.set(0, i === 0 ? 0.08 : 0, i === 0 ? -0.32 : -0.09);
      const mesh = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.05 - i * 0.007, 0.07, 4, 8),
        i > 2 ? cream : coat,
      );
      mesh.rotation.x = Math.PI / 2;
      mesh.position.z = -0.045;
      mesh.castShadow = true;
      seg.add(mesh);
      parent.add(seg);
      parent = seg;
      this.tail.push(seg);
    }

    this.group.visible = false;
  }

  /** Bought: Simba turns up next to the cat and stays. */
  spawn(near: THREE.Vector3) {
    this.position.set(near.x - 1.4, this.world.groundHeightAt(near.x - 1.4, near.z), near.z);
    this.group.position.copy(this.position);
    this.active = true;
    this.group.visible = true;
  }

  bark() {
    this.barkAge = 0;
  }

  update(dt: number, time: number, catPos: THREE.Vector3) {
    if (!this.active) return;
    this.barkAge += dt;
    this.trail.push(catPos, FOLLOW + 4);

    // Before the cat has walked a full follow distance there is nothing useful
    // on the trail, and steering at the cat itself parks Simba inside it. Hold
    // station until there is a real path to walk.
    const sampled = this.trail.travelled >= FOLLOW ? this.trail.sample(FOLLOW) : null;
    const target =
      sampled ?? (this.position.distanceTo(catPos) < 2.6 ? this.position : catPos);
    const prevX = this.position.x;
    const prevZ = this.position.z;

    // A long way off — you drove across town — and he simply catches up.
    if (this.position.distanceToSquared(target) > 900) {
      this.position.copy(target);
    } else {
      this.position.x = damp(this.position.x, target.x, 11, dt);
      this.position.y = damp(this.position.y, target.y, 9, dt);
      this.position.z = damp(this.position.z, target.z, 11, dt);
    }

    const stepX = this.position.x - prevX;
    const stepZ = this.position.z - prevZ;
    const step = Math.hypot(stepX, stepZ);
    const speed = step / Math.max(dt, 1e-4);
    const moving = step > 0.004;
    if (moving) this.facing = Math.atan2(stepX, stepZ);

    // Gait is driven by distance covered, so the paws never skate.
    this.gait += step * 5.5;
    const trot = clamp(speed / 6, 0, 1);

    this.group.position.copy(this.position);
    this.group.rotation.y = damp(this.group.rotation.y, this.facing, 10, dt);

    // Sitting down when the cat stops is most of the charm.
    this.sit = damp(this.sit, moving ? 0 : 1, 4, dt);
    this.body.position.y = 0.5 - this.sit * 0.16 + (moving ? Math.abs(Math.sin(this.gait)) * 0.02 : 0);
    this.body.rotation.x = damp(this.body.rotation.x, this.sit * 0.3, 6, dt);

    for (const leg of this.legs) {
      const phase = this.gait + (leg.front ? 0 : Math.PI * 0.55) + (leg.side > 0 ? Math.PI : 0);
      let hip = Math.sin(phase) * (0.35 + trot * 0.5) * (moving ? 1 : 0);
      let knee = -Math.max(0, Math.cos(phase)) * (0.3 + trot * 0.4) * (moving ? 1 : 0) - 0.12;
      if (this.sit > 0.05) {
        // Back legs fold under, front legs stay straight and proud.
        hip = leg.front ? hip * (1 - this.sit) : hip * (1 - this.sit) - this.sit * 0.9;
        knee = leg.front ? knee * (1 - this.sit) : knee * (1 - this.sit) - this.sit * 1.5;
      }
      leg.hip.rotation.x = damp(leg.hip.rotation.x, hip, 16, dt);
      leg.knee.rotation.x = damp(leg.knee.rotation.x, knee, 16, dt);
    }

    // Wag: faster when moving, and a delighted flurry just after a bark.
    const excited = this.barkAge < 1.2 ? 1 : 0;
    const wagRate = 6 + trot * 12 + excited * 10;
    const wagAmount = 0.18 + trot * 0.16 + excited * 0.2;
    for (let i = 0; i < this.tail.length; i++) {
      const k = i / (this.tail.length - 1);
      this.tail[i].rotation.y = Math.sin(time * wagRate - i * 0.6) * wagAmount * (0.4 + k);
      this.tail[i].rotation.x = damp(this.tail[i].rotation.x, -0.5 + this.sit * 0.35, 8, dt);
    }

    // Ears swing with the trot, and prick up when he barks.
    for (let i = 0; i < this.ears.length; i++) {
      const side = i === 0 ? -1 : 1;
      this.ears[i].rotation.x = damp(
        this.ears[i].rotation.x,
        Math.sin(this.gait * 2) * 0.12 * trot - excited * 0.3,
        10,
        dt,
      );
      this.ears[i].rotation.z = damp(this.ears[i].rotation.z, side * (0.2 + trot * 0.2), 8, dt);
    }

    // Head: up and forward at a trot, tilted and curious at rest.
    this.head.rotation.x = damp(
      this.head.rotation.x,
      moving ? -0.12 - trot * 0.1 : 0.06 - this.sit * 0.1,
      7,
      dt,
    );
    this.head.rotation.z = damp(
      this.head.rotation.z,
      moving ? 0 : Math.sin(time * 0.6) * 0.12,
      4,
      dt,
    );
    this.head.rotation.y = damp(this.head.rotation.y, moving ? 0 : Math.sin(time * 0.4) * 0.25, 4, dt);

    // Panting, and a blink now and then.
    this.pant += dt * (4 + trot * 8);
    this.head.scale.y = 1 + Math.sin(this.pant) * 0.012;

    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blinkTimer = 2 + Math.random() * 4;
      this.blink = 1;
    }
    this.blink = Math.max(0, this.blink - dt * 7);
    const drop = Math.sin(this.blink * Math.PI);
    for (const lid of this.lids) {
      lid.position.y = 0.058 - drop * 0.03;
      lid.scale.y = 0.12 + drop * 1.1;
    }
  }
}
