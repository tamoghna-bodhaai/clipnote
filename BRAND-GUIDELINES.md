# ClipNote brand guidelines

## Brand idea

ClipNote makes dense video feel navigable. The product should feel calm, precise, and quietly capable: a focused study desk, not a noisy AI playground.

## Design principles

1. **Ink first.** Let useful content lead. Use near-black for headlines, primary actions, and the active state.
2. **One clear signal.** Blue marks moments of action, progress, or selection; it is not decoration.
3. **Quiet surfaces.** Use warm near-white backgrounds, white cards, fine cool-gray dividers, and generous breathing room.
4. **Structured softness.** Corners are rounded but not playful. Interfaces should feel tactile and organized.
5. **Learn by scanning.** Group dense information with hierarchy, alignment, and short labels before reaching for color.

## Tokens

| Role | Token | Value | Use |
| --- | --- | --- | --- |
| Canvas | `--canvas` | `#F7F7F6` | Main page background |
| Surface | `--surface` | `#FFFFFF` | Cards, fields, raised content |
| Ink | `--ink` | `#171A22` | Headlines and primary content |
| Subtle ink | `--ink-muted` | `#676D78` | Descriptions and supporting text |
| Quiet text | `--ink-faint` | `#8B919D` | Metadata and helper copy |
| Divider | `--line` | `#E1E3E7` | Borders and separators |
| Action blue | `--blue` | `#2367EB` | Links, selected moments, focus |
| Blue wash | `--blue-soft` | `#EEF4FF` | Quiet selected/assistive surfaces |
| Action black | `--action` | `#10131C` | Primary buttons and active tabs |
| Error | `--danger` | `#E45454` | Validation and destructive actions |

## Typography

- Use **Manrope** for headings and product names. Keep headlines semibold/bold with tight tracking.
- Use **DM Sans** for body, labels, controls, and metadata.
- Headings should be short, sentence case, and direct. Body copy is warm, specific, and plain spoken.
- Do not use all caps except compact eyebrow labels. When used, add generous letter spacing.

## Layout and surfaces

- Page canvas: warm near-white (`--canvas`).
- Cards: white, `22px` radius, `1px` `--line` border, with only a very subtle shadow when raised.
- Inputs and compact controls: `12px` radius; cards may use `16–22px` depending on scale.
- Use a 4px spacing rhythm. Default page gutters: 20px mobile, 6–8% desktop.
- Prefer clear horizontal dividers over heavy boxed-in sections.

## Components and state

- **Primary button:** `--action` fill with white text. Use one dominant primary action per area.
- **Secondary button:** white fill, `--line` border, ink text.
- **Active tab/filter:** `--action` fill; inactive options sit on a light neutral tray.
- **Selected learning moment:** blue text or blue edge/outline; supporting context can use `--blue-soft`.
- **Focus:** a blue ring with enough offset to remain visible on white surfaces.
- Avoid gradients, glowing shadows, rainbow accents, and oversized illustration-like icons.

## Data and study content

- Timestamps, links, and jump-to-moment controls use `--blue` consistently.
- Keep transcript rows unadorned; separate them with hairline dividers.
- Use color to signal meaning, then pair it with a label, icon, or placement so no state relies on color alone.
- Favor short summaries, scannable labels, and whitespace over extra panels.

## Do / don’t

**Do:** use crisp black active states, restrained blue highlights, soft neutral trays, and generous white space.

**Don’t:** return to violet-led gradients, mix multiple saturated accents in one screen, use emoji as UI icons, or add shadows/borders simply to decorate.

## Implementation check before shipping

- Is the main action unmistakable without overusing blue?
- Does every card have a clear purpose?
- Are text and focus states readable on their actual surface?
- Are all new components using the tokens above rather than one-off hex values?
- Does the screen still feel calm when transcript or chat content becomes dense?
