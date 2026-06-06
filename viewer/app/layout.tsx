import type { ReactNode } from "react";

export const metadata = {
  title: "Tense — temporal graph viewer",
  description: "Live view of the bi-temporal graph: Current Facts solid, superseded Facts greyed.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
          background: "#f8fafc",
          color: "#0f172a",
        }}
      >
        {children}
      </body>
    </html>
  );
}
