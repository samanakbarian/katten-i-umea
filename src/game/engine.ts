import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { World, lampGlow } from "./city";
import { Cat } from "./cat";
import { GameAudio } from "./audio";
import { Input } from "./input";
import { Birds, Pickups } from "./pickups";
import { Monkeys } from "./monkeys";
import { Player } from "./player";
import { Sky } from "./sky";

export type Quality = "low" | "high";

export interface HudState {
  fish: number;
  fishTotal: number;
  cream: number;
  birds: number;
  monkeys: number;
  monkeyTotal: number;
  score: number;
  stamina: number;
  time: number;
  landmarks: { name: string; found: boolean }[];
  toast: { title: string; body: string; key: number } | null;
  finished: boolean;
  climbing: boolean;
  wet: boolean;
  fps: number;
  /** Everything the minimap needs, in world units. */
  map: {
    player: { x: number; z: number; yaw: number };
    fish: { x: number; z: number }[];
    monkeys: { x: number; z: number }[];
    landmarks: { x: number; z: number; found: boolean }[];
  };
}

export interface GameCallbacks {
  onState: (s: HudState) => void;
  onReady: () => void;
}

const FISH_TOTAL = 30;
const MONKEY_TOTAL = 12;

export class Game {
  readonly input: Input;
  readonly audio = new GameAudio();
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private composer?: EffectComposer;
  private bloom?: UnrealBloomPass;
  private sky: Sky;
  private world: World;
  private cat: Cat;
  private player: Player;
  private pickups: Pickups;
  private birds: Birds;
  private monkeys: Monkeys;
  private sun: THREE.DirectionalLight;
  private catLight: THREE.PointLight;

  private clock = new THREE.Clock();
  private raf = 0;
  private running = false;
  private elapsed = 0;
  private score = 0;
  private birdsScared = 0;
  private toast: HudState["toast"] = null;
  private toastTimer = 0;
  private fpsAvg = 60;
  private pixelRatio: number;
  private adaptTimer = 0;
  private finished = false;
  private hudAccumulator = 0;

