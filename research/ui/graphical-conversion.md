# Graphical conversion: vnl-lj

Scope: application UI across Practice, Maps, Settings, History, About and gameplay overlays. Exact guidance revision `wahe36zc27i7`. Existing vanilla TypeScript DOM components and CSS retained. Movement, map geometry, events, DOM IDs and stored settings retained. Dark is the default; Settings → Display → Theme provides persisted light/dark selection.

## Component coverage

| Component/use | Status | Mapping and evidence |
| --- | --- | --- |
| Topbar, brand, room labels | Converted | `src/style.css`: brand/ui/data roles, neutral surfaces, one-sided divider shadow. |
| Play primary action | Converted | Effective Button primary control/label assignments including bevel, shadow, hover/focus and disabled states. Named variables in `src/theme.css`. |
| Tick toggle, settings actions, sound samples | Converted | Button secondary rest/hover, radius s, xs compact type, shared inset border/bevel/shadow. Tick icon is recreated after changing rate. |
| Menu, About, fullscreen actions | Converted | Button ghost/outline semantics; shared focus outline and Lucide icon treatment. |
| Menu navigation | Converted | Tabs list/trigger/panel assignments, selected neutral-1 surface, neutral-10 text and shadow-s. Compact xs labels preserve four tabs within panel. |
| Map choices | Converted | Existing selected navigation mapping, neutral surfaces, s radius, data typography and pressed-state inset ring. |
| History and empty state | Converted | UI/data type scale, muted neutral labels and single-edge dividers. Dynamic rows share the same rules. |
| Controls, Display, Viewmodel, Crosshair, import report, sound disclosures | Converted | Collapsible trigger/panel/content assignments with native details keyboard behavior retained. |
| Selects, sensitivity field, file import | Converted | Select/Number field colors, s radius, xs compact control typography, theme focus/invalid/disabled states. Hidden file input intentionally stays hidden. |
| Checkboxes | Converted | Theme checkbox surface, xs radius, neutral-4 inset border, color-1 selected indicator; native form events and focus retained. |
| Sliders | Converted | Slider track/thumb mapping, full radius, neutral-3 track, neutral-1 thumb, color-1 ring and shadow-s. Chrome/WebKit and Firefox thumb rules. |
| About popup | Converted | Effective Dialog popover/title/description/backdrop, m radius, l padding/shadow. Inherits document mode and font; no portal scope mismatch. |
| Toast | Converted | Toast popover background/text/radius/padding, shadow-m and theme motion. Reduced-motion rule included. |
| Jump stats, PB, plot and strafe table | Converted | Data type scale, neutral surfaces, one-sided table dividers; plot reads neutral-4/success/warning from current mode and redraws on appearance changes. Existing compact 240px geometry retained. |
| Speed/keys, lane label, chat surfaces, gameplay shortcuts | Converted | Theme data typography, neutral-2 surfaces, s radius and border/shadow. Stats stay off by default; no central coaching hints or menu controls strip added. |
| Keycaps | Converted | Theme data family/weights, xxs type, neutral-3 surface, xs radius and inset border. |
| Crosshair geometry and custom color | Intentionally preserved | User-configured gameplay values remain in `src/settings-panel.ts`; preview container is themed. These are game settings, not interface token drift. |
| KZ jump-tier colors | Intentionally preserved | Existing GOKZ classification colors in `src/main.ts` remain domain encodings; chat containers and text roles are themed. |
| Three.js maps, knife and world art | Intentionally preserved | Renderer assets/lighting and world geometry are outside the interface skin. |

## Assets and dependency policy

GT America licensed files were not supplied. Official free fallback Inter variable WOFF2 is installed in `public/fonts/`, from the official rsms/inter repository, with its license. It is registered as **Sidebar Inter**, normal weights 100–900, covering requested 400/500/600. All four role stacks retain GT America first and Sidebar Inter second. Font preloads and uses font-display swap. The dev server served identical bytes (SHA-256 `693b77d4f32ee9b8bfc995589b5fad5e99adf2832738661f5402f9978429a8e3`). Browser computed popup font stack is correct and rendered views show the fallback.

To activate GT America, obtain licensed webfonts from https://www.grillitype.com/shops/gt-america, place them under `public/fonts/`, and add `@font-face` declarations named `GT America` to `src/theme.css` covering 400/500/600. Existing stacks will select it automatically.

Lucide's official vanilla JavaScript adapter (`lucide`) is the sole added dependency, installed with Bun. Verified installed exports and type declarations, four decorative SVGs rendered, stroke width 2. Existing Three.js/TypeScript/Vite dependency ranges were retained; Bun lock changes add Lucide only.

## Audit and repairs

Inspected theme values/effective assignments, all UI markup in `src/main.ts` and `src/settings-panel.ts`, settings normalization, global CSS and canvas plot styling. Fixed legacy hardcoded UI palette/type choices, native-width interface borders, plain-text icon placeholders, a missing selected-tab variable mapping, tick-icon recreation and chart redraw after mode changes. All CSS variable references resolve to installed definitions except the seven user-owned crosshair variables assigned by the settings panel. Foundations retain supplied light/dark values; consumed effective component assignments are named separately. Shared `text-wrap: pretty`, semantic type roles, keyboard focus and reduced-motion rules are present.

Native select option menus still use the browser/platform popup renderer; their theme font/colors and document color-scheme are supplied, but OS-specific padding/shadows cannot be made identical with native selects. This preserves existing interaction behavior.

## Verification

