// Intentional-defect flag registry for the in-browser SUT.
//
// Mirrors `demo-app/src/demo_app/defects.py`. The list of known ids is
// duplicated here on purpose so a typo in either layer fails to
// silently activate the wrong defect.
//
// Resolution order (first match wins):
//   1. `sessionStorage["qa-automation-lab.defects"]` — set by the
//      DefectsPanel toggle so visitors can flip bugs without rebuilding.
//   2. `import.meta.env.VITE_DEFECTS` — build-time default; used by the
//      pre-seeded `/defect-runs/example-<id>/` deploys so the dashboard
//      can demo each defect even before the visitor clicks anything.
//
// MSW handlers read the flag at request time (call `defectEnabled()`
// inside the handler body, not at module load) so toggles take effect
// immediately on the next API call.

export const KNOWN_DEFECTS = [
  "login_accepts_any_pin",
  "negative_qty_allowed",
  "off_by_one_pagination",
  "delete_skips_auth",
  "slow_query",
] as const;

export type DefectId = (typeof KNOWN_DEFECTS)[number];

const STORAGE_KEY = "qa-automation-lab.defects";
const KNOWN_SET = new Set<string>(KNOWN_DEFECTS);

function parseCsv(raw: string | null | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function sessionDefects(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    return parseCsv(window.sessionStorage.getItem(STORAGE_KEY));
  } catch {
    return new Set();
  }
}

function buildDefects(): Set<string> {
  // import.meta.env.VITE_DEFECTS is statically replaced at build time;
  // reading it here is safe in both browser and node test environments.
  return parseCsv(import.meta.env?.VITE_DEFECTS);
}

export function activeDefects(): DefectId[] {
  const seen = new Set<string>([...buildDefects(), ...sessionDefects()]);
  return KNOWN_DEFECTS.filter((id) => seen.has(id));
}

export function defectEnabled(id: DefectId): boolean {
  if (!KNOWN_SET.has(id)) return false;
  return activeDefects().includes(id);
}

export function setDefects(ids: readonly DefectId[]): void {
  if (typeof window === "undefined") return;
  const csv = ids.filter((id) => KNOWN_SET.has(id)).join(",");
  try {
    if (csv) {
      window.sessionStorage.setItem(STORAGE_KEY, csv);
    } else {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* sessionStorage disabled — visitor can still toggle in this tab */
  }
}
