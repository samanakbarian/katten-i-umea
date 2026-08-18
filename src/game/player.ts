import * as THREE from "three";
import { BOUNDS, World } from "./city";
import { Cat } from "./cat";
import { Input } from "./input";
import { Collider, clamp, damp, shortestAngle } from "./utils";

const RADIUS = 0.17;
const HEIGHT = 0.34;
const STEP = 0.42; // a cat hops a kerb without thinking about it
const GRAVITY = 21;
const JUMP = 7.4;
const WALK = 3.4;
const RUN = 9.5;
const CLIMB_SPEED = 3.6;

export interface PlayerEvents {
  onLand?: (impact: number) => void;
  onJump?: (double: boolean) => void;
  onMeow?: () => void;
  onSplash?: () => void;
}

export class Player {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  camYaw = Math.PI;
  camPitch = 0.22;
  grounded = false;
  climbing = false;
  stamina = 1;
  wetTimer = 0;
  meowAge = 99;
  onIce = false;
  speed01 = 0;

  private jumpsLeft = 2;
  private coyote = 0;
  private jumpBuffer = 0;
  private turnRate = 0;
  private nearby: Collider[] = [];
  private wallNormal = new THREE.Vector3();
  touchingWall = false;
  private camPos = new THREE.Vector3();
  private camTarget = new THREE.Vector3();
  private lastGroundedPos = new THREE.Vector3();
  private crouchAmount = 0;

  constructor(
    private world: World,
    private cat: Cat,
    private camera: THREE.PerspectiveCamera,
    private events: PlayerEvents = {},
  ) {
    this.position.copy(world.spawn);
    this.lastGroundedPos.copy(world.spawn);
    this.camPos.set(world.spawn.x, world.spawn.y + 3, world.spawn.z + 5);
  }

  respawn() {
    this.position.copy(this.world.spawn);
    this.velocity.set(0, 0, 0);
    this.wetTimer = 0;
  }

  update(dt: number, input: Input) {
    this.meowAge += dt;
    if (input.meowPressed) {
      this.meowAge = 0;
      this.events.onMeow?.();
    }

    // --- camera orientation --------------------------------------------------
    const sens = input.touchActive ? 0.0035 : 0.0024;
    this.camYaw -= input.lookDelta.x * sens;
    this.camPitch = clamp(this.camPitch + input.lookDelta.y * sens, -0.3, 1.15);

    // --- desired movement in world space -------------------------------------
    const forward = new THREE.Vector3(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw));
    const right = new THREE.Vector3(Math.cos(this.camYaw), 0, -Math.sin(this.camYaw));
    const wish = new THREE.Vector3()
      .addScaledVector(forward, input.move.y)
      .addScaledVector(right, input.move.x);
    const wishLen = wish.length();
    if (wishLen > 0.001) wish.divideScalar(wishLen);

    const wet = this.wetTimer > 0;
    const sprinting = input.sprint && this.stamina > 0.02 && wishLen > 0.1 && !wet;
    const target = wet ? 1.5 : sprinting ? RUN : WALK * (input.crouch ? 0.45 : 1);
    const targetVel = wish.clone().multiplyScalar(target * Math.min(1, wishLen * 1.3));

    // --- stamina -------------------------------------------------------------
    if (sprinting) this.stamina -= dt * 0.16;
    else if (this.climbing) this.stamina -= dt * 0.2;
    else this.stamina += dt * (this.grounded ? 0.42 : 0.12);
    this.stamina = clamp(this.stamina, 0, 1);

    // --- acceleration --------------------------------------------------------
    const groundedish = this.grounded || this.climbing;
    const accel = groundedish ? (this.onIce ? 5 : 30) : 9;
    const friction = groundedish ? (this.onIce ? 0.6 : 11) : 0.6;
    const vx = this.velocity.x;
    const vz = this.velocity.z;
    if (wishLen > 0.05) {
      this.velocity.x = damp(vx, targetVel.x, accel, dt);
      this.velocity.z = damp(vz, targetVel.z, accel, dt);
    } else {
      this.velocity.x = damp(vx, 0, friction, dt);
      this.velocity.z = damp(vz, 0, friction, dt);
    }

