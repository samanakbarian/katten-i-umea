import * as THREE from "three";
import { World } from "./city";
import { radialSprite } from "./textures";
import { mulberry32, rand } from "./utils";

/**
 * Kronor, lying around Umeå waiting to be knocked off a windowsill.
 *
 * Three denominations, told apart by size and metal, spread along the streets,
 * across the square, over the bridges and on a few rooftops for the cats who
 * climb. A coin is worth more the harder it is to reach.
 */

export interface CoinTier {
  value: number;
  color: string;
  radius: number;
}

const TIERS: CoinTier[] = [
  { value: 10, color: "#c9d2dc", radius: 0.085 }, // silver, on the pavement
  { value: 25, color: "#e8c05a", radius: 0.105 }, // gold, slightly out of the way
  { value: 50, color: "#e0a878", radius: 0.125 }, // rose gold, up high
];

interface Coin {
  mesh: THREE.Mesh;
  glow: THREE.Sprite;
  home: THREE.Vector3;
  value: number;
  phase: number;
  taken: boolean;
  pop: number;
}

export class Coins {
  readonly group = new THREE.Group();
  private coins: Coin[] = [];
  collected = 0;
  readonly totalValue: number;

  constructor(world: World) {
    const rng = mulberry32(5150);

    const geos = TIERS.map((t) => {
      // Standing on edge, so the spin catches the light and flashes.
      const g = new THREE.CylinderGeometry(t.radius, t.radius, 0.022, 18);
      g.rotateX(Math.PI / 2);
      return g;
    });
    const mats = TIERS.map(
      (t) =>
        new THREE.MeshStandardMaterial({
          color: t.color,
          metalness: 0.95,
          roughness: 0.22,
          emissive: new THREE.Color(t.color),
          emissiveIntensity: 0.18,
          envMapIntensity: 1.4,
        }),
    );
    const glowMats = TIERS.map(
      (t) =>
        new THREE.SpriteMaterial({
          map: radialSprite(`rgba(255,225,150,1)`, "rgba(255,170,40,0)"),
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          transparent: true,
          opacity: 0.42,
          toneMapped: false,
          color: new THREE.Color(t.color),
        }),
    );

    const place = (x: number, y: number, z: number, tier: number) => {
      const mesh = new THREE.Mesh(geos[tier], mats[tier]);
      mesh.position.set(x, y + 0.28, z);
      const glow = new THREE.Sprite(glowMats[tier]);
      glow.position.copy(mesh.position);
      glow.scale.setScalar(0.55 + tier * 0.12);
      this.group.add(mesh, glow);
      this.coins.push({
        mesh,
        glow,
        home: mesh.position.clone(),
        value: TIERS[tier].value,
        phase: rng() * 6.28,
        taken: false,
        pop: 0,
      });
    };

    // Along the pavements, which is where a cat walks anyway.
    for (const z of [22, 0, -22, -46, -70, -96, -124]) {
      for (let x = -140; x <= 140; x += 34) {
        place(x + rand(rng, -3, 3), 0, z + (rng() > 0.5 ? 6.4 : -6.4), 0);
      }
    }
    for (const x of [-120, -60, 0, 60, 120]) {
      for (let z = -140; z <= 20; z += 38) {
        place(x + (rng() > 0.5 ? 6.4 : -6.4), 0, z + rand(rng, -3, 3), 0);
      }
    }

    // A ring of them around Rådhustorget, easy money to get you started.
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      place(-26 + Math.cos(a) * 15, 0, 12 + Math.sin(a) * 11, 0);
    }

    // Out on the ice and over the bridges — worth more, and a longer walk.
    for (let x = -140; x <= 140; x += 30) {
      place(x, world.groundHeightAt(x, 52), 52, 1);
      place(x, world.groundHeightAt(x, 102), 102, 1);
    }
    for (const bx of [-60, 44]) {
      for (let i = 0; i < 6; i++) {
        const t = i / 5;
        const z = 18 + t * 118;
        place(bx + rand(rng, -4, 4), Math.sin(t * Math.PI) * 9.5 + 0.8, z, 1);
      }
    }

    // Teg, and the road out to the university.
    for (let i = 0; i < 18; i++) place(rand(rng, -140, 140), 0, rand(rng, 126, 195), 1);
    for (let x = 30; x <= 200; x += 22) place(x, 0, -40 + rand(rng, -5, 5), 1);

    // The expensive ones are on the roofs, where only a climbing cat gets them.
    const roofs = world.fishSpots.filter((p) => p.y > 6).slice(0, 26);
    for (const p of roofs) place(p.x + rand(rng, -2, 2), p.y, p.z + rand(rng, -2, 2), 2);

    this.totalValue = this.coins.reduce((sum, c) => sum + c.value, 0);
  }

  serialize() {
    return this.coins.reduce<number[]>((acc, c, i) => (c.taken ? (acc.push(i), acc) : acc), []);
  }

  restore(indices: number[]) {
    for (const i of indices ?? []) {
      const c = this.coins[i];
      if (!c) continue;
      c.taken = true;
      c.pop = 0;
      c.mesh.visible = false;
      c.glow.visible = false;
    }
    this.collected = this.coins.filter((c) => c.taken).length;
  }

  /** For the minimap. */
  get remaining() {
    return this.coins.filter((c) => !c.taken).map((c) => ({ x: c.home.x, z: c.home.z }));
  }

  /** Returns the kronor picked up this frame. */
  update(dt: number, time: number, catPos: THREE.Vector3, reach: number) {
    let earned = 0;
    for (const c of this.coins) {
      if (c.taken) {
        if (c.pop > 0) {
          c.pop -= dt * 3;
          const s = Math.max(0, c.pop);
          c.mesh.scale.setScalar(s);
          c.mesh.position.y += dt * 2.2;
          c.glow.position.copy(c.mesh.position);
          c.glow.scale.setScalar(s * 1.2);
          if (c.pop <= 0) {
            c.mesh.visible = false;
            c.glow.visible = false;
          }
        }
        continue;
      }
      c.mesh.rotation.y = time * 2.4 + c.phase;
      c.mesh.position.y = c.home.y + Math.sin(time * 2 + c.phase) * 0.05;
      c.glow.position.copy(c.mesh.position);

      const dx = c.home.x - catPos.x;
      const dz = c.home.z - catPos.z;
      const dy = c.mesh.position.y - (catPos.y + 0.28);
      if (dx * dx + dz * dz < reach * reach && dy < 1.1 && dy > -0.9) {
        c.taken = true;
        c.pop = 1;
        this.collected++;
        earned += c.value;
      }
    }
    return earned;
  }
}
