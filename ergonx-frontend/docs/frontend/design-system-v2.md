# ErgonX Design System v2

Status: adopted 2026-09-24, refined 2026-09-25 (§12) · Scope: `ergonx-frontend/` · Companion docs: [branding.md](./branding.md), [visualization-guidelines.md](./visualization-guidelines.md)

Visual direction: **modern enterprise blue + multi-accent signature X + module-coloured intelligence.** The interface should feel energetic yet calm enough for daily use: navy structure, blue actions, soft neutral canvas, and module colour used sparingly as information. Since the 2026-09-25 refinement the reference feel is Linear/Stripe: crisp 8–12 px radii, hairline borders carrying structure, near-flat elevation, 36 px controls and a tighter type scale.

This document describes the system as implemented. When code and this document disagree, the code in `src/app/globals.css` and `src/components/ui/` wins; update this file.

---

## 1. Architecture

| Layer | Location | Purpose |
|---|---|---|
| Tokens | `src/app/globals.css` (`:root`, `.dark`) | Raw brand palette and semantic role variables for light and dark. |
| Theme registration | `globals.css` `@theme inline` / `@theme` | Exposes roles as Tailwind v4 utilities (`bg-surface`, `text-ink-muted`, `border-line`, `bg-mod-payroll-soft`, `shadow-elevation-2`, `text-title` …). |
| Legacy bridge | `globals.css` §3 | Two residual rules: sentence-cases legacy `text-xs uppercase` micro-labels and gives native controls without `data-ui` dark-mode colours. |
| Primitives | `src/components/ui/*` | Button, Field/Input/Select/Textarea/Checkbox/Radio/Switch/FileInput, Card family, Badge/StatusBadge, Alert, DataTable/DataToolbar/Pagination, Dialog/Drawer/Popover/Menu/Tooltip, Tabs, Skeleton family, Empty/Error/Loading states, PageHeader, BackButton, ActionBar. |
| Charts | `src/components/charts/*` | ChartCard frame, formatters, Recharts wrappers and custom visuals. |
| Brand | `src/components/brand/*` | Logo, SidebarLogo transition, SplashScreen, AuthShell, DocumentFrame. |
| Shell | `src/components/layout/*` | AppShell, Sidebar, TopBar. |
| Theme runtime | `src/components/context/ThemeProvider.tsx` | Single canonical light/dark/system theme. |
| Module accents | `src/lib/moduleTheme.ts` | Accent class map, route→accent and route→module label. |

**Rule:** new code uses semantic roles and primitives. Raw Tailwind palette classes (`slate-*`, `sky-*`, `red-*` …) are rejected by ESLint (`no-restricted-syntax` in `eslint.config.mjs`); do not introduce hex values in components either. Arbitrary values are acceptable only for one-off geometry (e.g. chart heights).

---

## 2. Tokens

### 2.1 Brand palette

| Token | Value | Use |
|---|---|---|
| `--brand-navy` | `#0F2345` | Sidebar, hero surfaces, primary ink |
| `--brand-navy-deep` | `#08172F` | Dark-mode sidebar, tooltips |
| `--brand-ink` | `#23324D` | Body ink |
| `--brand-primary` / `--accent-blue` | `#2F6BFF` | Primary action |
| `--accent-teal` | `#14D2B8` | Signature gradient stop |
| `--accent-aqua` | `#22D3EE` | Signature gradient stop, hero eyebrows |
| `--accent-sky` | `#38BDF8` | Signature gradient stop |
| `--accent-violet` | `#7C5CFF` | Signature gradient stop |
| `--gradient-signature` | teal → aqua → blue → violet | Brand expression only (see §9) |

### 2.2 Semantic roles (light · dark)

| Role | Utility | Light | Dark |
|---|---|---|---|
| Canvas | `bg-canvas` | `#F5F7FB` | `#08111F` |
| Surface | `bg-surface` | `#FFFFFF` | `#0D1C37` |
| Surface muted | `bg-surface-muted` | `#EEF3FA` | `#13223A` |
| Surface sunken | `bg-surface-sunken` | `#E7EDF6` | `#0B1526` |
| Surface hover | `bg-surface-hover` | `#F3F6FB` | `#172841` |
| Ink strong | `text-ink-strong` | `#0F2345` | `#F2F5FB` |
| Ink | `text-ink` | `#23324D` | `#D3DCEC` |
| Ink muted | `text-ink-muted` | `#56657F` | `#9AA9C3` |
| Ink subtle | `text-ink-subtle` | `#8290A8` | `#6F82A3` |
| Line | `border-line` | `#D9E2EF` | `#1F3050` |
| Line soft / strong | `border-line-soft` / `border-line-strong` | `#E6ECF5` / `#C2CEDF` | `#182743` / `#2B4066` |
| Primary | `bg-primary`, `text-primary` | `#2F6BFF` | `#5687FF` |
| Primary soft / ink | `bg-primary-soft`, `text-primary-ink` | `#E9F0FF` / `#1D4ED8` | 16% tint / `#A9C2FF` |
| Focus ring | `--focus-ring` | blue 45% | light blue 55% |

