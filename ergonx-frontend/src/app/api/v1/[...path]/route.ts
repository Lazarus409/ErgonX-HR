import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const ACCESS_COOKIE = "ergonx_access";
const REFRESH_COOKIE = "ergonx_refresh";
const SESSION_COOKIE = "ergonx_session";
// Present only when the user ticked "Keep me signed in"; non-sensitive, so the
// client can read it to decide whether the inactivity sign-out applies.
const REMEMBER_COOKIE = "ergonx_remember";
const REMEMBER_SECONDS = 60 * 60 * 24 * 7;
const API_PREFIX = "/api/v1/";
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

type RouteContext = { params: Promise<{ path: string[] }> };

function backendOrigin(): string {
  return (process.env.ERGONX_API_PROXY_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");
}

function jsonResponse(body: object, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function cookieIsSecure(request: NextRequest): boolean {
  return request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
}

function clearSession(request: NextRequest, response: NextResponse): NextResponse {
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, SESSION_COOKIE, REMEMBER_COOKIE]) {
    response.cookies.set({ name, value: "", httpOnly: name === ACCESS_COOKIE || name === REFRESH_COOKIE, sameSite: "lax", secure: cookieIsSecure(request), path: "/", maxAge: 0 });
  }
  return response;
}

/**
 * Remembered sessions survive a browser restart for up to seven days. Otherwise
 * every cookie is a browser-session cookie, so closing the browser signs out.
 */
function establishSession(request: NextRequest, response: NextResponse, access: string, refresh: string | undefined, remember: boolean): NextResponse {
  const base = { sameSite: "lax" as const, secure: cookieIsSecure(request), path: "/" };
  const lifetime = remember ? { maxAge: REMEMBER_SECONDS } : {};
  response.cookies.set({ name: ACCESS_COOKIE, value: access, ...base, httpOnly: true, ...(remember ? { maxAge: 60 * 15 } : {}) });
  if (refresh) response.cookies.set({ name: REFRESH_COOKIE, value: refresh, ...base, httpOnly: true, ...lifetime });
  // This non-sensitive hint lets client route guards decide whether to hydrate.
  response.cookies.set({ name: SESSION_COOKIE, value: "1", ...base, httpOnly: false, ...lifetime });
  if (remember) response.cookies.set({ name: REMEMBER_COOKIE, value: "1", ...base, httpOnly: false, ...lifetime });
  else response.cookies.set({ name: REMEMBER_COOKIE, value: "", ...base, httpOnly: false, maxAge: 0 });
  return response;
}

function safeAuthPayload(payload: unknown): { body: unknown; access?: string; refresh?: string } {
  if (!payload || typeof payload !== "object") return { body: payload };
  const outer = payload as Record<string, unknown>;
  const data = outer.data;
  if (!data || typeof data !== "object") return { body: payload };
  const tokenData = data as Record<string, unknown>;
  const access = typeof tokenData.access === "string" ? tokenData.access : undefined;
  const refresh = typeof tokenData.refresh === "string" ? tokenData.refresh : undefined;
  if (!access) return { body: payload };
  const safeData = { ...tokenData };
  delete safeData.access;
  delete safeData.refresh;
  return { body: { ...outer, data: safeData }, access, refresh };
}

/**
 * The browser's IP as seen by the hosting proxy. Render appends the connecting
 * address as the last X-Forwarded-For entry; earlier entries are client-supplied.
 */
function clientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  const last = forwarded?.split(",").map((part) => part.trim()).filter(Boolean).pop();
  return last || request.headers.get("x-real-ip");
}

/**
 * Lets Django apply per-IP sign-in limits and record the real client address in
 * the audit trail. Sent only with the shared BFF_PROXY_SECRET so a direct caller
 * cannot choose its own IP.
 */
function setProxyIdentity(request: NextRequest, headers: Headers): void {
  const secret = process.env.BFF_PROXY_SECRET;
  const ip = clientIp(request);
  if (!secret || !ip) return;
  headers.set("x-ergonx-proxy-secret", secret);
  headers.set("x-ergonx-client-ip", ip);
}

/** Server-side sign-out: blacklist the refresh token so it cannot mint new access tokens. */
async function revokeRefreshToken(request: NextRequest): Promise<void> {
  const refresh = request.cookies.get(REFRESH_COOKIE)?.value;
  if (!refresh) return;
  const headers = new Headers({ "content-type": "application/json", accept: "application/json" });
  setProxyIdentity(request, headers);
  try {
    await fetch(`${backendOrigin()}${API_PREFIX}auth/logout/`, { method: "POST", headers, body: JSON.stringify({ refresh }), cache: "no-store" });
  } catch {
    // The cookies are cleared regardless; an unreachable API only leaves the token to expire.
  }
}

