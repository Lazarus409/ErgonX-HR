# ErgonX Frontend — Current Visual / Design-System Audit

**Audit basis:** current working tree, source inspection only, 24 September 2026. No source UI was changed for this audit.

## Reconciliation with the previous audit

The current implementation remains a Tailwind CSS v4, utility-first application with a limited shared UI layer. The prior architectural findings still apply: there is no Tailwind configuration file, no semantic token system beyond a few global CSS variables, no shared Button/Input/Card/Table primitive family, and charts remain bespoke rather than library-driven.

Changes confirmed since the previous audit:

- `globals.css` now adds theme-sensitive scrollbar variables (`--scrollbar-thumb` and `--scrollbar-thumb-hover`) and a thumb-hover treatment.
- The top bar has gained a richer profile menu: profile, preferences, security, institution switching, and a guarded sign-out state. Search triggering was also hardened so the document click handler does not immediately dismiss it.
- The current tree contains substantially expanded product functionality and many modified/new route files, but the core visual language and centralization level are fundamentally unchanged.

The observations below supersede the prior report.

## Evidence base

- Global CSS/theme: `src/app/globals.css`, `src/app/layout.tsx`, `src/components/context/ThemeProvider.tsx`
- Application chrome: `src/components/layout/AppShell.tsx`, `TopBar.tsx`, `Sidebar.tsx`, `src/components/navigation/navigation.ts`
- Shared UI: `src/components/ui/*`
- Representative pages: `src/app/dashboard/page.tsx`, `src/app/accounting/dashboard/page.tsx`, `src/app/reports/dashboard/page.tsx`, `src/app/login/page.tsx`, `src/app/onboarding/page.tsx`, `src/app/platform/page.tsx`
- Package configuration: `package.json`

## 1. Current color palette

**Current implementation.** Slate is the dominant neutral palette: `slate-50` canvas, white surfaces, `slate-200/300` borders, `slate-500/700/900/950` text and primary dark surfaces. Semantic colors include emerald, red/rose, amber, sky, indigo, blue, cyan, and violet.

**Relevant files.** `src/app/globals.css`; all route and component class strings.

**Strengths.** Restrained, readable enterprise-neutral base; semantic feedback colors are recognizable.

**Weaknesses.** Colors are direct Tailwind utilities rather than semantic roles. The current source contains roughly 690 `text-slate-500`, 523 `border-slate-200`, 248 `bg-slate-50`, and 69 `bg-slate-950` usages. A brand or theme change therefore requires broad migration.

**Constraints / reusability.** Tailwind v4 can support a semantic token migration, but the current palette is not centrally swappable.

## 2. Brand colors and where they are used

**Current implementation.** The effective product brand is `slate-950` with sky accents; the logo is `public/ergonx-logo.png`. Dark hero panels, the top bar, and primary buttons use slate. Sky is used in focus rings, links, active/attention accents, and onboarding/platform decorative treatment.

**Relevant files.** `globals.css`, `TopBar.tsx`, `Sidebar.tsx`, login/onboarding/platform pages.

**Strengths.** A dark neutral + sky accent is consistent enough to read as a product family.

**Weaknesses.** No documented brand palette, semantic naming, contrast rules, or logo usage component.

**Constraints / reusability.** Brand identity is spread across utilities and should be captured as token roles before visual rebrand work.

## 3. Background/surface system

**Current implementation.** The shell is `slate-50`; default content is white, bordered, and often lightly shadowed. Hero panels are `slate-950`. Small insets commonly use `slate-50/100`.

**Relevant files.** `AppShell.tsx`, `KPIStatCard.tsx`, dashboards, forms, tables.

**Strengths.** Familiar surface hierarchy; adequate visual separation in light mode.

**Weaknesses.** Surface names do not exist; cards, panels, filter bars, tables, and dialogs recreate the same recipes with small differences.

**Constraints / reusability.** A shared `Surface/Card` primitive can capture most of this without data or routing changes.

