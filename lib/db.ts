import "server-only";
import { Pool } from "pg";

let database: Pool | undefined;

function getDatabase() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL must be set to connect to PostgreSQL.");
  }

  database ??= new Pool({ connectionString });
  return database;
}

let schemaPromise: Promise<void> | undefined;

function ensureSchema() {
  schemaPromise ??= getDatabase().query(`
    CREATE TABLE IF NOT EXISTS leads (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      contact TEXT NOT NULL,
      personal_data_consent BOOLEAN NOT NULL DEFAULT TRUE,
      marketing_consent BOOLEAN NOT NULL,
      privacy_policy_version TEXT NOT NULL,
      notification_consent_version TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      user_agent TEXT,
      ip_address TEXT
    )
  `).then(() => getDatabase().query(
    "ALTER TABLE leads ADD COLUMN IF NOT EXISTS interests TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]",
  ).then(() => undefined));

  return schemaPromise;
}

export async function createLead(input: {
  name: string;
  contact: string;
  interests: string[];
  marketingConsent: boolean;
  userAgent: string | null;
  ipAddress: string | null;
}) {
  await ensureSchema();

  return getDatabase().query(
    `INSERT INTO leads (
      name, contact, interests, personal_data_consent, marketing_consent,
      privacy_policy_version, notification_consent_version,
      created_at, user_agent, ip_address
    ) VALUES ($1, $2, $3, TRUE, $4, $5, $6, NOW(), $7, $8)`,
    [
      input.name,
      input.contact,
      input.interests,
      input.marketingConsent,
      "draft-1",
      "2026-09-15",
      input.userAgent,
      input.ipAddress,
    ],
  );
}

export async function checkDatabase() {
  await ensureSchema();
  await getDatabase().query("SELECT 1");
}
