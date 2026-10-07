# ErgonX Branding

Status: adopted 2026-09-24 · Assets: `public/brand/` · Generator: `scripts/generate-brand-assets.py` · Components: `src/components/brand/`

## Asset set

All derivatives come from the approved high-resolution lockup `public/ergonx-logo.png` via `scripts/generate-brand-assets.py`. The only operations are background removal (colour-to-alpha against the measured off-white field), cropping, compositing and solid fills. **No glyph is redrawn, distorted or gradient-recoloured.** Re-run the script whenever the source artwork changes.

| File | Role | Where it is used |
|---|---|---|
| `ergonx-logo-primary.png` | **Primary full logo** — navy wordmark, blue X | Login/auth (mobile), onboarding header, offline page, Platform header (light), major product moments |
| `ergonx-logo-primary-reversed.png` | Primary lockup with white wordmark, X unchanged | Navy surfaces: expanded sidebar, auth brand panel, dark-mode headers |
| `ergonx-mark.png` | **Sidebar mark** — the X symbol | Collapsed sidebar, splash screen, compact brand spots |
| `icon-192.png`, `icon-512.png`, `icon-512-maskable.png`, `apple-touch-icon.png`, `favicon-32.png`, `favicon-48.png` | **App icon / favicon** — X on the navy gradient tile | Browser tab, PWA manifest, installed/shortcut icon |
| `ergonx-logo-mono.png` | **Monochrome logo** (navy) | Payslips, financial statements, print/PDF, footers, watermarks, formal surfaces |
| `ergonx-logo-mono-white.png` | Monochrome, white | Formal attribution on dark surfaces |

`<Logo variant="primary | reversed | mark | mono | mono-white" height={…} />` renders these with correct aspect ratio; `<AdaptiveLogo>` swaps primary ↔ reversed with the theme.

## Rules

- Keep the approved geometry and proportions; never stretch, skew, re-letter or apply CSS filters to the logo.
- Minimum clear space around any lockup: the height of the "E" cap on all sides. Minimum height: 20 px (lockup), 16 px (mark).
- Backgrounds: primary on light/neutral surfaces; reversed on navy (`--brand-navy`) or dark surfaces; mono on print and formal documents. Do not place the full-colour logo on the signature gradient.
- The splash screen, auth brand panel and hero art may use the signature gradient *around* the logo; the logo itself stays as supplied.
- Splash (`SplashScreen.tsx`): the X mark breathes on a navy tile, the full wordmark (primary or reversed by theme) reveals left to right beneath it (`animate-wordmark-reveal`, 520 ms after a 240 ms delay), and a signature shimmer tracks progress with "Preparing your workspace…". All motion collapses under `prefers-reduced-motion`.

## Multicolour X — current status

The approved direction is for the X to carry the **teal → aqua → royal blue → violet** gradient. The supplied artwork is raster-only and its X uses the earlier **cyan → blue** gradient. Per the brief we did **not** recolour it programmatically.

- Implemented: the full signature gradient in the UI (`--gradient-signature`, `bg-signature`, `text-signature`), sidebar active bars, hero/auth/splash art, onboarding progress.
- **Outstanding (design deliverable):** vector (SVG) master artwork for the primary, reversed, mark and app-icon roles with the multicolour X. When supplied, replace the PNGs in `public/brand/` (keep file names) or add SVG variants to `Logo.tsx`. No code changes are otherwise needed.
- Also outstanding: an official reversed (white-wordmark) lockup and official app-icon master; the current ones are faithful composites of approved elements and should be replaced by designed masters.

## App icon / favicon

The icon tile reproduces the supplied app-icon layout: X mark centred on a vertical navy gradient (`#014299 → #011C48`, sampled from the supplied icon) with ~22% corner radius; the maskable variant is full-bleed square. Declared in `app/layout.tsx` metadata and `public/manifest.webmanifest`; `/favicon.ico` redirects to `favicon-48.png`. The service-worker cache name was bumped (`ergonx-static-v2`) so old icons are evicted.

## Sidebar transition

Formal requirement, implemented in `SidebarLogo.tsx`:

- **Expanded:** the full ErgonX wordmark (reversed, on navy). **Collapsed:** the standalone X sidebar mark. The collapsed rail always shows the ErgonX X; tenant logos are never squeezed into it.
- Two layered assets in one fixed 124×36 container, so the header never jumps. Typography is never morphed.
- **Collapsing:** the wordmark scales to 72% toward the symbol position, fades and softly blurs; the X scales 50% → 100% and fades in (40 ms delay). **Expanding** reverses it.
- Timing 220 ms, `ease-standard`. Each toggle plays **one** signature-gradient highlight across the X (`animate-mark-highlight`, masked to the mark's shape); nothing loops.
- Under `prefers-reduced-motion` the swap is instant and the highlight is suppressed.
- Tenant context lives in the sidebar footer panel: the uploaded institution logo (or a monogram), institution name and code, with "on ErgonX" beside an uploaded logo.

## Signature gradient

`linear-gradient(120deg, #14D2B8 0%, #22D3EE 30%, #2F6BFF 68%, #7C5CFF 100%)`. A brand-expression device, not a background for components. Approved uses: auth brand panel art, hero art (Home, Employee Home, Executive header glow), splash progress, sidebar active indicator, onboarding progress bar. Not for buttons, cards, tables or charts.

## Institution branding

- Tenant identity is prominent: institution name in the top bar context line, sidebar footer panel (institution logo or monogram + name + code), Home greeting, document headers.
- ErgonX identity is subtle but persistent: sidebar logo, ErgonX wordmark/X in the sidebar header, "on ErgonX" beside an uploaded tenant logo, "Powered by ErgonX" on documents.
- Tenant-generated documents (`DocumentFrame`: payslips, financial statements): the institution logo (when uploaded) and name are primary; ErgonX appears only as a monochrome "Powered by" attribution in the footer.
- Printable records (`PrintDocument.tsx`: journal entry, leave request form, employment offer, employee record, payroll run summary): a **Print** button, and in print/PDF only an institution masthead (logo, name, document title, reference, printed date) plus the monochrome "Powered by ErgonX" footer. On screen nothing changes; the app shell is hidden in print.
- Institution logo images: uploaded in Settings → Institution as a private `ImageAsset`. `/auth/bootstrap/` exposes the current one as `active_institution.logo_image_id` (session `institution.logoImageId`); any member may view it, only `settings.institution.manage` may replace or remove it. It renders in the sidebar footer panel, the `DocumentFrame` header and printed records.
