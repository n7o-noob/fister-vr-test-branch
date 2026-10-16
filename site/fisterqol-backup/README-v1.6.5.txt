FisterQoL v1.6.5 - Browser release

Replace your existing Tampermonkey script with FisterQoL.user.js. Keep one copy enabled, document-start injection, then refresh fister.fun.

NEW IN 1.6.5: VR mode (WebXR)
QoL > VR adds the Fister VR headset mode (Fister VR 0.8.3, FisterQoL build) as an option. Off by default.
- Tick Enable VR mode, press Reload now, then press Enter VR (in the VR tab or the button at the bottom left).
- Needs a browser with WebXR on PC: Chrome or Edge with Quest Link, Air Link, Virtual Desktop or SteamVR.
  The Quest Browser cannot run Tampermonkey; there, keep using the Fister VR bookmarklet.
- All the Fister VR setup-page settings are in the tab: aim hand, turning, snap strength, headset resolution,
  world scale, eye position and height, arms, hand position, arm size, controller boxes, torso and legs,
  menu/HUD panel and distance, outline glow, and whether the VR buttons show on the game screen.
  Changes apply live (headset resolution: next time you enter VR). Enter VR, Recenter, VR info and Copy log
  buttons are in the tab too.
- Clips in VR: while the game is recording a clip, a steadied first-person view from your headset is drawn
  and given to the game's clip recorder, so clips taken in VR show what you saw and upload to the Discord
  through the game's normal clip upload. Settings: clip view on/off, 480p/720p/1080p, field of view, camera
  smoothing. Include QoL overlays works on top of it. Without this the clip would be one frozen frame.
- Save clip from the controller: right stick click (or right B) presses the game's own Save clip key,
  read from the game's Controls, with a short vibration. The VR tab shows which key was found.
- Works with QoL: the FPS limit is ignored while in VR (the headset needs every frame), crosshairs are
  hidden in VR (you aim with your hand), QoL HUD items show on the floating HUD, and Advanced low graphics,
  team outlines, texture packs, skyboxes and custom animations apply in the headset.
- If you also have the separate Fister VR userscript installed, disable it; only one copy can run.
Tested against stand-in three.js games with a simulated headset (headset view, panel, clip frames,
controller clip button, regression suites). Not yet verified in the live game or on a real headset.

New since Steam v0.14.0
- Verified FisterQoL Creator badge for jaxonb423 in shared chat/friends/leaderboard names.
- Optional Match end message in QoL: custom text, once per round via normal player chat.
- Fun tab: three-reel level-up cosmetic reveal. Reels show store cosmetics and stop on three actual choices before revealing normal selection. Skip and duration controls.

Release renames v0.15.0 to v1.6.3; existing settings/imports are retained. Creator badges are only visible to users of this update. No changes to rewards or claims. Runtime tests passed; live gameplay remains unverified.


v1.6.3 Organized settings
All mod settings now live under one QoL tab. A scrolling second tab row provides Gameplay, Optimization, Customization, Music, Animations, Textures & Skybox, Fun, and Profiles. Category selection persists. All settings panels stay mounted; existing settings/imports are retained. Search still covers hidden categories. FPS moved to Optimization. Fixed Fun checkbox children rendering. Actual ReactDOM category switching, preserved controls, nested search, React95 activation and source injection tests passed; live game layout remains unverified.

1.6.3: Keeps settings tab rows from shrinking and contains wide Customization controls.

1.6.3: Official-server round phase chat message hooks; bypass explicit frame interval while Show FPS is enabled. FPS counts rendered frames.

1.6.3: Gradient also applies to native link buttons and social taskbar.

1.6.3: QoL > Customization > Custom overlays. Import images/GIFs/videos, drag placement, width/opacity/position, video mute/volume/loop. Saved locally; each file under 100 MB. Use Move overlays to preview/edit; otherwise shown in game only. Resume videos if browser blocks playback.

1.6.3: QoL > Optimization > Advanced low graphics. Balanced/Low/Potato, 25-100% scene resolution, distant avatar detail, per-type effect spawn limits, supported static prop draw distance, trails/decals. Controls apply while Low graphics is enabled. Removes old low preset 60 FPS cap. Resolution applies to 3D only. Distance 0 preserves native detail/visibility. Rendering statistics included; actual FPS gain depends on bottleneck.

1.6.3: Custom media overlays in clips. Enable Include QoL overlays in native Clips settings and Include in clips per overlay. Vertical clips have individual X/Y controls; horizontal clips use on-screen layout. Opacity preserved; video frames recorded, video audio not mixed. GIF animation uses ImageDecoder where available, static fallback otherwise.

1.6.3: Chat emoji picker and shortcode rendering. QoL > Gameplay > Chat emojis. Updated QoL clients render supported emoji shortcodes; unmodded clients see shortcode text, not the emoji graphic. Both sender and recipient need this update for decoding.

1.6.3: Expanded emoji catalogue: 6753 names/aliases for 3824 sequences, searchable paged picker. Emojibase Discord/JoyPixels preset plus emoji-data aliases. Includes flags, joined sequences and skin tones; exact latest Discord name parity not guaranteed. Custom server emojis excluded. Native OS emoji appearance, not Discord image artwork. Unmodded users still see shortcode text. Sources: https://emojibase.dev/docs/shortcodes/ and https://github.com/iamcal/emoji-data .

1.6.3: QoL > Customization > Team avatar outlines: bold native team-colour outlines for other living avatars; thickness/brightness, respects walls, works at low detail and in clips. Native appearance for vehicles/ragdolls. Includes emoji mouse release and F2 picker shortcut while typing in chat.
