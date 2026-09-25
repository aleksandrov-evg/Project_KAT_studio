import type { Metadata } from "next";
import { Caveat, Montserrat } from "next/font/google";
import { CookieConsent } from "./cookie-consent";
import "./globals.css";

const montserrat = Montserrat({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-montserrat",
  display: "swap",
});

const caveat = Caveat({
  subsets: ["latin", "cyrillic"],
  weight: ["600"],
  variable: "--font-caveat",
  display: "swap",
});

const title = "KATFIT BALANCE — скоро открытие";
const description = "Камерная студия реформера, пилатеса и стрейчинга. Узнайте об открытии первыми.";
const ogImage = "/images/generated-1789461263769.png";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title,
  description,
  icons: { icon: "/images/katfit-cat.svg" },
  openGraph: {
    title,
    description,
    locale: "ru_RU",
    type: "website",
    images: [{ url: ogImage, alt: "Занятие на реформере в светлой студии KATFIT BALANCE" }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [ogImage],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" className={`${montserrat.variable} ${caveat.variable}`}>
      <body className={montserrat.className}>
        {children}
        <CookieConsent />
      </body>
    </html>
  );
}
