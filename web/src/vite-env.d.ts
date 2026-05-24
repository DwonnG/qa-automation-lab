/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly BASE_URL: string;
  readonly VITE_USE_MOCKS?: string;
  // CSV of intentional-defect ids to enable at build time. Used by the
  // pre-seeded /defect-runs/example-<id>/ Pages deploys so each defect
  // can be demoed even before the visitor toggles anything. Runtime
  // toggles via sessionStorage take precedence at request time.
  readonly VITE_DEFECTS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
