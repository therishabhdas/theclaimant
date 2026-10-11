import Link from "next/link";

function SealMark() {
  return (
    <svg viewBox="0 0 42 42" fill="none" aria-hidden="true">
      <circle cx="21" cy="21" r="18" />
      <path d="M12 27V15l9 8 9-8v12M15 31h12M17 12l4-4 4 4" />
      <circle cx="21" cy="21" r="2" />
    </svg>
  );
}

export function SiteHeader({ current }: { current: "home" | "about" }) {
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
        <Link className="header-link" href={current === "about" ? "/#opening" : "/about"}>
          {current === "about" ? "Return to the opening" : "Understand the realm"}
          <span aria-hidden="true">↗</span>
        </Link>
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
