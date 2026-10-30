import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "PERPDUEL — Long or Short. Beat a Person.",
  description: "1v1 perpetuals duels on dreamDEX. Real testnet orders, live PnL race, proof on-chain.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <a href="/" className="wordmark">PERP<span className="g">DUEL</span></a>
          <span className="topnote">dreamDEX perps · Somnia Hideki testnet · real orders, paper money</span>
        </header>
        <main>{children}</main>
        <footer className="foot">
          Testnet only. Paper USDso — nothing here is real money or financial advice. Every duel settles with real orders on Somnia Hideki (50383); verify each tx on the explorer.
        </footer>
      </body>
    </html>
  );
}
