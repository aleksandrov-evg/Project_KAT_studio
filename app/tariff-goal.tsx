"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { CONSENT_CHANGED_EVENT, getCookieConsent } from "./cookie-consent";
import { getMetrikaClientId, reachGoal } from "../lib/metrika";

export function TariffGoal() {
  const pathname = usePathname();
  const submitted = useRef(false);

  useEffect(() => {
    if (pathname !== "/") return;
    const target = document.getElementById("tariffs");
    if (!target || !("IntersectionObserver" in window)) return;
    // Keep the original advertising landing URL across consent changes.
    const landing = window.location.href;
    let timer: number | undefined;
    let visible = false;
    let stopped = false;
    let checking = false;

    async function send() {
      if (submitted.current || checking || stopped) return;
      checking = true;
      const consent = getCookieConsent();
      try {
        const response = await fetch(`/api/analytics/tariffs?consent=${consent ?? "unset"}`, {
          headers: { "X-Analytics-Request": "1" }, cache: "no-store",
        });
        if (!response.ok) return;
        const config = await response.json();
        if (stopped) return;
        if (!config.enabled) {
          if (consent === "accepted" && getCookieConsent() === "accepted") {
            submitted.current = true;
            reachGoal("tariffs_view");
          }
          return;
        }
        if (!config.allowed || typeof config.ticket !== "string") return;
        const cid = consent === "accepted" ? await getMetrikaClientId() : null;
        if (stopped || consent !== getCookieConsent()) return;
        // A single owner sends this goal. Never fall back to browser reachGoal
        // after POST: a timeout may mean Yandex accepted the event already.
        submitted.current = true;
        await fetch("/api/analytics/tariffs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticket: config.ticket, landing, consent, cid }),
          keepalive: true,
        });
      } catch { /* Analytics must never interrupt the page. */ }
      finally { checking = false; }
    }

    function cancelTimer() {
      window.clearTimeout(timer);
      timer = undefined;
    }
    function schedule() {
      cancelTimer();
      if (visible && document.visibilityState === "visible" && !submitted.current) {
        timer = window.setTimeout(() => void send(), 3000);
      }
    }
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      // On short screens, require half of the available viewport rather than
      // half of a section that may be taller than the entire viewport.
      const nextVisible = entry.isIntersecting && entry.intersectionRect.height >= Math.min(entry.boundingClientRect.height, window.innerHeight) * 0.5;
      if (nextVisible !== visible) {
        visible = nextVisible;
        schedule();
      }
    }, { threshold: Array.from({ length: 101 }, (_, index) => index / 100) });
    observer.observe(target);
    document.addEventListener("visibilitychange", schedule);
    window.addEventListener(CONSENT_CHANGED_EVENT, schedule);
    return () => {
      stopped = true;
      cancelTimer();
      observer.disconnect();
      document.removeEventListener("visibilitychange", schedule);
      window.removeEventListener(CONSENT_CHANGED_EVENT, schedule);
    };
  }, [pathname]);

  return null;
}
