# Nandini's Birthday Run 🎂

A little 2D platformer, made as a birthday present.

Nandini has **five flowers** — that's her health. Spikes cost a flower, and so does
falling (out of the world, or from a very long way up). Run, jump, and climb your way
through three levels to reach the birthday cake at the end of each one.

## Play it

It's plain HTML, CSS and JavaScript with no build step and no dependencies.

- **Locally:** open `index.html` in any browser. That's it.
- **Online:** push this repo and turn on GitHub Pages (Settings → Pages → deploy from
  `main`, folder `/root`). The game will be at
  `https://<your-username>.github.io/my-first-repo/`.

## Controls

| Action | Keys |
| --- | --- |
| Move | `←` `→` or `A` `D` |
| Jump | `Space`, `↑`, `W` or `Z` |
| Restart the level | `R` |
| Back to the title screen | `Esc` |
| Mute | `M` |

On a phone or tablet, on-screen buttons appear automatically.

## The levels

1. **The Garden Path** — a gentle introduction: a few gaps, a few spikes.
2. **Balloon Balconies** — a high route and a low route, and spikes on the ceiling.
3. **The Candle Tower** — a climb. Falling off is expensive.

Pink balloons are checkpoints: touch one and a fall sends you back there instead of to
the start. The wrapped gifts are optional — they're just there to be found.

## How it's put together

```
index.html        page shell, canvas, touch buttons
css/style.css     layout and the on-screen controls
js/levels.js      the three levels, drawn as ASCII maps, plus the map parser
js/sprites.js     every drawing routine (Nandini, cake, flowers, spikes, scenery)
js/input.js       keyboard and touch input
js/audio.js       small WebAudio blips, and the win jingle
js/game.js        physics, collision, camera, game states, the main loop
```

There are no image or sound files — the artwork is drawn with canvas paths and the
sounds are synthesised, so nothing can go missing.

### Editing a level

Levels live in `js/levels.js` as grids of characters, one character per 40×40 tile:

```
.  empty            #  solid ground        ^  floor spikes
P  Nandini's start  c  the cake (goal)     v  ceiling spikes
f  checkpoint       *  gift
```

Edit the art, reload the page, and the change is live. Keep every row in a level the
same length. The movement constants at the top of `js/game.js` are what the layouts are
designed around: a full jump clears three tiles of height and about four and a half
tiles of distance, so a step two tiles up and three tiles across is always comfortable.
