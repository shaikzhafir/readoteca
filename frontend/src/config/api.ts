// API configuration based on environment
export const API_BASE_URL = import.meta.env.MODE === 'production'
  ? '/api'
  : 'http://localhost:8080/api';
