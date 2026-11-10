# Design

## Theme

TNT reuses the vendored `@zcode/ui` product theme: a restrained dark and light tool surface, one accent for selection and primary actions, and semantic colors for error, warning and success. No gradients, glass surfaces or decorative onboarding treatments.

## Typography

The existing UI system font stack and compact type scale remain authoritative. Labels, data and controls use one sans family; technical paths and terminal text use the existing monospace treatment.

## Components

Use the existing settings rows, cards, buttons, selects, dialogs, dropdown menus and error boundaries. Local-only sections use the same control vocabulary as other settings pages. Cloud account, plan, upgrade, login and migration components are not part of the product surface.

## Layout

Desktop Web UI uses the existing app shell with a settings sidebar and a scrollable content region. Narrow layouts collapse to the existing responsive settings navigation. Interactive controls have default, hover, focus, active, disabled, loading and error states.

## Motion

State transitions stay within 150-250 ms and respect `prefers-reduced-motion`. Motion communicates loading, opening or state change only.

## Verification

Visual checks cover dark and light themes, desktop and narrow widths, and localized labels. Interactive changes require exercised local state changes through the running Web UI or automated service tests.
