# No native controls

Rule: nothing in `apps/desktop/src` outside `components/ui` renders a native
form control or a native tooltip. Every control is a reusable component in
`components/ui`, themed from role tokens, with an animated state change
(open/close, check, drag, expand). Native text inputs styled with
`INPUT_CONTROL` stay: they are already themed and have no platform chrome.

Banned outside `components/ui`: `<select>`, `<option>`, `<details>`,
`<summary>`, `<progress>`, `<meter>`, `<datalist>`, `<input type=
"checkbox|radio|range|color|number|date|file">`, and a `title` attribute on a
DOM element (use `Tooltip`). A test enforces it (wave 3).

## Wave 1 - components (one file each, parallel)

| Task | Owns | What |
| --- | --- | --- |
| W1-checkbox | `components/ui/Checkbox.tsx`, `Checkbox.test.tsx` | new: animated tick |
| W1-slider | `components/ui/Slider.tsx`, `Slider.test.tsx` | new: replaces `type="range"` |
| W1-color | `components/ui/ColorPicker.tsx`, `ColorPicker.test.tsx`, `styles/tokens.css` | new: SV square + hue strip + hex field in an `Overlay` |
| W1-disclosure | `components/ui/Disclosure.tsx`, `Disclosure.test.tsx` | new: replaces `<details>`, animated height |
| W1-select | `components/ui/Select.tsx`, `Select.test.tsx` | `size`, `variant`, `layout`, `hideLabel`, `align` |
| W1-number | `components/ui/NumberField.tsx`, `NumberField.test.tsx` | `size`, `layout`, `hideLabel` |

## Wave 2 - call sites (one file each, parallel)

HomeScreen, HomeSidebar, NewSpriteDialog, StudioHeader, TilemapEditor,
TimelineStrip, PalettePanel (+ its locale keys), ExportDialog, McpCard,
ReferencePanel, AgentPopover, Field (`StatusDot` title -> `Tooltip`).

## Wave 3 - guard

`src/test/native.test.ts`: parse every `.tsx` outside `components/ui` with the
TypeScript compiler API and fail on any banned element or attribute above.