- `bun run build`: TypeScript and production build pass. Existing large JavaScript chunk warning remains.
- `bun test`: 72 tests pass across 10 files, including config/profile round trips with the added appearance field.
- Browser at 1280×720: visually reviewed dark Practice/History, light Maps/Settings and light About; checked saved light mode survives reload, restored dark, verified rendered Lucide icons and popup family alias.
- Inter file served successfully; source declares requested weight coverage. Browser automation's read-only DOM bridge does not expose FontFaceSet, so a programmatic face-status check was unavailable.
- Stats checkbox toggles on/off, ending off. Existing 64 tick setting retained.
- Gameplay overlays were audited in source; live pointer-lock playtesting remains unavailable in this in-app browser (previous capture attempts returned Chromium UnknownError). HUD over active play, populated history/table data, narrow viewports and OS-native select popups need manual visual confirmation. No claim of exhaustive rendered fidelity.

Screenshots: `artifacts/theme-dark-menu.png`, `artifacts/theme-light-dialog.png`.

## Binding editor refinement

User requested a quieter treatment after reviewing the raised binding buttons. `src/settings-panel.ts` now renders flat key chips with muted Lucide remove icons and ghost + actions, with Bind text on unassigned actions. `src/style.css` scopes the compact treatment to `.binding-buttons`; other secondary actions retain their authored styling. Existing add/remove handlers and accessible names are preserved. Build passed; dark-mode rendering, capture prompt and Escape cancellation were checked in the browser. Screenshot: `artifacts/bindings-flat.png`.

## Gameplay chrome refinement

Removed the full-width topbar, brand link and redundant map/tick header labels. Only individual stats/menu controls remain at the top right. Browser title is Long jump practice. Removed stale header updates and the brand click handler. The optional stats card is 208px wide with a smaller distance value and three summary metrics. Full metrics, plot, strafe table, personal best and result note live under a native Details disclosure available while paused. The panel sits outside the hidden gameplay wrapper so paused inspection works, and details close on pointer lock to preserve the compact playing view. The user's stats visibility preference is unchanged.

Verified production build, 72 existing tests, compact/expanded stats rendering, show/hide and 64/128/64 switching in the browser. Active pointer-lock gameplay still needs manual visual confirmation. Screenshot: artifacts/game-chrome-compact.png.

## Quiet result feed and favicon

The left-side feed now replaces its content with the latest result instead of retaining four two-line reports. `src/jump-feed.ts` composes distance to two decimals and a compact strafes/sync/pre-speed line. GOKZ color is confined to a small marker; invalid/missed jumps remain explicitly labeled. The four-decimal distance and former secondary feed metrics are retained in the paused Details readout. Changing maps clears the feed. No history entries or sound behavior were removed.

Tab title is exactly `longjump`. `public/favicon.svg` is original vector artwork: an outlined jumping player with a balaclava, bent limbs and curved trailing strokes, drawn on a dark tile for browser-tab contrast. No font/icon dependency was added for this artwork.

Production build and 72 existing tests pass. Rendered the actual feed component with a sample result in a temporary review page, checked dark/light theme colors, and inspected the favicon at 16/32/64px. The temporary page was removed after review. Main-page title and favicon link were verified in the browser. Screenshot `artifacts/jump-feed-favicon.png` is a component preview, not a captured live jump; pointer-lock gameplay remains unverified in the in-app browser.

## About introduction and credits

Replaced the technical About summary with the requested browser-porting introduction and linked credits. Included map lineage from `research/maps/README.md`, movement/input/collision references from `research/movement/README.md`, GOKZ vanilla/jumpstats sources, zer0k-z's deadstrafe notes, Valve assets, GOKZ audio, sourcesounds/csgo, Graphical, Inter and Lucide. Existing technical limitations remain in the documentation. Retained native dialog behavior, added an accessible title and labeled credit sections, and used existing theme typography/spacing. Production build passed. Browser review checked opening/closing, credit content and scroll access. Live Steam pages were unavailable during this pass; map attribution uses the project's recorded research/provenance rather than newly inferred credits.

## KZ chat restoration

Supersedes the compact latest-result feed at the user's request. Restored the KZ prefix, distance tier color on the jump type/distance, green numeric values, grey labels, pipe separators and all previously reported metrics. Four reports appear in chronological order with the newest at the bottom; map changes still clear them. Transparent text replaces the earlier cards, with a black outline for game-world contrast. The feed sits 80px above the bottom edge to avoid the centered speed readout. Metric groups wrap together on narrow screens.

Reference: [GOKZ jump_reporting.sp](https://github.com/KZGlobalTeam/gokz/blob/c56aa84f0581167bc5a2998e9f631382f67141be/addons/sourcemod/scripting/gokz-jumpstats/jump_reporting.sp), especially DoChatReport and its value-format helpers. This is a Source-style adaptation, retaining this app's four-decimal distance and explicit invalid/failed labels rather than claiming pixel-exact GOKZ reproduction. Gameplay chat colors/outline are an intentional user-requested exception to menu mode colors; font, size, line height, letter spacing and report spacing use active theme tokens. No dependency or global token changes.

Coverage: jump report markup and feed history converted; obsolete compact feed styles removed; surrounding HUD/menu preserved. Verified TypeScript/Vite build, browser component preview at 672px and 312px content widths with no horizontal overflow, and light-mode invariance of gameplay colors/transparency. Screenshot: artifacts/kz-chat-restored.png. Temporary preview removed after review. Live jump/pointer-lock behavior not verified because the in-app browser rejects pointer lock.
