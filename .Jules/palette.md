# Palette's Journal - Critical Learnings Only

## 2025-08-01 - SPAs Catch-all Route Masking and JSON Array Parsing Robustness
**Learning:** When a backend is configured with a catch-all route (such as `app.get('*')`) to serve the frontend single-page application, requests to non-existent API endpoints receive a 200 OK with the HTML content of `index.html`. If the frontend attempts to parse this as JSON, it fails or receives a string. If the frontend then blindly executes `.map()` on this state, it crashes the entire React application with `TypeError: e.map is not a function`.
**Action:** Always validate the structure of response data from the API (e.g., using `Array.isArray(res.data)`) before updating state to prevent whole-app crashes due to catch-all route masking or non-matching endpoints.
