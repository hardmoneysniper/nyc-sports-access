import type { Metadata } from "next";
import "./globals.css";
import { SelectionProvider } from "@/lib/selectionContext";

export const metadata: Metadata = {
  title: "Transit Accessibility Dashboard (prototype)",
  description: "Data-wiring prototype -- not a final design.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <SelectionProvider>
          <main>{children}</main>
        </SelectionProvider>
      </body>
    </html>
  );
}
