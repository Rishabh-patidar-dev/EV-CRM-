import axios, { AxiosError } from "axios";

// The API enforces the crm_session cookie on every /api/v1 route, so
// `withCredentials` is what makes an authenticated request authenticated.
const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",
  headers: { "Content-Type": "application/json" },
  withCredentials: true, // send/receive the crm_session cookie
  // Without a timeout, axios waits forever. A request stalled on a dropped
  // connection would leave its panel spinning for the rest of the session
  // with no error and no way for the user to tell it apart from slow data.
  timeout: 30_000,
});

// ---------------------------------------------------------------------------
// Session expiry
// ---------------------------------------------------------------------------
// Sessions expire (12h, or 30 days with "keep me signed in"), and a staff
// account that is deleted or has its role changed stops resolving within a
// minute. Both surface as a 401 on the next call.
//
// The route guard in middleware.ts only checks for the `has_session` marker
// cookie this app sets at login — it cannot see the real httpOnly session
// cookie, which belongs to the API's domain. So once the real session lapses,
// the marker is still present, middleware still lets the user in, and every
// panel on the page just fails. This interceptor is what closes that gap:
// clear the stale marker and send them to /login.
let redirecting = false;

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const status = error.response?.status;

    if (status === 401 && typeof window !== "undefined" && !redirecting) {
      // The login screen itself 401s on a bad password — bouncing it back to
      // /login would wipe the error message the user needs to read.
      const onLoginPage = window.location.pathname.startsWith("/login");
      if (!onLoginPage) {
        redirecting = true;
        document.cookie = "has_session=; path=/; max-age=0";
        // Preserve where they were so login can return them there.
        const next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `/login?next=${next}`;
      }
    }

    return Promise.reject(error);
  }
);

/**
 * The API returns a safe message plus a requestId instead of raw exception
 * text. This pulls out the best available message for display, falling back
 * sensibly when the server is unreachable and there is no response at all.
 */
export function apiErrorMessage(error: unknown, fallback = "Something went wrong"): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string; requestId?: string } | undefined;
    if (data?.message) {
      return data.requestId ? `${data.message} (ref: ${data.requestId})` : data.message;
    }
    if (error.code === "ECONNABORTED") return "The request timed out. Please try again.";
    if (!error.response) return "Can't reach the server. Check your connection and try again.";
  }
  return fallback;
}

export default apiClient;
