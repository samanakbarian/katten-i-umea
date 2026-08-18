import * as THREE from "three";
import { mulberry32 } from "./utils";
import { snowflakeSprite } from "./textures";

/**
 * A January dusk over Norrland: deep blue zenith, a last band of orange over
 * the river, stars, drifting snow and — because this is 63° north — norrsken.
 */

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAG = /* glsl */ `
varying vec3 vDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform vec3 uSunDir;

void main() {
  float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(h, 0.75));

  // The low winter sun set hours ago; what is left is a thin band of ember
  // hugging the horizon in the south-west.
  float sun = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
  float band = 1.0 - smoothstep(0.0, 0.16, abs(vDir.y));
  col += uGlow * pow(sun, 10.0) * 0.28 * band;
  col += uGlow * pow(sun, 3.0) * 0.05 * band;

  gl_FragColor = vec4(col, 1.0);
}
`;

const AURORA_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const AURORA_FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uTime;
uniform float uSeed;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uIntensity;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = vUv;

  // Slow folds in the curtain, plus fine vertical rays that shimmer through it.
  float drift = uTime * 0.03;
  float fold = fbm(vec2(uv.x * 2.6 + drift, uv.y * 0.5));
  float ray = fbm(vec2(uv.x * 42.0 + drift * 2.0, uv.y * 1.2 - uTime * 0.08));

  // Bright along the lower edge, fading out towards the crown — the way a real
  // curtain hangs, brightest where the electrons stop.
  float hang = smoothstep(0.05, 0.3, uv.y) * (1.0 - smoothstep(0.35, 1.0, uv.y));

  // Only part of the width is lit at any moment, and it wanders.
  float presence = smoothstep(0.42, 0.78, fold);
  float rays = mix(0.55, 1.25, ray);

  float a = hang * presence * rays;
  a *= smoothstep(0.0, 0.2, uv.x) * smoothstep(1.0, 0.8, uv.x);

  // Oxygen green at the base, a hint of nitrogen violet up top. No rainbows.
  vec3 col = mix(uColorA, uColorB, smoothstep(0.25, 0.85, uv.y));

  gl_FragColor = vec4(col * uIntensity, clamp(a, 0.0, 1.0) * uIntensity);
}
`;

export class Sky {
  readonly group = new THREE.Group();
  readonly sunDirection = new THREE.Vector3(-0.35, 0.1, -1).normalize();
  private auroraMats: THREE.ShaderMaterial[] = [];
  private starMat: THREE.PointsMaterial;
  private dome!: THREE.Mesh;
  private snow?: THREE.Points;
  private snowVel!: Float32Array;
  private snowCount = 0;
  private snowRadius = 60;

  constructor(quality: "low" | "high") {
    // --- Sky dome -----------------------------------------------------------
    const domeGeo = new THREE.SphereGeometry(900, 32, 20);
    const domeMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uZenith: { value: new THREE.Color("#050c22") },
        uHorizon: { value: new THREE.Color("#2a3a63") },
        uGlow: { value: new THREE.Color("#ff9a4d") },
        uSunDir: { value: this.sunDirection.clone() },
      },
    });
    this.dome = new THREE.Mesh(domeGeo, domeMat);
    this.dome.renderOrder = -1000;
    this.group.add(this.dome);

    // --- Stars --------------------------------------------------------------
    const rng = mulberry32(1234);
    const starCount = quality === "high" ? 2200 : 900;
    const pos = new Float32Array(starCount * 3);
    const col = new Float32Array(starCount * 3);
    const c = new THREE.Color();
    for (let i = 0; i < starCount; i++) {
      // Only the upper hemisphere — the rest is hidden by the city anyway.
      const u = rng() * Math.PI * 2;
      const v = Math.acos(rng() * 0.98);
      const r = 820;
      pos[i * 3] = Math.sin(v) * Math.cos(u) * r;
      pos[i * 3 + 1] = Math.cos(v) * r;
      pos[i * 3 + 2] = Math.sin(v) * Math.sin(u) * r;
      const t = rng();
      c.setHSL(t > 0.8 ? 0.08 : 0.58, 0.35, 0.6 + rng() * 0.4);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    starGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    this.starMat = new THREE.PointsMaterial({
      size: 2.6,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const stars = new THREE.Points(starGeo, this.starMat);
    stars.renderOrder = -900;
    this.group.add(stars);

    // --- Aurora curtains ----------------------------------------------------
    const curtains = quality === "high" ? 4 : 2;
    for (let i = 0; i < curtains; i++) {
      const w = 900 - i * 90;
      const h = 340 + i * 40;
      const geo = new THREE.PlaneGeometry(w, h, 1, 1);
      const mat = new THREE.ShaderMaterial({
        vertexShader: AURORA_VERT,
        fragmentShader: AURORA_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uSeed: { value: i * 17.13 },
          uColorA: { value: new THREE.Color(i % 2 ? "#2bff9a" : "#4bffc4") },
          uColorB: { value: new THREE.Color(i % 2 ? "#6a5bff" : "#2f7bd8") },
          uIntensity: { value: 0.52 - i * 0.07 },
        },
      });
      this.auroraMats.push(mat);
      const mesh = new THREE.Mesh(geo, mat);
      const angle = -0.5 + i * 0.42;
      const dist = 620 - i * 40;
      mesh.position.set(Math.sin(angle) * dist, 250 + i * 26, -Math.cos(angle) * dist);
      mesh.lookAt(0, 160, 0);
      mesh.rotation.z += (i - 1.5) * 0.06;
      mesh.renderOrder = -800;
      this.group.add(mesh);
    }

    // --- Snowfall -----------------------------------------------------------
    this.snowCount = quality === "high" ? 5000 : 1800;
    const sp = new Float32Array(this.snowCount * 3);
    const ss = new Float32Array(this.snowCount);
    this.snowVel = new Float32Array(this.snowCount);
    for (let i = 0; i < this.snowCount; i++) {
      sp[i * 3] = (rng() - 0.5) * this.snowRadius * 2;
      sp[i * 3 + 1] = rng() * 40;
      sp[i * 3 + 2] = (rng() - 0.5) * this.snowRadius * 2;
      ss[i] = 0.06 + rng() * 0.16;
      this.snowVel[i] = 0.7 + rng() * 1.5;
    }
    const snowGeo = new THREE.BufferGeometry();
    snowGeo.setAttribute("position", new THREE.BufferAttribute(sp, 3));
    snowGeo.setAttribute("size", new THREE.BufferAttribute(ss, 1));
    const snowMat = new THREE.PointsMaterial({
      map: snowflakeSprite(),
      size: 0.15,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.snow = new THREE.Points(snowGeo, snowMat);
    this.snow.frustumCulled = false;
    this.group.add(this.snow);
  }

  /** Ambient colours the rest of the scene should key off. */
  get fogColor() {
    return new THREE.Color("#1b2647");
  }

  /**
   * A throwaway scene holding just the dome, used to bake an environment map so
   * the river, the ice and every window reflect the actual sky.
   */
  buildEnvScene() {
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(this.dome.geometry, this.dome.material));
    return scene;
  }

  update(dt: number, time: number, camera: THREE.Camera) {
    for (const m of this.auroraMats) m.uniforms.uTime.value = time;

    // Sky and snow follow the camera so the world feels endless.
    this.group.position.set(camera.position.x, 0, camera.position.z);

    if (this.snow) {
      const p = this.snow.geometry.attributes.position as THREE.BufferAttribute;
      const arr = p.array as Float32Array;
      const wind = Math.sin(time * 0.21) * 0.9 + 0.5;
      for (let i = 0; i < this.snowCount; i++) {
        const i3 = i * 3;
        arr[i3 + 1] -= this.snowVel[i] * dt * 1.6;
        arr[i3] += wind * dt * 0.6;
        arr[i3 + 2] += Math.cos(time * 0.3 + i) * dt * 0.25;
        if (arr[i3 + 1] < -2) {
          arr[i3 + 1] = 38 + Math.random() * 6;
          arr[i3] = (Math.random() - 0.5) * this.snowRadius * 2;
          arr[i3 + 2] = (Math.random() - 0.5) * this.snowRadius * 2;
        }
        if (arr[i3] > this.snowRadius) arr[i3] -= this.snowRadius * 2;
        if (arr[i3] < -this.snowRadius) arr[i3] += this.snowRadius * 2;
      }
      p.needsUpdate = true;
      this.snow.position.set(camera.position.x, 0, camera.position.z);
      this.snow.position.sub(this.group.position);
    }
    void this.starMat;
  }
}
