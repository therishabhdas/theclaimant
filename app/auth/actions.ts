"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "../../lib/supabase/server";

export async function signOut() {
  const supabase = createClient(await cookies());
  const { error } = await supabase.auth.signOut();

  if (error) {
    console.error("Unable to sign out from Supabase:", error.message);
    redirect("/auth?error=signout");
  }

  redirect("/");
}
