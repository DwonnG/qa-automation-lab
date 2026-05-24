import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "@/App";
import { queryClient } from "@/lib/queryClient";

import "@/styles/globals.css";

async function enableMocksIfRequested(): Promise<void> {
  if (import.meta.env.VITE_USE_MOCKS !== "true") return;
  const { worker } = await import("@/mocks/browser");
  // Scope the service worker to BASE_URL so the same SW can run at "/" in
  // dev and at "/qa-automation-lab/demo/" on GitHub Pages. Quiet logging
  // because the demo isn't a debugging surface for visitors.
  await worker.start({
    serviceWorker: {
      url: `${import.meta.env.BASE_URL}mockServiceWorker.js`,
    },
    quiet: true,
    onUnhandledRequest: "bypass",
  });
}

void enableMocksIfRequested().then(() => {
  const rootElement = document.getElementById("root");
  if (!rootElement) {
    throw new Error("root element not found");
  }

  createRoot(rootElement).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  );
});
