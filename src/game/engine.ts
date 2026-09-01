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
import { Coins } from "./money";
import {
  CAR_POS,
  HOUSE_POS,
  SHOP_POS,
  Shop,
  ShopItemState,
  buildCatHouse,
  buildShop,
} from "./shop";
import { Car } from "./car";

export type Quality = "low" | "high";

export interface HudState {
  fish: number;
  fishTotal: number;
  cream: number;
  birds: number;
  monkeys: number;
  monkeyTotal: number;
  money: number;
  coins: number;
  score: number;
  stamina: number;
  time: number;
  landmarks: { name: string; found: boolean }[];
  toast: { title: string; body: string; key: number } | null;
  finished: boolean;
  climbing: boolean;
  wet: boolean;
  fps: number;
  /** Contextual "press F to…" line, or null. */
  prompt: string | null;
  shopOpen: boolean;
  shopItems: ShopItemState[];
  shopMessage: string | null;
  driving: boolean;
  kmh: number;
  ownsHouse: boolean;
  ownsCar: boolean;
  /** Everything the minimap needs, in world units. */
  map: {
    player: { x: number; z: number; yaw: number };
    fish: { x: number; z: number }[];
    monkeys: { x: number; z: number }[];
    coins: { x: number; z: number }[];
    landmarks: { x: number; z: number; found: boolean }[];
    shop: { x: number; z: number };
    house: { x: number; z: number } | null;
    car: { x: number; z: number } | null;
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
  private coins: Coins;
  private shop = new Shop();
  private car: Car;
  private houseGroup: THREE.Group | null = null;
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
  private shopOpen = false;
  private shopMessage: string | null = null;
  private shopMessageTimer = 0;
  private prompt: string | null = null;
  /** Development only: pins the camera for screenshots. */
  private freeCam: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
  private houseRest = 0;

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
    this.coins = new Coins(this.world);
    this.scene.add(this.coins.group);

    this.scene.add(buildShop(this.world.colliders));
    this.car = new Car(this.world);
    this.scene.add(this.car.group);

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
        grant: (kr: number) => this.shop.add(kr),
        freecam: (px: number, py: number, pz: number, tx: number, ty: number, tz: number) => {
          this.freeCam = {
            pos: new THREE.Vector3(px, py, pz),
            target: new THREE.Vector3(tx, ty, tz),
          };
        },
        followcam: () => {
          this.freeCam = null;
        },
        drive: () => {
          if (this.car.spawned && !this.car.occupied) this.car.enter();
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
    const meowed = this.input.meowPressed && !this.car.occupied;
    if (this.car.occupied) {
      this.car.update(dt, this.input, this.camera);
      // The cat rides in the driver's seat, sitting up to see over the wheel.
      this.player.position.copy(this.car.doorStep);
      this.cat.root.position.copy(this.car.seat);
      this.cat.root.rotation.y = this.car.heading;
      this.cat.root.userData.heightAboveGround = 0;
      this.cat.update(dt, {
        speed01: 0,
        grounded: true,
        verticalVelocity: 0,
        crouch: 1,
        climbing: false,
        meowAge: this.player.meowAge,
        turn: 0,
      });
      this.player.meowAge += dt;
    } else {
      this.player.update(dt, this.input);
      if (this.car.spawned) this.car.rest(dt);
    }
    this.handleInteraction();
    this.input.endFrame();

    this.world.update(dt, this.elapsed);
    this.sky.update(dt, this.elapsed, this.camera);

    // Shadow camera rides along with whatever the player is currently being.
    const p = this.car.occupied ? this.car.position : this.player.position;
    this.sun.position.set(p.x - 34, p.y + 46, p.z - 52);
    this.sun.target.position.set(p.x, p.y, p.z);
    this.sun.target.updateMatrixWorld();
    this.catLight.position.set(p.x, p.y + 1.1, p.z);

    const got = this.pickups.update(dt, this.elapsed, p);
    if (got.fish) {
      this.score += 100;
      this.shop.add(15);
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
      this.shop.add(20);
      this.player.stamina = 1;
      this.audio.purr(1.1);
      this.showToast("Grädde", "Stamina restored. Purring at maximum.");
    }

    const rescued = this.monkeys.update(dt, this.elapsed, p, this.player.yaw);
    if (rescued) {
      this.score += 150 * rescued;
      this.shop.add(50 * rescued);
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

    // A car sweeps up coins over a much wider swathe than a cat's paw.
    const earned = this.coins.update(dt, this.elapsed, p, this.car.occupied ? 2.6 : 0.9);
    if (earned) {
      this.shop.add(earned);
      this.score += earned;
      this.audio.coin();
    }

    const startled = this.birds.update(dt, this.elapsed, p, meowed);
    if (startled) {
      this.birdsScared += startled;
      this.score += startled * 15;
      this.shop.add(startled * 3);
      this.audio.flap();
    }

    if (this.houseRest > 0) this.houseRest -= dt;
    this.checkLandmarks();

    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toast = null;
    }
    if (this.shopMessageTimer > 0) {
      this.shopMessageTimer -= dt;
      if (this.shopMessageTimer <= 0) this.shopMessage = null;
    }

    if (this.freeCam) {
      this.camera.position.copy(this.freeCam.pos);
      this.camera.lookAt(this.freeCam.target);
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

  /**
   * One key does everything: shop at the kiosk, sleep in the house, get in and
   * out of the car. Which of those it is depends on what the cat is standing
   * next to, and the HUD shows the same answer as a prompt.
   */
  private handleInteraction() {
    const p = this.player.position;
    const near = (v: THREE.Vector3, r: number) =>
      (p.x - v.x) ** 2 + (p.z - v.z) ** 2 < r * r;

    if (this.car.occupied) {
      this.prompt = "F — kliv ur bilen";
      if (this.input.interactPressed) {
        this.car.exit();
        this.player.position.copy(this.car.doorStep);
        this.player.velocity.set(0, 0, 0);
        this.showToast("Parkerad", "Bilen står kvar där du lämnade den.");
      }
      return;
    }

    if (near(SHOP_POS, 6)) {
      this.prompt = "F — handla i Zoobutiken";
      if (this.input.interactPressed) this.openShop();
      return;
    }
    if (this.car.spawned && near(this.car.position, 4)) {
      this.prompt = "F — kör bilen";
      if (this.input.interactPressed) {
        this.car.enter();
        this.audio.engineStart();
        this.showToast("Bilen igång", "W gasar, S bromsar och backar, A och D styr. Space är handbroms.");
      }
      return;
    }
    if (this.shop.ownsHouse && near(HOUSE_POS, 4.5)) {
      this.prompt = "F — sov i katthuset";
      if (this.input.interactPressed && this.houseRest <= 0) {
        this.player.stamina = 1;
        this.houseRest = 2;
        this.audio.purr(1.8);
        this.showToast("Hemma", "Kudden är varm. Konditionen är återställd.");
      }
      return;
    }
    this.prompt = null;
  }

  /** Opens the shop overlay; the loop stops until the HUD closes it again. */
  openShop() {
    if (this.shopOpen) return;
    this.shopOpen = true;
    this.shopMessage = null;
    this.emitState();
    this.pause();
  }

  closeShop() {
    this.shopOpen = false;
    this.shopMessage = null;
    this.resume();
  }

  /** Called by the HUD when a line in the catalogue is clicked. */
  buy(id: string) {
    const result = this.shop.buy(id);
    if (!result.ok) {
      this.shopMessage = result.reason ?? "Det gick inte.";
      this.shopMessageTimer = 4;
      this.audio.deny();
      this.emitState();
      return;
    }
    const item = result.item!;
    if (item.kind === "coat" && item.coat) {
      this.cat.setCoat(item.coat);
      this.shopMessage = result.equippedOnly ? `${item.name} på.` : `${item.name} köpt och påtagen.`;
      this.audio.purr(0.8);
    } else if (item.kind === "house") {
      this.houseGroup = buildCatHouse();
      this.scene.add(this.houseGroup);
      this.shopMessage = "Katthuset står på torget.";
      this.audio.fanfare();
    } else if (item.kind === "car") {
      // Parked on the street outside, pointing down it.
      this.car.spawn(CAR_POS.clone(), Math.PI / 2);
      this.shopMessage = "Bilen står parkerad utanför.";
      this.audio.fanfare();
    }
    this.shopMessageTimer = 4;
    this.emitState();
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
        this.shop.add(100);
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
      money: this.shop.money,
      coins: this.coins.collected,
      score: this.score,
      stamina: this.player.stamina,
      time: this.elapsed,
      landmarks: this.world.landmarks.map((l) => ({ name: l.name, found: l.found })),
      toast: this.toast,
      finished: this.finished,
      climbing: this.player.climbing,
      wet: this.player.wetTimer > 0,
      fps: Math.round(this.fpsAvg),
      prompt: this.prompt,
      shopOpen: this.shopOpen,
      shopItems: this.shop.state(),
      shopMessage: this.shopMessage,
      driving: this.car.occupied,
      kmh: this.car.kmh,
      ownsHouse: this.shop.ownsHouse,
      ownsCar: this.shop.ownsCar,
      map: {
        player: this.car.occupied
          ? { x: this.car.position.x, z: this.car.position.z, yaw: this.car.heading }
          : { x: this.player.position.x, z: this.player.position.z, yaw: this.player.yaw },
        fish: remaining,
        monkeys: this.monkeys.remaining,
        coins: this.coins.remaining,
        landmarks: this.world.landmarks.map((l) => ({
          x: l.position.x,
          z: l.position.z,
          found: l.found,
        })),
        shop: { x: SHOP_POS.x, z: SHOP_POS.z },
        house: this.shop.ownsHouse ? { x: HOUSE_POS.x, z: HOUSE_POS.z } : null,
        car: this.car.spawned ? { x: this.car.position.x, z: this.car.position.z } : null,
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
