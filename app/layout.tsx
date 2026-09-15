import type { Metadata } from "next";
import { YandexMetrikaGoals } from "./yandex-metrika";
import { METRIKA_ID, METRIKA_INIT_SCRIPT } from "../lib/metrika";
import "./globals.css";

export const metadata: Metadata = {
  title: "KATFIT BALANCE — скоро открытие",
  description: "Камерная студия реформера, пилатеса и стрейчинга. Узнайте об открытии первыми.",
  icons: { icon: "/images/katfit-cat.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <head>
        <script id="yandex-metrika" dangerouslySetInnerHTML={{ __html: METRIKA_INIT_SCRIPT }} />
      </head>
      <body>
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
