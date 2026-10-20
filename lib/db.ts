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
  `)
    .then(() => getDatabase().query(
    `ALTER TABLE leads
      ADD COLUMN IF NOT EXISTS interests TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      ADD COLUMN IF NOT EXISTS utm_source TEXT,
      ADD COLUMN IF NOT EXISTS utm_medium TEXT,
      ADD COLUMN IF NOT EXISTS utm_campaign TEXT,
      ADD COLUMN IF NOT EXISTS utm_content TEXT,
      ADD COLUMN IF NOT EXISTS utm_term TEXT,
      ADD COLUMN IF NOT EXISTS landing_path TEXT,
      ADD COLUMN IF NOT EXISTS referrer TEXT,
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'new',
      ADD COLUMN IF NOT EXISTS loss_reason TEXT,
      ADD COLUMN IF NOT EXISTS owner TEXT NOT NULL DEFAULT 'Екатерина',
      ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
    ))
    .then(() => getDatabase().query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'leads_status_check'
      ) THEN
        ALTER TABLE leads ADD CONSTRAINT leads_status_check
          CHECK (status IN ('new', 'in_progress', 'qualified', 'unqualified', 'lost'));
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'leads_lost_reason_check'
      ) THEN
        ALTER TABLE leads ADD CONSTRAINT leads_lost_reason_check
          CHECK (status <> 'lost' OR NULLIF(BTRIM(loss_reason), '') IS NOT NULL);
      END IF;
    END $$;
    `))
    .then(() => undefined);

  return schemaPromise;
}

export async function createLead(input: {
  name: string;
  contact: string;
  interests: string[];
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  landingPath: string | null;
  referrer: string | null;
  marketingConsent: boolean;
  userAgent: string | null;
  ipAddress: string | null;
}) {
  await ensureSchema();

  const normalizedContact = input.contact.replace(/\D/g, "").replace(/^8/, "7");
  const client = await getDatabase().connect();

  try {
    await client.query("BEGIN");
    // The transaction-level lock makes the check-and-insert operation atomic even
    // when two requests with the same phone number arrive simultaneously.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [normalizedContact]);
    const existingLead = await client.query(
      `SELECT 1
       FROM leads
       WHERE regexp_replace(regexp_replace(contact, '\\D', '', 'g'), '^8', '7') = $1
       LIMIT 1`,
      [normalizedContact],
    );

    if (existingLead.rowCount) {
      await client.query("COMMIT");
      return { created: false };
    }

    await client.query(
      `INSERT INTO leads (
      name, contact, interests,
      utm_source, utm_medium, utm_campaign, utm_content, utm_term, landing_path, referrer,
      personal_data_consent, marketing_consent,
      privacy_policy_version, notification_consent_version,
      created_at, user_agent, ip_address
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE, $11, $12, $13, NOW(), $14, $15)`,
    [
      input.name,
      input.contact,
      input.interests,
      input.utmSource,
      input.utmMedium,
      input.utmCampaign,
      input.utmContent,
      input.utmTerm,
      input.landingPath,
      input.referrer,
      input.marketingConsent,
      "draft-1",
      "2026-09-15",
      input.userAgent,
      input.ipAddress,
    ],
  );
    await client.query("COMMIT");
    return { created: true };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function checkDatabase() {
  await ensureSchema();
  await getDatabase().query("SELECT 1");
}

let measurementSchema: Promise<void> | undefined;
function ensureMeasurementSchema() {
  measurementSchema ??= getDatabase().query(`
    CREATE TABLE IF NOT EXISTS metrika_deliveries (
      id UUID PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).then(() => undefined).catch((error) => {
    measurementSchema = undefined;
    throw error;
  });
  return measurementSchema;
}

export async function claimMeasurement(id: string) {
  await ensureMeasurementSchema();
  // Tickets expire after 10 minutes; older delivery IDs no longer need deduplication.
  await getDatabase().query("DELETE FROM metrika_deliveries WHERE created_at < NOW() - INTERVAL '1 day'");
  const result = await getDatabase().query(
    "INSERT INTO metrika_deliveries (id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id", [id],
  );
  return result.rowCount === 1;
}

export async function finishMeasurement(id: string, sent: boolean) {
  await getDatabase().query("UPDATE metrika_deliveries SET status = $2 WHERE id = $1", [id, sent ? "sent" : "unconfirmed"]);
}
