import * as THREE from "three";
import { World } from "./city";
import { Input } from "./input";
import { Collider, clamp, damp } from "./utils";
import { radialSprite } from "./textures";

/**
 * A small estate car, sized for a city and driven by a cat who can barely see
 * over the wheel. Arcade handling: no tyre model, just grip that falls off on
 * ice and a nose that follows the wheels.
 */

const RADIUS = 1.45; // collision circle
const MAX_SPEED = 24;
const REVERSE_SPEED = -7;
const THROTTLE = 10;
const BRAKE = 18;
const DRAG = 0.55;
const ROLL = 2.2;
const MAX_STEER = 2.0;
/** The car pulls itself up steps this tall — kerbs, and the stepped bridges. */
const CLIMB = 0.75;

export class Car {
  readonly group = new THREE.Group();
  readonly position = new THREE.Vector3();
  heading = 0;
  speed = 0;
  /** Bought and standing in the world. */
  spawned = false;
  occupied = false;

  private steer = 0;
  private wheelSpin = 0;
  private frontWheels: THREE.Object3D[] = [];
  private allWheels: THREE.Object3D[] = [];
  private headlights: THREE.SpotLight[] = [];
  private beamPool: THREE.Mesh;
  private brakeLights: THREE.Mesh;
  private nearby: Collider[] = [];
  private camPos = new THREE.Vector3();
  private bodyTilt = 0;

  constructor(private world: World) {
    const paint = new THREE.MeshStandardMaterial({
      color: "#2f5a8c",
      metalness: 0.45,
      roughness: 0.38,
      envMapIntensity: 1.2,
    });
    const trim = new THREE.MeshStandardMaterial({ color: "#15171b", roughness: 0.6, metalness: 0.4 });
    const glass = new THREE.MeshStandardMaterial({
      color: "#0e1722",
      metalness: 0.75,
      roughness: 0.12,
      envMapIntensity: 1.5,
    });
    const rubber = new THREE.MeshStandardMaterial({ color: "#101114", roughness: 0.9 });
    const chrome = new THREE.MeshStandardMaterial({ color: "#b9c2cc", metalness: 0.95, roughness: 0.25 });
    const lampOn = new THREE.MeshBasicMaterial({ color: "#fff0d0", toneMapped: false });
    const lampRed = new THREE.MeshBasicMaterial({ color: "#ff3b30", toneMapped: false });

    const add = (
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      x: number,
      y: number,
      z: number,
      shadow = true,
    ) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = shadow;
      this.group.add(m);
      return m;
    };

    // Body: a low slab, a bonnet, and a cabin set back over the rear axle.
    add(new THREE.BoxGeometry(1.85, 0.62, 4.3), paint, 0, 0.62, 0);
    add(new THREE.BoxGeometry(1.72, 0.34, 1.5), paint, 0, 1.02, 1.32);
    add(new THREE.BoxGeometry(1.66, 0.72, 2.35), paint, 0, 1.28, -0.35);
    // Glasshouse.
    add(new THREE.BoxGeometry(1.7, 0.5, 2.4), glass, 0, 1.42, -0.35, false);
    add(new THREE.BoxGeometry(1.5, 0.44, 0.16), glass, 0, 1.36, 0.86, false);
    // Roof and rails.
    add(new THREE.BoxGeometry(1.62, 0.1, 2.3), paint, 0, 1.68, -0.4);
    add(new THREE.BoxGeometry(0.08, 0.09, 2.1), trim, -0.68, 1.76, -0.4);
    add(new THREE.BoxGeometry(0.08, 0.09, 2.1), trim, 0.68, 1.76, -0.4);
    // Bumpers and sills.
    add(new THREE.BoxGeometry(1.9, 0.26, 0.3), trim, 0, 0.5, 2.14);
    add(new THREE.BoxGeometry(1.9, 0.26, 0.3), trim, 0, 0.5, -2.14);
    add(new THREE.BoxGeometry(1.92, 0.16, 3.6), trim, 0, 0.42, 0);
    add(new THREE.BoxGeometry(0.9, 0.1, 0.06), chrome, 0, 0.72, 2.18, false);

