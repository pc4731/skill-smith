import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.js";
import "./styles.css";
import { applyTokens, resolveInitialMode } from "./theme/applyTokens.js";
import { ThemeProvider } from "./theme/ThemeProvider.js";

applyTokens(resolveInitialMode());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>,
);
