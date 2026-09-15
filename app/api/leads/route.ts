import { NextResponse } from "next/server";
import { createLead } from "../../../lib/db";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const data = await request.formData();
  const name = String(data.get("name") ?? "").trim();
  const contact = String(data.get("contact") ?? "").trim();
  const personalDataConsent = data.get("personalDataConsent") === "on";
  const marketingConsent = data.get("marketingConsent") === "on";
  const phoneDigits = contact.replace(/\D/g, "");
  const errors: Record<string, string> = {};

  if (!/^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё\s-]{1,}$/.test(name)) errors.name = "Укажите имя — не менее 2 букв.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) && !(phoneDigits.length >= 10 && phoneDigits.length <= 15)) errors.contact = "Укажите корректный телефон или e-mail.";
  if (!personalDataConsent) errors.personalDataConsent = "Подтвердите согласие на обработку персональных данных.";
  if (Object.keys(errors).length) {
    return NextResponse.json({ message: "Проверьте поля, отмеченные красным.", errors }, { status: 400 });
  }
  createLead({
    name,
    contact,
    marketingConsent,
    userAgent: request.headers.get("user-agent"),
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  });
  return NextResponse.json({ message: "Спасибо! Вы в списке — сообщим об открытии по указанному контакту." });
}
