export const API_PREFIX = "/api";

export const LOGIN_URL = `${API_PREFIX}/login`;
export const ITEMS_URL = `${API_PREFIX}/items`;
export const HEALTH_URL = `${API_PREFIX}/health`;

export const ADMIN_RESET_URL = "/admin/reset";

export const itemUrl = (id) => `${ITEMS_URL}/${id}`;
