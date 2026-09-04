"use client";

import { useEffect, useRef } from "react";
import type { HudState } from "@/game/engine";

const MIN_X = -180;
const MAX_X = 200;
const MIN_Z = -170;
const MAX_Z = 205;

/** A little chart of Umeå: the river, the landmarks, and where the fish are. */
export function Minimap({ map, size = 168 }: { map: HudState["map"]; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const sx = (x: number) => ((x - MIN_X) / (MAX_X - MIN_X)) * size;
    const sy = (z: number) => ((z - MIN_Z) / (MAX_Z - MIN_Z)) * size;

    // Land.
    ctx.fillStyle = "#0d1426";
    ctx.fillRect(0, 0, size, size);

    // Umeälven, with its ice shelves.
    ctx.fillStyle = "#1d3f5e";
    ctx.fillRect(0, sy(40), size, sy(115) - sy(40));
    ctx.fillStyle = "#2a5a80";
    ctx.fillRect(0, sy(62), size, sy(93) - sy(62));

    // Bridges.
    ctx.strokeStyle = "#6b7386";
    ctx.lineWidth = 2;
    for (const bx of [-60, 44]) {
      ctx.beginPath();
      ctx.moveTo(sx(bx), sy(18));
      ctx.lineTo(sx(bx), sy(137));
      ctx.stroke();
    }

    // Street grid, faint.
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.lineWidth = 1;
    for (const z of [22, 0, -22, -46, -70, -96, -124, -152]) {
      ctx.beginPath();
      ctx.moveTo(sx(-160), sy(z));
      ctx.lineTo(sx(160), sy(z));
      ctx.stroke();
    }
    for (const x of [-150, -120, -90, -60, -30, 0, 30, 60, 90, 120]) {
      ctx.beginPath();
      ctx.moveTo(sx(x), sy(-155));
      ctx.lineTo(sx(x), sy(34));
      ctx.stroke();
    }

    // Fish still out there.
    for (const f of map.fish) {
      ctx.fillStyle = "#7fdcff";
      ctx.beginPath();
      ctx.arc(sx(f.x), sy(f.z), 1.9, 0, Math.PI * 2);
      ctx.fill();
    }

    // Loose change.
    ctx.fillStyle = "rgba(232,192,90,0.75)";
    for (const c of map.coins) {
      ctx.fillRect(sx(c.x) - 1, sy(c.z) - 1, 2, 2);
    }

    // Monkeys still waiting to be found.
    for (const m of map.monkeys) {
      ctx.fillStyle = "#ffc07a";
      ctx.beginPath();
      ctx.arc(sx(m.x), sy(m.z), 2.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Landmarks.
    for (const l of map.landmarks) {
      ctx.beginPath();
      ctx.arc(sx(l.x), sy(l.z), 3.2, 0, Math.PI * 2);
      if (l.found) {
        ctx.fillStyle = "#ffc46b";
        ctx.fill();
      } else {
        ctx.strokeStyle = "rgba(255,196,107,0.6)";
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }

    // Places you own or can spend money in.
    const marker = (x: number, z: number, glyph: string, color: string) => {
      ctx.fillStyle = color;
      ctx.font = "bold 9px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(glyph, sx(x), sy(z));
    };
    marker(map.shop.x, map.shop.z, "S", "#7fe0ff");
    if (map.house) marker(map.house.x, map.house.z, "H", "#ffb37a");
    if (map.car) marker(map.car.x, map.car.z, "B", "#9fd0ff");
    if (map.dog) marker(map.dog.x, map.dog.z, "S", "#ffcf8a");

    // The cat.
    const px = sx(map.player.x);
    const py = sy(map.player.z);
    ctx.save();
    ctx.translate(px, py);
    // World yaw 0 faces +Z, which is downwards on the map.
    ctx.rotate(Math.PI - map.player.yaw);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4.2, 5);
    ctx.lineTo(0, 2.6);
    ctx.lineTo(-4.2, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }, [map, size]);

  return (
    <canvas
      ref={ref}
      style={{ width: size, height: size }}
      className="rounded-xl border border-white/10 bg-black/40"
    />
  );
}
