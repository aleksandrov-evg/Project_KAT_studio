"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { reachGoal } from "../lib/metrika";

type Status = "idle" | "success" | "error";
type FieldName = "name" | "contact" | "personalDataConsent";
type FieldErrors = Partial<Record<FieldName, string>>;

function validateLead(data: FormData): FieldErrors {
  const name = String(data.get("name") ?? "").trim();
  const contact = String(data.get("contact") ?? "").trim();
  const phoneDigits = contact.replace(/\D/g, "");
  const errors: FieldErrors = {};
  if (!/^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё\s-]{1,}$/.test(name)) errors.name = "Укажите имя — не менее 2 букв.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) && !(phoneDigits.length >= 10 && phoneDigits.length <= 15)) errors.contact = "Укажите корректный телефон или e-mail.";
  if (data.get("personalDataConsent") !== "on") errors.personalDataConsent = "Подтвердите согласие на обработку персональных данных.";
  return errors;
}

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [menuOpen, setMenuOpen] = useState(false);
  const [mapsOpen, setMapsOpen] = useState(false);
  const mapsCloseRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!mapsOpen && !menuOpen) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (mapsOpen) {
        setMapsOpen(false);
        return;
      }
      if (menuOpen) setMenuOpen(false);
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mapsOpen, menuOpen]);

  useEffect(() => {
    if (!mapsOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    mapsCloseRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mapsOpen]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("idle");
    const form = event.currentTarget;
    const data = new FormData(form);
    const clientErrors = validateLead(data);
    if (Object.keys(clientErrors).length) {
      setErrors(clientErrors);
      setStatus("error");
      setMessage("Проверьте поля, отмеченные красным.");
      return;
    }
    try {
      const response = await fetch("/api/leads", { method: "POST", body: data });
      const body = await response.json();
      if (response.ok) {
        form.reset(); setErrors({}); setStatus("success"); setMessage(body.message);
        reachGoal("lead_submit");
      } else {
        setErrors(body.errors ?? {}); setStatus("error"); setMessage(body.message ?? "Не удалось отправить форму. Попробуйте ещё раз.");
      }
    } catch {
      setStatus("error"); setMessage("Не удалось отправить форму. Проверьте подключение и попробуйте ещё раз.");
    }
  }

  function clearFieldError(event: React.ChangeEvent<HTMLInputElement>) {
    const field = event.currentTarget.name as FieldName;
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
  }

  const closeMenu = () => setMenuOpen(false);

  const logo = (
    <a className="logo" href="#top" aria-label="KATFIT BALANCE">
      <img src="/images/katfit-cat.svg" alt="" width={32} height={32} />
      <span>KATFIT</span>
      <span>BALANCE</span>
    </a>
  );

  return <main>
    <header className={`header container${menuOpen ? " header--menu-open" : ""}`}>
      {logo}
      <button className="menu-button" type="button" aria-label={menuOpen ? "Закрыть меню" : "Открыть меню"} aria-expanded={menuOpen} aria-controls="main-navigation" onClick={() => setMenuOpen((open) => !open)}><span /><span /><span /></button>
      <nav id="main-navigation" className={menuOpen ? "nav nav--open" : "nav"} aria-label="Основная навигация">
        <a href="#about" onClick={closeMenu}>О студии</a>
        <a href="#directions" onClick={closeMenu}>Направления</a>
        <a href="#opening" onClick={closeMenu}>Открытие</a>
        <a href="#location" onClick={closeMenu}>Мы рядом</a>
        <a className="nav__cta button button--small" href="#opening" onClick={closeMenu}>Узнать об открытии</a>
      </nav>
      <a className="button button--small header__cta" href="#opening">Узнать об открытии</a>
    </header>

    <section className="hero container" id="top">
      <div className="hero__copy">
        <p className="eyebrow">СКОРО ОТКРЫТИЕ</p>
        <h1>Больше движения.<br />Ближе к себе.</h1>
        <p className="lead">Камерная студия реформера, пилатеса и стрейчинга. Пространство, где можно замедлиться и почувствовать своё тело.</p>
        <a className="button" href="#opening">Узнать об открытии <span>↗</span></a>
        <p className="caption">Оставьте контакт — пригласим, когда всё будет готово.</p>
      </div>
      <div className="hero__media">
        <Image src="/images/generated-1789461263769.png" alt="Занятие на реформере в светлой студии" width={568} height={568} priority sizes="(max-width: 768px) 100vw, 568px" />
        <p>ДВИЖЕНИЕ В СВОЁМ РИТМЕ</p>
      </div>
    </section>

    <section className="about" id="about"><div className="container">
      <div className="about__intro"><h2>Место, где<br />вам хорошо</h2><div><p>Мы создаём студию с вниманием к простым вещам: свету, пространству и тому, как вы чувствуете себя на занятии.</p><p className="hand">Без гонки за результатом.<br />С интересом к движению.</p></div></div>
      <div className="principles">{[["01", "В своём темпе", "Начните с комфортной нагрузки и двигайтесь постепенно."], ["02", "С вниманием к вам", "Техника, понятные объяснения и поддержка на занятиях."], ["03", "Для себя", "Время, чтобы переключиться с повседневных дел на движение."]].map(([n, title, text]) => <article key={n}><span>{n}</span><h3>{title}</h3><p>{text}</p></article>)}</div>
    </div></section>

    <section className="directions" id="directions"><div className="container">
      <div className="section-heading"><h2>Найдите<br />своё движение</h2><p>Три направления. Один подход —<br />бережное внимание к телу.</p></div>
      <div className="direction-grid">{[
        ["01", "Пилатес", "Упражнения на коврике с вниманием к дыханию, устойчивости и координации.", "generated-1789461307080.png"],
        ["02", "Стрейчинг", "Мягкая работа над гибкостью и подвижностью. Возможность замедлиться и снять повседневное напряжение.", "generated-1789461307602.png"],
        ["03", "Реформер", "Работа с сопротивлением на специальном оборудовании. Сила, контроль и точность движения.", "generated-1789461308072.png"]
      ].map(([n, title, text, image]) => (
        <article className="direction" key={n}>
          <Image src={`/images/${image}`} alt={`Занятие: ${title}`} width={400} height={300} sizes="(max-width: 768px) 100vw, 33vw" />
          <p className="number">{n}</p>
          <h3>{title}</h3>
          <p>{text}</p>
        </article>
      ))}</div>
    </div></section>

    <section className="location" id="location"><div className="container location__inner">
      <div className="location__copy">
        <h2>Мы рядом</h2>
        <p className="location__lead">В центре Королёва — удобно заглянуть на тренировку по пути домой или в выходной.</p>
        <div className="location__address">
          <span className="location__pin" aria-hidden="true">⌖</span>
          <address><strong>ТЦ «Гелиос» · Проспект Космонавтов, 20а</strong><span>338 офис · 3 этаж</span><span>Королёв, Московская область</span></address>
        </div>
        <button className="button" type="button" onClick={() => setMapsOpen(true)}>Построить маршрут <span aria-hidden="true">↗</span></button>
      </div>
      <button className="location__map" type="button" onClick={() => setMapsOpen(true)} aria-label="Выбрать приложение для построения маршрута к студии">
        <span className="location__map-image"><Image src="/images/studio-map.webp" alt="Карта расположения студии на проспекте Космонавтов, 20а в Королёве" fill sizes="(max-width: 768px) 100vw, 620px" /></span>
      </button>
    </div></section>

    <section className="opening" id="opening"><div className="container opening__inner">
      <div className="opening__copy"><h2>Скоро встретимся</h2><p className="opening__lead">Готовим пространство<br />для ваших новых привычек.</p><p>Студия на этапе запуска. Дату открытия и подробности сообщим, когда всё будет готово.</p></div>
      <form className="lead-form" onSubmit={submit} noValidate>
        <h2>Узнайте об открытии первыми</h2><p>Оставьте имя и удобный контакт для приглашения. Выберите интересующий формат — это поможет нам подготовить стартовую сетку. Выбор не является записью на занятие.</p>
        <div className="lead-form__contacts"><label className={errors.name ? "field field--error" : "field"}>Ваше имя<input name="name" required autoComplete="name" placeholder="Как к вам обращаться" aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "name-error" : undefined} onChange={clearFieldError} />{errors.name && <span className="field-error" id="name-error">{errors.name}</span>}</label>
        <label className={errors.contact ? "field field--error" : "field"}>Телефон или e-mail<input name="contact" required autoComplete="email" placeholder="+7 или name@example.ru" aria-invalid={Boolean(errors.contact)} aria-describedby={errors.contact ? "contact-error" : undefined} onChange={clearFieldError} />{errors.contact && <span className="field-error" id="contact-error">{errors.contact}</span>}</label></div>
        <fieldset className="interest-field"><legend>Что вам интересно?</legend><p>Можно выбрать несколько вариантов.</p><div className="interest-field__options"><label><span>Пилатес на реформере</span><input type="checkbox" name="interests" value="reformer" /></label><label><span>Классический пилатес</span><input type="checkbox" name="interests" value="pilates" /></label><label><span>Стрейчинг</span><input type="checkbox" name="interests" value="stretching" /></label><label><span>Персональные занятия</span><input type="checkbox" name="interests" value="personal" /></label><label><span>Пока не знаю — хочу подобрать формат</span><input type="checkbox" name="interests" value="undecided" /></label></div></fieldset>
        <label className={errors.personalDataConsent ? "consent consent--error" : "consent"}><input type="checkbox" name="personalDataConsent" required aria-invalid={Boolean(errors.personalDataConsent)} aria-describedby={errors.personalDataConsent ? "personal-data-consent-error" : undefined} onChange={clearFieldError} /><span>Даю согласие на обработку моих персональных данных в соответствии с <a href="/privacy-policy">Политикой обработки персональных данных</a>.{errors.personalDataConsent && <span className="field-error" id="personal-data-consent-error">{errors.personalDataConsent}</span>}</span></label>
        <label className="consent"><input type="checkbox" name="marketingConsent" /><span>Я даю согласие ИП Александровой Екатерине Михайловне на получение информационных и рекламных уведомлений об открытии студии, занятиях, специальных условиях и предложениях по указанному контакту. Это необязательно. <a href="/notification-consent">Условия согласия на уведомления</a>.</span></label>
        <button className="button" type="submit">Сообщить мне об открытии</button>
        {status !== "idle" && <p className={`form-status form-status--${status}`} role={status === "error" ? "alert" : "status"}>{message}</p>}
      </form>
    </div></section>
    <footer><div className="container footer">{logo}<div><h2>Будем ближе. Скоро.</h2><p>ТЦ «Гелиос» · Проспект Космонавтов, 20а<br />338 офис · 3 этаж · Королёв</p></div><small>Реформер · Пилатес · Стрейчинг<br /><a href="/privacy-policy">Политика обработки персональных данных</a></small></div></footer>
    {mapsOpen && <div className="maps-dialog" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setMapsOpen(false); }}>
      <div className="maps-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="maps-dialog-title">
        <div className="maps-dialog__header"><h2 id="maps-dialog-title">Открыть маршрут</h2><button ref={mapsCloseRef} type="button" onClick={() => setMapsOpen(false)} aria-label="Закрыть выбор карт">×</button></div>
        <p>Выберите удобное приложение. На телефоне маршрут откроется в установленной версии сервиса.</p>
        <div className="maps-dialog__links">
          <a href="https://yandex.ru/maps/?text=%D0%A2%D0%A6%20%D0%93%D0%B5%D0%BB%D0%B8%D0%BE%D1%81%2C%20%D0%9F%D1%80%D0%BE%D1%81%D0%BF%D0%B5%D0%BA%D1%82%20%D0%9A%D0%BE%D1%81%D0%BC%D0%BE%D0%BD%D0%B0%D0%B2%D1%82%D0%BE%D0%B2%2C%2020%D0%B0%2C%20%D0%9A%D0%BE%D1%80%D0%BE%D0%BB%D1%91%D0%B2">Яндекс Карты <span>↗</span></a>
          <a href="https://www.google.com/maps/search/?api=1&amp;query=%D0%A2%D0%A6%20%D0%93%D0%B5%D0%BB%D0%B8%D0%BE%D1%81%2C%20%D0%9F%D1%80%D0%BE%D1%81%D0%BF%D0%B5%D0%BA%D1%82%20%D0%9A%D0%BE%D1%81%D0%BC%D0%BE%D0%BD%D0%B0%D0%B2%D1%82%D0%BE%D0%B2%2C%2020%D0%B0%2C%20%D0%9A%D0%BE%D1%80%D0%BE%D0%BB%D1%91%D0%B2">Google Maps <span>↗</span></a>
          <a href="https://maps.apple.com/?q=%D0%A2%D0%A6%20%D0%93%D0%B5%D0%BB%D0%B8%D0%BE%D1%81%2C%20%D0%9F%D1%80%D0%BE%D1%81%D0%BF%D0%B5%D0%BA%D1%82%20%D0%9A%D0%BE%D1%81%D0%BC%D0%BE%D0%BD%D0%B0%D0%B2%D1%82%D0%BE%D0%B2%2C%2020%D0%B0%2C%20%D0%9A%D0%BE%D1%80%D0%BE%D0%BB%D1%91%D0%B2">Apple Maps <span>↗</span></a>
        </div>
      </div>
    </div>}
  </main>;
}
