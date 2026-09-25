# Studio style (1.2.1)

The studio's **layout** follows the reference one to one
([studio-layout.md](studio-layout.md)): which regions exist, where they sit,
what each holds and in what order, their sizes and spacing. Its **look** is
Bitwright's own, as it was in 1.0: the role tokens in `src/styles/tokens.css`
(warm neutrals at hue 85, the yellow accent, the surface ladder), the Inter /
system type stack, the radius and shadow tokens, the window bezel with its
background effect, and the shared components in `components/ui/`. The colour
and shape classes quoted in studio-layout.md describe the reference and are
superseded by this file; the structure and sizes stay.

## Rules

- Colours only through role tokens: `bg-surface-*`, `text-fg-*`,
  `border-line-*`, `bg-accent` / `text-accent-fg` / `hover:bg-accent-hover`,
  `ring-line-focus`, the severity tokens for pass/fail and warnings, `danger`
  for the window's close button. Tailwind's palette (`neutral-*`, `pink-*`,
  `sky-*`, `purple-*`, `red-*`, `amber-*`, `emerald-*`, `white`, `black`) is
  not available, and a test fails on any such class in `src`.
- Shapes through the radius tokens: `rounded-sm` (6px) for small controls and
  swatches, `rounded-md` (10px) for rows, cards and inputs, `rounded-lg`
  (14px) for panels, dialogs and floating toolbars, `rounded-pill` for
  buttons and segmented controls, `rounded-full` for dots and round buttons.
- Elevation through `shadow-sm` / `shadow-md` / `shadow-lg` only, never a
  coloured shadow.
- Controls through `components/ui`: `Button` (primary / secondary / ghost /
  danger), `IconButton`, `SegmentedTabs`, `Select`/`ComboBox`, `Field`,
  `NumberField`, `Dialog`, `Menu`, `Tooltip`, `Pill`, `Card`. A bespoke
  control is fine where the layout needs one (a tool row, a frame card), but
  it takes its colours and shapes from the same tokens.
- Type: `text-sm` body, `text-xs` secondary, `text-[11px]` the smallest (keys,
  badges); nothing under 11px.

## Mapping from the reference's classes

| Reference                                                     | Bitwright                                                                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| window / header / columns / strips `bg-neutral-950`           | `bg-surface-canvas`                                                                              |
| panel heads `bg-neutral-900/40`                               | no fill; a `border-b border-line-subtle`                                                         |
| rows, cards, the name box `bg-neutral-900`                    | `bg-surface-content border border-line-subtle`                                                   |
| hover `bg-neutral-800`, `hover:bg-neutral-900/80`             | `hover:bg-surface-content-alt`                                                                   |
| inputs, selects                                               | `bg-surface-input border border-line-input focus:border-line-focus`                              |
| floating panels, popovers, menus `bg-neutral-950/90 backdrop` | `bg-surface-float border border-line-subtle shadow-md rounded-lg`                                |
| stage `canvas-workspace-bg`                                   | `bg-surface-well` with the checker drawn in `--border-subtle`                                    |
| home background / sidebar / card                              | `bg-surface-canvas` / `bg-surface-canvas` + `border-r` / `bg-surface-content`                    |
| text `neutral-100/200/300`                                    | `text-fg-primary`                                                                                |
| text `neutral-400/500`                                        | `text-fg-secondary`                                                                              |
| text `neutral-600`, disabled                                  | `text-fg-muted` on `bg-surface-disabled` (disabled controls only)                                |
| borders `neutral-800` / `neutral-700`                         | `border-line-subtle` / `border-line`                                                             |
| **pink** active tool, primary action, current frame/step      | `bg-accent text-accent-fg` (hover `bg-accent-hover`), ring `ring-accent`                         |
| **pink** text values (size chip, brush size, frame name)      | `text-fg-primary font-medium`                                                                    |
| **sky** toggles that are on (grid, onion skin, symmetry)      | `bg-surface-content-alt text-fg-primary border-line-strong` (a pressed state, as the old dock's) |
| **sky** export button                                         | `Button variant="primary"`                                                                       |
| **purple** layers accents, current layer                      | current layer `border-accent` + `bg-surface-content-alt`; icons `text-fg-secondary`              |
| gradient pink→purple (agent card, nav, avatar)                | `bg-accent text-accent-fg` (nav current), `bg-surface-content` otherwise                         |
| emerald / red pass-fail                                       | `text-severity-success` / `text-severity-error`                                                  |
| `rounded` (4px)                                               | `rounded-sm` / `rounded-md` per the rule above; buttons `rounded-pill`                           |
| `shadow-md shadow-pink-600/20`                                | `shadow-sm`                                                                                      |
| Manrope, lucide                                               | Inter stack; lucide icons stay, at stroke width 1.75                                             |
