import { clamp } from "./utils";

/** Keyboard + mouse-look + touch, normalised into one small state object. */
export class Input {
  move = { x: 0, y: 0 }; // -1..1, y is forward
  lookDelta = { x: 0, y: 0 };
  sprint = false;
  /** Edge flags for this frame — valid between beginFrame() and endFrame(). */
  jumpPressed = false;
  jumpHeld = false;
  meowPressed = false;
  crouch = false;
  pointerLocked = false;
  touchActive = false;

  // Presses land whenever the browser feels like it, which may be halfway
  // through a frame. Latch them so a tap is never swallowed.
  private jumpLatch = false;
  private meowLatch = false;
  private keys = new Set<string>();
  private buttons = new Set<string>();
  private touchLook: { id: number; x: number; y: number } | null = null;
  private touchStick: { id: number; ox: number; oy: number; x: number; y: number } | null = null;
  private disposers: (() => void)[] = [];

  constructor(private element: HTMLElement) {
    const onKey = (e: KeyboardEvent, down: boolean) => {
      const code = e.code;
      if (
        [
          "KeyW", "KeyA", "KeyS", "KeyD", "KeyE", "KeyC", "Space",
          "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight",
        ].includes(code)
      ) {
        e.preventDefault();
      }
      if (down) {
        if (!this.keys.has(code)) {
          if (code === "Space") this.jumpLatch = true;
          if (code === "KeyE") this.meowLatch = true;
        }
        this.keys.add(code);
      } else {
        this.keys.delete(code);
      }
    };

    const kd = (e: KeyboardEvent) => onKey(e, true);
    const ku = (e: KeyboardEvent) => onKey(e, false);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    this.disposers.push(() => window.removeEventListener("keydown", kd));
    this.disposers.push(() => window.removeEventListener("keyup", ku));

    const onMouseMove = (e: MouseEvent) => {
      if (!this.pointerLocked) return;
      this.lookDelta.x += e.movementX;
      this.lookDelta.y += e.movementY;
    };
    const onLockChange = () => {
      this.pointerLocked = document.pointerLockElement === this.element;
      if (!this.pointerLocked) this.keys.clear();
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("pointerlockchange", onLockChange);
    this.disposers.push(() => document.removeEventListener("mousemove", onMouseMove));
    this.disposers.push(() => document.removeEventListener("pointerlockchange", onLockChange));

    // --- touch ---------------------------------------------------------------
    const half = () => window.innerWidth / 2;
    const ts = (e: TouchEvent) => {
      this.touchActive = true;
      for (const t of Array.from(e.changedTouches)) {
        if (t.clientX < half() && !this.touchStick) {
          this.touchStick = { id: t.identifier, ox: t.clientX, oy: t.clientY, x: t.clientX, y: t.clientY };
        } else if (!this.touchLook) {
          this.touchLook = { id: t.identifier, x: t.clientX, y: t.clientY };
        }
      }
    };
    const tm = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (this.touchStick && t.identifier === this.touchStick.id) {
          this.touchStick.x = t.clientX;
          this.touchStick.y = t.clientY;
        } else if (this.touchLook && t.identifier === this.touchLook.id) {
          this.lookDelta.x += (t.clientX - this.touchLook.x) * 1.4;
          this.lookDelta.y += (t.clientY - this.touchLook.y) * 1.4;
          this.touchLook.x = t.clientX;
          this.touchLook.y = t.clientY;
        }
      }
      e.preventDefault();
    };
    const te = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (this.touchStick && t.identifier === this.touchStick.id) this.touchStick = null;
        if (this.touchLook && t.identifier === this.touchLook.id) this.touchLook = null;
      }
    };
    element.addEventListener("touchstart", ts, { passive: false });
    element.addEventListener("touchmove", tm, { passive: false });
    element.addEventListener("touchend", te);
    element.addEventListener("touchcancel", te);
    this.disposers.push(() => element.removeEventListener("touchstart", ts));
    this.disposers.push(() => element.removeEventListener("touchmove", tm));
    this.disposers.push(() => element.removeEventListener("touchend", te));
    this.disposers.push(() => element.removeEventListener("touchcancel", te));
  }

  /** Called by the on-screen buttons on touch devices. */
  setButton(name: "jump" | "sprint" | "meow" | "crouch", down: boolean) {
    if (down) {
      if (!this.buttons.has(name)) {
        if (name === "jump") this.jumpLatch = true;
        if (name === "meow") this.meowLatch = true;
      }
      this.buttons.add(name);
    } else {
      this.buttons.delete(name);
    }
  }

  requestPointerLock() {
    // Chrome returns a promise that rejects if the gesture has already been
    // spent; that is fine, the player can click again.
    const r = this.element.requestPointerLock?.() as unknown;
    if (r && typeof (r as Promise<void>).catch === "function") {
      (r as Promise<void>).catch(() => undefined);
    }
  }

  /** Refresh derived state; call once at the top of every frame. */
  beginFrame() {
    this.jumpPressed = this.jumpLatch;
    this.meowPressed = this.meowLatch;
    this.jumpLatch = false;
    this.meowLatch = false;

    let x = 0;
    let y = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) y += 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) y -= 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) x -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) x += 1;

    if (this.touchStick) {
      const dx = this.touchStick.x - this.touchStick.ox;
      const dy = this.touchStick.y - this.touchStick.oy;
      const max = 60;
      x += clamp(dx / max, -1, 1);
      y += clamp(-dy / max, -1, 1);
    }

    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    this.move.x = x;
    this.move.y = y;

    this.sprint =
      this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") || this.buttons.has("sprint");
    this.crouch = this.keys.has("KeyC") || this.buttons.has("crouch");
    this.jumpHeld = this.keys.has("Space") || this.buttons.has("jump");
  }

  /** Clear the accumulated look delta once the frame has used it. */
  endFrame() {
    this.lookDelta.x = 0;
    this.lookDelta.y = 0;
  }

  /** The virtual stick position for the on-screen HUD, or null. */
  get stick() {
    if (!this.touchStick) return null;
    return {
      ox: this.touchStick.ox,
      oy: this.touchStick.oy,
      dx: clamp(this.touchStick.x - this.touchStick.ox, -60, 60),
      dy: clamp(this.touchStick.y - this.touchStick.oy, -60, 60),
    };
  }

  dispose() {
    this.disposers.forEach((d) => d());
    this.disposers.length = 0;
  }
}
