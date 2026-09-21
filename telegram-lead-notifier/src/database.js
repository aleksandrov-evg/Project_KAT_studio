import pg from "pg";

const { Client } = pg;

export async function connectDatabase(config) {
  const client = new Client({ connectionString: config.databaseUrl });
  await client.connect();

  const lock = await client.query(
    "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
    [config.notifierKey],
  );
  if (!lock.rows[0].acquired) {
    throw new Error(`Another notifier owns the lock for NOTIFIER_KEY=${config.notifierKey}.`);
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS lead_notification_state (
      notifier_key TEXT PRIMARY KEY,
      last_lead_id BIGINT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(
    `INSERT INTO lead_notification_state (notifier_key, last_lead_id)
     SELECT $1, CASE WHEN $2::boolean THEN 0 ELSE COALESCE(MAX(id), 0) END
     FROM leads
     ON CONFLICT (notifier_key) DO NOTHING`,
    [config.notifierKey, config.sendExisting],
  );
  return client;
}

export async function getPendingLeads(client, config) {
  const result = await client.query(
    `SELECT id, name, contact, interests, created_at, utm_source, utm_campaign
     FROM leads
     WHERE id > (
       SELECT last_lead_id FROM lead_notification_state WHERE notifier_key = $1
     )
     ORDER BY id ASC
     LIMIT $2`,
    [config.notifierKey, config.batchSize],
  );
  return result.rows;
}

export async function markLeadSent(client, config, leadId) {
  await client.query(
    `UPDATE lead_notification_state
     SET last_lead_id = $2, updated_at = NOW()
     WHERE notifier_key = $1 AND last_lead_id < $2`,
    [config.notifierKey, leadId],
  );
}
