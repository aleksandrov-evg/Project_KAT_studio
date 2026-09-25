"use client";

import { useEffect, useState } from "react";
import { METRIKA_INIT_SCRIPT } from "../lib/metrika";
import { YandexMetrikaGoals } from "./yandex-metrika";

const CONSENT_KEY = "katfit-cookie-consent";
const OPEN_SETTINGS_EVENT = "katfit:open-cookie-settings";
type Consent = "accepted" | "rejected" | null;

function getConsent(): Consent {
  const value = window.localStorage.getItem(CONSENT_KEY);
  return value === "accepted" || value === "rejected" ? value : null;
}

function YandexMetrika() {
  useEffect(() => {
    if (document.getElementById("yandex-metrika")) return;
    const script = document.createElement("script");
    script.id = "yandex-metrika";
    script.text = METRIKA_INIT_SCRIPT;
    document.head.appendChild(script);
  }, []);

  return <YandexMetrikaGoals />;
}

export function CookieConsent() {
  const [consent, setConsent] = useState<Consent>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setConsent(getConsent());
    setReady(true);
    const openSettings = () => setConsent(null);
    window.addEventListener(OPEN_SETTINGS_EVENT, openSettings);
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, openSettings);
  }, []);

  function choose(value: Exclude<Consent, null>) {
    window.localStorage.setItem(CONSENT_KEY, value);
    setConsent(value);
  }

  return <>
    {consent === "accepted" && <YandexMetrika />}
    {ready && consent === null && <aside className="cookie-consent" aria-labelledby="cookie-consent-title" role="dialog">
      <div><h2 id="cookie-consent-title">Файлы cookie</h2><p>Мы используем аналитические cookie Яндекс.Метрики, чтобы понимать, как посетители пользуются сайтом. Они включаются только с вашего согласия. Подробнее — в <a href="/privacy-policy#cookies">Политике обработки персональных данных</a>.</p></div>
      <div className="cookie-consent__actions"><button className="button button--small" type="button" onClick={() => choose("accepted")}>Принять</button><button className="button button--small button--outline" type="button" onClick={() => choose("rejected")}>Не принимать</button></div>
    </aside>}
  </>;
}

export function CookieSettingsButton() {
  return <button className="cookie-settings" type="button" onClick={() => window.dispatchEvent(new Event(OPEN_SETTINGS_EVENT))}>Настройки cookie</button>;
}
