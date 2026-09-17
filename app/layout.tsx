import type { Metadata } from "next";
import { Caveat, Montserrat } from "next/font/google";
import { YandexMetrikaGoals } from "./yandex-metrika";
import { METRIKA_ID, METRIKA_INIT_SCRIPT } from "../lib/metrika";
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
      <head>
        <script id="yandex-metrika" dangerouslySetInnerHTML={{ __html: METRIKA_INIT_SCRIPT }} />
      </head>
      <body className={montserrat.className}>
        {children}
        <YandexMetrikaGoals />
        <noscript>
          <div>
            <img src={`https://mc.yandex.ru/watch/${METRIKA_ID}`} style={{ position: "absolute", left: "-9999px" }} alt="" />
          </div>
        </noscript>
      </body>
    </html>
  );
}
