# Steam client patch (experimental, optional)

The Quest bookmarklet and the PC userscript don't need any of this.

Fister's Steam app is an Electron launcher that loads fister.fun. These diffs
change two launcher files so it injects the VR layer when started with `--vr`:

- `main.js.diff`: `--vr` flag, WebXR/OpenXR switches, XR permission, hands the
  layer to the page.
- `preload.js.diff`: runs the layer in the page before the game starts.

The launcher files themselves belong to the Fister developers and are **not**
included here. Apply the diffs to your own copy.

## Applying

1. Extract `resources/app.asar` from your Fister install (e.g. with
   `npx @electron/asar extract app.asar app`).
2. From the extracted folder: `patch -p1 < main.js.diff` and
   `patch -p1 < preload.js.diff`.
3. Copy `dist/fisterVr.js` from this repo to `app/dist/fisterVr.js`.
4. Repack (`npx @electron/asar pack app app.asar`) and add `--vr` to Fister's
   Steam launch options.

## Caveats

- `Fister.exe` checks an embedded hash of `app.asar` (Electron ASAR integrity)
  and won't start a modified one until that hash is updated in the exe.
- Electron may be built without VR headset support, so this route may not work
  at all. The browser routes are the tested ones.
- Steam updates and "Verify integrity of game files" undo the patch.
- The diffs were made against the launcher build from October 2026. A newer
  launcher may need them re-applied by hand.
