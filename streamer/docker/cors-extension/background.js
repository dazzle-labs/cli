// Dazzle CORS & Network Isolation Extension
//
// 1. Blocks requests to localhost, RFC1918, and link-local addresses
//    (prevents local port scanning on multi-tenant GPU pods).
// 2. Adds permissive CORS headers to all external responses
//    (lets user content fetch third-party APIs without CORS errors).
//
// The page's own origin (sidecar content server on localhost) is allowed
// so content loads normally.

const BLOCKED_PATTERNS = [
  /^https?:\/\/localhost[:/]/i,
  /^https?:\/\/127\.\d+\.\d+\.\d+[:/]/i,
  /^https?:\/\/10\.\d+\.\d+\.\d+[:/]/i,
  /^https?:\/\/172\.(1[6-9]|2\d|3[01])\.\d+\.\d+[:/]/i,
  /^https?:\/\/192\.168\.\d+\.\d+[:/]/i,
  /^https?:\/\/169\.254\.\d+\.\d+[:/]/i,
  /^https?:\/\/\[::1\][:/]/i,
];

// --- Network isolation: block local requests ---
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    // Always allow top-level navigation (the page itself loads from localhost).
    if (details.type === "main_frame") {
      return;
    }

    // Allow requests to the same origin as the initiator (sidecar content).
    // This lets the page load its own scripts, styles, and images.
    if (details.initiator) {
      try {
        const requestOrigin = new URL(details.url).origin;
        const initiatorOrigin = new URL(details.initiator).origin;
        if (requestOrigin === initiatorOrigin) {
          return;
        }
      } catch (e) {
        // malformed URL — fall through to block check
      }
    }

    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(details.url)) {
        console.log("[dazzle] Blocked local network request:", details.url);
        return { cancel: true };
      }
    }
  },
  { urls: ["<all_urls>"] },
  ["blocking"]
);

// --- CORS: add permissive headers to all responses ---
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    const headers = details.responseHeaders.filter(
      (h) => !h.name.toLowerCase().startsWith("access-control-")
    );
    headers.push({ name: "Access-Control-Allow-Origin", value: "*" });
    headers.push({ name: "Access-Control-Allow-Methods", value: "GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD" });
    headers.push({ name: "Access-Control-Allow-Headers", value: "*" });
    headers.push({ name: "Access-Control-Expose-Headers", value: "*" });
    return { responseHeaders: headers };
  },
  { urls: ["<all_urls>"] },
  ["blocking", "responseHeaders"]
);

console.log("[dazzle] CORS & network isolation extension loaded");