Feedback roles each have a solid, a `-soft` background and an `-ink` text colour: `success` (emerald), `warning` (amber), `danger` (rose), `info` (cyan), plus `neutral-soft` / `neutral-ink`.

### 2.3 Module accents

| Module | Accent | Utility family |
|---|---|---|
| Core HR | Indigo / blue | `mod-hr` |
| Recruitment | Violet | `mod-recruitment` |
| Leave | Teal | `mod-leave` |
| Attendance | Cyan / sky | `mod-attendance` |
| Payroll | Amber / gold | `mod-payroll` |
| Accounting | Emerald | `mod-accounting` |
| Reports & Analytics | Blue-violet | `mod-reports` |
| Audit | Restrained rose | `mod-audit` |
| Settings | Navy / slate | `mod-settings` |

Each has a solid (`text-mod-x`, `bg-mod-x`) and a soft tint (`bg-mod-x-soft`). Use them through `moduleAccents[accent]` (`tile`, `soft`, `solid`, `text`, `border`, `cssVar`). Module colour appears in icon tiles, accent lines, chart series, active nav dots, selected states and badges. **Never paint a whole page in a module colour.**

`accentForPath(pathname)` resolves a route's module; `PageHeader` uses it automatically when a page does not pass `accent`, so every page shows its module eyebrow.

### 2.4 Typography

Font: **Plus Jakarta Sans** via `next/font/google` (self-hosted at build time) exposed as `--font-brand`, with a system fallback stack.

| Utility | Size / line | Use |
|---|---|---|
| `text-display` | 32 / 40 | Hero titles (desktop) |
| `text-title` | 28 / 36 | Page titles (`PageHeader`, semibold) |
| `text-heading` | 19 / 26 | Section headings, dialog titles |
| `text-card-title` | 15 / 22 | Card and table titles |
| `text-body` | 14 / 22 | Descriptions, long copy (also the body default) |
| `text-sm` | 14 / 20 | Default UI text, tables |
| `text-support` | 13 / 20 | Secondary copy, labels |
| `text-caption` | 12 / 16 | Metadata, table headers, legends |
| `text-kpi` | 30 / 36 | Primary KPI values |
| `text-kpi-sm` | 22 / 28 | Secondary KPI values |

Rules: use weight and spacing for hierarchy rather than borders; avoid all-caps micro-labels (the bridge de-capitalises legacy `text-xs uppercase` inside `main`); numbers use `tabular-nums`.

### 2.5 Spacing grammar

Scale: 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 px.

