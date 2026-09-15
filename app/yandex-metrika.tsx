"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { hit, reachGoal } from "../lib/metrika";

export function YandexMetrikaGoals() {
  const pathname = usePathname();
  const isFirstHit = useRef(true);

  useEffect(() => {
    const timer = window.setTimeout(() => reachGoal("engaged_60s"), 60_000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (isFirstHit.current) {
      isFirstHit.current = false;
      return;
    }
    hit(window.location.href);
  }, [pathname]);

  useEffect(() => {
    if (pathname !== "/") return;
    const opening = document.getElementById("opening");
    if (!opening || !("IntersectionObserver" in window)) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        reachGoal("opening_view");
        observer.disconnect();
      },
      { threshold: 0.35 },
    );
    observer.observe(opening);
    return () => observer.disconnect();
  }, [pathname]);

  return null;
}