    // --- jump, double jump, wall climb ---------------------------------------
    this.jumpBuffer = input.jumpPressed ? 0.15 : Math.max(0, this.jumpBuffer - dt);
    this.coyote = this.grounded ? 0.12 : Math.max(0, this.coyote - dt);

    this.climbing = false;
    if (
      this.touchingWall &&
      input.jumpHeld &&
      this.stamina > 0.02 &&
      !this.grounded &&
      wishLen > 0.1 &&
      wish.dot(this.wallNormal) < -0.2
    ) {
      // Scrambling up a wall or a birch trunk. Keep leaning into the surface so
      // contact — and therefore the climb — survives the next frame, and allow
      // a slower shuffle sideways along it.
      this.climbing = true;
      this.velocity.y = CLIMB_SPEED;
      const tangentX = this.wallNormal.z;
      const tangentZ = -this.wallNormal.x;
      const sideways = wish.x * tangentX + wish.z * tangentZ;
      this.velocity.x = -this.wallNormal.x * 2 + tangentX * sideways * 2;
      this.velocity.z = -this.wallNormal.z * 2 + tangentZ * sideways * 2;
      this.jumpsLeft = 1;
    } else if (this.jumpBuffer > 0 && (this.coyote > 0 || this.jumpsLeft > 0) && !wet) {
      const isDouble = this.coyote <= 0;
      this.velocity.y = JUMP * (isDouble ? 0.85 : 1);
      if (isDouble) {
        // The mid-air twist gives a little push in the direction you are holding.
        this.velocity.x += wish.x * 2.2;
        this.velocity.z += wish.z * 2.2;
      }
      this.jumpsLeft = isDouble ? 0 : this.jumpsLeft - 1;
      this.coyote = 0;
      this.jumpBuffer = 0;
      this.grounded = false;
      this.events.onJump?.(isDouble);
    }

    if (!this.climbing) this.velocity.y -= GRAVITY * dt;
    // A cat falls slower than a brick: terminal velocity, and a hold-space float.
    if (this.velocity.y < 0 && input.jumpHeld && !this.grounded) this.velocity.y += GRAVITY * 0.28 * dt;
    this.velocity.y = Math.max(this.velocity.y, -24);

    // --- integrate + collide -------------------------------------------------
    this.collideAndMove(dt);

    // --- water ---------------------------------------------------------------
    if (
      this.world.isOverOpenWater(this.position.x, this.position.z) &&
      this.position.y < -0.35 &&
      this.wetTimer <= 0
    ) {
      this.wetTimer = 2.2;
      this.events.onSplash?.();
    }
    if (this.wetTimer > 0) {
      this.wetTimer -= dt;
      this.velocity.y = Math.max(this.velocity.y, -0.4);
      this.position.y = Math.max(this.position.y, -0.95);
      if (this.wetTimer <= 0) {
        // Hauled out on the nearest ice shelf, thoroughly offended.
        const z = this.position.z < 77 ? 58 : 97;
        this.position.set(this.position.x, -0.5, z);
        this.velocity.set(0, 0, 0);
      }
    }

    // --- facing --------------------------------------------------------------
    const planarSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    this.speed01 = clamp(planarSpeed / RUN, 0, 1);
    if (planarSpeed > 0.35) {
      const desired = Math.atan2(this.velocity.x, this.velocity.z);
      const delta = shortestAngle(this.yaw, desired);
      const turn = delta * Math.min(1, dt * 11);
      this.yaw += turn;
      this.turnRate = damp(this.turnRate, clamp(delta * 1.6, -1, 1), 8, dt);
    } else {
      this.turnRate = damp(this.turnRate, 0, 8, dt);
    }

