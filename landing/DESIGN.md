---
name: Optimización de Seguridad Ultra
description: A CEDIS dock wall read as an argument; painted doors, floor lines and bolted sign plates on concrete.
colors:
  rojo: "#E7342B"
  rojo-osc: "#C3261E"
  rojo-txt: "#A81F18"
  placa: "#1D1D1B"
  placa-txt: "#F3F1EC"
  placa-txt-2: "#B9B4AA"
  suelo: "#DAD8D3"
  suelo-2: "#CECBC4"
  tinta: "#16130F"
  tinta-2: "#48443D"
  linea: "#ADA9A1"
  blanco: "#FFFFFF"
  amarillo: "#F2C230"
typography:
  display:
    fontFamily: "Big Shoulders Display, Arial Narrow, Roboto Condensed, sans-serif"
    fontSize: "clamp(3rem, 7.4vw, 5.9rem)"
    fontWeight: 800
    lineHeight: 0.98
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Big Shoulders Display, Arial Narrow, Roboto Condensed, sans-serif"
    fontSize: "clamp(2.3rem, 5.2vw, 4rem)"
    fontWeight: 800
    lineHeight: 0.98
    letterSpacing: "-0.005em"
  headline-compact:
    fontFamily: "Big Shoulders Display, Arial Narrow, Roboto Condensed, sans-serif"
    fontSize: "clamp(2rem, 4.2vw, 3.2rem)"
    fontWeight: 800
    lineHeight: 0.98
    letterSpacing: "-0.005em"
  title:
    fontFamily: "Big Shoulders Display, Arial Narrow, Roboto Condensed, sans-serif"
    fontSize: "clamp(1.35rem, 2.2vw, 1.7rem)"
    fontWeight: 800
    lineHeight: 0.98
    letterSpacing: "0.01em"
  numeral:
    fontFamily: "Big Shoulders Stencil Display, Big Shoulders Display, Arial Narrow, sans-serif"
    fontSize: "clamp(3.4rem, 7vw, 5.2rem)"
    fontWeight: 900
    lineHeight: 0.85
    letterSpacing: "-0.01em"
  numeral-door:
    fontFamily: "Big Shoulders Stencil Display, Big Shoulders Display, Arial Narrow, sans-serif"
    fontSize: "clamp(9rem, 21vw, 17rem)"
    fontWeight: 900
    lineHeight: 0.8
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Barlow, Helvetica Neue, Arial, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.6
    fontFeature: "tnum"
  lead:
    fontFamily: "Barlow, Helvetica Neue, Arial, sans-serif"
    fontSize: "clamp(1.08rem, 1.6vw, 1.25rem)"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Barlow, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.78rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.08em"
  button:
    fontFamily: "Big Shoulders Display, Arial Narrow, Roboto Condensed, sans-serif"
    fontSize: "1.2rem"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.04em"
rounded:
  plate: "2px"
  door: "3px"
  panel: "4px"
spacing:
  gutter: "clamp(16px, 4vw, 40px)"
  section: "clamp(64px, 9vw, 120px)"
  block: "clamp(40px, 6vw, 64px)"
  column-gap: "clamp(28px, 5vw, 64px)"
  sm: "8px"
  md: "14px"
  lg: "22px"
  container: "1180px"
