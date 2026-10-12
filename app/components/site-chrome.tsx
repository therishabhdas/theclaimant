import { Suspense } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { signOut } from "../auth/actions";
import { createClient } from "../../lib/supabase/server";

function SealMark() {
  return (
    <svg viewBox="0 0 42 42" fill="none" aria-hidden="true">
      <circle cx="21" cy="21" r="18" />
      <path d="M12 27V15l9 8 9-8v12M15 31h12M17 12l4-4 4 4" />
      <circle cx="21" cy="21" r="2" />
    </svg>
  );
}

async function AuthNavigation() {
  const supabase = createClient(await cookies());
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error && error.name !== "AuthSessionMissingError") {
    throw new Error(`Unable to verify the current account: ${error.message}`);
  }

  if (!user) {
    return (
      <Link className="auth-nav-link" href="/auth">
        Sign in <span aria-hidden="true">↗</span>
      </Link>
    );
  }

  return (
    <div className="auth-navigation">
      <Link className="auth-nav-link" href="/account">
        {user.email}
      </Link>
      <form action={signOut}>
        <button className="auth-nav-signout" type="submit">Sign out</button>
      </form>
    </div>
  );
}

export function SiteHeader({ current }: { current: "home" | "about" | "account" }) {
  return (
    <>
      <div className="topline">
        <span>THE SEVEN KINGDOMS</span>
        <span className="topline-center">IN THE AFTERMATH OF KING ROBERT&apos;S DEATH</span>
        <span>A POLITICAL RPG</span>
      </div>
      <header className="site-header">
        <Link className="wordmark" href="/" aria-label="The Claimant home">
          <span className="wordmark-seal"><SealMark /></span>
          <span className="wordmark-type">
            <span className="wordmark-name">THE CLAIMANT</span>
            <span className="wordmark-note">A CHRONICLE OF POWER</span>
          </span>
        </Link>
        <nav className="main-nav" aria-label="Main navigation">
          <Link aria-current={current === "home" ? "page" : undefined} href="/">
            The opening
          </Link>
          <Link aria-current={current === "about" ? "page" : undefined} href="/about">
            About the game
          </Link>
        </nav>
        <div className="header-actions">
          <Link className="header-link" href={current === "about" ? "/#opening" : "/about"}>
            {current === "about" ? "Return to the opening" : "Understand the realm"}
            <span aria-hidden="true">↗</span>
          </Link>
          <Suspense
            fallback={
              <Link className="auth-nav-link" href="/auth">
                Sign in
              </Link>
            }
          >
            <AuthNavigation />
          </Suspense>
        </div>
      </header>
    </>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <Link className="footer-brand" href="/">
        <SealMark />
        <span>THE CLAIMANT</span>
      </Link>
      <span className="footer-note">THE RECORD IS NOT THE WHOLE TRUTH.</span>
      <Link className="footer-about" href="/about">About the game ↗</Link>
    </footer>
  );
}
