// API configuration based on environment
export const API_BASE_URL = import.meta.env.MODE === 'production' 
  ? '' // Use relative URLs in production (served from same server)
  : 'http://localhost:8080'; // Use full URL in development
