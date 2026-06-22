import Link from "next/link";
import { demoEndpoints } from "@/lib/demo-catalogue";
import { Logo } from "../components/Logo";
import { ThemeToggle } from "../components/ThemeToggle";
import { DemoConsole } from "./DemoConsole";

export const metadata = {
  title: "SDK Demo",
  description: "A small SELAT Router SDK demo for routing catalogue endpoints through paid rails."
};

export default function DemoPage() {
  return (
    <main>
      <div className="chart-frame" />
      <div className="shell">
        <header className="topbar">
          <Link href="/demo" className="brand" aria-label="ETH Market Brief demo">
            <Logo />
          </Link>
          <nav>
            <Link href="/demo">SDK Demo</Link>
          </nav>
          <ThemeToggle />
        </header>

        <section className="subpage demo-page">
          <aside>Router SDK // Mission console</aside>
          <h1>Build an ETH market brief across paid API rails.</h1>
          <p>
            A treasury analyst agent needs a current view before adjusting ETH exposure. It uses Agentic Market for
            web research and market quotes, then MPP for smart-money flow and delivery. The SDK call stays server-side,
            so signer material never reaches the browser.
          </p>
          <div className="demo-mission-strip" aria-label="Demo mission summary">
            <span>Asset: ETH</span>
            <span>Rails: x402 + MPP</span>
            <span>Budget: about 0.09 USDC</span>
            <span>Output: analyst memo</span>
          </div>
        </section>

        <DemoConsole endpoints={demoEndpoints} />
      </div>
    </main>
  );
}