## 4. Typography system

**Current implementation.** Tailwind's default sans/system typography is used. Common hierarchy: `text-xs`, `text-sm`, `text-2xl`, `text-3xl`; headings use semibold/bold and `tracking-tight`; labels sometimes use uppercase tracking.

**Relevant files.** `PageHeader.tsx`, dashboards, login, onboarding, platform.

**Strengths.** Readable baseline and recognizable heading hierarchy.

**Weaknesses.** No explicit font family, type ramp, role-based text components, line-height standard, or documentation. Typography differs between standard operational pages and more polished auth/onboarding/platform screens.

**Constraints / reusability.** A small typography token/rule set would migrate easily through shared page header, field label, table header, and card title components.

## 5. Current spacing system

**Current implementation.** Tailwind's 4px scale is dominant. Shell padding is `p-4 sm:p-6 xl:p-8`; cards commonly use `p-5` or `p-6`; sections commonly use gaps of 4–6.

**Relevant files.** `AppShell.tsx`, dashboard pages, shared UI.

**Strengths.** Baseline rhythm is generally consistent.

**Weaknesses.** Page-local exceptions and arbitrary dimensions are common, especially for table widths, charts, popovers, and premium pages.

**Constraints / reusability.** The spacing scale itself is usable; rules for page, section, card, and control density are missing.

## 6. Border radius system

**Current implementation.** Operational UI uses `rounded-lg`, `rounded-xl`, and `rounded-2xl`; login/onboarding/platform often use `rounded-3xl`; badges use `rounded-full`.

**Relevant files.** Shared UI, login, onboarding, platform, dashboards.

**Strengths.** Rounded treatment is coherent within individual areas.

**Weaknesses.** Three levels of visual personality coexist: compact operational UI, softer dashboards, and oversized premium auth/onboarding/platform UI.

**Constraints / reusability.** Normalize to a small radius scale through primitives; do not retain page-specific radius as a default.

## 7. Shadows/elevation

**Current implementation.** `shadow-sm` is common for cards; `shadow-md` appears on hover; dialogs/toasts use `shadow-xl`; premium pages use custom `rgba(15,23,42,…)` shadows.

**Relevant files.** `KPIStatCard.tsx`, `ConfirmDialog.tsx`, `ToastProvider.tsx`, login/onboarding/platform pages.

**Strengths.** Default operational elevation is conservative.

**Weaknesses.** No named elevation scale; bespoke shadows create visual divergence.

**Constraints / reusability.** Define elevation tokens and apply them through shared surfaces, overlays, and menus.

## 8. Buttons

**Current implementation.** Buttons are inline class strings. Primary uses dark slate with white text; secondary is generally bordered slate; destructive is red; icon buttons are rounded and padded.

**Relevant files.** All route files; `ConfirmDialog.tsx`, `ErrorState.tsx`, `TopBar.tsx`.

**Strengths.** Intent is usually legible, with common disabled opacity and hover states.

**Weaknesses.** No Button component, variant API, size scale, shared loading state, or consistent focus/active behavior. Button height ranges from compact table actions to `h-14` auth controls.

**Constraints / reusability.** High-leverage replacement candidate. Existing semantics and handlers can be retained while visual classes migrate.

## 9. Cards

**Current implementation.** `KPIStatCard` is reusable. Most other cards are inline sections/articles combining border, background, radius, padding, and shadow utilities.

**Relevant files.** `KPIStatCard.tsx`, dashboards, `WorkspaceHome.tsx`, module pages.

**Strengths.** Card-based composition is widely established.

**Weaknesses.** No shared base card, interactive card, statistic card, or inset panel variants.

**Constraints / reusability.** Reuse KPI card behavior; introduce a base surface component and migrate page-level styling incrementally.

## 10. Forms and inputs

**Current implementation.** Native inputs/selects/textareas are styled per page. Typical controls use `rounded-lg/xl`, slate borders, white/slate-50 background, 40–56px heights, and page-local label/error helpers. The login screen has the most developed focus styling.