| Context | Convention |
|---|---|
| Page padding | 16 (mobile) · 24 (sm) · 40 (xl) horizontal; 24–32 top |
| Section spacing | `space-y-6` (24) between page sections, `space-y-8` on Home |
| Card padding | 20 (`p-5`) default, 24–28 for hero/feature cards |
| Dashboard gaps | `gap-4` (KPI rows), `gap-5` (chart grids) |
| Field spacing | `gap-4` in grids, `space-y-4` stacked, 6 px label→control |
| Toolbar spacing | `gap-3` between controls, `p-4` toolbar padding |
| Table density | comfortable: 20×14 px cells (default, per the spec's "more row height"); compact: 16×10 px |

### 2.6 Radius & elevation

| Name | Value | Utility |
|---|---|---|
| Small | 10 px | `rounded-lg` (controls, buttons) |
| Medium | 14 px | `rounded-xl` (tiles, panels) |
| Large | 18 px | `rounded-2xl` (cards, tables) |
| Hero | 22 px | `rounded-3xl` (heroes, dialogs) |
| Pill | full | `rounded-full` |

Elevation (navy-tinted, never pure black): `shadow-elevation-1` (resting cards), `shadow-elevation-2` (hover, raised), `shadow-elevation-3` (heroes, splash), `shadow-overlay` (menus, dialogs, toasts). Legacy `shadow-sm/md/lg/xl` are re-tuned onto the same curve.

### 2.7 Motion

| Token | Value | Use |
|---|---|---|
| `--duration-quick` | 140 ms | Hover, press, colour |
| `--duration-standard` | 200 ms | Popovers, tabs, sidebar collapse (220 ms) |
| `--duration-emphasis` | 300 ms | Drawers, dialogs, chart entrance |
| `ease-standard` | `cubic-bezier(.2,0,0,1)` | Default |
| `ease-emphasis` | `cubic-bezier(.3,0,0,1.15)` | Emphasised entrances |

Named animations: `animate-fade-in`, `animate-pop-in`, `animate-slide-up`, `animate-shimmer` (skeletons and splash only), `animate-splash-pulse`. No perpetual decorative animation. `prefers-reduced-motion` collapses all transitions/animations globally and disables chart entrance (`useChartAnimation`).

---

## 3. Surfaces & cards

- **Surface** — base container (`tone`, `elevation`, `padding`, `radius`).
- **Card** — Surface + header (`title`, `description`, `icon`, `accent`, `actions`) and optional 3 px module `accentLine`.
- **MetricCard** — KPI: label, `text-kpi` value, description, icon tile, soft accent glow, optional `chart` slot (e.g. a `Sparkline` of the recent trend), optional trend chip (direction + whether up is good), skeleton while loading, optional link.
- **InsightCard** — module-tinted interpretation of data ("Offer rate …").
- **ActionCard** — navigation card with icon tile, animated accent line and CTA.
- **AttentionItem** — severity bar + chip (label, not colour alone) + description + link.
- **SummaryCard / SummaryList** — label/value lists with tabular numerals.
- **ProfileCard / Avatar** — deterministic, name-derived avatar tints.
- **HomeHero** (`components/home`) — expressive navy greeting surface with the abstract X art; one per page.

Avoid the "white rectangle + grey border" monotony: vary with accent lines, soft tints, icon tiles and hierarchy — not with extra borders.

## 4. Buttons

`Button` variants: `primary`, `secondary`, `ghost`, `danger`, `link`, `inverse` (on navy). Sizes `sm` (32), `md` (36), `lg` (44). States: hover, active (1 px press), focus-visible ring, disabled (50% + no pointer events), `loading` (spinner, optional `loadingLabel`, `aria-busy`). `ButtonLink` renders a Next `Link` with button styling. `IconButton` requires `label` (accessible name + tooltip). Hand-styled page buttons use `buttonClasses({ variant, size, className })` so they share the primitive recipe exactly.

## 5. Forms

`Field` wires label, required marker, optional marker, helper text and error message (`role="alert"`, `aria-invalid`, `aria-describedby`) around any control. Controls: `Input` (sizes, leading icon, trailing slot), `Select` (native, custom chevron), `Textarea`, `Checkbox`, `Radio`, `Switch` (`role="switch"`), `FileInput` (accessible drop-zone over a native input), `FormSection` (labelled group with side heading). Heights: 32/40/48. Focus: primary border + 4 px 15% ring. Disabled/read-only use `surface-muted`. `ActionBar` holds form actions (optionally sticky).

## 6. Tables

`DataTable<Row>`: column model (`header`, `cell`, `numeric`, `sortValue`, `hideBelow`, `width`), caption (screen-reader), toolbar slot, sticky header, calm row hover, right-aligned tabular numerals, client-side sort on the current page, built-in skeleton / empty / error states, footer slot (`Pagination`). Horizontal overflow is contained inside the card (`minWidth`), never the page. `DataToolbar` provides search (with clear), filters and actions. Long values truncate with a native tooltip (`title`) or wrap. Status uses `StatusBadge`.

## 7. Navigation & shell

- **Sidebar** (desktop): navy structural anchor with a static signature glow, expanded 272 px / collapsed 80 px (persisted per browser), logo transition (see branding.md), groups with animated disclosure, only the most specific destination active, signature-gradient active bar, module-coloured active icon tile, tooltips when collapsed, institution monogram footer with subtle "on ErgonX" attribution. **Mobile**: the same panel as a modal drawer (Escape, scrim, scroll lock).
- **Visibility** is computed exclusively from `navigation.ts` + enabled modules + effective permissions + self-service eligibility. Visibility is never authorization.
- **TopBar**: light translucent surface; route context (`Section / Page`) with module dot and institution name; search trigger (`Ctrl/Cmd+K`) opening a command-palette dialog; help; theme toggle; notifications popover with unread count; profile menu (profile, preferences, security, appearance: light/dark/system, institution switching, sign out).
- **Skip link** to `#main-content`; single `<main>` landmark per page.

## 8. States

- **Empty**: icon tile, title, explanation, optional action (`EmptyState`, `size="compact"` inside cards/tables).
- **Loading**: skeletons shaped like the content — `LoadingState variant` = `page | dashboard | table | detail | form | inline | splash`. Splash is only for session start.
- **Error**: `ErrorState` block or `variant="inline"` banner, always with retry when possible. Error must never be presented as "empty".
- **Access**: `AccessDenied`, `ModuleDisabled`, `ConfigurationIncomplete`.
- **Status**: `StatusBadge` — tone + icon + label (ACTIVE, PENDING, DRAFT, APPROVED, REJECTED, FINALIZED, PAID, OVERDUE, SCHEDULED, …); meaning never relies on colour alone.
- **Toasts**: token-styled, severity bar + icon, `role="alert"` for errors.

## 9. Dark mode

One theme architecture: `ThemeProvider` stores `ergonx-theme` (`light | dark | system`), toggles `.dark` on `<html>`, and an inline `THEME_INIT_SCRIPT` applies it before first paint. The former Platform-only colour mode (`ergonx-platform-color-mode`) is adopted once and removed.

Dark uses a deep-navy canvas, elevated navy surfaces, readable neutral ink, subtle borders and preserved (lightened) module accents. It is not an inversion. Because every route uses semantic roles, dark mode needs no per-utility patching. Printing always uses light tokens.

## 10. Accessibility

- Visible focus ring on every interactive element; skip link; one `main` landmark.
- Dialog/Drawer: `role="dialog"`, `aria-modal`, labelled, focus trap, Escape, focus restore, body scroll lock.
- Menus: `role="menu"`, arrow-key/Home/End navigation, Escape returns focus to trigger.
- Tabs: roving `tabIndex`, arrow keys.
- Charts: `figure` + caption, plain-language `summary`, and a visually hidden data table (`ChartCard data`).
- Status, severity and calendar cells carry text/icons, not just colour.
- Controls ≥ 32 px (36 px default with a mouse). On touch devices (`pointer: coarse`) buttons, icon buttons, inputs and selects grow to at least 40 px.
- `prefers-reduced-motion` respected globally.

## 11. Migration status and legacy bridge

Fully migrated to primitives: shell, Home, Employee Home, Executive and all module dashboards, Reports, auth/public pages, onboarding hub, Platform, HR org resources, Employees list, Recruitment lists, Payroll lists (runs, periods, payslips, components, structures, adjustments), payslip document, Financial Reports, Audit, Approvals, Notifications, self-service profile/leave/payslips/documents/contacts, Settings landing/modules.

All routes now use semantic colour roles. The 2026-09-25 pass mapped every raw palette utility (about 2,600 occurrences across 65 files) onto roles, snapped about 140 hand-styled buttons onto `buttonClasses()` and about 140 native inputs/selects onto the 36 px control height, and moved the remaining hand-rolled headers (Flexible Work, My Attendance, Add Employee, employee profile) onto `PageHeader`/`Avatar`/`Button`. Large operational pages (attendance, leave management, accounting operations, employee detail) still compose native `<input>`/`<table>` markup rather than `<Field>`/`<DataTable>`; convert them opportunistically when those pages next change.

## 12. 2026-09-25 refinement (Linear/Stripe direction)

- Dark mode deepened. (Light canvas and line values briefly moved to neutral and were restored to the locked brand palette the same day; see below.)
- Radii were briefly tightened to 8/12/16 px, then restored to the implementation prompt's 10/14/18/22 px scale (see reconciliation below).
- Elevation flattened: borders carry structure; `elevation-1` is a 1 px hint.
- Controls and buttons 36 px by default; primary/danger buttons carry an inset top highlight; primary CTAs also carry the soft brand glow (`--glow-primary`).
- Type was briefly tightened (24 px titles), then restored to the prompt's targets: 28 px titles, 19 px section headings, 14 px body, 30/22 px KPIs.
- Shell: 56 px top bar, 16 rem sidebar with 36 px nav rows and no decorative glow; content max width 1360 px.
- MetricCard keeps its soft module-accent glow; MetricCard and ActionCard no longer lift on hover.

**Brand-spec reconciliation (same day):** the locked brand foundation wins on colour (canvas `#F5F7FB`, muted surface `#EEF3FA`, soft border `#D9E2EF`), and important CTAs and KPI cards keep a soft glow. The prompt's type targets (28–32 px titles) and radius scale (10/14/18/22 px) also win; the 36 px control density from the refinement remains. The sidebar keeps the formal wordmark ↔ X transition (branding.md), with tenant context in the footer panel.

**New in this pass:** `SegmentedControl` (filters with five or fewer options, radio-group semantics; used for attendance status filters), the `MetricCard` `chart` slot with sparklines on Payroll, Attendance and Accounting KPIs, row action menus (`Menu` + `IconButton`) on Employees and Schedules, charts on the Recruitment dashboard (intake trend, status donut, most active openings) and an at-a-glance chart on Reports & Analytics. Later the same day: the splash wordmark reveal and printable formal records (`PrintMasthead`, `PrintFooter`, `PrintButton` in `src/components/brand/PrintDocument.tsx`).
