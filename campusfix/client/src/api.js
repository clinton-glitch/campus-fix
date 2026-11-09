const TOKEN_KEY = 'campusfix_token';

export const tokenStore = {
  get: () => {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  set: (t) => {
    try { localStorage.setItem(TOKEN_KEY, t); } catch { /* ignore */ }
  },
  clear: () => {
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  },
};

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details || [];
  }
}

async function request(path, { method = 'GET', body, raw } = {}) {
  const headers = {};
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload = body;
  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: payload });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.');
  }
  if (!res.ok) {
    let data = {};
    try { data = await res.json(); } catch { /* non-JSON error */ }
    if (res.status === 401 && token && !path.startsWith('/auth/')) {
      tokenStore.clear();
      window.dispatchEvent(new Event('campusfix:logout'));
    }
    throw new ApiError(res.status, data.error || 'Something went wrong', data.details);
  }
  if (raw) return res;
  if (res.status === 204) return null;
  return res.json();
}

const qs = (params) => {
  const p = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => v !== '' && v != null && p.set(k, v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  login: (b) => request('/auth/login', { method: 'POST', body: b }),
  register: (b) => request('/auth/register', { method: 'POST', body: b }),
  me: () => request('/auth/me'),
  categories: () => request('/categories'),
  stats: () => request('/stats'),
  requests: (params) => request(`/requests${qs(params)}`),
  request: (id) => request(`/requests/${id}`),
  createRequest: (formData) => request('/requests', { method: 'POST', body: formData }),
  deleteRequest: (id) => request(`/requests/${id}`, { method: 'DELETE' }),
  assign: (id, officer_id) => request(`/requests/${id}/assign`, { method: 'POST', body: { officer_id } }),
  setStatus: (id, status, note) => request(`/requests/${id}/status`, { method: 'PATCH', body: { status, note } }),
  attachmentBlob: async (id) => (await request(`/requests/${id}/attachment`, { raw: true })).blob(),
  exportCsv: async (params) => (await request(`/requests/export/csv${qs(params)}`, { raw: true })).blob(),
  users: (role) => request(`/users${qs({ role })}`),
  createUser: (b) => request('/users', { method: 'POST', body: b }),
  updateUser: (id, b) => request(`/users/${id}`, { method: 'PATCH', body: b }),
  notifications: () => request('/notifications'),
  readAll: () => request('/notifications/read-all', { method: 'POST' }),
  audit: (params) => request(`/audit${qs(params)}`),
};