**Relevant files.** Login, onboarding, settings, HR, accounting, attendance, payroll and recruitment routes.

**Strengths.** Native semantics and labels are frequently present; global `focus-visible` provides a baseline.

**Weaknesses.** No field primitive; labels, help text, errors, required markers, input sizes, and dark mode vary. Some `outline-none` controls rely only on weak border changes.

**Constraints / reusability.** The largest migration surface after tables. Build Field/Input/Select/Textarea first, then migrate forms by module.

## 11. Tables

**Current implementation.** Native HTML tables are used in 44 TSX files. Common approach: outer white bordered overflow container, `min-w-*` table, `slate-50` header, `divide-y`, hover rows, and page-local filters/actions.

**Relevant files.** Reports, HR, accounting, attendance, payroll, recruitment, settings and audit routes.

**Strengths.** Semantic data tables, desktop-friendly density, and horizontal overflow prevent clipping.

**Weaknesses.** No shared table primitive or toolbar/pagination/action-menu pattern. Header weight, padding, row density, empty states, and mobile fallback vary. Horizontal scrolling is often the only mobile adaptation.

**Constraints / reusability.** Very high-leverage redesign target; visual-only standardization can preserve existing API/data logic.

## 12. Navigation

**Current implementation.** `navigation.ts` is the central access-aware navigation registry. Visibility is filtered by permissions, enabled modules, and self-service eligibility.

**Relevant files.** `src/components/navigation/navigation.ts`, `Sidebar.tsx`.

**Strengths.** Strong functional centralization; one source of truth for primary routes and permissions.

**Weaknesses.** Only information architecture is centralized; navigation visual variants, subitem treatment, and states live in Sidebar markup.

**Constraints / reusability.** Preserve the data model and replace rendering primitives.

## 13. Top bar

**Current implementation.** Sticky 64px `slate-950/95` bar with institution context, keyboard-search (`Ctrl/Cmd+K`), help placeholder, notifications, profile menu, institution switching, theme toggle, and mobile-menu trigger.

**Relevant files.** `TopBar.tsx`.

**Strengths.** Current update significantly improves account/profile utility and interaction completeness. Popover visual treatment is consistent internally.

**Weaknesses.** Some top-bar icon states use light-surface hover colors despite a dark background. The bar is feature-dense and can crowd narrower desktop widths.

**Constraints / reusability.** Retain behavior; split into reusable icon-button and menu/popover primitives during redesign.

## 14. Sidebar/dock

**Current implementation.** Fixed white sidebar: 256px expanded, 80px collapsed at `lg`, mobile slide-over with scrim, grouped primary/self-service navigation, and institution card. The former `DesktopDock` has been removed.

**Relevant files.** `Sidebar.tsx`, `AppShell.tsx`.

**Strengths.** Responsive behavior and role-aware filtering are in place.

**Weaknesses.** Sidebar is visually flatter and lighter than the top bar; collapsed state is not persisted; dark theme is not explicitly designed for it.

**Constraints / reusability.** Strong behavioral base. Redesign should be localized to shell/navigation components.

## 15. Status badges

**Current implementation.** Shared `StatusBadge` maps domain statuses to semantic pastel background/text/ring variants with a dot indicator.

**Relevant files.** `src/components/ui/StatusBadge.tsx`.

**Strengths.** The most complete visual primitive in the current system; status map is centralized.

**Weaknesses.** No density/size variants or dark-theme variants; status vocabulary is hardcoded in a component.

**Constraints / reusability.** Reuse and evolve, rather than replace.

## 16. Charts and chart library

**Current implementation.** No chart library is installed. Charts are bespoke SVG line paths, CSS/DOM bar charts, gradients, and simple legends.

**Relevant files.** `src/app/dashboard/page.tsx`, `src/app/accounting/dashboard/page.tsx`, module dashboards.

