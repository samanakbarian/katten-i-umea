import { Game, type HudState, type Quality } from "../src/game/engine";

/**
 * Entry point for the single-file build. Same engine as the Next.js app, but
 * the HUD is plain DOM so the whole game fits in one self-contained HTML page
 * with no framework and nothing to fetch.
 */

type Phase = "menu" | "loading" | "playing" | "paused";

const MAP = { minX: -180, maxX: 200, minZ: -170, maxZ: 205 };

const app = document.getElementById("app") as HTMLDivElement;

app.innerHTML = `
  <canvas id="view"></canvas>

  <div id="hud" hidden>
    <div class="panel-stack">
      <div class="panel">
        <div class="count"><span class="emoji">🐟</span><b id="fish">0</b><span class="of" id="fishTotal">/30</span><span class="label">strömming</span></div>
        <div class="count small"><span class="emoji">🐒</span><b id="monkeys">0</b><span class="of" id="monkeyTotal">/12</span><span class="label">apor</span></div>
        <div class="row"><span id="places">🏛 0/9 platser</span><span id="birds">🕊 0</span><span id="cream">🥛 0</span></div>
      </div>
      <div class="panel score"><b id="score">0</b><span class="label">poäng</span><span id="time">0:00</span></div>
    </div>

    <div class="map-stack">
      <canvas id="minimap" width="168" height="168"></canvas>
      <div class="fps"><span id="fps">60</span> fps</div>
      <button id="pauseBtn" class="chip">Paus</button>
    </div>

    <div class="stamina">
      <div class="bar"><div id="staminaFill"></div></div>
      <div class="stamina-label" id="staminaLabel">kondition</div>
    </div>

    <div class="hints" id="hints">
      <div><kbd>W A S D</kbd> spring · <kbd>Shift</kbd> sprinta · <kbd>Space</kbd> hoppa / dubbelhopp</div>
      <div><kbd>Space</kbd> mot en vägg klättrar · <kbd>C</kbd> smyg · <kbd>E</kbd> jama · <kbd>Esc</kbd> paus</div>
    </div>

    <button id="muteBtn" class="chip mute" aria-label="Ljud">🔊</button>

    <div id="toast" hidden><div class="toast-title"></div><div class="toast-body"></div></div>

    <div id="touch" hidden>
      <div class="stick-well"></div>
      <div class="touch-buttons">
        <button data-btn="meow">Jama</button>
        <button data-btn="sprint">Spring</button>
        <button data-btn="crouch">Smyg</button>
        <button data-btn="jump" class="big">Hopp</button>
      </div>
    </div>
  </div>

  <div id="menu" class="overlay">
    <div class="sheet">
      <div class="cat-emoji">🐈‍⬛</div>
      <h1>Katten i Umeå</h1>
      <p class="lede">
        A winter night in the city of birches. You are a white cat. There are thirty herring
        scattered across town, twelve small monkeys who would very much like to be found, nine
        landmarks, and a great many pigeons who have not yet been startled.
      </p>
      <div class="quality">
        <button data-q="high" class="q active">Vackert (bloom, skuggor)</button>
        <button data-q="low" class="q">Snabbt</button>
      </div>
      <button id="playBtn" class="play">Släpp ut katten</button>
      <p id="error" class="error" hidden></p>
      <div class="controls">
        <div><kbd>W A S D</kbd> run</div>
        <div><kbd>Mouse</kbd> look</div>
        <div><kbd>Shift</kbd> sprint</div>
        <div><kbd>Space</kbd> jump ×2</div>
        <div><kbd>Space</kbd> at a wall: climb</div>
        <div><kbd>E</kbd> meow (scares birds)</div>
      </div>
      <p class="tip">
        Tip: cats climb. Sara Kulturhus is twenty floors tall, and there is a herring on the roof
        — and a monkey.
      </p>
    </div>
  </div>

  <div id="loading" class="overlay" hidden>
    <div class="sheet center">
      <div class="spinner"></div>
      <p class="loading-title">Bygger Umeå…</p>
      <p class="loading-sub">Planting birches, freezing the river, turning on the northern lights.</p>
    </div>
  </div>

  <div id="paused" class="overlay" hidden>
    <div class="sheet center">
      <h2>Paus</h2>
      <div class="stats">
        <div class="stat"><b id="pFish">0/30</b><span>Strömming</span></div>
        <div class="stat"><b id="pMonkeys">0/12</b><span>Apor</span></div>
        <div class="stat"><b id="pPlaces">0/9</b><span>Platser</span></div>
        <div class="stat"><b id="pScore">0</b><span>Poäng</span></div>
      </div>
      <div id="pLandmarks" class="chips"></div>
      <button id="resumeBtn" class="play small">Fortsätt</button>
      <p class="tip">Klicka för att fånga muspekaren igen.</p>
    </div>
  </div>
`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>("view");
const hudEl = $("hud");
const menuEl = $("menu");
const loadingEl = $("loading");
const pausedEl = $("paused");
const toastEl = $("toast");
const minimap = $<HTMLCanvasElement>("minimap");

