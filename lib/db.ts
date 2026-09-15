import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

const databasePath = process.env.LEADS_DB_PATH
  ? path.resolve(process.env.LEADS_DB_PATH)
  : path.join(process.cwd(), "data", "leads.db");
const dataDirectory = path.dirname(databasePath);
mkdirSync(dataDirectory, { recursive: true });

const database = new Database(databasePath);

database.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    contact TEXT NOT NULL,
    personal_data_consent INTEGER NOT NULL,
    marketing_consent INTEGER NOT NULL,
    privacy_policy_version TEXT NOT NULL,
    notification_consent_version TEXT NOT NULL,
    created_at TEXT NOT NULL,
    user_agent TEXT,
    ip_address TEXT
  )
`);

export function createLead(input: {
  name: string;
  contact: string;
  userAgent: string | null;
  ipAddress: string | null;
}) {
  return database.prepare(`
    INSERT INTO leads (
      name, contact, personal_data_consent, marketing_consent,
      privacy_policy_version, notification_consent_version,
      created_at, user_agent, ip_address
    ) VALUES (?, ?, 1, 1, ?, ?, ?, ?, ?)
  `).run(
    input.name,
    input.contact,
    "draft-1",
    "draft-1",
    new Date().toISOString(),
    input.userAgent,
    input.ipAddress,
  );
}

export function checkDatabase() {
  database.prepare("SELECT 1").get();
}
