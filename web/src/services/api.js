const API_BASE_URL = "http://localhost:3000/api/v1";

const api = {
  getToken: () => localStorage.getItem("almac_token"),
  setToken: (token) => localStorage.setItem("almac_token", token),
  removeToken: () => localStorage.removeItem("almac_token"),
  isAuthenticated: () => !!localStorage.getItem("almac_token"),
  getUser: () => {
    const user = localStorage.getItem("almac_user");
    return user ? JSON.parse(user) : null;
  },
  setUser: (user) => localStorage.setItem("almac_user", JSON.stringify(user)),
  removeUser: () => localStorage.removeItem("almac_user"),

  login: async (email, password) => {
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Login failed");
    return data;
  },

  register: async (userData) => {
    const response = await fetch(`${API_BASE_URL}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(userData),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Registration failed");
    return data;
  },

  getMe: async () => {
    const token = api.getToken();
    const response = await fetch(`${API_BASE_URL}/auth/me`, {
      method: "GET",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Failed to fetch profile");
    return data;
  },

  // Upload image for scan
  uploadImage: async (file, onProgress) => {
    const token = api.getToken();
    const formData = new FormData();
    formData.append("file", file);
    
    const response = await fetch(`${API_BASE_URL}/uploads/image`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}` },
      body: formData,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Upload failed");
    return data;
  },

  // Get all inspections
  getInspections: async (page = 1, limit = 20) => {
    const token = api.getToken();
    const response = await fetch(`${API_BASE_URL}/inspections?page=${page}&limit=${limit}`, {
      method: "GET",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Failed to fetch inspections");
    return data;
  },

  // Get single inspection details
  getInspection: async (scanId) => {
    const token = api.getToken();
    const response = await fetch(`${API_BASE_URL}/uploads/${scanId}`, {
      method: "GET",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Failed to fetch inspection");
    return data;
  },

  // Update user profile
  updateProfile: async (updates) => {
    const token = api.getToken();
    const response = await fetch(`${API_BASE_URL}/auth/me`, {
      method: "PUT",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Failed to update profile");
    return data;
  },
};

export default api;