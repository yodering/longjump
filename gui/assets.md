# Font and icon setup

The download contains Markdown references, not font files or icon artwork. During an authorized UI implementation or conversion, install and configure the selected free assets in the receiving app. Read the active theme’s **Font and icon setup** section for its selected families, role weights, exact stacks, official download destinations, and named free fallbacks. Guidance-only setup, planning, and read-only audits do not install assets or change runtime code. An implementation request already authorizes this setup within its scope; do not add another approval round for free assets.

## Fonts

- **Free font:** download or install the selected family from its linked Google Fonts page or official vendor/repository, then configure it in the app. A generic system fallback does not complete setup of an available selected free font.
- **Licensed font:** use appropriately licensed webfont files already supplied in the project. If they are unavailable, install and configure the reference’s named free fallback for each affected role. Keep the selected licensed family first in the stack, with the installed fallback immediately after it, retaining the remaining authored fallback stack. Tell the user which fallback is active and link the selected font’s official vendor page with the steps to add the licensed webfont later. Do not purchase a license or download restricted files.
- **System font:** preserve its stack; no download is needed.
- **Unknown/custom family:** verify its official source and web-use terms before treating it as free. Use supplied assets when their licensing and setup are established. Otherwise report the unresolved family and source requirement; do not guess a license, download source, or substitute family.

Install into the app, not the operating system. Reuse existing assets and the framework’s supported font loader when available. For local files, use the app’s established font directory (for example, `public/fonts/`) and configure `@font-face` with the authored family name, accurate weights/styles, and `font-display`. Alternatively use the framework’s local or Google font loader, checking its installed API. Connect loader-generated font families or CSS variables to the appropriate theme roles so an unloaded literal family name does not silently fall through. For a licensed selection, its authored name stays first and the loader’s free fallback family follows it.

Collect the weights used by all roles sharing a family. Fetch those static faces or a variable file whose declared range actually covers them, including required styles and language coverage. Preserve the theme’s authored weights; do not claim an unsupported face or rely silently on synthetic bold/italic. If the official family lacks an authored weight, report the mismatch and use the supported CSS matching behavior without inventing a file or weight range.

Keep the source’s actual license and required attribution notices alongside locally downloaded assets; free fonts do not all use the same license. Add a missing package only when the chosen setup needs it, using the receiving project’s package manager and version policy. Preserve existing dependency versions, ranges, overrides, and lockfile choices; do not upgrade the framework to obtain a font API.

Some free fonts require an official request form or emailed download. Do not submit personal details, accept marketing consent, or agree to personal license terms on the user’s behalf. Complete independent asset setup and give the exact official destination and required user action when a download is gated or unavailable. Keep the selected free family and report the setup as incomplete; do not silently switch it to another font.

## Icons

Install and use the selected free pack from the official source linked in the theme reference: Lucide or Phosphor. Reuse an already installed compatible package; add a missing framework adapter using the project’s package manager and version policy. Check exports and props against the installed version. Match the selected style/weight where supported, preserve glyph meaning, and retain sizes, colors, accessible names, and decorative hiding.

For Central or another licensed pack, use supplied licensed artwork when available. Otherwise install and use the reference’s free fallback (Lucide for Central), preserving semantic icon mappings, and tell the user which pack is active. Link the selected pack’s vendor destination and explain where to add its licensed artwork and replace the fallback adapter later. Do not pretend a fallback reproduces the licensed pack’s exact glyphs or unsupported style/weight. Retain required license notices for installed or downloaded artwork.

## Finish setup

Verify the configured files/imports, loaded family aliases, required weights, and actual icon exports using the receiving app’s review policy. Distinguish source checks from rendered review. Report installed families/packs and their official sources, any active free fallbacks, and unresolved downloads or coverage. For each unavailable licensed selection, give a short path to completion: obtain the web-use license/files at the linked vendor, place them in the configured asset directory, and register the selected family or icon adapter. See [Verification](verification.md) for related checks.
