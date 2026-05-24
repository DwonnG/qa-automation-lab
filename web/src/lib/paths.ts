// Derive paths from Vite's BASE_URL so the same build works both:
//   - at "/" (local dev, Docker, Playwright/Cypress CI)
//   - at "/qa-automation-lab/demo/" (GitHub Pages, where the MSW service
//     worker scope is the same subpath and must intercept these requests)
const RAW_BASE: string =
  typeof import.meta !== "undefined" && import.meta.env?.BASE_URL
    ? import.meta.env.BASE_URL
    : "/";
const BASE = RAW_BASE.endsWith("/") ? RAW_BASE.slice(0, -1) : RAW_BASE;

export const API_PREFIX = `${BASE}/api`;

export const LOGIN_URL = `${API_PREFIX}/login`;
export const ITEMS_URL = `${API_PREFIX}/items`;
export const HEALTH_URL = `${API_PREFIX}/health`;

export const itemUrl = (id: string): string => `${ITEMS_URL}/${id}`;
