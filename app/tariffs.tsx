"use client";

import { useId, useState } from "react";

type TariffTab = "group" | "personal";

type TariffTier = {
  name: string;
  perSession: string;
  formula: string;
  total: string;
  featured?: boolean;
};

const GROUP_TIERS: TariffTier[] = [
  { name: "Разовое", perSession: "2 500 ₽", formula: "2 500 ₽ × 1", total: "= 2 500 ₽" },
  { name: "Пакет 4", perSession: "2 200 ₽", formula: "2 200 ₽ × 4", total: "= 8 800 ₽" },
  { name: "Пакет 8", perSession: "2 000 ₽", formula: "2 000 ₽ × 8", total: "= 16 000 ₽", featured: true },
];

const PERSONAL_TIERS: TariffTier[] = [
  { name: "Разовое", perSession: "4 000 ₽", formula: "4 000 ₽ × 1", total: "= 4 000 ₽" },
  { name: "Блок 8", perSession: "3 500 ₽", formula: "3 500 ₽ × 8", total: "= 28 000 ₽", featured: true },
];

export function TariffsSection() {
  const [tab, setTab] = useState<TariffTab>("group");
  const tabsId = useId();
  const tiers = tab === "group" ? GROUP_TIERS : PERSONAL_TIERS;

  return (
    <section className="tariffs" id="tariffs" aria-labelledby={`${tabsId}-title`}>
      <div className="container">
        <div className="tariffs__header">
          <h2 id={`${tabsId}-title`}>Тарифы</h2>
          <div className="tariffs__tabs" role="tablist" aria-label="Тип занятий">
            <button
              type="button"
              role="tab"
              id={`${tabsId}-group`}
              aria-selected={tab === "group"}
              aria-controls={`${tabsId}-panel`}
              className={tab === "group" ? "tariffs__tab tariffs__tab--active" : "tariffs__tab"}
              onClick={() => setTab("group")}
            >
              Групповые
            </button>
            <button
              type="button"
              role="tab"
              id={`${tabsId}-personal`}
              aria-selected={tab === "personal"}
              aria-controls={`${tabsId}-panel`}
              className={tab === "personal" ? "tariffs__tab tariffs__tab--active" : "tariffs__tab"}
              onClick={() => setTab("personal")}
            >
              Персональные
            </button>
          </div>
        </div>

        <div
          className="tariffs__panel"
          role="tabpanel"
          id={`${tabsId}-panel`}
          aria-labelledby={tab === "group" ? `${tabsId}-group` : `${tabsId}-personal`}
        >
          <div className={`tariffs__scale tariffs__scale--${tiers.length}`}>
            <div className="tariffs__prices" aria-hidden="true">
              {tiers.map((tier) => (
                <div
                  key={`${tab}-price-${tier.name}`}
                  className={tier.featured ? "tariffs__price tariffs__price--featured" : "tariffs__price"}
                >
                  <strong>{tier.perSession}</strong>
                  <span>за тренировку</span>
                </div>
              ))}
            </div>

            <div className="tariffs__track" aria-hidden="true">
              <div className="tariffs__dots">
                {tiers.map((tier) => (
                  <span
                    key={`${tab}-dot-${tier.name}`}
                    className={tier.featured ? "tariffs__dot tariffs__dot--featured" : "tariffs__dot"}
                  />
                ))}
              </div>
              <div className="tariffs__bar" />
            </div>

            <ul className="tariffs__cards">
              {tiers.map((tier) => (
                <li
                  key={`${tab}-card-${tier.name}`}
                  className={tier.featured ? "tariffs__card tariffs__card--featured" : "tariffs__card"}
                >
                  <p className="tariffs__card-name">{tier.name}</p>
                  <p className="tariffs__card-price">
                    <strong>{tier.perSession}</strong>
                    <span>за тренировку</span>
                  </p>
                  <p className="tariffs__card-formula">{tier.formula}</p>
                  <p className="tariffs__card-total">{tier.total}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
