import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/app";
import { EmbeddedEditor } from "./app/embed";
import "./app/app.css";

const params = new URLSearchParams(location.search);
if (params.get("theme")) document.documentElement.classList.toggle("dark", params.get("theme") === "dark");

createRoot(document.getElementById("root")!).render(
  <StrictMode>{params.has("embed") ? <EmbeddedEditor params={params} /> : <App />}</StrictMode>,
);
