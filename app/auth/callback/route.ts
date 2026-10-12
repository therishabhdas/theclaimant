import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "../../../lib/supabase/server";

function safeNextPath(value: string | null, origin: string) {
  if (!value?.startsWith("/")) {
    return "/account";
  }

  const destination = new URL(value, origin);
  return destination.origin === origin
    ? `${destination.pathname}${destination.search}${destination.hash}`
    : "/account";
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(
      new URL("/auth?error=callback", requestUrl.origin),
    );
  }

  const supabase = createClient(await cookies());
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("Unable to complete the Supabase email confirmation:", error.message);
    return NextResponse.redirect(
      new URL("/auth?error=callback", requestUrl.origin),
    );
  }

  return NextResponse.redirect(
    new URL(
      safeNextPath(requestUrl.searchParams.get("next"), requestUrl.origin),
      requestUrl.origin,
    ),
  );
}
