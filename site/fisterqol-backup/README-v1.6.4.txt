FisterQoL v1.6.3 - Browser release

Replace your existing Tampermonkey script with FisterQoL.user.js. Keep one copy enabled, document-start injection, then refresh fister.fun.

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