**Strengths.** No extra dependency; live data and empty states are handled.

**Weaknesses.** No reusable visualization grammar, axes, data labels, tooltips, chart controls, accessible data-table fallback, or consistent scales. Chart hex strokes bypass theme utility conventions.

**Constraints / reusability.** Replace chart implementation behind existing data contracts; chart data/API logic can stay.

## 17. Dashboard composition

**Current implementation.** Executive/accounting/module dashboards use hero panels, KPI grids, information cards, and bespoke charts. `KPIStatCard` is shared but most compositions are local.

**Relevant files.** Executive, HR, attendance, leave, payroll, accounting, recruitment, and reports dashboard routes.

**Strengths.** A clear summary-first composition exists and modules have recognizable dashboard anatomy.

**Weaknesses.** Card anatomy, chart design, hierarchy, and colored accents differ by module.

**Constraints / reusability.** Introduce dashboard-grid, metric-card, chart-card, and insight-list primitives to preserve modules while harmonizing layout.

## 18. Light theme

**Current implementation.** Default light mode uses `#f8fafc` body background, white surfaces, slate copy, and pastel semantic states.

**Relevant files.** `globals.css`, all components/routes.

**Strengths.** Broadly consistent and readable.

**Weaknesses.** One-off hex canvas colors such as `#f5f7fa` and `#f4f7fb` remain in auth/platform pages; the light surface system is not semantic.

**Constraints / reusability.** Best-supported current theme; should become the initial token reference.

## 19. Dark theme

**Current implementation.** `ThemeProvider` persists `ergonx-theme`, follows OS preference initially, and toggles the root `.dark` class. `globals.css` remaps selected utility selectors; scrollbar tokens now adapt. Platform also has a separate dark-mode key and mechanism.

**Relevant files.** `ThemeProvider.tsx`, `globals.css`, `TopBar.tsx`, `ToastProvider.tsx`, `platform/page.tsx`.

**Strengths.** User preference persists; current update improves scrollbar cohesion.

**Weaknesses.** Direct `dark:` usage occurs in only three source files. Selector overrides cannot cover all semantic/colored utilities, charts, form controls, sidebar, or page exceptions. Platform uses a separate theme implementation.

**Constraints / reusability.** A full dark mode requires semantic tokens, not additional selector patches.

## 20. Responsive design

**Current implementation.** Tailwind breakpoint utilities are widely used. The shell changes at `lg` (1024px); grids collapse across `sm/md/lg/xl`; tables commonly scroll horizontally.

**Relevant files.** `AppShell.tsx`, `Sidebar.tsx`, all dashboard/list/form routes.

**Strengths.** The app has practical breakpoint coverage and a functional mobile sidebar.

**Weaknesses.** No centralized responsive pattern for tables, filter toolbars, headers, dashboards, or dialogs. Page-specific layouts vary.

**Constraints / reusability.** Preserve the breakpoints while adding standardized responsive component behaviors.

## 21. Loading, empty, and error states

**Current implementation.** Shared `LoadingState`, `EmptyState`, and `ErrorState` exist; pages also use local text placeholders, `animate-pulse` skeletons, and bespoke states. Toasts support success/error/info.

**Relevant files.** `src/components/ui/{LoadingState,EmptyState,ErrorState,ToastProvider}.tsx`; route pages.

**Strengths.** Shared baseline, retry support, and accessible toast live region.

**Weaknesses.** Full-page loading is generic; page-level loading density and empty-state presentation are inconsistent; no standardized inline/section/table states.

**Constraints / reusability.** Keep current APIs and add variants for page, section, table, and action feedback.

## 22. Hover, focus, and active states

**Current implementation.** Global `:focus-visible` uses a 3px semi-transparent sky outline. Most controls have hover background/color changes; selected sidebar/report states use pale fills/rings.

**Relevant files.** `globals.css`, TopBar, Sidebar, UI components, route-local controls.

**Strengths.** A global keyboard focus baseline exists; common interactive controls advertise pointer/disabled state.

