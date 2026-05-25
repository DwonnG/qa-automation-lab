// Floating toggle panel for the MSW-backed SUT. Only mounts when
// VITE_USE_MOCKS=true; the real backend reads its own DEFECTS env var.

import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  KNOWN_DEFECTS,
  activeDefects,
  setDefects,
  type DefectId,
} from "@/lib/defects";

const LABELS: Record<DefectId, string> = {
  login_accepts_any_pin: "Login accepts any 6-digit PIN",
  negative_qty_allowed: "Negative quantity allowed",
  off_by_one_pagination: "Off-by-one pagination",
  delete_skips_auth: "DELETE skips auth",
  slow_query: "List endpoint sleeps 400ms",
  selector_drift: "Add item button renamed",
};

export function DefectsPanel() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<Set<DefectId>>(
    () => new Set(activeDefects()),
  );
  const queryClient = useQueryClient();

  // Re-sync on cross-tab storage writes.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === "qa-automation-lab.defects") {
        setActive(new Set(activeDefects()));
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const persist = useCallback(
    (next: Set<DefectId>) => {
      setActive(next);
      setDefects(Array.from(next));
      // Force the next render through MSW so a freshly-toggled defect
      // shows on the current page without navigation.
      void queryClient.invalidateQueries({ queryKey: ["items"] });
    },
    [queryClient],
  );

  const toggle = useCallback(
    (id: DefectId) => {
      const next = new Set(active);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      persist(next);
    },
    [active, persist],
  );

  const clearAll = useCallback(() => persist(new Set()), [persist]);

  if (import.meta.env.VITE_USE_MOCKS !== "true") {
    return null;
  }

  const summary = active.size === 0 ? "off" : `${active.size} on`;

  return (
    <div
      className="fixed right-4 top-4 z-50 max-w-xs"
      data-testid="defects-panel"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/80 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur transition hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-expanded={open}
        aria-controls="defects-panel-body"
      >
        <span aria-hidden="true">{open ? "▴" : "▾"}</span>
        <span>Defects · {summary}</span>
      </button>
      {open && (
        <div
          id="defects-panel-body"
          className="mt-2 rounded-md border border-border bg-background/95 p-3 text-xs shadow-lg backdrop-blur"
          role="group"
          aria-label="Intentional defects"
        >
          <p className="mb-2 text-muted-foreground">
            Flip a bug on; the SUT and its tests will behave accordingly.
          </p>
          <ul className="space-y-1.5">
            {KNOWN_DEFECTS.map((id) => (
              <li key={id}>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={active.has(id)}
                    onChange={() => toggle(id)}
                    className="mt-0.5"
                    data-testid={`defect-toggle-${id}`}
                  />
                  <span>
                    <code className="text-[0.65rem]">{id}</code>
                    <br />
                    <span className="text-muted-foreground">{LABELS[id]}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {active.size > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="mt-3 w-full rounded border border-border bg-background px-2 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
              data-testid="defects-clear-all"
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
}
