import * as THREE from "three";
import { CoatColors, WHITE_COAT } from "./cat";
import { ColliderGrid, box, cylinder, makeCollider, paint } from "./utils";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { radialSprite, snowTexture } from "./textures";

/**
 * Zoobutiken on Rådhustorget: the one place in Umeå that will sell a cat a new
 * coat, a house of its own, and — for a cat who has been extremely thorough
 * about windowsills — a car.
 */

export type ItemKind = "coat" | "house" | "car" | "dog";

export interface ShopItem {
  id: string;
  name: string;
  blurb: string;
  price: number;
  kind: ItemKind;
  coat?: CoatColors;
}

export interface ShopItemState extends ShopItem {
  owned: boolean;
  equipped: boolean;
  affordable: boolean;
}

export const CATALOGUE: ShopItem[] = [
  {
    id: "coat-white",
    name: "Vit",
    blurb: "Ren snö. Ingår.",
    price: 0,
    kind: "coat",
    coat: WHITE_COAT,
  },
  {
    id: "coat-ginger",
    name: "Rödrandig",
    blurb: "Klassisk Umeå-bondkatt, morotsfärgad.",
    price: 200,
    kind: "coat",
    coat: {
      base: "#c9904b",
      stripe: "#6b4321",
      under: "#f2e7d5",
      tailTip: "#5d3a1c",
      eye: "#3f7a2f",
      eyeGlow: "#8fe07a",
    },
  },
  {
    id: "coat-grey",
    name: "Gråtigrerad",
    blurb: "Silverfärgad päls, byggd för skymning.",
    price: 250,
    kind: "coat",
    coat: {
      base: "#9aa2ab",
      stripe: "#454c55",
      under: "#e4e8ee",
      tailTip: "#3a4048",
      eye: "#b08a2e",
      eyeGlow: "#ffd06a",
    },
  },
  {
    id: "coat-black",
    name: "Svart",
    blurb: "Osynlig mellan lyktstolparna. Ögonen är inte det.",
    price: 350,
    kind: "coat",
    coat: {
      base: "#2c2b30",
      stripe: "#171619",
      under: "#3c3a40",
      tailTip: "#141316",
      eye: "#b8a03a",
      eyeGlow: "#ffe27a",
    },
  },
  {
    id: "coat-calico",
    name: "Sköldpadd",
    blurb: "Tre färger, noll symmetri, mycket åsikter.",
    price: 450,
    kind: "coat",
    coat: {
      base: "#d8b483",
      stripe: "#4a2f22",
      under: "#fbf3e6",
      tailTip: "#c26a2e",
      eye: "#3f7a2f",
      eyeGlow: "#9ae88a",
    },
  },
  {
    id: "coat-russian",
    name: "Rysk blå",
    blurb: "Blåskimrande. Vet om det.",
    price: 550,
    kind: "coat",
    coat: {
      base: "#8296a8",
      stripe: "#5c6b7a",
      under: "#aebecc",
      tailTip: "#54626f",
      eye: "#2f8a63",
      eyeGlow: "#7cf0c0",
    },
  },
  {
    id: "coat-gold",
    name: "Guldkatt",
    blurb: "Fullständigt onödig. Du vill ha den ändå.",
    price: 900,
    kind: "coat",
    coat: {
      base: "#e0b458",
      stripe: "#a8791f",
      under: "#fdf0cc",
      tailTip: "#8a5f12",
      eye: "#7a4bd8",
      eyeGlow: "#c9a0ff",
    },
  },
  {
    id: "house",
    name: "Katthus",
    blurb: "Eget hus på torget, med kudde och lampa. Sov i det för att vila upp dig.",
    price: 700,
    kind: "house",
  },
  {
    id: "dog",
    name: "Simba",
    blurb: "En hund. Följer dig överallt, sätter sig när du stannar, och duvorna gillar honom inte.",
    price: 1200,
    kind: "dog",
  },
  {
    id: "car",
    name: "Bil",
    blurb: "En liten kombi. Umeå är stort och tassarna är små.",
    price: 1400,
    kind: "car",
  },
];