components:
  button-primary:
    backgroundColor: "{colors.rojo-osc}"
    textColor: "{colors.blanco}"
    typography: "{typography.button}"
    rounded: "{rounded.door}"
    padding: "15px 22px 14px"
  button-primary-hover:
    backgroundColor: "{colors.rojo-txt}"
    textColor: "{colors.blanco}"
  button-small:
    backgroundColor: "{colors.rojo-osc}"
    textColor: "{colors.blanco}"
    rounded: "{rounded.door}"
    padding: "11px 16px 10px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.tinta}"
    rounded: "{rounded.door}"
    padding: "15px 22px 14px"
  button-ghost-hover:
    backgroundColor: "{colors.tinta}"
    textColor: "{colors.suelo}"
  source-plate:
    backgroundColor: "{colors.placa}"
    textColor: "{colors.placa-txt}"
    rounded: "{rounded.plate}"
    padding: "6px 9px 6px 7px"
  illustrative-plate:
    backgroundColor: "{colors.amarillo}"
    textColor: "{colors.tinta}"
    rounded: "{rounded.plate}"
    padding: "6px 9px 6px 7px"
  filter-chip:
    backgroundColor: "transparent"
    textColor: "{colors.tinta}"
    rounded: "{rounded.plate}"
    padding: "10px 12px"
  filter-chip-pressed:
    backgroundColor: "{colors.tinta}"
    textColor: "{colors.suelo}"
  year-door-selected:
    backgroundColor: "{colors.rojo-osc}"
    textColor: "{colors.blanco}"
    rounded: "{rounded.plate}"
    height: "128px"
  sign-plate:
    backgroundColor: "{colors.placa}"
    textColor: "{colors.placa-txt}"
    rounded: "{rounded.door}"
    padding: "22px 26px"
  contact-field:
    backgroundColor: "{colors.rojo-osc}"
    textColor: "{colors.blanco}"
    rounded: "{rounded.panel}"
    padding: "clamp(28px, 5vw, 64px)"
---

# Design System: Optimización de Seguridad Ultra

## Overview

**Creative North Star: "The Dock Wall"**

The page is the loading-dock wall of a CEDIS, read left to right as an argument. Concrete gray is the ground; everything placed on it is something you would find bolted, painted or stenciled on that wall: roll-up doors painted Ultra red with horizontal slats, carbón sign plates with bolts in the corners, stenciled numerals, painted floor lines between bays, and a single yellow-and-black hazard strip under the main door. Nothing glows and nothing floats. Depth comes from paint and mounting, not light.

Density is high but orderly, the way signage is: condensed uppercase display type, tabular numbers everywhere, and every figure paired with a small plate that says where it came from. The system is light-first (concrete by day) with a full dark theme that reads as the same wall at night: ground drops to near-black, plates go darker still, red text brightens.

Confirmed rejections from the direction: the dark control-room hero with a glowing accent, and the stock-photo consulting page. There are no photographs in the system.

**Key Characteristics:**
- Concrete ground, red painted door fields, carbón bolted plates.
- Condensed signage sans for words, stencil for numerals and one-word verdicts, Barlow for reading.
- Square markers, painted dashed floor lines, 2 to 4px corners.
- Every number carries a source plate; illustrative figures carry a yellow triangle plate.
- Motion is mechanical: doors count, bars fill, buttons press. Nothing drifts.

## Colors

A concrete-and-paint palette: two warm grays, one near-black plate, the Ultra red in three strengths, and a safety yellow kept for warnings.

