# Changelog

## 0.5.1 (2026-11-19)

- Map elements: the deprecated `/api/projects/{id}/models/*/bioEntities/elements/` endpoint (flagged by MINERVA as old API) is no longer called. Elements come from `minerva.elements.data.getAll()` (MINERVA 22) or the new API per map (`new_api/.../maps/{mapId}/bio_entities/elements/` on 22, `.../bioEntities/elements/` on 21). With no project open, for example in the admin registration form, no request is made.
- Clean now removes the plugin's tags from the map; before, it reset the filters and immediately re-tagged every mapped row. Only the plugin's own markers are removed (`removeSingleMarker`), so tags from other plugins stay.

## 0.5.0 (2026-11-19)

Corrections following a security and MINERVA 22 conformance audit and a review by a MINERVA developer.

- Licence: code relicensed under MIT, Copyright (c) 2026 Luiz Ladeira; the DNT-IVB dataset (Google Sheet) is declared CC BY 4.0. The build configuration is written for this plugin (`babel.config.js`); the editor-only `jsconfig.json` was removed.
- MINERVA 22: map elements are loaded with `minerva.elements.data.getAll()` when available, with the legacy REST endpoint kept as a fallback for MINERVA 21. Elements from both sources are normalised to one shape (`id`, `modelId`, `x`, `y`, `width`, `height`).
- Markers: one marker per map element. Several assays share an element, and MINERVA 22 throws when a marker id is added twice (16 duplicate calls in 0.4).
- Unload: the plugin container (with its styles), markers, timers, pending fetches, listeners and host-DOM changes are all removed or restored when the plugin is closed, including when it is closed before the data has loaded.
- Styles are injected inside the plugin container instead of the page `<head>`, so they leave with the plugin.
- DOI links are built only from values that are DOIs; other values are shown as text. Links and the "Access data" window open with `noopener noreferrer`.
- `Element_id` is read from the raw cell value and must be a positive integer; unresolved ids are reported in the browser console.
- The version shown in MINERVA is taken from `package.json`.
- The plugin URL can be set at build time (`PLUGIN_URL=... npm run build`, via envify) for test or alternative hosting; the default is unchanged.
- Removed dead code: unused `minervaAPI.js` typedefs, `MODEL_ID_COLUMN`, a no-op label replacement, the unused `$pink` variable and `.dnt-cell-id` rule.
- `package.json`: added repository metadata and `engines`; removed unused or deprecated packages (`@babel/polyfill`, mocha, chai, selenium-webdriver, watchify, uglify-js, xmlhttprequest) and the broken `test` and duplicate `build-debug` scripts; browserify updated to 17; `package-lock.json` added. Runtime dependencies: 0 known vulnerabilities (`npm audit --omit=dev`).
- `.gitignore`: added `node_modules/`, `dist/`, `__tmp_minerva_plugin/` and the generated CSS.

## 0.4

- MINERVA drawer header restored (`HIDE_HOST_CHROME = false`); keyless gviz data access; compact expandable-row layout; green/red mapping dots.