/** Where the shop and the things you buy from it stand. */
export const SHOP_POS = new THREE.Vector3(-46, 0, 22);
// Out on the open part of Rådhustorget: clear of the market stalls, and well
// clear of Rådhuset itself, whose footprint reaches z = 22.5.
export const HOUSE_POS = new THREE.Vector3(-44, 0, 12);
export const CAR_POS = new THREE.Vector3(-57, 0, 14);

/**
 * A soft column of light standing over something you own, so you can find it
 * again from the other side of the square. Additive and depth-tested off at the
 * top so it reads through the snowfall.
 */
export function beacon(color: THREE.ColorRepresentation, height = 16) {
  const geo = new THREE.CylinderGeometry(0.45, 0.9, height, 12, 1, true);
  geo.translate(0, height / 2, 0);
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createLinearGradient(0, 64, 0, 0);
  grad.addColorStop(0, "rgba(255,255,255,0.85)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.28)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 4, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;

  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      map: tex,
      color: new THREE.Color(color),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
      opacity: 0.5,
    }),
  );
  mesh.renderOrder = 6;
  return mesh;
}

/** The kiosk itself: a small lit shed with a sign, built into the world. */
export function buildShop(colliders: ColliderGrid) {
  const group = new THREE.Group();
  const painted: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  const x = SHOP_POS.x;
  const z = SHOP_POS.z;

  painted.push(box(6, 3.2, 4.5, x, 0, z, "#7d2f36"));
  painted.push(box(6.6, 0.35, 5.1, x, 3.2, z, "#f0ece2"));
  // Counter hatch facing the square, with an awning over it.
  painted.push(box(0.25, 1.1, 3, x + 3, 1.1, z, "#2a2429"));
  painted.push(box(1.6, 0.18, 3.4, x + 3.7, 2.5, z, "#c9843c"));
  glow.push(box(0.12, 1.0, 2.8, x + 3.05, 1.15, z, "#ffdca0"));
  // Sign.
  glow.push(box(0.16, 0.7, 3.2, x + 3.15, 3.4, z, "#7fe0ff"));
  painted.push(box(0.5, 0.9, 3.6, x + 3.3, 3.3, z, "#221c20"));

  const snow = new THREE.Mesh(
    mergeGeometries([box(6.6, 0.22, 5.1, x, 3.55, z, 0xffffff)], false)!,
    new THREE.MeshStandardMaterial({
      map: snowTexture(),
      vertexColors: true,
      color: 0xf4f8ff,
      roughness: 0.8,
    }),
  );
  group.add(snow);

  group.add(
    new THREE.Mesh(
      mergeGeometries(painted, false)!,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.05 }),
    ),
  );
  group.add(
    new THREE.Mesh(
      mergeGeometries(glow, false)!,
      new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    ),
  );

  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: radialSprite("rgba(255,214,150,1)", "rgba(255,150,60,0)"),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0.4,
      toneMapped: false,
    }),
  );
  halo.position.set(x + 3.2, 2.6, z);
  halo.scale.setScalar(6);
  group.add(halo);

  const column = beacon("#7fe0ff", 20);
  column.position.set(x, 3.6, z);
  group.add(column);

  colliders.add(makeCollider(x, z, 6, 3.6, 4.5));
  return group;
}

/**
 * The cat house. Built only once bought, so it appears on the square with a
 * puff of sparkles the moment you can afford it.
 */