### Primary
- **Ultra Red** (rojo): the brand red from the corporate identity. Used for small painted markers only: square bullets, phase markers on the method rule, the final node of the reform timeline, the "Reforzar" post dots on the CEDIS plan, the slash separators between client names, and the ring around the selected year door. Too light for white body text (4.26:1), so it never carries a text label smaller than the plan's 17px bold post numbers.
- **Door Red** (rojo-osc): the painted-field red. Every large red surface with white text on it uses this value (5.81:1 with white): the primary button, the selected year door, the Mexico bar in the OECD chart, the "alto" layer, the CPP badge, the contact field. The hero door is painted in its own two-stop gradient of the same family (#D42C23 to #BE241C) to read as sheet metal.
- **Signal Red Text** (rojo-txt): red used as ink on concrete. Highlighted words in headlines, stenciled verdicts ("Reforzar", the three "Diseñamos / Operamos / Monitoreamos" words), the "después" figure, cost increases in the shift table. 5.13:1 on concrete, 4.51:1 on the darker concrete. In dark mode it becomes #FF6A5F.

### Tertiary
- **Safety Yellow** (amarillo): warning paint. Illustrative-example plates (with a carbón triangle), the "Complementar" post marker and dock edge lines on the CEDIS plan, the single hazard strip under the hero door, the copy-confirmation notice on the contact plates, and the keyboard focus ring on carbón and red surfaces. Yellow text only ever sits on carbón or red, never on concrete.

### Neutral
- **Concrete** (suelo): the page ground and the face of flat blocks such as method quadrant cells and deliverable tiles.
- **Worn Concrete** (suelo-2): recessed or secondary surfaces: chart wells, bar tracks, the "current scheme" card, the badge plate, the year series under the door.
- **Carbón Plate** (placa): the sign plate. Source plates, the year-door calculator panel, the CEDIS plan board, the "with redesign" card, the client strip, the contact channel plates.
- **Plate White** (placa-txt) and **Plate Gray** (placa-txt-2): primary and secondary text on carbón (8.18:1 for the secondary).
- **Ink** (tinta) and **Worn Ink** (tinta-2): primary and secondary text on concrete (6.8:1 for the secondary). Ink also draws the heavy 2 to 3px structural rules and the pressed filter chip.
- **Floor Line** (linea): hairline table borders, the painted dashed section divider, hatched "intruder" segments. Decorative only; it is 1.64:1 on concrete and never carries text.
- **White** (blanco): text on door red.

Dark theme (applied through `prefers-color-scheme` unless `data-theme="light"`, and forced by `data-theme="dark"`) remaps only the neutrals and rojo-txt: ground #1A1917, worn ground #22211E, plate #0E0D0B, ink #EEEBE5, worn ink #B7B1A7, line #3F3C36, red text #FF6A5F. The reds and yellow stay put.

### Named Rules
**The Painted Field Rule.** Red at scale is always a painted surface in Door Red, never a glow, gradient halo or tint. Large red fields carry horizontal slat lines (repeating dark and light 1 to 2px bands) so they read as a door.

**The Plate Honesty Rule.** A number on this wall is never bare. A carbón plate with a square marks a sourced figure (Ley, Cálculo propio, Estudios, Normas, Experiencia de campo); a yellow plate with a triangle marks an illustrative example. Yellow is spent on this distinction first.

**The Two Grays Rule.** Surfaces separate by stepping between Concrete and Worn Concrete, or by switching to a carbón plate. There is no third gray surface and no white card.

## Typography

**Display Font:** Big Shoulders Display (with Arial Narrow, Roboto Condensed)
**Numeral Font:** Big Shoulders Stencil Display (with Big Shoulders Display, Arial Narrow)
**Body Font:** Barlow (with Helvetica Neue, Arial)

**Character:** Condensed industrial signage over a plain, slightly technical grotesk. The stencil face is paint through a template; it appears where a number or a one-word command would be sprayed on a wall.

### Hierarchy
- **Display** (800, clamp(3rem, 7.4vw, 5.9rem), 0.98): the hero headline only, uppercase, with one word in Signal Red Text.
- **Headline** (800, clamp(2.3rem, 5.2vw, 4rem), 0.98): section headlines, uppercase, balanced wrapping. A compact step (clamp(2rem, 4.2vw, 3.2rem)) serves headlines that sit in a column beside other content.
- **Title** (800, clamp(1.35rem, 2.2vw, 1.7rem), 0.98, 0.01em): block and card titles, uppercase. Smaller contextual titles step down to 1.15 to 1.45rem.
- **Numeral** (900 stencil, clamp(3.4rem, 7vw, 5.2rem), 0.85): readouts, before/after figures, the equation, the fraction plate. Smaller stencil steps (1.35 to 2.4rem) mark year tiles, phase numbers, clock times and stats. The door number is the largest type on the page (clamp(9rem, 21vw, 17rem)).
- **Body** (400, 17px, 1.6): reading text, max 66ch; tabular numerals on by default. Secondary paragraphs drop to 0.9 to 0.96rem.
- **Lead** (400, clamp(1.08rem, 1.6vw, 1.25rem)): the hero subline, 52ch.
- **Label** (700, 0.72 to 0.82rem, 0.06 to 0.1em, uppercase, Barlow): plates, table headers, axis and lane labels, filter chips.

### Named Rules
**The Stencil Is Paint Rule.** Stencil is for numerals and single-word verdicts (Sustituir, Reforzar, Eliminar, Complementar; Diseñamos, Operamos, Monitoreamos). Never for sentences or body copy.

**The Uppercase Signage Rule.** Display-face headings and titles are uppercase; Barlow is only uppercase at label size with open tracking. A person's name is the one display-face exception set in sentence case.

## Layout

A single 1180px column centered on concrete, with a fluid side gutter (clamp(16px, 4vw, 40px)) on the body so nothing touches the edge on phones. Sections stack with generous vertical bays (clamp(64px, 9vw, 120px)) and each bay opens with a painted dashed floor line: 5px tall, 56px dashes with 28px gaps in Floor Line gray, running the full width of the section.

Section heads use a two-column split: headline left, supporting paragraph right, bottom-aligned. Content below is mostly two-column asymmetric grids (1.1/0.9, 1.15/0.85, 1.3/0.7) that collapse to one column at 860px. Repeated sets use even grids: 6 year doors (3 at 720px), 6 method phases (3 at 980px, 2 at 560px), 4 deliverables (2, then 1), 3 service columns, a 2 by 2 decision quadrant that becomes a stack at 640px with its axis labels restated inside each cell.

Internal rhythm is small and fixed (8px, 14px, 22px gaps); block separation within a section is clamp(40px, 6vw, 64px). The top bar is sticky, translucent concrete with a blur, a hairline bottom rule, and it drops its section links below 860px, keeping the brand mark and the small CTA.

### Named Rules
**The Floor Line Rule.** Sections are separated by a painted dashed floor line, not by alternating background bands.

## Elevation & Depth

The wall is flat. Depth appears only where an object is mounted on it: the hero door, the year-door calculator panel, the CEDIS plan board and the director's badge carry one soft two-layer shadow (a 1px contact shadow plus a diffuse 24px drop). Everything else separates by paint: surface steps, 2 to 3px ink rules, and hairlines.

Material depth is drawn, not lit: slat bands on doors, a steel frame drawn as two inset rings on the hero door, a 3px inset bottom lip on the primary button, and bolts rendered as small radial dots in plate corners.

### Shadow Vocabulary
- **Mounted** (`0 1px 1px rgba(22,19,15,.10), 0 8px 24px -8px rgba(22,19,15,.28)`; dark: `0 1px 1px rgba(0,0,0,.4), 0 10px 28px -8px rgba(0,0,0,.7)`): for objects hung on the wall. Four uses on the page; keep it that rare.
- **Button Lip** (`inset 0 -3px 0 rgba(0,0,0,.22)`): the pressed-steel bottom edge of the primary button.
- **Door Frame** (`inset 0 0 0 10px #2A2724, inset 0 0 0 12px #4a4642`): the steel frame around the hero door.

### Named Rules
**The Mounted Only Rule.** A shadow means "bolted to the wall". Blocks, cards and plates that are painted on do not get one.

## Shapes

Square. Corners are 2px on plates, chips, bars and tiles, 3px on doors, buttons and bordered blocks, 4px on the large panels (calculator, contact field, badge). Nothing is pill-shaped.

Markers are squares: list bullets (8px), timeline nodes (15px, ink outline, red when final), phase markers (15px red), and the square on a source plate. Circles are kept for things that are physically round: bolts, post markers on the CEDIS plan, the position dots in the detection-layer diagrams, and the Ultra logo. Triangles mean "illustrative". Diagonal hatching appears in two places only: the hazard strip under the door and the intruder segment in the timing lanes.

Heavy ink borders (2 to 3px) frame structural blocks: the contingency row, the decision quadrant, the fraction plate, rules above phases and under service titles.

### Named Rules
**The Square Marker Rule.** List bullets, timeline nodes and phase markers are squares. A circle on this wall is an object, never a bullet.

## Components

### Buttons
Painted steel with a pressed lip; confident and heavy.
- **Shape:** gently squared (3px).
- **Primary:** Door Red with white Big Shoulders Display 800 uppercase at 1.2rem, 0.04em tracking, 15px 22px 14px padding, an inline 18px arrow SVG, and a 3px inset dark lip. Label is "Agendar sitio piloto".
- **Small:** same, 1rem, 11px 16px 10px, used in the top bar.
- **Hover / Active:** hover (fine pointers only) darkens to #A81F18; press scales to 0.97 over 160ms with a fast ease-out.
- **Ghost:** transparent with a 2px inset Ink ring; hover fills with Ink and flips text to Concrete. On a carbón plate the ring and text use Plate White.

### Source Plates
- **Style:** small carbón plate, Barlow 700 at 0.74rem uppercase, 0.09em tracking, 2px corners, a 9px square marker at left. Illustrative plates are Safety Yellow with ink text and a 6/10px triangle marker.
- **Placement:** in a wrapping row under the figure they support. A legend near the footer explains how to read them.

### Filter Chips
- **Style:** transparent, 2px Ink border, Barlow 700 0.82rem uppercase, 10px 12px, 2px corners, with a 12px round color swatch matching the post marker it filters.
- **State:** pressed (`aria-pressed="true"`) fills with Ink and flips text to Concrete; press scales to 0.97.

### Cards / Containers
- **Corner Style:** 3px.
- **Background:** Worn Concrete for "before" or neutral content, Carbón Plate for the "after" or Ultra content. The pair reads as current scheme versus redesign.
- **Shadow Strategy:** none; see Mounted Only.
- **Border:** none; internal rows separate with 1px dashed lines (Floor Line on concrete, 18% white on carbón).
- **Internal Padding:** 22px 22px 18px.

### Navigation
- **Style:** sticky top bar on 92% Concrete with an 8px blur and 1px Floor Line rule. Brand mark is the 34px Ultra logo plus "Corporativo Ultra" in display 800 uppercase. Section links are Barlow 600 0.95rem in Worn Ink, turning Ink on hover. Small primary button at the right.
- **Mobile:** links hide at 860px; the brand word hides at 480px, leaving logo and button.

### Dock Door (signature)
The hero object: a 4:4.6 red roll-up door with slat bands, a steel frame, a Mounted shadow, a small spaced-out door label at the top, a stenciled hour count in the middle and a footer with year and DOF date. Directly below it sits the single hazard strip (14px, 45° yellow and ink) and a five-tile year series (2026 to 2030) in Worn Concrete; the active year tile turns Door Red. On load the door counts 48 down to 40, one stage per year (skipped with reduced motion).

### Year Doors (signature interaction)
A radio group styled as six small dock doors on the carbón calculator panel: 128px tall, dark steel (#34312C) with 15px slat bands, year label in display 800 and the weekly hours in stencil. Selected turns Door Red with a carbón gap and a red outer ring. Picking a door updates guard figures (guard silhouettes drawn from one inline SVG symbol) and two salary-multiple bars; changing values briefly blur (3px, 35% opacity, 220ms) and bar fills slide over 420ms. Focus shows the yellow ring offset 4px.

### Sign Plates (contact channels, badge)
Carbón plates with four bolts in the corners (radial dots, 3px) holding a label, a large display value (selectable) and a row of primary and ghost buttons. The director's badge is the Worn Concrete version with two bottom bolts, a lanyard slot and a stenciled "CPP" in Door Red.

### Focus
Keyboard focus is a 3px outline offset 3px with 2px corners: ink (tinta) on concrete, Safety Yellow inside the calculator panel, the CEDIS plan and the contact band, where it reads at 10.08:1 on carbón.

## Do's and Don'ts

### Do:
- **Do** paint large red areas in Door Red (#C3261E) with slat bands, and keep Ultra Red (#E7342B) for small markers.
- **Do** attach a source plate to every figure, and a yellow triangle plate to every illustrative one.
- **Do** separate sections with the painted dashed floor line (5px, 56px dash, 28px gap).
- **Do** set numerals and one-word verdicts in the stencil face, words in Big Shoulders Display uppercase, and reading text in Barlow at 17px/1.6 with tabular numerals.
- **Do** keep corners at 2, 3 or 4px and markers square.
- **Do** keep the Mounted shadow for objects hung on the wall (door, calculator, plan, badge).
- **Do** gate hover styles to fine pointers, press-scale interactive elements to 0.97, and drop all motion under reduced motion.
- **Do** draw icons as inline stroked SVG symbols (2.2px stroke, round joins).

### Don't:
- **Don't** build a dark control-room hero with a glowing accent, or a stock-photo consulting page.
- **Don't** use photographs; the wall is made of paint, plates and diagrams.
- **Don't** add more than one hazard strip to a surface.
- **Don't** set yellow text or a yellow-only indicator on concrete; yellow belongs on carbón or red.
- **Don't** put white text smaller than bold 17px on Ultra Red (#E7342B); use Door Red.
- **Don't** add kickers or eyebrow labels above headlines; the headline itself is the sign.
- **Don't** use glyph or emoji icons, or round pill buttons.
- **Don't** introduce a third surface gray or a white card.
