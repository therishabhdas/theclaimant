import type { Metadata } from "next";
import InspectDashboard from "./inspect-dashboard";

export const metadata: Metadata = {
  title: "System check",
  description: "Private operational diagnostics for The Claimant.",
  robots: { index: false, follow: false },
};

export default function InspectPage() {
  return (
    <main className="inspect-page">
      <InspectDashboard />
    </main>
  );
}
