import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "The Claimant | A Chronicle of Power",
    template: "%s | The Claimant",
  },
  description:
    "An original, text-based political RPG about contested succession, divided loyalties, imperfect information, and the cost of rule.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
