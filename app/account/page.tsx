import type { Metadata } from "next";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signOut } from "../auth/actions";
import { SiteFooter, SiteHeader } from "../components/site-chrome";
import { createClient } from "../../lib/supabase/server";

export const metadata: Metadata = {
  title: "Your account",
  description: "Your account on The Claimant.",
};

async function AccountDetails() {
  const supabase = createClient(await cookies());
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error && error.name !== "AuthSessionMissingError") {
    throw new Error(`Unable to verify the current account: ${error.message}`);
  }

  if (!user) {
    redirect("/auth?next=%2Faccount");
  }

  return (
    <section className="auth-page">
      <div className="auth-card">
        <p className="eyebrow"><span />YOUR PLACE IN THE REALM</p>
        <h1>Your account.</h1>
        <p className="auth-intro">Signed in as {user.email}</p>
        <form action={signOut}>
          <button className="button-primary auth-submit" type="submit">
            Sign out <span aria-hidden="true">↗</span>
          </button>
        </form>
      </div>
    </section>
  );
}

export default function AccountPage() {
  return (
    <main>
      <SiteHeader current="account" />
      <Suspense
        fallback={
          <section className="auth-page">
            <div className="auth-card">Checking your account…</div>
          </section>
        }
      >
        <AccountDetails />
      </Suspense>
      <SiteFooter />
    </main>
  );
}
