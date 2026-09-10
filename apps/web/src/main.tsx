import React from "react";
import { createRoot } from "react-dom/client";
import Root from "./Root";
import "./theme/global.css";
import "./style.css";
import "@mantine/core/styles.layer.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