    // Lamps.
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(0.42, 0.2, 0.1), lampOn, s * 0.62, 0.86, 2.15, false);
      add(new THREE.BoxGeometry(0.34, 0.26, 0.1), lampRed, s * 0.66, 0.9, -2.16, false);
    }
    this.brakeLights = add(new THREE.BoxGeometry(1.6, 0.08, 0.06), lampRed, 0, 1.14, -2.16, false);
    this.brakeLights.visible = false;

    // Wheels.
    const tyre = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 16);
    tyre.rotateZ(Math.PI / 2);
    const hub = new THREE.CylinderGeometry(0.17, 0.17, 0.28, 10);
    hub.rotateZ(Math.PI / 2);
    for (const [wx, wz, front] of [
      [-0.92, 1.4, true],
      [0.92, 1.4, true],
      [-0.92, -1.4, false],
      [0.92, -1.4, false],
    ] as [number, number, boolean][]) {
      const pivot = new THREE.Group();
      pivot.position.set(wx, 0.36, wz);
      const spin = new THREE.Group();
      const t = new THREE.Mesh(tyre, rubber);
      t.castShadow = true;
      const h = new THREE.Mesh(hub, chrome);
      spin.add(t, h);
      pivot.add(spin);
      this.group.add(pivot);
      this.allWheels.push(spin);
      if (front) this.frontWheels.push(pivot);
    }

    // Headlight beams. Two spots, no shadows — they are for mood and for
    // actually seeing the road, not for casting the car's own shadow.
    for (const s of [-1, 1]) {
      const spot = new THREE.SpotLight(0xfff2d8, 90, 55, 0.7, 0.5, 1.1);
      spot.position.set(s * 0.62, 0.86, 2.1);
      spot.target.position.set(s * 0.9, -0.4, 16);
      spot.castShadow = false;
      this.group.add(spot, spot.target);
      this.headlights.push(spot);
    }

    // A pool of light thrown on the snow ahead, which sells the beams cheaply.
    this.beamPool = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 16),
      new THREE.MeshBasicMaterial({
        map: radialSprite("rgba(255,238,200,1)", "rgba(255,190,90,0)"),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0.45,
        toneMapped: false,
      }),
    );
    this.beamPool.rotation.x = -Math.PI / 2;
    this.beamPool.position.set(0, 0.06, 7.5);
    this.group.add(this.beamPool);

    this.group.visible = false;
  }

  /** Called when the car is bought. */
  spawn(at: THREE.Vector3, heading: number) {
    this.position.copy(at);
    this.position.y = this.world.groundHeightAt(at.x, at.z);
    this.heading = heading;
    this.speed = 0;
    this.spawned = true;
    this.group.visible = true;
    this.sync();
  }

  /** Seat position in world space, for putting the cat behind the wheel. */
  get seat() {
    return new THREE.Vector3(-0.34, 1.06, -0.1).applyAxisAngle(
      new THREE.Vector3(0, 1, 0),
      this.heading,
    ).add(this.position);
  }

  /** Somewhere clear beside the car to step out onto. */
  get doorStep() {
    const side = new THREE.Vector3(-2.1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.heading);
    const p = this.position.clone().add(side);
    p.y = this.world.groundHeightAt(p.x, p.z) + 0.05;
    return p;
  }

  private sync() {
    this.group.position.copy(this.position);
    this.group.rotation.y = this.heading;
  }

  /** Idle: parked, lights off. */
  rest(dt: number) {
    for (const h of this.headlights) h.intensity = damp(h.intensity, 0, 6, dt);
    this.beamPool.visible = false;
    this.brakeLights.visible = false;
  }

  update(dt: number, input: Input, camera: THREE.PerspectiveCamera) {
    const onIce = this.world.isOverIce(this.position.x, this.position.z);
    const grip = onIce ? 0.35 : 1;

    // --- throttle, brake, reverse -------------------------------------------
    const forward = input.move.y;
    if (forward > 0.05) {
      this.speed += THROTTLE * forward * dt;
    } else if (forward < -0.05) {
      // S brakes while rolling forward, and only backs up once stopped.
      if (this.speed > 0.5) this.speed -= BRAKE * -forward * dt;
      else this.speed -= THROTTLE * 0.7 * -forward * dt;
    }
    if (input.jumpHeld) {
      // Handbrake: bleed speed towards zero without swinging past it.
      const bleed = BRAKE * 1.2 * grip * dt;
      this.speed = Math.abs(this.speed) <= bleed ? 0 : this.speed - Math.sign(this.speed) * bleed;
    }

    // Drag and rolling resistance.
    this.speed -= this.speed * DRAG * dt;
    if (Math.abs(forward) < 0.05) this.speed -= Math.sign(this.speed) * ROLL * dt;
    if (Math.abs(this.speed) < 0.06) this.speed = 0;
    this.speed = clamp(this.speed, REVERSE_SPEED, MAX_SPEED);

    // --- steering ------------------------------------------------------------
    const steerInput = -input.move.x;
    this.steer = damp(this.steer, steerInput, 12, dt);
    // No turning standing still, and less of it flat out — plus ice does what
    // ice does.
    const bite = (Math.abs(this.speed) / (Math.abs(this.speed) + 7)) * grip;
    const turn = this.steer * MAX_STEER * bite * Math.sign(this.speed || 1);
    this.heading += turn * dt;

    // --- integrate + collide -------------------------------------------------
    const dirX = Math.sin(this.heading);
    const dirZ = Math.cos(this.heading);
    this.position.x += dirX * this.speed * dt;
    this.position.z += dirZ * this.speed * dt;
    this.resolve();

    // --- ground --------------------------------------------------------------
    let support = this.world.groundHeightAt(this.position.x, this.position.z);
    for (const c of this.nearby) {
      if (this.position.x + RADIUS <= c.minX || this.position.x - RADIUS >= c.maxX) continue;
      if (this.position.z + RADIUS <= c.minZ || this.position.z - RADIUS >= c.maxZ) continue;
      if (c.maxY <= this.position.y + CLIMB && c.maxY > support) support = c.maxY;
    }
    this.position.y = damp(this.position.y, support, 14, dt);

    // Cars and open water do not mix; nudge it back onto the ice.
    if (this.world.isOverOpenWater(this.position.x, this.position.z)) {
      this.position.z = this.position.z < 77 ? 61 : 94;
      this.speed *= -0.3;
    }

    // --- presentation --------------------------------------------------------
    this.wheelSpin += (this.speed / 0.36) * dt;
    for (const w of this.allWheels) w.rotation.x = this.wheelSpin;
    for (const p of this.frontWheels) p.rotation.y = damp(p.rotation.y, this.steer * 0.5, 12, dt);
    // Body roll into the corner and squat under power.
    this.bodyTilt = damp(this.bodyTilt, -turn * 0.16, 7, dt);
    this.group.rotation.z = this.bodyTilt;
    this.group.rotation.x = damp(this.group.rotation.x, clamp(-this.speed * 0.004, -0.03, 0.03), 6, dt);

    const lit = clamp(0.4 + Math.abs(this.speed) / 20, 0, 1);
    for (const h of this.headlights) h.intensity = damp(h.intensity, 80 * lit, 6, dt);
    this.beamPool.visible = true;
    (this.beamPool.material as THREE.MeshBasicMaterial).opacity = 0.3 + lit * 0.18;
    this.brakeLights.visible = input.jumpHeld || forward < -0.05;

    this.sync();
    this.updateCamera(dt, camera);
  }

  /** Push the car out of anything it has driven into, and scrub off speed. */
  private resolve() {
    const p = this.position;
    this.world.colliders.query(p.x - 6, p.z - 6, p.x + 6, p.z + 6, this.nearby);
    for (const c of this.nearby) {
      // Drivable (kerbs, bridge decks) and overhead geometry are not walls.
      if (c.maxY <= p.y + CLIMB) continue;
      if (c.minY > p.y + 1.8) continue;

      const nx = clamp(p.x, c.minX, c.maxX);
      const nz = clamp(p.z, c.minZ, c.maxZ);
      let dx = p.x - nx;
      let dz = p.z - nz;
      let d = Math.hypot(dx, dz);
      if (d >= RADIUS) continue;
      if (d < 1e-4) {
        // Dead centre: shove it out the nearest face.
        dx = p.x - (c.minX + c.maxX) / 2;
        dz = p.z - (c.minZ + c.maxZ) / 2;
        d = Math.hypot(dx, dz) || 1;
      }
      const push = (RADIUS - d) / d;
      p.x += dx * push;
      p.z += dz * push;
      this.speed *= 0.35;
    }
  }

  private updateCamera(dt: number, camera: THREE.PerspectiveCamera) {
    // The camera simply looks where the car is going.
    const back = 7.6 + Math.abs(this.speed) * 0.1;
    const desired = new THREE.Vector3(
      this.position.x - Math.sin(this.heading) * back,
      this.position.y + 3.1,
      this.position.z - Math.cos(this.heading) * back,
    );
    if (this.camPos.lengthSq() === 0) this.camPos.copy(desired);
    this.camPos.x = damp(this.camPos.x, desired.x, 5, dt);
    this.camPos.y = damp(this.camPos.y, desired.y, 6, dt);
    this.camPos.z = damp(this.camPos.z, desired.z, 5, dt);
    camera.position.copy(this.camPos);
    camera.lookAt(
      this.position.x + Math.sin(this.heading) * 6,
      this.position.y + 1.1,
      this.position.z + Math.cos(this.heading) * 6,
    );
  }

  /** Speed in km/h, for the HUD. */
  get kmh() {
    return Math.round(Math.abs(this.speed) * 3.6);
  }

  enter() {
    this.occupied = true;
    this.camPos.set(0, 0, 0);
  }

  exit() {
    this.occupied = false;
    this.speed = 0;
  }
}
