import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";
import "./ui/theme/tokens.css";
import "./ui/theme/base.css";
import "./ui/theme/scrollbar.css";
import "./ui/theme/focus.css";
import "./ui/theme/corner-shape.css";
import "./ui/theme/shiki.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