**Weaknesses.** Hover/active/focus styles are duplicated and sometimes incomplete. There is no common pressed state or focus-ring token.

**Constraints / reusability.** Centralize through control primitives and semantic focus variables.

## 23. Animation/transitions

**Current implementation.** Transitions are small and local: color/shadow changes, 200ms sidebar/layout transition, `animate-spin`, `animate-pulse`, and onboarding progress transition.

**Relevant files.** App shell, sidebar, cards, loading state, onboarding.

**Strengths.** Motion is appropriately restrained for operational software.

**Weaknesses.** No motion duration/easing tokens, enter/exit behavior, or explicit reduced-motion strategy.

**Constraints / reusability.** Introduce tokenized motion only where feedback/navigation needs it; do not add decorative motion indiscriminately.

## 24. Reusable design tokens

**Current implementation.** `globals.css` exposes `--background`, `--foreground`, and scrollbar variables. Tailwind defaults provide the rest. There is no `tailwind.config.*` file and no semantic CSS token architecture.

**Relevant files.** `globals.css`, `package.json`.

**Strengths.** Tailwind v4 makes token introduction feasible without a legacy config migration.

**Weaknesses.** Current variables do not drive component styles; token coverage is insufficient for surface, text, border, accent, semantic, radius, shadow, typography, spacing, or motion.

**Constraints / reusability.** This is the first redesign foundation to implement.

## 25. Hardcoded styling inconsistencies

**Current implementation.** Classes are predominantly inline; arbitrary dimensions and hand-coded shadows appear across pages. Accounting charts contain raw SVG hex colors.

**Relevant files.** All routes, especially dashboards, auth, onboarding, platform, and wide data tables.

**Strengths.** Styling is visible and easy to inspect locally.

**Weaknesses.** Small differences accumulate: rounded corners, input heights, panel padding, borders, shadows, table widths, semantic shades, and page backgrounds.

**Constraints / reusability.** Token/primitives migration must tolerate existing utility classes until each page is converted.

## 26. Pages/components that visually diverge from the main system

**Current implementation.** Platform admin, onboarding, login/get-started/reset flows use 3xl corners, custom shadows, glow/blur decoration, stronger sky accenting, and more editorial typography. Operational modules are flatter and denser.

**Relevant files.** `src/app/platform/*`, `src/app/onboarding/*`, `src/app/login/*`, `src/app/get-started/*`, operational module routes.

**Strengths.** Setup/auth experiences feel more deliberate.

**Weaknesses.** The application presents at least two visual systems to users.

**Constraints / reusability.** Retain information hierarchy, but restyle these through the same future tokens/components.

## 27. Most visually dated components

**Current implementation.** Dense CRUD tables, inline filter rows, repeated bordered form panels, generic empty/error blocks, and the monochrome operational sidebar are the weakest visual areas.

**Relevant files.** List/detail pages across HR, accounting, attendance, payroll, recruitment and settings; `Sidebar.tsx`; `EmptyState.tsx`; `ErrorState.tsx`.

**Strengths.** Functional, predictable, and familiar to ERP users.

**Weaknesses.** They read as utility-admin styling rather than a bespoke product system.

**Constraints / reusability.** Improve through primitives rather than page-by-page aesthetic exceptions.

## 28. Components that can be reused in a redesign

**Current implementation.** Preserve functional contracts for AppShell, navigation data, Sidebar access filtering, TopBar search/notifications/profile behavior, ThemeProvider, PageHeader, StatusBadge, KPIStatCard, ConfirmDialog, ToastProvider, and loading/error/empty APIs.

**Relevant files.** `src/components/layout/*`, `src/components/navigation/navigation.ts`, `src/components/context/ThemeProvider.tsx`, `src/components/ui/*`.

**Strengths.** These are established behavior boundaries.

**Weaknesses.** Most require new visual APIs or variants.

