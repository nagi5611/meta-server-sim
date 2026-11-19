(function () {
  "use strict";
  const BASE = "/admin/api";

  async function parse(res) {
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
  if (!res.ok) {
      const err = new Error(data?.error || res.statusText || "request_failed");
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  async function request(path, opts) {
    const headers = { accept: "application/json", ...(opts?.headers || {}) };
    if (opts?.body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(`${BASE}${path}`, {
      credentials: "include",
      ...opts,
      headers,
      body: opts?.body !== undefined ? JSON.stringify(opts.body) : opts?.body,
    });
    return parse(res);
  }

  window.LobbyAdminApi = {
    login: (username, password) => request("/login", { method: "POST", body: { username, password } }),
    logout: () => request("/logout", { method: "POST", body: {} }),
    getCatalog: () => request("/catalog"),
    putCatalog: (worlds) => request("/catalog", { method: "PUT", body: { worlds } }),
    overview: () => request("/overview"),
    metrics: (range, worldId) => {
      const q = new URLSearchParams({ range: range || "24h" });
      if (worldId) q.set("worldId", worldId);
      return request(`/metrics?${q}`);
    },
    getUsers: () => request("/users"),
    patchUser: (id, body) => request(`/users/${encodeURIComponent(id)}`, { method: "PATCH", body }),
    kickUser: (id) => request(`/users/${encodeURIComponent(id)}/kick`, { method: "POST", body: {} }),
    joinLogs: (page) => request(`/join-logs?page=${page || 1}`),
  };
})();