export function buildCatHouse(): { group: THREE.Group; light: THREE.PointLight } {
  const group = new THREE.Group();
  const x = HOUSE_POS.x;
  const z = HOUSE_POS.z;
  const painted: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];

  // Walls with a doorway, framed by two posts and a lintel. The opening faces
  // -z, which is the way the cat comes across the square.
  painted.push(box(2.6, 1.7, 0.25, x, 0, z + 1.15, "#a8632f"));
  painted.push(box(0.25, 1.7, 2.3, x - 1.2, 0, z, "#a8632f"));
  painted.push(box(0.25, 1.7, 2.3, x + 1.2, 0, z, "#a8632f"));
  painted.push(box(0.75, 1.7, 0.25, x - 0.92, 0, z - 1.15, "#a8632f"));
  painted.push(box(0.75, 1.7, 0.25, x + 0.92, 0, z - 1.15, "#a8632f"));
  painted.push(box(2.6, 0.45, 0.25, x, 1.25, z - 1.15, "#a8632f"));

  // Pitched roof.
  for (const s of [-1, 1]) {
    const g = new THREE.BoxGeometry(1.75, 0.2, 2.9);
    g.rotateZ(s * 0.72);
    g.translate(x + s * -0.68, 2.15, z);
    paint(g, "#6d3b1c");
    painted.push(g);
  }
  painted.push(cylinder(0.16, 0.16, 0.7, x, 2.5, z + 0.6, "#5c331a", 8));

  // A cushion, and a lamp that says somebody is home.
  painted.push(box(1.9, 0.22, 1.7, x, 0.02, z, "#c9455a"));
  glow.push(box(0.3, 0.3, 0.3, x, 1.35, z + 0.9, "#ffd8a0"));
  glow.push(box(0.9, 0.12, 0.12, x, 1.82, z - 1.2, "#ffcf6b"));

  group.add(
    new THREE.Mesh(
      mergeGeometries(painted, false)!,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82 }),
    ),
  );
  group.add(
    new THREE.Mesh(
      mergeGeometries(glow, false)!,
      new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    ),
  );

  // Kept out of the group and handed back separately: the house is built at
  // startup and only revealed when bought, and a light that comes and goes
  // would recompile every material in the city at that moment.
  const light = new THREE.PointLight(0xffc98a, 0, 7, 2);
  light.position.set(x, 1.1, z);

  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: radialSprite("rgba(255,200,130,1)", "rgba(255,140,40,0)"),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0.5,
      toneMapped: false,
    }),
  );
  halo.position.set(x, 1.2, z - 1.3);
  halo.scale.setScalar(4);
  group.add(halo);

  const column = beacon("#ffb45c");
  column.position.set(x, 2.3, z);
  group.add(column);

  group.visible = false;
  return { group, light };
}

/** Turned on when the house is paid for. */
export const HOUSE_LIGHT_INTENSITY = 2.2;

/** Wallet, inventory and the till. */
export class Shop {
  money = 0;
  earned = 0;
  spent = 0;
  private owned: Set<string> = new Set(["coat-white"]);
  equippedCoat = "coat-white";

  add(kr: number) {
    if (kr <= 0) return;
    this.money += kr;
    this.earned += kr;
  }

  has(id: string) {
    return this.owned.has(id);
  }

  get ownsHouse() {
    return this.owned.has("house");
  }

  get ownsCar() {
    return this.owned.has("car");
  }

  /**
   * Buying an unowned item costs money; a coat already owned is simply put on
   * again, free. Returns what happened so the caller can make a noise about it.
   */
  buy(id: string): { ok: boolean; item?: ShopItem; equippedOnly?: boolean; reason?: string } {
    const item = CATALOGUE.find((i) => i.id === id);
    if (!item) return { ok: false, reason: "Den varan finns inte." };

    if (this.owned.has(id)) {
      if (item.kind === "coat") {
        this.equippedCoat = id;
        return { ok: true, item, equippedOnly: true };
      }
      return { ok: false, reason: "Du äger redan den." };
    }
    if (this.money < item.price) {
      return { ok: false, reason: `Du saknar ${item.price - this.money} kr.` };
    }

    this.money -= item.price;
    this.spent += item.price;
    this.owned.add(id);
    if (item.kind === "coat") this.equippedCoat = id;
    return { ok: true, item };
  }

  serialize() {
    return { money: this.money, owned: [...this.owned], coat: this.equippedCoat };
  }

  restore(data: { money: number; owned: string[]; coat: string }) {
    this.money = data.money ?? 0;
    this.owned = new Set(data.owned?.length ? data.owned : ["coat-white"]);
    this.equippedCoat = data.coat ?? "coat-white";
  }

  /** The catalogue as the HUD needs to render it. */
  state(): ShopItemState[] {
    return CATALOGUE.map((i) => ({
      ...i,
      owned: this.owned.has(i.id),
      equipped: i.kind === "coat" && this.equippedCoat === i.id,
      affordable: this.money >= i.price,
    }));
  }
}