export async function handler(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { path } = await context.params;
  const route = path.join("/");

  if (UNSAFE_METHODS.has(request.method)) {
    const origin = request.headers.get("origin");
    if (origin) {
      try {
        const originUrl = new URL(origin);
        // Standalone Next may use an internal localhost origin while retaining
        // the browser's Host header. Compare the externally requested host,
        // including a reverse proxy's forwarded host, rather than that
        // internal origin string.
        const expectedHost = request.headers.get("x-forwarded-host") || request.headers.get("host");
        if (!expectedHost || originUrl.host !== expectedHost) {
          return jsonResponse({ success: false, message: "Cross-origin requests are not accepted.", code: "csrf_failed" }, 403);
        }
      } catch {
        return jsonResponse({ success: false, message: "Cross-origin requests are not accepted.", code: "csrf_failed" }, 403);
      }
    }
  }

  if (route === "auth/logout" && request.method === "POST") {
    await revokeRefreshToken(request);
    return clearSession(request, jsonResponse({ success: true, data: { logged_out: true } }, 200));
  }

  // Accepting an Institution Admin invitation creates the account and returns
  // its token pair, so it signs the browser in exactly like auth/login.
  const isInvitationAcceptance = request.method === "POST" && /^auth\/institution-admin-invitations\/[^/]+$/.test(route);

  const headers = new Headers();
  // user-agent lets the API name each signed-in session ("Chrome on Windows").
  const acceptedHeaders = ["accept", "content-type", "x-institution-id", "user-agent"];
  for (const name of acceptedHeaders) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("accept", headers.get("accept") || "application/json");
  setProxyIdentity(request, headers);

  // The acceptance is anonymous; a stale or expired cookie from an earlier
  // session must not be sent, or JWT authentication rejects the request.
  const access = isInvitationAcceptance ? undefined : request.cookies.get(ACCESS_COOKIE)?.value;
  if (access) headers.set("authorization", `Bearer ${access}`);

  let body: BodyInit | undefined;
  let remember = !isInvitationAcceptance && request.cookies.get(REMEMBER_COOKIE)?.value === "1";
  if (!["GET", "HEAD"].includes(request.method)) {
    if (route === "auth/login") {
      // "Keep me signed in" only decides cookie lifetimes here; the API never sees it.
      const raw = await request.text();
      try {
        const credentials = JSON.parse(raw) as Record<string, unknown>;
        remember = credentials.remember === true;
        delete credentials.remember;
        body = JSON.stringify(credentials);
      } catch {
        remember = false;
        body = raw;
      }
    } else if (route === "auth/profile/password") {
      // A password change signs out every other session; naming this session's
      // refresh token keeps the browser that made the change signed in.
      const raw = await request.text();
      const refresh = request.cookies.get(REFRESH_COOKIE)?.value;
      try {
        const payload = JSON.parse(raw) as Record<string, unknown>;
        delete payload.current_refresh;
        if (refresh) payload.current_refresh = refresh;
        body = JSON.stringify(payload);
      } catch {
        body = raw;
      }
    } else if (route === "auth/refresh") {
      const refresh = request.cookies.get(REFRESH_COOKIE)?.value;
      body = JSON.stringify(refresh ? { refresh } : {});
      headers.set("content-type", "application/json");
    } else {
      body = await request.arrayBuffer();
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${backendOrigin()}${API_PREFIX}${route}/${request.nextUrl.search}`, {
      method: request.method,
      headers,
      body,
      cache: "no-store",
    });
  } catch {
    return jsonResponse({ success: false, message: "The server could not be reached.", code: "network_error" }, 503);
  }

  const responseHeaders = new Headers();
  for (const name of ["content-type", "content-disposition"]) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  responseHeaders.set("Cache-Control", "no-store");

  const isTokenRoute = route === "auth/login" || route === "auth/refresh" || isInvitationAcceptance;
  if (isTokenRoute && upstream.headers.get("content-type")?.includes("application/json")) {
    const tokenResult = safeAuthPayload(await upstream.json());
    const response = NextResponse.json(tokenResult.body, { status: upstream.status, headers: responseHeaders });
    return tokenResult.access ? establishSession(request, response, tokenResult.access, tokenResult.refresh, remember) : response;
  }

  return new NextResponse(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