**Constraints / reusability.** Reuse behavior and data contracts; replace presentational class recipes.

## 29. Components that should be replaced

**Current implementation.** There is no shared component to retain for Button, IconButton, Field, Input, Select, Textarea, Card/Surface, Table, DataToolbar, Pagination, Chart, Alert, Drawer, or Menu.

**Relevant files.** These patterns are scattered across routes.

**Strengths.** None as centralized design-system assets.

**Weaknesses.** Repeated implementation creates visual and accessibility drift.

**Constraints / reusability.** Introduce replacement primitives with compatible `className` escape hatches, then migrate high-traffic routes first.

## 30. Screenshot inventory

**Current implementation.** Source inspection covered login, executive dashboard, accounting dashboard, reports, onboarding, platform, shell/navigation, shared states, and representative form/table pages.

**Relevant files.** See evidence base.

**Strengths.** The local route source is sufficient to document component composition.

**Weaknesses.** No screenshots were captured for this report. The browser execution environment cannot access the host-local development server, and authenticated pages require a suitable test session/data set.

**Constraints / reusability.** Capture a follow-up inventory from a browser that can reach the frontend and use a non-production demo account; include desktop, tablet, mobile, dark, empty, loading, error, and populated-data states.

## Is styling centralized enough for a full overhaul?

**Partly.** Shell behavior, navigation data, theme persistence, statuses, several feedback states, and KPI cards are centralized enough to overhaul efficiently. Styling across operational routes is not: direct utility strings dominate every form, table, card, action, and chart. A visual overhaul should not start with page rewrites; it should introduce tokens and primitives, then migrate pages in controlled waves.

---

# CURRENT VISUAL IDENTITY SUMMARY

A slate-led enterprise ERP: pale neutral work canvas, white bordered content surfaces, a near-black utility bar and hero panels, sky accenting, Lucide iconography, soft rounded corners, and restrained elevation. Auth/onboarding/platform surfaces are more polished and expressive than the main operational product.

# DESIGN-SYSTEM MATURITY

**Early to intermediate.** The app has useful functional shared components and consistent Tailwind habits, but lacks formal semantic tokens, core control primitives, a table system, a chart system, and complete dark-theme coverage.

# TOP 10 VISUAL PROBLEMS

1. No semantic theme token layer or Tailwind design configuration.
2. No shared Button, Field, Input, Select, Card, or Table primitives.
3. Dark mode is selector-patched and incomplete; platform uses a separate theme mechanism.
4. Direct color utilities are repeated hundreds of times.
5. Operational, auth/onboarding, and platform screens use divergent visual treatments.
6. Tables lack a standard toolbar, density, action, pagination, empty, and mobile pattern.
7. Charts are bespoke and inconsistent, with limited interaction and accessibility.
8. Top bar and sidebar do not form a fully unified shell treatment.
9. Elevation, radius, input height, and page spacing vary by route.
10. Loading, empty, error, hover, focus, and active states lack complete shared variants.

# HIGHEST-LEVERAGE COMPONENTS TO REDESIGN

1. Semantic theme tokens and global CSS baseline.
2. Button and icon-button primitives.
3. Field/Input/Select/Textarea primitives.
4. Surface/Card and section primitives.
5. DataTable, toolbar, pagination, and mobile record-card patterns.
6. App shell: sidebar, top bar, navigation item/submenu, and popover menu.
7. Status, alert, toast, loading, empty, and error primitives.
8. Dashboard metric, chart-card, and visualization primitives.
9. Dialog/drawer/confirmation patterns.
10. Page header and action-bar system.

# ESTIMATED BLAST RADIUS OF A THEME OVERHAUL

**High visual reach; moderate implementation risk if staged.** Shell/theme/global changes affect nearly all authenticated routes. A token-only change will not restyle all pages because many direct utilities and raw SVG colors remain. Creating compatible primitives first, applying them to shell/shared states, then migrating tables/forms/dashboards module by module will avoid data, permission, and route rewrites.
