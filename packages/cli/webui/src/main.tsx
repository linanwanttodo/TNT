import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@fontsource-variable/inter/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";

import { App } from "./App.js";
import { installIconSprite } from "./ui/primitives/icons/sprite.ts";
import "./ui/theme/tokens.css";
import "./ui/theme/fonts.css";
import "./ui/theme/base.css";
import "./ui/theme/motion.css";
import "./ui/theme/scrollbar.css";
import "./ui/theme/focus.css";
import "./ui/theme/corner-shape.css";
import "./ui/theme/shiki.css";

// Every glyph in the app is a `<use>` into one document sprite; without the
// sprite mounted, the icons render as empty boxes.
installIconSprite();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
