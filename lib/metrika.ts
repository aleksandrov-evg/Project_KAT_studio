export const METRIKA_ID = 112667422;

export const METRIKA_INIT_SCRIPT = `(function (m, e, t, r, i, k, a) {
  m[i] = m[i] || function () { (m[i].a = m[i].a || []).push(arguments); };
  m[i].l = 1 * new Date();
  for (var j = 0; j < document.scripts.length; j++) {
    if (document.scripts[j].src === r) { return; }
  }
  k = e.createElement(t);
  a = e.getElementsByTagName(t)[0];
  k.async = 1;
  k.src = r;
  a.parentNode.insertBefore(k, a);
})(window, document, "script", "https://mc.yandex.ru/metrika/tag.js?id=${METRIKA_ID}", "ym");
ym(${METRIKA_ID}, "init", {
  ssr: true,
  webvisor: true,
  clickmap: true,
  ecommerce: "dataLayer",
  referrer: document.referrer,
  url: location.href,
  accurateTrackBounce: true,
  trackLinks: true
});`;

type Ym = (id: number, method: string, ...args: unknown[]) => void;

function getYm(): Ym | undefined {
  if (typeof window === "undefined") return undefined;
  const ym = (window as Window & { ym?: Ym }).ym;
  return typeof ym === "function" ? ym : undefined;
}

export function reachGoal(name: string) {
  getYm()?.(METRIKA_ID, "reachGoal", name);
}

export function hit(url: string) {
  getYm()?.(METRIKA_ID, "hit", url);
}