let game: Game | null = null;
let quality: Quality = "high";
let muted = false;
let phase: Phase = "menu";
let lastToastKey = -1;
/**
 * A pointer-lock request that is refused fires a change event with no lock,
 * which must not be read as "the player pressed Esc" — otherwise resuming
 * bounces straight back to the pause screen on any browser that denies it.
 */
let lockGraceUntil = 0;

const isTouch = "ontouchstart" in window;
if (isTouch) {
  $("touch").hidden = false;
  $("hints").hidden = true;
  minimap.width = minimap.height = 120;
  minimap.style.width = minimap.style.height = "120px";
}
// Phones and low-core machines start on the lighter renderer.
if ((navigator.hardwareConcurrency ?? 8) <= 4) setQuality("low");

function setQuality(q: Quality) {
  quality = q;
  document.querySelectorAll<HTMLButtonElement>(".q").forEach((b) => {
    b.classList.toggle("active", b.dataset.q === q);
  });
}

function setPhase(p: Phase) {
  phase = p;
  menuEl.hidden = p !== "menu";
  loadingEl.hidden = p !== "loading";
  pausedEl.hidden = p !== "paused";
  hudEl.hidden = p !== "playing";
}

document.querySelectorAll<HTMLButtonElement>(".q").forEach((b) => {
  b.addEventListener("click", () => setQuality(b.dataset.q as Quality));
});

