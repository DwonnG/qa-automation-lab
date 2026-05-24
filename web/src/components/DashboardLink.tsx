// Persistent "back to dashboard" link rendered above the SUT on the Pages
// build. Only mounts when the bundle was built with VITE_USE_MOCKS=true,
// because the dashboard only exists alongside the demo on GitHub Pages —
// in dev (`/`) and Docker (SPA served by FastAPI) there's nothing to go
// "back" to and the link would 404.
//
// Href is derived from Vite's BASE_URL so we land at the dashboard root
// regardless of the deploy subpath (e.g. /qa-automation-lab/demo/ ->
// /qa-automation-lab/). Resolves via `new URL('..', base)` rather than
// string trimming so it stays correct even if a future build moves the
// SUT to a deeper path.

function resolveDashboardHref(): string {
  const base = import.meta.env.BASE_URL ?? "/";
  if (typeof window === "undefined") {
    return base;
  }
  const baseUrl = new URL(base, window.location.origin);
  return new URL("..", baseUrl).pathname;
}

export function DashboardLink() {
  if (import.meta.env.VITE_USE_MOCKS !== "true") {
    return null;
  }
  const href = resolveDashboardHref();
  return (
    <a
      href={href}
      className="fixed left-4 top-4 z-50 inline-flex items-center gap-1.5 rounded-full border border-border bg-background/80 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur transition hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      data-testid="back-to-dashboard"
    >
      <svg
        viewBox="0 0 16 16"
        width="12"
        height="12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M10 12 6 8l4-4" />
      </svg>
      <span>Back to dashboard</span>
    </a>
  );
}
