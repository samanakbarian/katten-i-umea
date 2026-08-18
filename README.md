# Katten i Umeå

A 3D browser game. You are a white cat on a January night in Umeå: find thirty
herring, rescue twelve small monkeys, discover nine landmarks, climb Sara
Kulturhus and startle as many pigeons as possible.

Nothing is downloaded at runtime. The city, the cat, the monkeys, every texture
and every sound are generated procedurally in the browser with three.js, canvas
2D and the Web Audio API — no 3D models, no image files, no audio files.

```bash
npm install
npm run dev      # http://localhost:3000
```

## Controls

| Key | |
| --- | --- |
| `W A S D` / arrows | run |
| Mouse | look (click to capture the pointer) |
| `Shift` | sprint (costs stamina) |
| `Space` | jump; press again mid-air for a second jump; hold while falling to glide |
| `Space` held against a wall | climb it — facades, birch trunks, lamp posts |
| `C` | crouch |
| `E` | meow (scares birds within 14 m) |
| `Esc` | pause |

Touch devices get a virtual stick on the left half of the screen, drag-to-look
on the right, and on-screen buttons.

## The city

One unit is one metre and the cat is 60 cm long, so the buildings tower over
you the way they should.

Rådhustorget with its winter market and strings of advent lights, Rådhuset and
its clock tower, Väven on the quay, Sara Kulturhus at twenty storeys of timber,
Umeå stads kyrka, Norrlandsoperan, the university campus with Bildmuseet and a
frozen Universitetsdammen, Kyrkbron and Tegsbron over Umeälven, Teg on the south
bank, and about a thousand instanced birches — Umeå is Björkarnas stad.

Umeälven is frozen at the banks with an open channel mid-stream. Cats do not
enjoy the open channel.

## The monkeys

Twelve of them are hand-placed at the best spots in the city: the market square,
the Rådhuset tower gallery, the roofs of Väven and Norrlandsoperan, the church
tower, both bridges, Bildmuseet, out on the frozen pond, the far end of the
birch alley, a garden in Teg, and the very top of Sara Kulturhus. Each sits
blinking, scratching an ear and looking around until you find it, then joins a
parade behind you.

The parade follows the cat's own path rather than each monkey chasing the one
ahead — a chain lets a single straggler drag the whole line off, and sampling a
distance-indexed trail means the troop rounds corners and climbs onto roofs with
you instead of cutting through the building.

## Source layout

```
src/game/
  engine.ts     renderer, lights, post-processing, the game loop
  city.ts       procedural Umeå: blocks, landmarks, bridges, props, colliders
  cat.ts        the cat rig — jointed legs, nine-bone tail, ears, blinking
  monkeys.ts    the twelve monkeys and the parade that follows the cat
  player.ts     movement, AABB collision, climbing, third-person camera
  sky.ts        sky dome, stars, aurora shader, snowfall
  pickups.ts    herring, saucers of cream, scareable birds
  textures.ts   every texture, drawn into a canvas at load time
  audio.ts      synthesised meow, purr, squeak, footfalls, splash
  input.ts      keyboard, pointer lock, touch
src/components/game/   React shell, HUD, minimap
src/app/               the page
```

## Performance

Two modes are offered on the title screen: *Vackert* (bloom, soft shadows,
higher pixel ratio) and *Snabbt*. The renderer also drops its own pixel ratio if
the frame rate sags. Static city geometry is merged into a handful of draw calls
and the birches are instanced.

Requires WebGL2.
