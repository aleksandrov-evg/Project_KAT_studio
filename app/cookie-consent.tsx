"use client";

import { useEffect, useState } from "react";
import { injectMetrikaScript } from "../lib/metrika";
import { YandexMetrikaGoals } from "./yandex-metrika";

export const CONSENT_KEY = "katfit-cookie-consent";
export const OPEN_SETTINGS_EVENT = "katfit:open-cookie-settings";
export const CONSENT_CHANGED_EVENT = "katfit:cookie-consent-changed";

export type CookieConsentValue = "accepted" | "rejected";
export type Consent = CookieConsentValue | null;

export function getCookieConsent(): Consent {
  if (typeof window === "undefined") return null;
  const value = window.localStorage.getItem(CONSENT_KEY);
  return value === "accepted" || value === "rejected" ? value : null;
}

export function setCookieConsent(value: CookieConsentValue) {
  window.localStorage.setItem(CONSENT_KEY, value);
  window.dispatchEvent(new CustomEvent(CONSENT_CHANGED_EVENT, { detail: value }));
}

function YandexMetrika() {
  useEffect(() => {
    injectMetrikaScript();
  }, []);

  return <YandexMetrikaGoals />;
}

export function CookieConsent() {
  const [consent, setConsent] = useState<Consent>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setConsent(getCookieConsent());
    setReady(true);

    const openSettings = () => setConsent(null);
    const onConsentChanged = (event: Event) => {
      const detail = (event as CustomEvent<CookieConsentValue>).detail;
      if (detail === "accepted" || detail === "rejected") setConsent(detail);
      else setConsent(getCookieConsent());
    };

    window.addEventListener(OPEN_SETTINGS_EVENT, openSettings);
    window.addEventListener(CONSENT_CHANGED_EVENT, onConsentChanged);
    return () => {
      window.removeEventListener(OPEN_SETTINGS_EVENT, openSettings);
      window.removeEventListener(CONSENT_CHANGED_EVENT, onConsentChanged);
    };
  }, []);

  function choose(value: CookieConsentValue) {
    setCookieConsent(value);
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
