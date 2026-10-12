import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../components/site-chrome";
import AuthForm from "./auth-form";

export const metadata: Metadata = {
  title: "Sign in or create an account",
  description: "Sign in or create an account for The Claimant.",
};

export default function AuthPage() {
  return (
    <main>
      <SiteHeader current="account" />
      <AuthForm />
      <SiteFooter />
    </main>
  );
}
