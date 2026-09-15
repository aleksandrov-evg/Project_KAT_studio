"use client";

import { FormEvent, useState } from "react";

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

  return <main>
    <header className="header container">
      <a className="logo" href="#top">СТУДИЯ <span>/ ПИЛАТЕС</span></a>
      <button className="menu-button" type="button" aria-label="Открыть меню" aria-expanded={menuOpen} aria-controls="main-navigation" onClick={() => setMenuOpen((open) => !open)}><span /><span /><span /></button>
      <nav id="main-navigation" className={menuOpen ? "nav nav--open" : "nav"} aria-label="Основная навигация"><a href="#about" onClick={() => setMenuOpen(false)}>О студии</a><a href="#directions" onClick={() => setMenuOpen(false)}>Направления</a><a href="#opening" onClick={() => setMenuOpen(false)}>Открытие</a></nav>
      <a className="button button--small" href="#opening">Узнать об открытии</a>
    </header>

    <section className="hero container" id="top">
      <div className="hero__copy">
        <p className="eyebrow">СКОРО ОТКРЫТИЕ</p>
        <h1>Больше движения.<br />Ближе к себе.</h1>
        <p className="lead">Камерная студия реформера, пилатеса и стрейчинга. Пространство, где можно замедлиться и почувствовать своё тело.</p>
        <a className="button" href="#opening">Узнать об открытии <span>↗</span></a>
        <p className="caption">Оставьте контакт — пригласим, когда всё будет готово.</p>
      </div>
      <div className="hero__media"><img src="/images/generated-1789461263769.png" alt="Занятие на реформере в светлой студии" /><p>ДВИЖЕНИЕ В СВОЁМ РИТМЕ</p></div>
    </section>

    <section className="about" id="about"><div className="container">
      <div className="about__intro"><h2>Место, где<br />вам хорошо</h2><div><p>Мы создаём студию с вниманием к простым вещам: свету, пространству и тому, как вы чувствуете себя на занятии.</p><p className="hand">Без гонки за результатом.<br />С интересом к движению.</p></div></div>
      <div className="principles">{[["01", "В своём темпе", "Начните с комфортной нагрузки и двигайтесь постепенно."], ["02", "С вниманием к вам", "Техника, понятные объяснения и поддержка на занятиях."], ["03", "Для себя", "Время, чтобы переключиться с повседневных дел на движение."]].map(([n, title, text]) => <article key={n}><span>{n}</span><h3>{title}</h3><p>{text}</p></article>)}</div>
    </div></section>

    <section className="directions" id="directions"><div className="container">
      <div className="section-heading"><h2>Найдите<br />своё движение</h2><p>Три направления. Один подход —<br />бережное внимание к телу.</p></div>
      <div className="direction-grid">{[
        ["01", "Реформер", "Работа с сопротивлением на специальном оборудовании. Сила, контроль и точность движения.", "generated-1789461307080.png"],
        ["02", "Пилатес", "Упражнения на коврике с вниманием к дыханию, устойчивости и координации.", "generated-1789461307602.png"],
        ["03", "Стрейчинг", "Мягкая работа над гибкостью и подвижностью. Возможность замедлиться и снять повседневное напряжение.", "generated-1789461308072.png"]
      ].map(([n, title, text, image]) => <article className="direction" key={n}><img src={`/images/${image}`} alt="" /><p className="number">{n}</p><h3>{title}</h3><p>{text}</p></article>)}</div>
    </div></section>

    <section className="opening container" id="opening"><div className="opening__copy"><h2>Скоро встретимся</h2><p className="opening__lead">Готовим пространство<br />для ваших новых привычек.</p><p>Студия на этапе запуска. Дату открытия и подробности сообщим, когда всё будет готово.</p></div>
      <form className="lead-form" onSubmit={submit} noValidate>
        <h2>Узнайте об открытии первыми</h2><p>Оставьте имя и удобный контакт для приглашения.</p>
        <label className={errors.name ? "field field--error" : "field"}>Ваше имя<input name="name" required autoComplete="name" placeholder="Как к вам обращаться" aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "name-error" : undefined} onChange={clearFieldError} />{errors.name && <span className="field-error" id="name-error">{errors.name}</span>}</label>
        <label className={errors.contact ? "field field--error" : "field"}>Телефон или e-mail<input name="contact" required autoComplete="email" placeholder="+7 или name@example.ru" aria-invalid={Boolean(errors.contact)} aria-describedby={errors.contact ? "contact-error" : undefined} onChange={clearFieldError} />{errors.contact && <span className="field-error" id="contact-error">{errors.contact}</span>}</label>
        <label className={errors.personalDataConsent ? "consent consent--error" : "consent"}><input type="checkbox" name="personalDataConsent" required aria-invalid={Boolean(errors.personalDataConsent)} aria-describedby={errors.personalDataConsent ? "personal-data-consent-error" : undefined} onChange={clearFieldError} /><span>Даю согласие на обработку моих персональных данных в соответствии с <a href="/privacy-policy">Политикой обработки персональных данных</a>.{errors.personalDataConsent && <span className="field-error" id="personal-data-consent-error">{errors.personalDataConsent}</span>}</span></label>
        <label className="consent"><input type="checkbox" name="marketingConsent" /><span>Я даю согласие ИП Александровой Екатерине Михайловне на получение информационных и рекламных уведомлений об открытии студии, занятиях, специальных условиях и предложениях по указанному контакту. Это необязательно. <a href="/notification-consent">Условия согласия на уведомления</a>.</span></label>
        <button className="button" type="submit">Сообщить мне об открытии</button>
        {status !== "idle" && <p className={`form-status form-status--${status}`} role={status === "error" ? "alert" : "status"}>{message}</p>}
      </form>
    </section>
    <footer><div className="container footer"><a className="logo" href="#top">СТУДИЯ <span>/ ПИЛАТЕС</span></a><div><h2>Будем ближе. Скоро.</h2><p>Адрес и способы связи появятся здесь ближе к открытию.</p></div><small>Реформер · Пилатес · Стрейчинг<br /><a href="/privacy-policy">Политика обработки персональных данных</a></small></div></footer>
  </main>;
}
