# FisterQoL (bundled)

`FisterQoL.user.template.js` is FisterQoL's Tampermonkey userscript (Browser release, with the QoL > VR tab), with
`const VR_SOURCE=__FISTER_VR_SOURCE__;` where `tools/build.cjs` inserts `src/fister-vr.js`.

Built from it:

- `dist/FisterQoL.user.js`: Tampermonkey (PC). Install with document-start injection.
- `dist/fisterqol.bookmarklet.js`: the same, reformatted to run from a bookmarklet (readable).
- `dist/fister-vr-qol.bookmarklet.txt` and the setup page option: the compressed bookmarklet.

`licenses/` holds the licenses of third-party code bundled inside FisterQoL (React95, styled-components, acorn,
eslint-scope, emoji data).
