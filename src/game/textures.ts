import * as THREE from "three";
import { mulberry32 } from "./utils";

/**
 * Every texture in the game is drawn procedurally into a canvas at runtime.
 * No binary assets, no downloads, identical result on every machine.
 */

function canvas(size: number, h = size) {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = h;
  const ctx = c.getContext("2d")!;
  return { c, ctx };
}

function finish(c: HTMLCanvasElement, srgb: boolean, repeat = 1) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  if (repeat !== 1) t.repeat.set(repeat, repeat);
  return t;
}

function noiseOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  amount: number,
  seed = 1,
) {
  const rng = mulberry32(seed);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

export interface FacadeTextures {
  map: THREE.Texture;
  emissive: THREE.Texture;
  roughness: THREE.Texture;
}

/**
 * One tile = one window bay (about 3.2 m of facade). The emissive map decides
 * which flats have the lights on — that is what makes a winter dusk sing.
 */
export function facadeTextures(seed = 7): FacadeTextures {
  const S = 256;
  const { c, ctx } = canvas(S);
  const { c: ec, ctx: ectx } = canvas(S);
  const { c: rc, ctx: rctx } = canvas(S);
  const rng = mulberry32(seed);

  // Base plaster, kept white so vertex colours can tint each building.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, S, S);
  rctx.fillStyle = "#c8c8c8"; // fairly rough plaster
  rctx.fillRect(0, 0, S, S);
  ectx.fillStyle = "#000000";
  ectx.fillRect(0, 0, S, S);

  // Horizontal floor separation line.
  ctx.fillStyle = "rgba(0,0,0,0.10)";
  ctx.fillRect(0, S - 10, S, 10);
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.fillRect(0, S - 14, S, 4);

  // Window opening.
  const wx = S * 0.24;
  const wy = S * 0.16;
  const ww = S * 0.52;
  const wh = S * 0.6;

  // Reveal / frame shadow.
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(wx - 6, wy - 6, ww + 12, wh + 12);

  // Glass — dark and cold when unlit.
  const glass = ctx.createLinearGradient(0, wy, 0, wy + wh);
  glass.addColorStop(0, "#1d2531");
  glass.addColorStop(1, "#0d1218");
  ctx.fillStyle = glass;
  ctx.fillRect(wx, wy, ww, wh);
  rctx.fillStyle = "#2a2a2a"; // glass is smooth
  rctx.fillRect(wx, wy, ww, wh);

  // Muntins.
  ctx.fillStyle = "#f2efe8";
  ctx.fillRect(wx + ww / 2 - 3, wy, 6, wh);
  ctx.fillRect(wx, wy + wh * 0.45 - 3, ww, 6);
  ctx.strokeStyle = "#f2efe8";
  ctx.lineWidth = 7;
  ctx.strokeRect(wx, wy, ww, wh);

  // Sill.
  ctx.fillStyle = "#e9e4d8";
  ctx.fillRect(wx - 10, wy + wh, ww + 20, 10);

  // Lit window in the emissive map: warm lamp glow, curtains, a plant.
  const lit = ectx.createRadialGradient(
    wx + ww / 2,
    wy + wh * 0.62,
    2,
    wx + ww / 2,
    wy + wh * 0.5,
    ww * 0.8,
  );
  lit.addColorStop(0, "#ffd9a0");
  lit.addColorStop(0.55, "#ffb968");
  lit.addColorStop(1, "#39220c");
  ectx.fillStyle = lit;
  ectx.fillRect(wx, wy, ww, wh);
  // Curtain silhouettes.
  ectx.fillStyle = "rgba(0,0,0,0.55)";
  ectx.fillRect(wx, wy, ww * 0.18, wh);
  ectx.fillRect(wx + ww * 0.82, wy, ww * 0.18, wh);
  ectx.fillRect(wx, wy, ww, wh * 0.12);
  // Muntins block the light too.
  ectx.fillStyle = "#000";
  ectx.fillRect(wx + ww / 2 - 3, wy, 6, wh);
  ectx.fillRect(wx, wy + wh * 0.45 - 3, ww, 6);

  noiseOverlay(ctx, S, S, 14, seed + 1);
  void rng;

  return {
    map: finish(c, true),
    emissive: finish(ec, true),
    roughness: finish(rc, false),
  };
}

/**
 * A second facade look for the modern riverfront blocks: floor-to-ceiling glass.
 */
export function glassTextures(seed = 11): FacadeTextures {
  const S = 256;
  const { c, ctx } = canvas(S);
  const { c: ec, ctx: ectx } = canvas(S);
  const { c: rc, ctx: rctx } = canvas(S);
  const rng = mulberry32(seed);

  ctx.fillStyle = "#243244";
  ctx.fillRect(0, 0, S, S);
  const g = ctx.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, "rgba(140,190,225,0.55)");
  g.addColorStop(0.5, "rgba(30,50,70,0.2)");
  g.addColorStop(1, "rgba(90,140,180,0.35)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);

  rctx.fillStyle = "#1e1e1e";
  rctx.fillRect(0, 0, S, S);
  ectx.fillStyle = "#000";
  ectx.fillRect(0, 0, S, S);

  // Mullions.
  ctx.fillStyle = "#8e9aa6";
  ctx.fillRect(0, 0, S, 8);
  ctx.fillRect(0, S / 2 - 3, S, 6);
  ctx.fillRect(0, 0, 8, S);
  rctx.fillStyle = "#9a9a9a";
  rctx.fillRect(0, 0, S, 8);
  rctx.fillRect(0, 0, 8, S);

  // A couple of lit offices behind the glass.
  for (let i = 0; i < 2; i++) {
    if (rng() > 0.55) continue;
    const y = i * (S / 2) + 12;
    const grad = ectx.createLinearGradient(0, y, 0, y + S / 2 - 16);
    grad.addColorStop(0, "#cfe2ff");
    grad.addColorStop(1, "#4a6a94");
    ectx.fillStyle = grad;
    ectx.fillRect(10, y, S - 20, S / 2 - 20);
  }

  noiseOverlay(ctx, S, S, 10, seed);
  return { map: finish(c, true), emissive: finish(ec, true), roughness: finish(rc, false) };
}

/** Snow-covered rooftops and window ledges. */
export function snowTexture(seed = 3) {
  const S = 256;
  const { c, ctx } = canvas(S);
  ctx.fillStyle = "#eef3fb";
  ctx.fillRect(0, 0, S, S);
  const rng = mulberry32(seed);
  for (let i = 0; i < 900; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = rng() * 14 + 3;
    ctx.fillStyle = rng() > 0.5 ? "rgba(255,255,255,0.55)" : "rgba(198,214,238,0.45)";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  noiseOverlay(ctx, S, S, 12, seed + 4);
  return finish(c, true);
}

/** Ploughed asphalt with salt, slush and tyre tracks. */
export function roadTexture(seed = 21) {
  const S = 256;
  const { c, ctx } = canvas(S);
  const rng = mulberry32(seed);
  ctx.fillStyle = "#3a3d44";
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 2200; i++) {
    const x = rng() * S;
    const y = rng() * S;
    ctx.fillStyle = `rgba(${180 + rng() * 60 | 0},${190 + rng() * 60 | 0},210,${rng() * 0.25})`;
    ctx.fillRect(x, y, rng() * 5 + 1, rng() * 5 + 1);
  }
  // Packed-snow tyre tracks.
  for (const cx of [S * 0.28, S * 0.72]) {
    const grad = ctx.createLinearGradient(cx - 26, 0, cx + 26, 0);
    grad.addColorStop(0, "rgba(220,230,245,0)");
    grad.addColorStop(0.5, "rgba(220,230,245,0.30)");
    grad.addColorStop(1, "rgba(220,230,245,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(cx - 26, 0, 52, S);
  }
  noiseOverlay(ctx, S, S, 18, seed);
  return finish(c, true);
}

/** Cobbles of Rådhustorget, with snow packed into the joints. */
export function cobbleTexture(seed = 33) {
  const S = 256;
  const { c, ctx } = canvas(S);
  const rng = mulberry32(seed);
  ctx.fillStyle = "#cfd6e2";
  ctx.fillRect(0, 0, S, S);
  const n = 8;
  const s = S / n;
  for (let iy = 0; iy < n; iy++) {
    for (let ix = 0; ix < n; ix++) {
      const off = iy % 2 ? s / 2 : 0;
      const g = 120 + rng() * 70;
      ctx.fillStyle = `rgb(${g | 0},${(g + 6) | 0},${(g + 18) | 0})`;
      ctx.beginPath();
      const x = ix * s + off + 2;
      const y = iy * s + 2;
      const r = 4;
      const w = s - 4;
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + w, r);
      ctx.arcTo(x + w, y + w, x, y + w, r);
      ctx.arcTo(x, y + w, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.fill();
      // Snow dusting on the top of each stone.
      ctx.fillStyle = `rgba(238,244,255,${0.15 + rng() * 0.3})`;
      ctx.fillRect(x + 3, y + 3, w - 6, w * 0.35);
    }
  }
  noiseOverlay(ctx, S, S, 16, seed);
  return finish(c, true);
}

/** Birch bark — Umeå is Björkarnas stad, the City of Birches. */
export function birchTexture(seed = 55) {
  const S = 128;
  const { c, ctx } = canvas(S, S * 2);
  const H = S * 2;
  const rng = mulberry32(seed);
  ctx.fillStyle = "#f3f0e8";
  ctx.fillRect(0, 0, S, H);
  for (let i = 0; i < 26; i++) {
    const y = rng() * H;
    const w = rng() * 40 + 12;
    const h = rng() * 7 + 3;
    ctx.fillStyle = `rgba(30,26,24,${0.5 + rng() * 0.45})`;
    ctx.beginPath();
    ctx.ellipse(rng() * S, y, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(140,130,115,${rng() * 0.3})`;
    ctx.fillRect(rng() * S, rng() * H, rng() * 20 + 4, 2);
  }
  // Warm grey base towards the foot of the trunk.
  const g = ctx.createLinearGradient(0, H, 0, H * 0.72);
  g.addColorStop(0, "rgba(70,64,58,0.75)");
  g.addColorStop(1, "rgba(70,64,58,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, H);
  noiseOverlay(ctx, S, H, 14, seed);
  return finish(c, true);
}

/**
 * Tabby fur. On a capsule, U wraps around the body and V runs nose-to-tail, so
 * the stripes are drawn across U — they ring the cat like a proper mackerel.
 */
export function furTexture(base = "#c68b46", stripe = "#6b4321", seed = 91) {
  const S = 256;
  const { c, ctx } = canvas(S);
  const rng = mulberry32(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);

  // Darker along the spine, lighter towards the belly (U = 0.25 and 0.75).
  const shade = ctx.createLinearGradient(0, 0, S, 0);
  shade.addColorStop(0, "rgba(255,255,255,0.30)");
  shade.addColorStop(0.28, "rgba(96,98,104,0.20)");
  shade.addColorStop(0.55, "rgba(255,255,255,0.34)");
  shade.addColorStop(0.8, "rgba(96,98,104,0.18)");
  shade.addColorStop(1, "rgba(255,255,255,0.30)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, S, S);

  // Mackerel bands running around the body.
  ctx.strokeStyle = stripe;
  ctx.lineCap = "round";
  for (let i = 0; i < 15; i++) {
    const y = (i / 15) * S + rng() * 5;
    ctx.lineWidth = 3 + rng() * 6;
    ctx.globalAlpha = 0.3 + rng() * 0.4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(S * 0.3, y + 9, S * 0.6, y - 8, S, y + 3);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Individual hairs for a bit of grain.
  for (let i = 0; i < 2600; i++) {
    const x = rng() * S;
    const y = rng() * S;
    ctx.strokeStyle = rng() > 0.5 ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rng() - 0.5) * 4, y + rng() * 6);
    ctx.stroke();
  }
  return finish(c, true);
}

/** Soft radial sprite: lamp glow pools, snowflakes, shadows. */
export function radialSprite(inner = "rgba(255,255,255,1)", outer = "rgba(255,255,255,0)") {
  const S = 128;
  const { c, ctx } = canvas(S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  const fade = (a: number) => inner.replace(/[\d.]+\)$/, `${a})`);
  // Several stops approximating a gaussian: a linear ramp leaves a visible rim
  // where the pool of lamplight meets the snow.
  g.addColorStop(0, inner);
  g.addColorStop(0.18, fade(0.72));
  g.addColorStop(0.36, fade(0.38));
  g.addColorStop(0.58, fade(0.13));
  g.addColorStop(0.8, fade(0.03));
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Six-fold snow crystal, drawn once and instanced across the sky. */
export function snowflakeSprite() {
  const S = 64;
  const { c, ctx } = canvas(S);
  ctx.translate(S / 2, S / 2);
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineCap = "round";
  for (let i = 0; i < 6; i++) {
    ctx.rotate(Math.PI / 3);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -S * 0.42);
    ctx.stroke();
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(0, -S * 0.2);
    ctx.lineTo(-S * 0.11, -S * 0.31);
    ctx.moveTo(0, -S * 0.2);
    ctx.lineTo(S * 0.11, -S * 0.31);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(0, 0, 4, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Normal map for the Ume river: two crossing wave trains. */
export function waterNormalTexture(seed = 5) {
  const S = 256;
  const { c, ctx } = canvas(S);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const rng = mulberry32(seed);
  const o1 = rng() * 6.28;
  const o2 = rng() * 6.28;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x / S) * Math.PI * 2;
      const v = (y / S) * Math.PI * 2;
      // Height field, then its analytic gradient as the normal.
      const dx =
        Math.cos(u * 3 + o1) * 0.5 + Math.cos(u * 7 + v * 2 + o2) * 0.22 + Math.cos(u * 13) * 0.08;
      const dy =
        Math.cos(v * 4 + o2) * 0.5 + Math.cos(v * 9 + u * 3 + o1) * 0.2 + Math.cos(v * 11) * 0.08;
      const i = (y * S + x) * 4;
      d[i] = 128 + dx * 70;
      d[i + 1] = 128 + dy * 70;
      d[i + 2] = 235;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return finish(c, false);
}

/** Fine-grained snow field with wind-blown drifts. */
export function groundTexture(seed = 77) {
  const S = 512;
  const { c, ctx } = canvas(S);
  const rng = mulberry32(seed);
  ctx.fillStyle = "#e7eef9";
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 260; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const w = rng() * 190 + 40;
    const h = rng() * 26 + 8;
    const a = rng() * Math.PI;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.fillStyle = rng() > 0.5 ? "rgba(255,255,255,0.5)" : "rgba(186,203,230,0.35)";
    ctx.beginPath();
    ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // Sparkle — snow at dusk glitters.
  for (let i = 0; i < 1400; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.25 + rng() * 0.6})`;
    ctx.fillRect(rng() * S, rng() * S, 2, 2);
  }
  noiseOverlay(ctx, S, S, 10, seed);
  return finish(c, true);
}
