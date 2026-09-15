import React from "react";
import { createRoot } from "react-dom/client";
import PdfReader from "./views/PdfReader";

globalThis.__KISS_CONTEXT__ = "pdf";
createRoot(document.getElementById("root")).render(<PdfReader />);