  constructor(
    private container: HTMLElement,
    private canvas: HTMLCanvasElement,
    private quality: Quality,
    private callbacks: GameCallbacks,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: quality === "high",
      powerPreference: "high-performance",
      stencil: false,
    });
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, quality === "high" ? 1.75 : 1);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = quality === "high";
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 1200);

    // --- sky, fog, environment ----------------------------------------------
    this.sky = new Sky(quality);
    this.scene.add(this.sky.group);
    this.scene.fog = new THREE.FogExp2(this.sky.fogColor.getHex(), 0.0042);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = this.sky.buildEnvScene();
    const env = pmrem.fromScene(envScene, 0.04, 1, 2000);
    this.scene.environment = env.texture;
    this.scene.environmentIntensity = 0.45;
    pmrem.dispose();

    // --- lighting -------------------------------------------------------------
    // It is half past three in January: almost all the light is sky, lamps and
    // whatever the snow bounces back up at you.
    const hemi = new THREE.HemisphereLight(0x3d5c8f, 0x223050, 0.4);
    this.scene.add(hemi);

    this.sun = new THREE.DirectionalLight(0xffc08a, 0.55);
    this.sun.position.copy(this.sky.sunDirection).multiplyScalar(-60).setY(28);
    this.sun.castShadow = quality === "high";
    if (this.sun.shadow) {
      const s = 34;
      this.sun.shadow.mapSize.set(2048, 2048);
      this.sun.shadow.camera.left = -s;
      this.sun.shadow.camera.right = s;
      this.sun.shadow.camera.top = s;
      this.sun.shadow.camera.bottom = -s;
      this.sun.shadow.camera.near = 1;
      this.sun.shadow.camera.far = 160;
      this.sun.shadow.bias = -0.0009;
      this.sun.shadow.normalBias = 0.03;
    }
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // Cool bounce from the aurora side, so shadows are not dead black.
    const fill = new THREE.DirectionalLight(0x7fd8c8, 0.16);
    fill.position.set(40, 60, 60);
    this.scene.add(fill);

    // --- world ---------------------------------------------------------------
    this.world = new World(quality);
    this.scene.add(this.world.group);
    this.scene.add(lampGlow(this.world.lampLights));

    this.cat = new Cat();
    this.scene.add(this.cat.root);

    this.pickups = new Pickups(this.world, FISH_TOTAL);
    this.scene.add(this.pickups.group);
    this.birds = new Birds(this.world);
    this.scene.add(this.birds.group);
    this.monkeys = new Monkeys(this.world, MONKEY_TOTAL);
    this.scene.add(this.monkeys.group);

    // A soft warm light travelling with the cat keeps it readable at night.
    this.catLight = new THREE.PointLight(0xffe6cc, 0.8, 5, 2);
    this.catLight.position.set(0, 1.4, 0);
    this.scene.add(this.catLight);

    this.player = new Player(this.world, this.cat, this.camera, {
      onJump: (double) => {
        this.audio.jump();
        if (double) this.pickups.burst(this.player.position.clone().setY(this.player.position.y + 0.2), new THREE.Color("#bfe9ff"), 10);
      },
      onLand: (impact) => this.audio.land(impact),
      onMeow: () => this.audio.meow(),
      onSplash: () => {
        this.audio.splash();
        this.showToast("Blöt katt!", "Umeälven is freezing. Shake it off on the ice.");
      },
    });

    this.input = new Input(canvas);

    // --- post processing -----------------------------------------------------
    if (quality === "high") {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.8, 0.85);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }

    this.resize();
    this.callbacks.onReady();

    if (process.env.NODE_ENV !== "production") {
      // Handy for poking at the world from the console or a screenshot script.
      (window as unknown as { __katt?: unknown }).__katt = {
        teleport: (x: number, y: number, z: number) => {
          this.player.position.set(x, y, z);
          this.player.velocity.set(0, 0, 0);
        },
        look: (yaw: number, pitch: number) => {
          this.player.camYaw = yaw;
          this.player.camPitch = pitch;
        },
        debug: () => ({
          pos: this.player.position.toArray().map((v) => Math.round(v * 10) / 10),
          vel: this.player.velocity.toArray().map((v) => Math.round(v * 10) / 10),
          grounded: this.player.grounded,
          climbing: this.player.climbing,
          wall: this.player.touchingWall,
          jumpHeld: this.input.jumpHeld,
          stam: Math.round(this.player.stamina * 100) / 100,
          yaw: Math.round(this.player.camYaw * 100) / 100,
          found: this.world.landmarks.filter((l) => l.found).map((l) => l.name),
          parade: this.monkeys.paradeDebug(this.player.position),
        }),
      };
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.clock.getDelta();
    this.audio.start();
    this.input.requestPointerLock();
    this.loop();
  }

  pause() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  resume() {
    if (this.running) return;
    this.running = true;
    this.clock.getDelta();
    this.loop();
  }

  get isRunning() {
    return this.running;
  }

  showToast(title: string, body: string) {
    this.toast = { title, body, key: Date.now() + Math.random() };
    this.toastTimer = 4.5;
  }

  resize = () => {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.bloom?.setSize(w, h);
  };

  private loop = () => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.elapsed += dt;

    this.fpsAvg = this.fpsAvg * 0.92 + (1 / Math.max(dt, 0.0001)) * 0.08;
    this.adaptQuality(dt);

    this.input.beginFrame();
    const meowed = this.input.meowPressed;
    this.player.update(dt, this.input);
    this.input.endFrame();

    this.world.update(dt, this.elapsed);
    this.sky.update(dt, this.elapsed, this.camera);

    // Shadow camera rides along with the cat.
    const p = this.player.position;
    this.sun.position.set(p.x - 34, p.y + 46, p.z - 52);
    this.sun.target.position.set(p.x, p.y, p.z);
    this.sun.target.updateMatrixWorld();
    this.catLight.position.set(p.x, p.y + 1.1, p.z);

    const got = this.pickups.update(dt, this.elapsed, p);
    if (got.fish) {
      this.score += 100;
      this.audio.pickup(this.pickups.fishTaken);
      if (this.pickups.fishTaken === FISH_TOTAL && !this.finished) {
        this.finished = true;
        this.audio.fanfare();
        this.showToast(
          "Alla strömmingar!",
          `Every fish in Umeå, found in ${formatTime(this.elapsed)}. The gulls are furious.`,
        );
      }
    }
    if (got.cream) {
      this.score += 40;
      this.player.stamina = 1;
      this.audio.purr(1.1);
      this.showToast("Grädde", "Stamina restored. Purring at maximum.");
    }

    const rescued = this.monkeys.update(dt, this.elapsed, p, this.player.yaw);
    if (rescued) {
      this.score += 150 * rescued;
      this.audio.squeak();
      this.pickups.burst(
        p.clone().setY(p.y + 0.35),
        new THREE.Color("#ffd08a"),
        20 * rescued,
      );
      if (this.monkeys.rescued === MONKEY_TOTAL) {
        this.showToast(
          "Hela apflocken!",
          `All ${MONKEY_TOTAL} monkeys found. They are following you and they are not going home.`,
        );
      } else if (this.monkeys.rescued === 1) {
        this.showToast("En liten apa!", "It has decided you are its cat now. It will follow you.");
      } else {
        this.showToast(
          "Apa hittad",
          `${this.monkeys.rescued} of ${MONKEY_TOTAL} monkeys are trailing along behind you.`,
        );
      }
    }

    const startled = this.birds.update(dt, this.elapsed, p, meowed);
    if (startled) {
      this.birdsScared += startled;
      this.score += startled * 15;
      this.audio.flap();
    }

    this.checkLandmarks();

    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toast = null;
    }

    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);

    this.hudAccumulator += dt;
    if (this.hudAccumulator > 0.1) {
      this.hudAccumulator = 0;
      this.emitState();
    }
  };

  /** Drop resolution before the frame rate, if the machine is struggling. */
  private adaptQuality(dt: number) {
    this.adaptTimer += dt;
    if (this.adaptTimer < 3) return;
    this.adaptTimer = 0;
    if (this.fpsAvg < 40 && this.pixelRatio > 0.7) {
      this.pixelRatio = Math.max(0.7, this.pixelRatio - 0.25);
      this.renderer.setPixelRatio(this.pixelRatio);
      this.resize();
    } else if (this.fpsAvg > 58 && this.pixelRatio < Math.min(window.devicePixelRatio || 1, 1.75)) {
      this.pixelRatio = Math.min(Math.min(window.devicePixelRatio || 1, 1.75), this.pixelRatio + 0.25);
      this.renderer.setPixelRatio(this.pixelRatio);
      this.resize();
    }
  }

  private checkLandmarks() {
    const p = this.player.position;
    for (const lm of this.world.landmarks) {
      if (lm.found) continue;
      const dx = p.x - lm.position.x;
      const dz = p.z - lm.position.z;
      if (dx * dx + dz * dz < lm.radius * lm.radius) {
        lm.found = true;
        this.score += 250;
        this.audio.purr(0.9);
        this.showToast(lm.name, lm.blurb);
      }
    }
  }

  private emitState() {
    const remaining = this.pickups.fish.filter((f) => !f.taken).map((f) => ({ x: f.home.x, z: f.home.z }));
    this.callbacks.onState({
      fish: this.pickups.fishTaken,
      fishTotal: FISH_TOTAL,
      cream: this.pickups.creamTaken,
      birds: this.birdsScared,
      monkeys: this.monkeys.rescued,
      monkeyTotal: MONKEY_TOTAL,
      score: this.score,
      stamina: this.player.stamina,
      time: this.elapsed,
      landmarks: this.world.landmarks.map((l) => ({ name: l.name, found: l.found })),
      toast: this.toast,
      finished: this.finished,
      climbing: this.player.climbing,
      wet: this.player.wetTimer > 0,
      fps: Math.round(this.fpsAvg),
      map: {
        player: { x: this.player.position.x, z: this.player.position.z, yaw: this.player.yaw },
        fish: remaining,
        monkeys: this.monkeys.remaining,
        landmarks: this.world.landmarks.map((l) => ({
          x: l.position.x,
          z: l.position.z,
          found: l.found,
        })),
      },
    });
  }

  dispose() {
    this.pause();
    this.input.dispose();
    this.audio.dispose();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m?.dispose();
    });
    this.composer?.dispose();
    this.renderer.dispose();
  }
}

export function formatTime(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
