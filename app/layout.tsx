import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KATFIT BALANCE — скоро открытие",
  description: "Камерная студия реформера, пилатеса и стрейчинга. Узнайте об открытии первыми.",
  icons: { icon: "/images/katfit-cat.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
