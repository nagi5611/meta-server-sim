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
    const rawBody = opts?.body;
    const isForm = typeof FormData !== "undefined" && rawBody instanceof FormData;
    if (rawBody !== undefined && !isForm) headers["content-type"] = "application/json";
    const res = await fetch(`${BASE}${path}`, {
      credentials: "include",
      ...opts,
      headers,
      body:
        rawBody === undefined
          ? undefined
          : isForm
            ? rawBody
            : JSON.stringify(rawBody),
    });
    return parse(res);
  }

  function uploadWithProgress(path, formData, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${BASE}${path}`, true);
      xhr.withCredentials = true;
      xhr.responseType = "text";
      xhr.setRequestHeader("accept", "application/json");
      if (onProgress) {
        xhr.upload.onprogress = (ev) => {
          if (!ev.lengthComputable) return;
          onProgress(Math.min(100, Math.round((ev.loaded / ev.total) * 100)));
        };
      }
      xhr.onload = () => {
        let data = null;
        try {
          data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
        } catch {
          data = { raw: xhr.responseText };
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else {
          const err = new Error(data?.error || xhr.statusText || "request_failed");
          err.status = xhr.status;
          err.data = data;
          reject(err);
        }
      };
      xhr.onerror = () => reject(new Error("network_error"));
      xhr.send(formData);
    });
  }

  window.LobbyAdminApi = {
    login: (login, password) =>
      request("/login", { method: "POST", body: { login, password, username: login, email: login } }),
    verifyOtp: (challengeId, code) =>
      request("/login/verify-otp", { method: "POST", body: { challengeId, code } }),
    resendOtp: (challengeId) =>
      request("/login/resend-otp", { method: "POST", body: { challengeId } }),
    verifyKey: (challengeId, signature) =>
      request("/login/verify-key", { method: "POST", body: { challengeId, signature } }),
    listAdminKeys: () => request("/admin-keys"),
    adminKeyReauthChallenge: () =>
      request("/admin-keys/reauth-challenge", { method: "POST", body: {} }),
    registerAdminKey: (body) => request("/admin-keys", { method: "POST", body }),
    revokeAdminKey: (id) =>
      request(`/admin-keys/${encodeURIComponent(id)}/revoke`, { method: "POST", body: {} }),
    deleteRevokedAdminKey: (id) =>
      request(`/admin-keys/${encodeURIComponent(id)}`, { method: "DELETE" }),
    superLoginAudit: (limit) =>
      request(`/super-login-audit${limit ? `?limit=${limit}` : ""}`),
    bootstrapFromLobby: () => request("/bootstrap-from-lobby", { method: "POST", body: {} }),
    logout: () => request("/logout", { method: "POST", body: {} }),
    session: () => request("/session"),
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
    banHistory: (id) => request(`/users/${encodeURIComponent(id)}/ban-history`),
    kickUser: (id) => request(`/users/${encodeURIComponent(id)}/kick`, { method: "POST", body: {} }),
    sendPasswordReset: (id) =>
      request(`/users/${encodeURIComponent(id)}/password-reset`, { method: "POST", body: {} }),
    joinLogs: (page) => request(`/join-logs?page=${page || 1}`),
    listAnnouncements: () => request('/announcements'),
    createAnnouncement: (body) => request('/announcements', { method: 'POST', body }),
    updateAnnouncement: (id, body) =>
      request(`/announcements/${encodeURIComponent(id)}`, { method: 'PUT', body }),
    deleteAnnouncement: (id) =>
      request(`/announcements/${encodeURIComponent(id)}`, { method: 'DELETE', body: {} }),
    uploadThumbnail: (file, onProgress) => {
      const fd = new FormData();
      fd.append("file", file, file.name || "thumbnail");
      return uploadWithProgress("/upload/thumbnail", fd, onProgress);
    },
  };
})();