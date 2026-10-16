# Fister VR (test branch)

An unofficial WebXR mod that lets you play [fister.fun](https://fister.fun) in VR, built for a
standalone **Meta Quest 2**. It runs in the Quest Browser, with no PC, SteamVR or browser extensions.

> Fan-made. Not created by, endorsed by or affiliated with the Fister developers (BOOTLOOP Studio).
> It changes only what your own browser shows and sends, the same way your mouse and keyboard would.

**Test setup page (password-locked):** https://n7o-noob.github.io/fister-vr-test-branch/ (open it in the Quest Browser)

**Stable setup page:** https://n7o-noob.github.io/fister-vr/

## Features

- **Enter VR button** on the running game, with 1:1 head tracking from your avatar's head (eye height adjustable).
- **Right-hand aim, Vivecraft-style:** you face and punch where your right controller points, and other
  players see it. Your view comes only from the headset; the right stick turns.
- **Arms follow your controllers:** from the shoulder, or hands on the controllers. Size is adjustable and only
  you see the change.
- **Your torso and legs are hidden** (with clothing), so you aren't looking at the inside of your own body.
- **Game menus and HUD in VR:** main menu, loading screens, pause and settings, health, scoreboard and charge
  bar, on a panel that floats in front of you. Point the right hand and pull the trigger to click; sliders,
  checkboxes and dropdowns work, and the stick scrolls.
- **Ragdolls** switch to the game's third-person camera until you get up.
- **Works from the main menu:** enter VR before the game shows any 3D, and the view switches to the game when it
  starts rendering. It keeps working through menus, round breaks and killcam.
- **Fixes for VR-specific problems:** outline glow that draws as black boxes, input that stops after focus
  changes, late screen clears that flash black, and one-frame position glitches.
- **Debug console:** hold both grips for a second in VR, or press VR INFO outside it.
- **Optional FisterQoL bundle:** the setup page can build a bookmarklet that loads FisterQoL with the VR mod
  inside it. See [With FisterQoL](#with-fisterqol).

## Quick start (Quest 2)

1. In the headset, open the setup page in the **Quest Browser**, pick your settings and press
   **Copy bookmarklet**.
2. Bookmark any page, edit that bookmark, rename it **Fister VR**, and paste the copied text (it starts with
   `javascript:`) over its URL.
3. Open fister.fun. The main menu is fine; you don't need to be in a match.
4. Open Bookmarks, tap **Fister VR**, then press **Enter VR** (bottom left).

Tap the bookmark again after each page reload.

## Controls

| Controller | Input | Does |
|---|---|---|
| Right | Pointing | Your aim (where you face and punch) |
| Left / Right | Trigger | Left mouse button |
| Right | Trigger, pointing at a menu | Clicks it |
| Right | Stick up/down, pointing at a menu | Scroll |
| Left / Right | Grip | Right mouse button |
| Left | Stick | W A S D |
| Left | Stick click | Recenter |
| Left | X | Emote wheel: holds E until you pick an emote with the laser (press X again to close) |
| Left | Y | Escape (pause menu) |
| Right | Stick left/right | Turn |
| Right | A (hold) | V (voice chat) |
| Right | B | Wake input if buttons stop working |
| Right | Stick click | Save a clip (with FisterQoL: presses your Save clip key) |
| Both | Grips, hold 1 s | Debug console |

## With FisterQoL

On the setup page, set **What the bookmark loads** to **Fister VR + FisterQoL**. The bookmark then loads
FisterQoL (reformatted from its Tampermonkey version to run from a bookmark), with the VR mod inside it.

- **Tap the bookmark any time on fister.fun**, best from the main menu. FisterQoL has to start before the game
  does, so the bookmark restarts the game inside the same tab (a fresh copy of the home page in a full-window frame,
  with FisterQoL loaded first) and stops the copy that was already running. If you're in a match you'll leave it.
- You get FisterQoL's **QoL** settings tab. Its **VR** section has every VR setting plus Enter VR, Recenter,
  VR info and Copy log.
- **Clips in VR:** in the headset the game's canvas stops updating, so clips would be a frozen frame. While the
  game records a clip, the mod draws a steadied first-person view from the headset (480p to 1080p, adjustable
  field of view and smoothing) and hands it to the game's recorder. Saved clips go to the Discord through the
  game's normal clip upload. **Right stick click** saves a clip with your Save clip key from the game's controls.
- In VR, FisterQoL ignores its FPS limit (the headset needs every frame) and hides the crosshairs (you aim with
  your hand). QoL HUD items appear on the floating HUD; low graphics, team outlines, texture packs, skyboxes and
  custom animations apply in the headset.
- **Use these VR settings every time** (on by default) re-applies the page's settings on each tap. Turn it off
  to manage them in QoL > VR instead.

On PC, install [`dist/FisterQoL.user.js`](dist/FisterQoL.user.js) in Tampermonkey instead (document-start) and
turn on **Settings > QoL > VR > Enable VR mode**. Don't run it together with `fister-vr.user.js`.

The FisterQoL source is in [`qol/`](qol/); third-party licenses for code bundled in it are in
[`qol/licenses/`](qol/licenses/).

## PC browsers (Chrome / Edge + SteamVR, Quest Link or Virtual Desktop)

Install [`dist/fister-vr.user.js`](dist/fister-vr.user.js) in Tampermonkey or Violentmonkey (it runs at
document-start), open fister.fun and press **Enter VR**. Any OpenXR runtime works, not only SteamVR.

## Steam client

Experimental. See [`steam/README.md`](steam/README.md).

## Settings

The setup page builds your settings into the bookmarklet. Outside the headset you can also change them from
the browser console, for example:

```js
fisterVR.config.armScale = 0.4; fisterVR.saveConfig();
fisterVR.config.buttons['right.b'] = { key: 'KeyE' }; fisterVR.saveConfig();
```

## How it works

Fister loads its game code live from fister.fun, so the mod doesn't edit it. It hooks three.js from the outside:

- **Renderer:** it finds the game's `WebGLRenderer` and turns on `renderer.xr`.
- **Headset view:** it re-renders the game's camera through an XR rig placed at your avatar's head.
- **Controls:** it turns controller input into the mouse and keyboard events the game already understands.
- **Menus:** it repaints the game's HTML interface onto a texture for the menu panel.

Everything is in [`src/fister-vr.js`](src/fister-vr.js).

## Building

```
node tools/build.cjs
```

This regenerates `docs/index.html` (the setup page), `dist/fister-vr.user.js`, `dist/fister-vr.bookmarklet.txt`
and `dist/fisterVr.js`, plus the FisterQoL builds: `dist/FisterQoL.user.js`, `dist/fisterqol.bookmarklet.js`
(readable bookmarklet format) and `dist/fister-vr-qol.bookmarklet.txt` (default settings). A GitHub Action does
the same on every push that touches `src/`, `site/`, `tools/` or `qol/`.
See [`test/README.md`](test/README.md) for the stand-in game tests.

## License

MIT for this repository's own code. See [LICENSE](LICENSE). Fister itself and its assets belong to their owners.

## Test build

This is the public **test branch**. The setup page is behind a password (deterrent, not real security — the repo is public). Enter the test password to open it; the bookmarklet it gives you is sealed and asks for the same password each time it runs. The live mod is at the main `fister-vr` repo.