    this.crouchAmount = damp(this.crouchAmount, input.crouch ? 1 : 0, 12, dt);

    // --- drive the rig -------------------------------------------------------
    this.cat.root.position.copy(this.position);
    this.cat.root.rotation.y = this.yaw;
    const groundY = this.groundHeightBelow();
    this.cat.root.userData.heightAboveGround = this.position.y - groundY;
    this.cat.update(dt, {
      speed01: this.speed01,
      grounded: this.grounded,
      verticalVelocity: this.velocity.y,
      crouch: this.crouchAmount,
      climbing: this.climbing,
      meowAge: this.meowAge,
      turn: this.turnRate,
    });

    this.updateCamera(dt);
  }

  // ------------------------------------------------------------------ physics

  private aabbOverlap(c: Collider, x: number, y: number, z: number) {
    return (
      x + RADIUS > c.minX &&
      x - RADIUS < c.maxX &&
      z + RADIUS > c.minZ &&
      z - RADIUS < c.maxZ &&
      y + HEIGHT > c.minY &&
      y < c.maxY
    );
  }

  private collideAndMove(dt: number) {
    const prevY = this.position.y;
    const p = this.position;
    const reach = 3 + Math.max(Math.abs(this.velocity.x), Math.abs(this.velocity.z)) * dt;
    this.world.colliders.query(p.x - reach, p.z - reach, p.x + reach, p.z + reach, this.nearby);

    this.touchingWall = false;
    this.wallNormal.set(0, 0, 0);

    // --- horizontal, one axis at a time so we slide along walls ---------------
    for (const axis of ["x", "z"] as const) {
      const delta = this.velocity[axis] * dt;
      // A velocity of effectively zero must not trigger a resolution: the cat is
      // usually already touching something, and "resolving" that would shove it
      // to the far side of the building.
      if (Math.abs(delta) < 1e-4) continue;
      p[axis] += delta;
      for (const c of this.nearby) {
        if (!this.aabbOverlap(c, p.x, p.y, p.z)) continue;
        // Step up onto low obstacles instead of stopping dead.
        const stepUp = c.maxY - p.y;
        if (stepUp > 0 && stepUp <= STEP && this.velocity.y <= 0.1) {
          if (this.canStandAt(p.x, c.maxY + 0.001, p.z, c)) {
            p.y = c.maxY + 0.001;
            this.velocity.y = Math.max(this.velocity.y, 0);
            continue;
          }
        }
        // Push out the short way. Never further than the near face, whatever the
        // velocity says — a frame is at most half a metre, walls are thicker.
        const lo = (axis === "x" ? c.minX : c.minZ) - RADIUS - 0.001;
        const hi = (axis === "x" ? c.maxX : c.maxZ) + RADIUS + 0.001;
        const outward = p[axis] - lo < hi - p[axis] ? -1 : 1;
        p[axis] = outward < 0 ? lo : hi;
        this.velocity[axis] = 0;
        if (c.climbable && c.maxY > p.y + HEIGHT) {
          this.touchingWall = true;
          if (axis === "x") this.wallNormal.set(outward, 0, 0);
          else this.wallNormal.set(0, 0, outward);
        }
      }
    }

    // --- vertical ------------------------------------------------------------
    p.y += this.velocity.y * dt;

    let support = this.world.groundHeightAt(p.x, p.z);
    for (const c of this.nearby) {
      if (p.x + RADIUS <= c.minX || p.x - RADIUS >= c.maxX) continue;
      if (p.z + RADIUS <= c.minZ || p.z - RADIUS >= c.maxZ) continue;
      if (c.maxY <= prevY + 0.02 && c.maxY > support) support = c.maxY;
      // Bumped head on an overhang.
      if (
        this.velocity.y > 0 &&
        c.minY > prevY &&
        p.y + HEIGHT > c.minY &&
        prevY + HEIGHT <= c.minY + 0.02
      ) {
        p.y = c.minY - HEIGHT - 0.001;
        this.velocity.y = 0;
      }
    }

    const wasGrounded = this.grounded;
    if (p.y <= support) {
      const impact = -this.velocity.y;
      p.y = support;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.grounded = true;
      this.jumpsLeft = 2;
      if (!wasGrounded && impact > 3) this.events.onLand?.(impact);
      this.lastGroundedPos.copy(p);
    } else {
      this.grounded = false;
    }

    this.onIce =
      this.grounded &&
      this.world.isOverIce(p.x, p.z) &&
      Math.abs(p.y - this.world.groundHeightAt(p.x, p.z)) < 0.05;

    // Keep the cat inside Västerbotten.
    p.x = clamp(p.x, BOUNDS.minX, BOUNDS.maxX);
    p.z = clamp(p.z, BOUNDS.minZ, BOUNDS.maxZ);
    if (p.y < -30) this.respawn();
  }

  /** Is there room to stand at this spot, ignoring the collider we stepped onto? */
  private canStandAt(x: number, y: number, z: number, ignore: Collider) {
    for (const c of this.nearby) {
      if (c === ignore) continue;
      if (this.aabbOverlap(c, x, y, z)) return false;
    }
    return true;
  }

  private groundHeightBelow() {
    const p = this.position;
    let support = this.world.groundHeightAt(p.x, p.z);
    for (const c of this.nearby) {
      if (p.x + RADIUS <= c.minX || p.x - RADIUS >= c.maxX) continue;
      if (p.z + RADIUS <= c.minZ || p.z - RADIUS >= c.maxZ) continue;
      if (c.maxY <= p.y + 0.05 && c.maxY > support) support = c.maxY;
    }
    return support;
  }

  // ------------------------------------------------------------------- camera

  private updateCamera(dt: number) {
    // Third-person boom, pulled in when it would clip a building.
    const focusHeight = 0.36;
    this.camTarget.set(this.position.x, this.position.y + focusHeight, this.position.z);

    const wanted = 1.7 + this.speed01 * 0.7;
    const dir = new THREE.Vector3(
      Math.sin(this.camYaw) * Math.cos(this.camPitch),
      Math.sin(this.camPitch) + 0.12,
      Math.cos(this.camYaw) * Math.cos(this.camPitch),
    ).normalize();

    let dist = wanted;
    const steps = 9;
    for (let i = 1; i <= steps; i++) {
      const t = (i / steps) * wanted;
      const px = this.camTarget.x + dir.x * t;
      const py = this.camTarget.y + dir.y * t;
      const pz = this.camTarget.z + dir.z * t;
      if (py < this.world.groundHeightAt(px, pz) + 0.22) {
        dist = Math.max(0.6, t - wanted / steps);
        break;
      }
      let blocked = false;
      for (const c of this.nearby) {
        const pad = 0.22;
        if (
          px > c.minX - pad &&
          px < c.maxX + pad &&
          pz > c.minZ - pad &&
          pz < c.maxZ + pad &&
          py > c.minY - pad &&
          py < c.maxY + pad
        ) {
          blocked = true;
          break;
        }
      }
      if (blocked) {
        dist = Math.max(0.6, t - wanted / steps);
        break;
      }
    }

    const desired = new THREE.Vector3(
      this.camTarget.x + dir.x * dist,
      this.camTarget.y + dir.y * dist,
      this.camTarget.z + dir.z * dist,
    );
    // Snap in fast, ease out slow — no rubber-banding through walls.
    const lambda = desired.distanceTo(this.camPos) > 3 ? 24 : 12;
    this.camPos.x = damp(this.camPos.x, desired.x, lambda, dt);
    this.camPos.y = damp(this.camPos.y, desired.y, lambda, dt);
    this.camPos.z = damp(this.camPos.z, desired.z, lambda, dt);

    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
  }
}