function formatTime(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// --------------------------------------------------------------- minimap
const mctx = minimap.getContext("2d")!;

function drawMinimap(map: HudState["map"]) {
  const size = minimap.width;
  const sx = (x: number) => ((x - MAP.minX) / (MAP.maxX - MAP.minX)) * size;
  const sy = (z: number) => ((z - MAP.minZ) / (MAP.maxZ - MAP.minZ)) * size;

  mctx.fillStyle = "#0d1426";
  mctx.fillRect(0, 0, size, size);

  // Umeälven, with its ice shelves.
  mctx.fillStyle = "#1d3f5e";
  mctx.fillRect(0, sy(40), size, sy(115) - sy(40));
  mctx.fillStyle = "#2a5a80";
  mctx.fillRect(0, sy(62), size, sy(93) - sy(62));

  mctx.strokeStyle = "#6b7386";
  mctx.lineWidth = 2;
  for (const bx of [-60, 44]) {
    mctx.beginPath();
    mctx.moveTo(sx(bx), sy(18));
    mctx.lineTo(sx(bx), sy(137));
    mctx.stroke();
  }

  mctx.strokeStyle = "rgba(255,255,255,0.07)";
  mctx.lineWidth = 1;
  for (const z of [22, 0, -22, -46, -70, -96, -124, -152]) {
    mctx.beginPath();
    mctx.moveTo(sx(-160), sy(z));
    mctx.lineTo(sx(160), sy(z));
    mctx.stroke();
  }
  for (const x of [-150, -120, -90, -60, -30, 0, 30, 60, 90, 120]) {
    mctx.beginPath();
    mctx.moveTo(sx(x), sy(-155));
    mctx.lineTo(sx(x), sy(34));
    mctx.stroke();
  }

  for (const f of map.fish) {
    mctx.fillStyle = "#7fdcff";
    mctx.beginPath();
    mctx.arc(sx(f.x), sy(f.z), 1.9, 0, Math.PI * 2);
    mctx.fill();
  }
  for (const m of map.monkeys) {
    mctx.fillStyle = "#ffc07a";
    mctx.beginPath();
    mctx.arc(sx(m.x), sy(m.z), 2.4, 0, Math.PI * 2);
    mctx.fill();
  }
  for (const l of map.landmarks) {
    mctx.beginPath();
    mctx.arc(sx(l.x), sy(l.z), 3.2, 0, Math.PI * 2);
    if (l.found) {
      mctx.fillStyle = "#ffc46b";
      mctx.fill();
    } else {
      mctx.strokeStyle = "rgba(255,196,107,0.6)";
      mctx.lineWidth = 1.2;
      mctx.stroke();
    }
  }

  mctx.save();
  mctx.translate(sx(map.player.x), sy(map.player.z));
  // World yaw 0 faces +Z, which is downwards on the map.
  mctx.rotate(Math.PI - map.player.yaw);
  mctx.fillStyle = "#ffffff";
  mctx.beginPath();
  mctx.moveTo(0, -6);
  mctx.lineTo(4.2, 5);
  mctx.lineTo(0, 2.6);
  mctx.lineTo(-4.2, 5);
  mctx.closePath();
  mctx.fill();
  mctx.restore();
}

// ------------------------------------------------------------------ HUD
function onState(s: HudState) {
  $("fish").textContent = String(s.fish);
  $("fishTotal").textContent = `/${s.fishTotal}`;
  $("monkeys").textContent = String(s.monkeys);
  $("monkeyTotal").textContent = `/${s.monkeyTotal}`;
  const found = s.landmarks.filter((l) => l.found).length;
  $("places").textContent = `🏛 ${found}/${s.landmarks.length} platser`;
  $("birds").textContent = `🕊 ${s.birds}`;
  $("cream").textContent = `🥛 ${s.cream}`;
  $("score").textContent = s.score.toLocaleString("sv-SE");
  $("time").textContent = formatTime(s.time);
  $("fps").textContent = String(s.fps);

  const fill = $("staminaFill");
  fill.style.width = `${Math.round(s.stamina * 100)}%`;
  fill.style.background =
    s.stamina > 0.3
      ? "linear-gradient(90deg,#4ade80,#22d3ee)"
      : "linear-gradient(90deg,#f97316,#ef4444)";
  $("staminaLabel").textContent = s.climbing ? "klättrar" : s.wet ? "blöt katt" : "kondition";

  if (s.toast && s.toast.key !== lastToastKey) {
    lastToastKey = s.toast.key;
    toastEl.querySelector(".toast-title")!.textContent = s.toast.title;
    toastEl.querySelector(".toast-body")!.textContent = s.toast.body;
    toastEl.hidden = false;
    // Restart the entrance animation.
    toastEl.style.animation = "none";
    void toastEl.offsetHeight;
    toastEl.style.animation = "";
  } else if (!s.toast) {
    toastEl.hidden = true;
  }

  // Pause panel mirrors the same numbers.
  $("pFish").textContent = `${s.fish}/${s.fishTotal}`;
  $("pMonkeys").textContent = `${s.monkeys}/${s.monkeyTotal}`;
  $("pPlaces").textContent = `${found}/${s.landmarks.length}`;
  $("pScore").textContent = s.score.toLocaleString("sv-SE");
  $("pLandmarks").innerHTML = s.landmarks
    .map(
      (l) =>
        `<span class="chip-sm${l.found ? " found" : ""}">${l.found ? escapeHtml(l.name) : "???"}</span>`,
    )
    .join("");

  drawMinimap(s.map);
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

// --------------------------------------------------------------- control
async function launch() {
  if (game) return;
  setPhase("loading");
  // Let the loading screen paint before we spend a second building the city.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  try {
    game = new Game(app, canvas, quality, { onState, onReady: () => undefined });
    game.audio.setMuted(muted);
    lockGraceUntil = performance.now() + 1000;
    game.start();
    setPhase("playing");
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "WebGL could not start on this device.";
    const err = $("error");
    err.textContent = msg;
    err.hidden = false;
    setPhase("menu");
  }
}

function pause() {
  if (!game) return;
  game.pause();
  document.exitPointerLock?.();
  setPhase("paused");
}

function resume() {
  if (!game) return;
  lockGraceUntil = performance.now() + 1000;
  game.resume();
  game.input.requestPointerLock();
  setPhase("playing");
}

$("playBtn").addEventListener("click", launch);
$("resumeBtn").addEventListener("click", resume);
$("pauseBtn").addEventListener("click", pause);
$("muteBtn").addEventListener("click", () => {
  muted = !muted;
  game?.audio.setMuted(muted);
  $("muteBtn").textContent = muted ? "🔇" : "🔊";
});

document.querySelectorAll<HTMLButtonElement>("[data-btn]").forEach((b) => {
  const name = b.dataset.btn as "jump" | "sprint" | "meow" | "crouch";
  const down = (e: Event) => {
    e.preventDefault();
    game?.input.setButton(name, true);
  };
  const up = (e: Event) => {
    e.preventDefault();
    game?.input.setButton(name, false);
  };
  b.addEventListener("touchstart", down, { passive: false });
  b.addEventListener("touchend", up);
  b.addEventListener("touchcancel", up);
});

// Losing the pointer lock (Esc, alt-tab) pauses the game.
document.addEventListener("pointerlockchange", () => {
  if (!game || !game.isRunning || isTouch) return;
  if (document.pointerLockElement) return;
  if (performance.now() < lockGraceUntil) return;
  pause();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && game?.isRunning) pause();
});
window.addEventListener("resize", () => game?.resize());

setPhase("menu");
void phase;
