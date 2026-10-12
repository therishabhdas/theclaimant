"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "../../lib/supabase/client";

function getSafeNextPath(value: string | null) {
  if (!value?.startsWith("/")) {
    return "/account";
  }

  const destination = new URL(value, window.location.origin);
  return destination.origin === window.location.origin
    ? `${destination.pathname}${destination.search}${destination.hash}`
    : "/account";
}

function AuthFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const nextPath = getSafeNextPath(searchParams.get("next"));
  const authError = searchParams.get("error");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage("");
    setIsError(false);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email")).trim();
    const password = String(formData.get("password"));
    const supabase = createClient();

    const result =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: {
              emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`,
            },
          });

    setIsSubmitting(false);

    if (result.error) {
      setIsError(true);
      setMessage(result.error.message);
      return;
    }

    if (mode === "signup" && !result.data.session) {
      setMessage("Check your email for a confirmation link to finish creating your account.");
      return;
    }

    router.replace(nextPath);
    router.refresh();
  }

  const authErrorMessage =
    authError === "callback"
      ? "That confirmation link could not be verified. Request a new sign-up link and try again."
      : authError === "signout"
        ? "You could not be signed out. Please try again."
        : "";

  return (
    <section className="auth-page">
      <div className="auth-card">
        <p className="eyebrow"><span />A PLACE IN THE REALM</p>
        <h1>{mode === "signin" ? "Welcome back." : "Join the chronicle."}</h1>
        <p className="auth-intro">
          {mode === "signin"
            ? "Sign in with your email address and password."
            : "Create an account with your email address and a password."}
        </p>

        {authErrorMessage && (
          <p className="auth-message auth-message-error" role="alert">
            {authErrorMessage}
          </p>
        )}

        <form className="auth-form" onSubmit={handleSubmit}>
          <label htmlFor="auth-email">Email address</label>
          <input
            autoComplete="email"
            id="auth-email"
            name="email"
            required
            type="email"
          />

          <label htmlFor="auth-password">Password</label>
          <input
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            id="auth-password"
            minLength={6}
            name="password"
            required
            type="password"
          />

          {message && (
            <p
              className={`auth-message${isError ? " auth-message-error" : ""}`}
              role={isError ? "alert" : "status"}
            >
              {message}
            </p>
          )}

          <button className="button-primary auth-submit" disabled={isSubmitting} type="submit">
            {isSubmitting
              ? "Please wait…"
              : mode === "signin"
                ? "Sign in"
                : "Create account"}
            <span aria-hidden="true">↗</span>
          </button>
        </form>

        <p className="auth-switch">
          {mode === "signin" ? "New to the chronicle?" : "Already have an account?"}{" "}
          <button
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setMessage("");
              setIsError(false);
            }}
            type="button"
          >
            {mode === "signin" ? "Create an account" : "Sign in"}
          </button>
        </p>
        <Link className="auth-back" href="/">Return to the opening</Link>
      </div>
    </section>
  );
}

export default function AuthForm() {
  return (
    <Suspense
      fallback={
        <section className="auth-page">
          <div className="auth-card">Preparing sign in…</div>
        </section>
      }
    >
      <AuthFormContent />
    </Suspense>
  );
}
