import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClipNote — Video notes, made simple",
  description: "Turn lectures, tutorials, and conversations into clear notes.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
