import { NextResponse } from "next/server";
import { createLead } from "../../../lib/db";

export const runtime = "nodejs";

function trackingValue(data: FormData, field: string) {
  return String(data.get(field) ?? "").trim().slice(0, 500) || null;
}

export async function POST(request: Request) {
  const data = await request.formData();
  const name = String(data.get("name") ?? "").trim();
  const contact = String(data.get("contact") ?? "").trim();
  const personalDataConsent = data.get("personalDataConsent") === "on";
  const marketingConsent = data.get("marketingConsent") === "on";
  const interests = data.getAll("interests").map(String);
  const allowedInterests = new Set(["reformer", "pilates", "stretching", "personal", "undecided"]);
  const tracking = {
    utmSource: trackingValue(data, "utm_source"),
    utmMedium: trackingValue(data, "utm_medium"),
    utmCampaign: trackingValue(data, "utm_campaign"),
    utmContent: trackingValue(data, "utm_content"),
    utmTerm: trackingValue(data, "utm_term"),
    landingPath: trackingValue(data, "landingPath"),
    referrer: trackingValue(data, "referrer"),
  };
  const errors: Record<string, string> = {};

  if (!/^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё\s-]{1,}$/.test(name)) errors.name = "Укажите имя — не менее 2 букв.";
  if (!/^\+7 \(\d{3}\) \d{3}-\d{2}-\d{2}$/.test(contact)) errors.contact = "Введите номер в формате +7 (999) 999-99-99.";
  if (!personalDataConsent) errors.personalDataConsent = "Подтвердите согласие на обработку персональных данных.";
  if (interests.some((interest) => !allowedInterests.has(interest))) errors.interests = "Выберите корректный формат.";
  if (Object.keys(errors).length) {
    return NextResponse.json({ message: "Проверьте поля, отмеченные красным.", errors }, { status: 400 });
  }
  await createLead({
    name,
    contact,
    interests,
    ...tracking,
    marketingConsent,
    userAgent: request.headers.get("user-agent"),
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  });
  return NextResponse.json({ message: "Спасибо! Вы в списке — сообщим об открытии по телефону." });
}
