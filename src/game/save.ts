/**
 * The night in Umeå, written to localStorage so you can close the tab and come
 * back to the same cat, the same wallet, and the same dog.
 *
 * Everything is stored as indices into the world's own deterministic layout —
 * the city is generated from a fixed seed, so fish #17 is always the same fish.
 * That keeps a save to a couple of kilobytes and makes it forwards-compatible
 * with any change that does not renumber the world.
 */

const KEY = "katten-i-umea/save/v1";

export interface SaveData {
  version: 1;
  savedAt: number;
  elapsed: number;
  score: number;
  money: number;
  birdsScared: number;
  owned: string[];
  coat: string;
  /** Indices of the things already picked up. */
  fish: number[];
  cream: number[];
  coins: number[];
  monkeys: number[];
  landmarks: number[];
  player: { x: number; y: number; z: number; yaw: number };
  car: { x: number; y: number; z: number; heading: number } | null;
  dog: boolean;
}

/** A save is only useful if the browser will actually keep it. */
export function storageAvailable() {
  try {
    const probe = `${KEY}/probe`;
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

export function writeSave(data: SaveData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    // Private windows, blocked site data, a full quota — none of it should
    // interrupt the game.
    return false;
  }
}

export function readSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as SaveData;
    if (data?.version !== 1) return null;
    return data;
  } catch {
    return null;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}

/** A one-line summary for the title screen's continue button. */
export function describeSave(data: SaveData) {
  const minutes = Math.floor(data.elapsed / 60);
  const bits = [`${data.fish.length} strömming`, `${data.monkeys.length} apor`];
  if (data.money) bits.push(`${data.money.toLocaleString("sv-SE")} kr`);
  return `${bits.join(" · ")} · ${minutes} min`;
}
