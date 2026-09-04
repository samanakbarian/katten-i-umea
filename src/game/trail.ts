import * as THREE from "three";

/**
 * A breadcrumb trail of where the cat has been, indexed by distance travelled.
 *
 * Followers sample a point a fixed number of metres back along it rather than
 * chasing whoever is in front of them. A chain of chasers lets one straggler
 * drag the whole line off, and it cuts corners through buildings; walking the
 * cat's actual path keeps the troop on the pavement and takes it up onto the
 * roofs with you.
 */
export class PathTrail {
  private points: { p: THREE.Vector3; d: number }[] = [];
  private length = 0;

  /** Extend the trail. `keep` is how many metres of history are still needed. */
  push(pos: THREE.Vector3, keep: number) {
    const last = this.points[this.points.length - 1];
    if (!last) {
      this.points.push({ p: pos.clone(), d: 0 });
      return;
    }
    const step = last.p.distanceTo(pos);
    if (step < 0.1) return;
    this.length += step;
    this.points.push({ p: pos.clone(), d: this.length });
    const needed = this.length - keep;
    while (this.points.length > 2 && this.points[0].d < needed) this.points.shift();
  }

  /** The point `back` metres along the path, or null before anything is on it. */
  sample(back: number): THREE.Vector3 | null {
    if (!this.points.length) return null;
    const target = this.length - back;
    if (target <= this.points[0].d) return this.points[0].p;
    for (let i = this.points.length - 1; i > 0; i--) {
      const a = this.points[i - 1];
      const b = this.points[i];
      if (a.d <= target && target <= b.d) {
        const span = b.d - a.d;
        return a.p.clone().lerp(b.p, span > 1e-5 ? (target - a.d) / span : 0);
      }
    }
    return this.points[this.points.length - 1].p;
  }

  get isEmpty() {
    return this.points.length === 0;
  }

  /**
   * Metres laid down so far. A follower must check this before sampling: with a
   * short trail every sample collapses onto the head of it, which parks the
   * follower inside whoever it is following.
   */
  get travelled() {
    return this.length;
  }
}
