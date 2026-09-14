const API_BASE_URL = "http://localhost:3000/api/v1";

const api = {
  // Get stored token
  getToken: () => localStorage.getItem("almac_token"),
  
  // Store token
  setToken: (token) => localStorage.setItem("almac_token", token),
  
  // Remove token (logout)
  removeToken: () => localStorage.removeItem("almac_token"),
  
  // Check if user is logged in
  isAuthenticated: () => !!localStorage.getItem("almac_token"),
  
  // Get stored user data
  getUser: () => {
    const user = localStorage.getItem("almac_user");
    return user ? JSON.parse(user) : null;
  },
  
  // Store user data
  setUser: (user) => localStorage.setItem("almac_user", JSON.stringify(user)),
  
  // Remove user data
  removeUser: () => localStorage.removeItem("almac_user"),

  // Login
  login: async (email, password) => {
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || "Login failed");
    }
    return data;
  },

  // Register
  register: async (userData) => {
    const response = await fetch(`${API_BASE_URL}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(userData),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || "Registration failed");
    }
    return data;
  },

  // Get current user profile
  getMe: async () => {
    const token = api.getToken();
    const response = await fetch(`${API_BASE_URL}/auth/me`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || "Failed to fetch profile");
    }
    return data;
  },
};

export default api;