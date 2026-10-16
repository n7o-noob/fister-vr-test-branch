FisterQoL 2.0
=============

A quality-of-life mod for Fister (fister.fun). Everything lives in the game's own Settings menu under a new QoL tab.
Works in the browser, in the Steam app on Windows, and natively on Linux (no Proton).


Install: browser (Windows, macOS, Linux)
----------------------------------------
1. Install Tampermonkey (or another userscript manager) in Chrome, Edge, Firefox or Safari.
2. Open Browser/FisterQoL.user.js and install it. Remove any older copy so only one is enabled.
3. In the script's Tampermonkey settings, make sure "Run at" is document-start.
4. Reload fister.fun and open Settings > QoL.


Install: Steam on Windows
-------------------------
Needs Python 3 (python.org; tick "Add python.exe to PATH" when installing).
1. Close Fister.
2. Open the "Steam (Windows)" folder and double-click "Install FisterQoL.bat".
   It finds Fister in your Steam libraries. If it can't, run it from a terminal with --dir and the path
   to your Fister folder (Steam > right-click Fister > Manage > Browse local files).
3. Start Fister from Steam and open Settings > QoL.

This replaces any older FisterQoL Steam install (v0.1.x or v1.6.4) for you.
When Steam updates Fister, it puts the original files back and QoL turns off. Run the installer again.
To remove it, double-click "Uninstall FisterQoL.bat". Steam > Properties > Installed Files > Verify integrity also restores everything.


Install: Linux (native, no Proton)
----------------------------------
Fister on Steam only ships a Windows build. This runs the same app natively on Linux instead,
using the Linux build of the Electron version it was made with, plus the Linux Steam library.
Works on Steam Deck too (use Desktop Mode for the install step).
1. In Steam, install Fister as usual (Steam uses Proton for the download; that's fine).
2. Open a terminal in the "Linux (native, no Proton)" folder and run:
       python3 fisterqol-linux.py
   It finds Fister in your Steam libraries (normal, Flatpak and Snap Steam), downloads Electron from
   GitHub and steamworks.js from npm (both checked against their published hashes), and builds
   Fister/linux-native/ inside your game folder.
3. It prints one line. In Steam, right-click Fister > Properties > General > Launch Options, and paste it.
   It looks like:  "/home/you/.local/share/Steam/steamapps/common/Fister/linux-native/run.sh" %command%
4. Press Play. Fister now starts natively, with Steam sign-in, the overlay and FisterQoL.

- Leave Proton selected under Compatibility: Steam needs it to list Fister, but it isn't used.
- Steam updates to Fister are picked up automatically the next time you launch.
- Without FisterQoL: python3 fisterqol-linux.py --no-qol
- To go back to Proton: clear the launch options. To delete the native build: python3 fisterqol-linux.py --uninstall
- It runs through XWayland so the Steam overlay works. For native Wayland, add FISTERQOL_WAYLAND=1 before the
  path in the launch options. If your system blocks Chromium's sandbox, it falls back to running without it.
- Problems? Check linux-native/qol-loader.log and linux-native/refresh.log.


Features
--------
Gameplay
- HUD: powerup timer and an input display (action buttons, or a keyboard and mouse diagram), with size and position controls.
- Custom crosshair: cross, dot, ring or your own image/GIF, with parry and grab cooldown bars.
- Camera: less screen shake and flashing, steady FOV, hide speed lines.
- Audio: separate volume for combat effects and custom sounds.
- Chat emojis: press F2 or click ☺ in chat, or type :shortcodes:.
- Fister emotes: :approve-fister:, :mad-approve-fister:, :meh-fister:, :disapprove-fister:, :dodgeball:, :javelin: and :piston:. They show in chat and above players for everyone using FisterQoL.
- Optional message sent in chat at the end of each round.

Optimization
- Low graphics mode with Balanced, Low and Potato presets, render resolution, view distances and effect limits.
- FPS counter.

Customization
- Theme creator: restyle the game with your own CSS and add decorations with HTML. Add your own images, fonts and videos, pick elements on screen to get their selectors, and share themes as a file or a code.
- Three-colour gradient and a Windows 95 look for QoL menus.
- Custom overlays: images, GIFs and videos on screen, optionally included in clips.
- Outfit import/export: copy your whole outfit as a code and load it again later, or share it.
- Pets: a pet that floats next to you in matches. Pick one from Pets in your Loadout, or import your own .glb model.
- Team outlines: bold team-colour outlines around players in team modes.

Clips
- Include QoL overlays (HUD, crosshair, FPS, music player, custom overlays) in your clips, with separate layouts for vertical and horizontal clips.

Music
- A built-in music player for your own songs and playlists (MP3, OGG, WAV, FLAC, M4A or ZIP), with a visualizer. It can be included in clips.

Animations
- Replace your avatar's animations with your own .glb/.gltf animations, and choppy-animation options.

Textures & Skybox
- Texture packs for maps and custom skyboxes.

Fun
- A slot-machine reveal for level-up rewards.
- Bisty: the grumpy FisterQoL version of Fisty. He sometimes shows up on the loading screen instead of Fisty with tips about QoL. Choose how often (or never) in QoL > Fun.

Profiles
- Save and switch between sets of QoL, audio, camera, graphics and clip settings.


Notes
-----
- FisterQoL only changes what you see. Pets, themes, overlays and custom animations are not visible to other players. Emotes are sent as normal chat text, so players without FisterQoL see the :shortcode: instead.
- Your settings, songs, pets, themes and overlays are saved in your browser, or in the Fister app on Steam. The browser and the app keep separate settings; use Profiles or theme export to move them over. Clearing site data for fister.fun removes them.
- Themes from other people are cleaned before use: scripts, links, forms and outside URLs are removed. Only turn on "Allow outside resources" for themes you trust.
- If a theme breaks the menu, press Ctrl+Shift+F9 to turn custom themes off, or add ?qoltheme=off to the end of the game's address.
- If the game updates and FisterQoL can't recognise it, the game still loads normally and a notice appears. Check for a FisterQoL update.

FisterQoL is a fan-made mod and is not affiliated with the Fister developers.

Credits
-------
FisterQoL by jaxonb423.
Third-party licences (React95, styled-components, acorn, emoji data and others) are in the licenses folder.
