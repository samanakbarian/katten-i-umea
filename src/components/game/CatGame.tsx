"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Minimap } from "./Minimap";
import type { Game, HudState, Quality } from "@/game/engine";

type Phase = "menu" | "loading" | "playing" | "paused";

const EMPTY_HUD: HudState = {
  fish: 0,
  fishTotal: 30,
  cream: 0,
  birds: 0,
  monkeys: 0,
  monkeyTotal: 12,
  score: 0,
  stamina: 1,
  time: 0,
  landmarks: [],
  toast: null,
  finished: false,
  climbing: false,
  wet: false,
  fps: 60,
  map: { player: { x: 0, z: 0, yaw: 0 }, fish: [], monkeys: [], landmarks: [] },
};

function formatTime(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function CatGame() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [phase, setPhase] = useState<Phase>("menu");
  const [hud, setHud] = useState<HudState>(EMPTY_HUD);
  const [quality, setQuality] = useState<Quality>("high");
  const [muted, setMuted] = useState(false);
  const [isTouch, setIsTouch] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsTouch(typeof window !== "undefined" && "ontouchstart" in window);
    // Nudge the default down on phones and low-core machines.
    if (typeof navigator !== "undefined" && (navigator.hardwareConcurrency ?? 8) <= 4) {
      setQuality("low");
    }
  }, []);

  const launch = useCallback(async () => {
    if (gameRef.current || !containerRef.current || !canvasRef.current) return;
    setPhase("loading");
    // Let the loading screen paint before we spend a second building the city.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      const { Game: GameCtor } = await import("@/game/engine");
      const game = new GameCtor(containerRef.current, canvasRef.current, quality, {
        onState: setHud,
        onReady: () => undefined,
      });
      gameRef.current = game;
      game.audio.setMuted(muted);
      game.start();
      setPhase("playing");
    } catch (e) {
      console.error(e);
      setError(
        e instanceof Error ? e.message : "WebGL could not start. Try another browser or device.",
      );
      setPhase("menu");
    }
  }, [quality, muted]);

  const resume = useCallback(() => {
    const g = gameRef.current;
    if (!g) return;
    g.resume();
    g.input.requestPointerLock();
    setPhase("playing");
  }, []);

  const pause = useCallback(() => {
    const g = gameRef.current;
    if (!g) return;
    g.pause();
    document.exitPointerLock?.();
    setPhase("paused");
  }, []);

  // Losing the pointer lock (Esc, alt-tab) pauses the game.
  useEffect(() => {
    const onLockChange = () => {
      const g = gameRef.current;
      if (!g || !g.isRunning) return;
      if (!document.pointerLockElement && !("ontouchstart" in window)) {
        g.pause();
        setPhase("paused");
      }
    };
    const onVisibility = () => {
      if (document.hidden && gameRef.current?.isRunning) {
        gameRef.current.pause();
        setPhase("paused");
      }
    };
    const onResize = () => gameRef.current?.resize();
    document.addEventListener("pointerlockchange", onLockChange);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerlockchange", onLockChange);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    return () => {
      gameRef.current?.dispose();
      gameRef.current = null;
    };
  }, []);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    gameRef.current?.audio.setMuted(next);
  };

  const touchButton = (name: "jump" | "sprint" | "meow" | "crouch", label: string, cls: string) => (
    <button
      key={name}
      className={`select-none rounded-full border border-white/20 text-sm font-semibold tracking-wide text-white/90 backdrop-blur active:scale-95 ${cls}`}
      onTouchStart={(e) => {
        e.preventDefault();
        gameRef.current?.input.setButton(name, true);
      }}
      onTouchEnd={(e) => {
        e.preventDefault();
        gameRef.current?.input.setButton(name, false);
      }}
    >
      {label}
    </button>
  );

  const foundCount = hud.landmarks.filter((l) => l.found).length;

  return (
    <div
      ref={containerRef}
      className="relative h-[100dvh] w-full overflow-hidden bg-[#070b16] text-white"
    >
      <canvas ref={canvasRef} className="block h-full w-full touch-none" />

      {/* ------------------------------------------------------------- HUD */}
      {phase === "playing" && (
        <>
          <div className="pointer-events-none absolute left-4 top-4 space-y-2">
            <div className="rounded-xl border border-white/10 bg-black/45 px-4 py-3 backdrop-blur-md">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl">🐟</span>
                <span className="text-2xl font-bold tabular-nums">
                  {hud.fish}
                  <span className="text-base font-normal text-white/50">/{hud.fishTotal}</span>
                </span>
                <span className="ml-1 text-xs uppercase tracking-widest text-white/50">
                  strömming
                </span>
              </div>
              <div className="mt-1.5 flex items-baseline gap-2">
                <span className="text-xl">🐒</span>
                <span className="text-xl font-bold tabular-nums">
                  {hud.monkeys}
                  <span className="text-sm font-normal text-white/50">/{hud.monkeyTotal}</span>
                </span>
                <span className="ml-1 text-xs uppercase tracking-widest text-white/50">apor</span>
              </div>
              <div className="mt-2 flex gap-4 text-xs text-white/70">
                <span>🏛 {foundCount}/{hud.landmarks.length} platser</span>
                <span>🕊 {hud.birds}</span>
                <span>🥛 {hud.cream}</span>
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/45 px-4 py-2 text-sm backdrop-blur-md">
              <span className="tabular-nums font-semibold">{hud.score.toLocaleString("sv-SE")}</span>
              <span className="ml-2 text-white/50">poäng</span>
              <span className="ml-3 tabular-nums text-white/70">{formatTime(hud.time)}</span>
            </div>
          </div>

          <div className="pointer-events-none absolute right-4 top-4 flex flex-col items-end gap-2">
            <Minimap map={hud.map} size={isTouch ? 120 : 168} />
            <div className="text-[10px] uppercase tracking-widest text-white/40">
              {hud.fps} fps
            </div>
          </div>

          {/* Stamina */}
          <div className="pointer-events-none absolute bottom-6 left-1/2 w-64 -translate-x-1/2">
            <div className="h-2 overflow-hidden rounded-full border border-white/10 bg-black/50">
              <div
                className="h-full rounded-full transition-[width] duration-100"
                style={{
                  width: `${Math.round(hud.stamina * 100)}%`,
                  background:
                    hud.stamina > 0.3
                      ? "linear-gradient(90deg,#4ade80,#22d3ee)"
                      : "linear-gradient(90deg,#f97316,#ef4444)",
                }}
              />
            </div>
            <div className="mt-1 text-center text-[10px] uppercase tracking-[0.2em] text-white/40">
              {hud.climbing ? "klättrar" : hud.wet ? "blöt katt" : "kondition"}
            </div>
          </div>

          {!isTouch && (
            <div className="pointer-events-none absolute bottom-5 left-4 space-y-1 text-[11px] text-white/40">
              <div>
                <Key>W A S D</Key> spring · <Key>Shift</Key> sprinta · <Key>Space</Key> hoppa /
                dubbelhopp
              </div>
              <div>
                <Key>Space</Key> mot en vägg klättrar · <Key>C</Key> smyg · <Key>E</Key> jama ·{" "}
                <Key>Esc</Key> paus
              </div>
            </div>
          )}

          <button
            onClick={toggleMute}
            className="absolute bottom-4 right-4 rounded-full border border-white/15 bg-black/45 px-3 py-2 text-sm backdrop-blur hover:bg-black/70"
            aria-label={muted ? "Slå på ljud" : "Stäng av ljud"}
          >
            {muted ? "🔇" : "🔊"}
          </button>

          {/* Toast */}
          {hud.toast && (
            <div
              key={hud.toast.key}
              className="pointer-events-none absolute bottom-24 left-1/2 w-[min(92vw,30rem)] -translate-x-1/2 animate-[fadeUp_.4s_ease-out] rounded-2xl border border-amber-300/25 bg-black/65 px-5 py-4 text-center backdrop-blur-md"
            >
              <div className="text-lg font-semibold text-amber-200">{hud.toast.title}</div>
              <div className="mt-1 text-sm text-white/75">{hud.toast.body}</div>
            </div>
          )}

          {/* Touch controls */}
          {isTouch && (
            <div className="absolute inset-x-0 bottom-0 flex items-end justify-between p-5">
              <div className="h-32 w-32 rounded-full border border-white/10 bg-white/5" />
              <div className="grid grid-cols-2 gap-3">
                {touchButton("meow", "Jama", "h-14 w-14 bg-white/10")}
                {touchButton("sprint", "Spring", "h-14 w-14 bg-white/10")}
                {touchButton("crouch", "Smyg", "h-14 w-14 bg-white/10")}
                {touchButton("jump", "Hopp", "h-20 w-20 bg-amber-400/25 text-base")}
              </div>
            </div>
          )}
        </>
      )}

      {/* --------------------------------------------------------- overlays */}
      {phase === "menu" && (
        <Overlay>
          <div className="mx-auto max-w-xl text-center">
            <div className="text-6xl">🐈‍⬛</div>
            <h1 className="mt-4 bg-gradient-to-b from-white to-amber-200/70 bg-clip-text pb-2 text-5xl font-black leading-[1.2] tracking-tight text-transparent sm:text-6xl">
              Katten i Umeå
            </h1>
            <p className="mt-3 text-lg text-white/70">
              A winter night in the city of birches. You are a white cat. There are thirty herring
              scattered across town, twelve small monkeys who would very much like to be found, nine
              landmarks, and a great many pigeons who have not yet been startled.
            </p>

            <div className="mt-7 flex items-center justify-center gap-2">
              {(["high", "low"] as Quality[]).map((q) => (
                <button
                  key={q}
                  onClick={() => setQuality(q)}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    quality === q
                      ? "bg-amber-300 text-black"
                      : "border border-white/15 text-white/70 hover:bg-white/10"
                  }`}
                >
                  {q === "high" ? "Vackert (bloom, skuggor)" : "Snabbt"}
                </button>
              ))}
            </div>

            <button
              onClick={launch}
              className="mt-6 rounded-full bg-gradient-to-r from-amber-300 to-orange-400 px-10 py-4 text-lg font-bold text-black shadow-[0_0_40px_rgba(251,191,36,0.35)] transition hover:scale-[1.03]"
            >
              Släpp ut katten
            </button>

            {error && <p className="mt-4 text-sm text-red-300">{error}</p>}

            <div className="mt-8 grid grid-cols-2 gap-x-8 gap-y-2 text-left text-sm text-white/55 sm:grid-cols-3">
              <div><Key>W A S D</Key> run</div>
              <div><Key>Mouse</Key> look</div>
              <div><Key>Shift</Key> sprint</div>
              <div><Key>Space</Key> jump ×2</div>
              <div><Key>Space</Key> at a wall: climb</div>
              <div><Key>E</Key> meow (scares birds)</div>
            </div>
            <p className="mt-6 text-xs text-white/35">
              Tip: cats climb. Sara Kulturhus is twenty floors tall, and there is a herring on the
              roof — and a monkey.
            </p>
          </div>
        </Overlay>
      )}

      {phase === "loading" && (
        <Overlay>
          <div className="text-center">
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-amber-300" />
            <p className="mt-5 text-lg text-white/80">Bygger Umeå…</p>
            <p className="mt-1 text-sm text-white/45">
              Planting birches, freezing the river, turning on the northern lights.
            </p>
          </div>
        </Overlay>
      )}

      {phase === "paused" && (
        <Overlay>
          <div className="max-w-md text-center">
            <h2 className="text-3xl font-bold">Paus</h2>
            <div className="mt-5 grid grid-cols-4 gap-3 text-sm">
              <Stat label="Strömming" value={`${hud.fish}/${hud.fishTotal}`} />
              <Stat label="Apor" value={`${hud.monkeys}/${hud.monkeyTotal}`} />
              <Stat label="Platser" value={`${foundCount}/${hud.landmarks.length}`} />
              <Stat label="Poäng" value={hud.score.toLocaleString("sv-SE")} />
            </div>
            {hud.landmarks.some((l) => l.found) && (
              <div className="mt-5 text-left">
                <div className="mb-2 text-xs uppercase tracking-widest text-white/40">Upptäckt</div>
                <div className="flex flex-wrap gap-2">
                  {hud.landmarks.map((l) => (
                    <span
                      key={l.name}
                      className={`rounded-full px-3 py-1 text-xs ${
                        l.found
                          ? "bg-amber-300/20 text-amber-200"
                          : "border border-white/10 text-white/30"
                      }`}
                    >
                      {l.found ? l.name : "???"}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <button
              onClick={resume}
              className="mt-7 rounded-full bg-amber-300 px-8 py-3 font-bold text-black transition hover:scale-[1.03]"
            >
              Fortsätt
            </button>
            <p className="mt-3 text-xs text-white/40">Klicka för att fånga muspekaren igen.</p>
          </div>
        </Overlay>
      )}

      {phase === "playing" && !isTouch && (
        <button
          onClick={pause}
          className="absolute right-4 top-[13.5rem] rounded-full border border-white/15 bg-black/40 px-3 py-1.5 text-xs backdrop-blur hover:bg-black/70"
        >
          Paus
        </button>
      )}
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-gradient-to-b from-[#070b16]/85 via-[#0b1428]/90 to-[#070b16]/95 p-6 backdrop-blur-sm">
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3">
      <div className="text-lg font-bold tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-widest text-white/40">{label}</div>
    </div>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-white/20 bg-white/10 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-white/80">
      {children}
    </kbd>
  );
}
