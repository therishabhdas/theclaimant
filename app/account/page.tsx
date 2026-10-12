import type { Metadata } from "next";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signOut } from "../auth/actions";
import { SiteFooter, SiteHeader } from "../components/site-chrome";
import CharacterDraw from "./character-draw";
import {
  getAssignedCharacter,
  type AssignedCharacter,
} from "../../lib/character-assignment";
import { createClient } from "../../lib/supabase/server";

export const metadata: Metadata = {
  title: "Your account",
  description: "Draw and keep your character in The Claimant.",
};

async function AccountDetails() {
  const supabase = createClient(await cookies());
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError && userError.name !== "AuthSessionMissingError") {
    throw new Error(`Unable to verify the current account: ${userError.message}`);
  }

  if (!user) {
    redirect("/auth?next=%2Faccount");
  }

  const { data: assignment, error: assignmentError } = await supabase
    .from("user_character_assignments")
    .select("character_id")
    .eq("user_id", user.id)
    .maybeSingle();

  let assignedCharacter: AssignedCharacter | null = null;
  let assignmentErrorMessage: string | null = null;
  let assignmentSetupError: string | null = null;

  if (assignmentError) {
    console.error("Unable to load the user's character assignment:", assignmentError.message);
    assignmentSetupError = "The character assignment database setup is not available.";
  } else if (assignment) {
    const result = await getAssignedCharacter(supabase, assignment.character_id);
    assignedCharacter = result.character;
    assignmentErrorMessage = result.error;
  }

  return (
    <>
      <section className="account-intro">
        <p className="eyebrow"><span />YOUR PLACE IN THE REALM</p>
        <h1>Your account.</h1>
        <p>Signed in as <strong>{user.email}</strong></p>
      </section>
      <CharacterDraw
        key={user.id}
        initialCharacter={assignedCharacter}
        setupError={assignmentSetupError}
        initialError={assignmentErrorMessage}
      />
      <section className="account-actions">
        <form action={signOut}>
          <button className="button-outline" type="submit">
            Sign out <span aria-hidden="true">↗</span>
          </button>
        </form>
      </section>
    </>
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
