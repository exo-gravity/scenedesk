import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";
import { MantineProvider } from "@mantine/core";
import { theme, cssVariablesResolver } from "./theme/theme";
import "./theme/global.css";
import "./style.css";
import "@mantine/core/styles.layer.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MantineProvider
      theme={theme}
      cssVariablesResolver={cssVariablesResolver}
      forceColorScheme="dark"
    >
      <App />
    </MantineProvider>
  </React.StrictMode>,
);
