"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";
export default function LoginPage() {
  const [message, setMessage] = useState("");
  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const response = await fetch(`${apiUrl}/auth/login/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: form.get("email"), password: form.get("password") }) });
    if (!response.ok) return setMessage("Sign-in failed. Check your email and password.");
    const tokens = await response.json(); window.localStorage.setItem("ergonx.accessToken", tokens.access); window.localStorage.setItem("ergonx.refreshToken", tokens.refresh); window.localStorage.setItem("ergonx.institutionId", String(form.get("institutionId") ?? "")); window.location.assign("/");
  }
  return <main className="narrow"><Link href="/">Back to workspaces</Link><h1>Sign in</h1><p>Enter the UUID of the institution you want to work in. It is sent only to the ErgonX API in the tenant selector header.</p><form className="login-form" onSubmit={signIn}><label>Email<input name="email" type="email" required autoComplete="email" /></label><label>Password<input name="password" type="password" required autoComplete="current-password" /></label><label>Institution UUID<input name="institutionId" required /></label><button type="submit">Sign in</button></form>{message && <p className="notice">{message}</p>}</main>;
}
