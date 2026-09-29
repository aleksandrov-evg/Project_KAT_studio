import pg from "pg";

const { Client } = pg;

const LEAD_SELECT_COLUMNS = `
  id, name, contact, interests, created_at,
  utm_source, utm_medium, utm_campaign, utm_content, utm_term,
  landing_path, referrer,
  marketing_consent, personal_data_consent, privacy_policy_version
`;

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

  await ensureCrmTables(client, config);
  await ensureTelegramOpsTables(client);

  return client;
}

async function ensureTelegramOpsTables(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS telegram_lead_messages (
      chat_id BIGINT NOT NULL,
      message_id BIGINT NOT NULL,
      lead_id BIGINT NOT NULL,
      person_id TEXT,
      opportunity_id TEXT,
      client_stage TEXT,
      lead_snapshot JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (chat_id, message_id)
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS telegram_lead_messages_lead_id_idx
    ON telegram_lead_messages (lead_id)
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS telegram_update_cursor (
      notifier_key TEXT PRIMARY KEY,
      last_update_id BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function ensureCrmTables(client, config) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS lead_crm_state (
      lead_id BIGINT PRIMARY KEY,
      person_id TEXT,
      opportunity_id TEXT,
      status TEXT NOT NULL CHECK (status IN ('synced', 'permanent_error', 'skipped')),
      error TEXT,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS lead_crm_cursor (
      notifier_key TEXT PRIMARY KEY,
      initialized_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  if (!config.crmSyncEnabled) return;

  const existing = await client.query(
    "SELECT 1 FROM lead_crm_cursor WHERE notifier_key = $1",
    [config.crmNotifierKey],
  );
  if (existing.rowCount > 0) return;

  await client.query("BEGIN");
  try {
    if (!config.crmSendExisting) {
      await client.query(
        `INSERT INTO lead_crm_state (lead_id, status, error)
         SELECT id, 'skipped', 'skipped-existing-on-startup'
         FROM leads
         ON CONFLICT (lead_id) DO NOTHING`,
      );
    }
    await client.query(
      `INSERT INTO lead_crm_cursor (notifier_key) VALUES ($1)
       ON CONFLICT (notifier_key) DO NOTHING`,
      [config.crmNotifierKey],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
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

export async function getPendingCrmLeads(client, config) {
  const result = await client.query(
    `SELECT ${LEAD_SELECT_COLUMNS}
     FROM leads l
     WHERE NOT EXISTS (
       SELECT 1 FROM lead_crm_state s WHERE s.lead_id = l.id
     )
     ORDER BY l.id ASC
     LIMIT $1`,
    [config.batchSize],
  );
  return result.rows;
}

export async function markCrmSynced(client, leadId, { personId, opportunityId }) {
  await client.query(
    `INSERT INTO lead_crm_state (lead_id, person_id, opportunity_id, status, error, synced_at)
     VALUES ($1, $2, $3, 'synced', NULL, NOW())
     ON CONFLICT (lead_id) DO UPDATE SET
       person_id = EXCLUDED.person_id,
       opportunity_id = EXCLUDED.opportunity_id,
       status = 'synced',
       error = NULL,
       synced_at = NOW()`,
    [leadId, personId ?? null, opportunityId ?? null],
  );
}

export async function markCrmPermanentError(client, leadId, errorMessage) {
  await client.query(
    `INSERT INTO lead_crm_state (lead_id, person_id, opportunity_id, status, error, synced_at)
     VALUES ($1, NULL, NULL, 'permanent_error', $2, NOW())
     ON CONFLICT (lead_id) DO UPDATE SET
       status = 'permanent_error',
       error = EXCLUDED.error,
       synced_at = NOW()`,
    [leadId, String(errorMessage).slice(0, 2000)],
  );
}

export async function countPendingCrmLeads(client) {
  const result = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM leads l
     WHERE NOT EXISTS (
       SELECT 1 FROM lead_crm_state s WHERE s.lead_id = l.id
     )`,
  );
  return result.rows[0].count;
}

export async function saveTelegramLeadMessage(
  client,
  {
    chatId,
    messageId,
    leadId,
    personId = null,
    opportunityId = null,
    clientStage = "WAITLIST",
    leadSnapshot = null,
  },
) {
  await client.query(
    `INSERT INTO telegram_lead_messages (
       chat_id, message_id, lead_id, person_id, opportunity_id, client_stage, lead_snapshot
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     ON CONFLICT (chat_id, message_id) DO UPDATE SET
       person_id = COALESCE(EXCLUDED.person_id, telegram_lead_messages.person_id),
       opportunity_id = COALESCE(EXCLUDED.opportunity_id, telegram_lead_messages.opportunity_id),
       client_stage = COALESCE(EXCLUDED.client_stage, telegram_lead_messages.client_stage),
       lead_snapshot = COALESCE(EXCLUDED.lead_snapshot, telegram_lead_messages.lead_snapshot),
       updated_at = NOW()`,
    [
      chatId,
      messageId,
      leadId,
      personId,
      opportunityId,
      clientStage,
      leadSnapshot ? JSON.stringify(leadSnapshot) : null,
    ],
  );
}

export async function findTelegramLeadByMessage(client, chatId, messageId) {
  const result = await client.query(
    `SELECT chat_id, message_id, lead_id, person_id, opportunity_id, client_stage, lead_snapshot
     FROM telegram_lead_messages
     WHERE chat_id = $1 AND message_id = $2`,
    [chatId, messageId],
  );
  return result.rows[0] ?? null;
}

export async function findLatestTelegramLeadByLeadId(client, leadId) {
  const result = await client.query(
    `SELECT chat_id, message_id, lead_id, person_id, opportunity_id, client_stage, lead_snapshot
     FROM telegram_lead_messages
     WHERE lead_id = $1
     ORDER BY updated_at DESC
     LIMIT 1`,
    [leadId],
  );
  return result.rows[0] ?? null;
}

export async function updateTelegramLeadMessageState(
  client,
  { chatId, messageId, personId, opportunityId, clientStage },
) {
  await client.query(
    `UPDATE telegram_lead_messages
     SET person_id = COALESCE($3, person_id),
         opportunity_id = COALESCE($4, opportunity_id),
         client_stage = COALESCE($5, client_stage),
         updated_at = NOW()
     WHERE chat_id = $1 AND message_id = $2`,
    [chatId, messageId, personId ?? null, opportunityId ?? null, clientStage ?? null],
  );
}

export async function getCrmIdsForLead(client, leadId) {
  const result = await client.query(
    `SELECT person_id, opportunity_id, status, error
     FROM lead_crm_state WHERE lead_id = $1`,
    [leadId],
  );
  return result.rows[0] ?? null;
}

export async function getLeadById(client, leadId) {
  const result = await client.query(
    `SELECT ${LEAD_SELECT_COLUMNS}
     FROM leads WHERE id = $1`,
    [leadId],
  );
  return result.rows[0] ?? null;
}

/** Allow WF-01 retry after a permanent_error (e.g. CRM was temporarily broken). */
export async function clearCrmPermanentError(client, leadId) {
  await client.query(
    `DELETE FROM lead_crm_state WHERE lead_id = $1 AND status = 'permanent_error'`,
    [leadId],
  );
}

export async function getTelegramUpdateOffset(client, notifierKey) {
  const result = await client.query(
    `INSERT INTO telegram_update_cursor (notifier_key, last_update_id)
     VALUES ($1, 0)
     ON CONFLICT (notifier_key) DO UPDATE SET notifier_key = EXCLUDED.notifier_key
     RETURNING last_update_id`,
    [notifierKey],
  );
  return Number(result.rows[0].last_update_id) || 0;
}

export async function setTelegramUpdateOffset(client, notifierKey, lastUpdateId) {
  await client.query(
    `INSERT INTO telegram_update_cursor (notifier_key, last_update_id, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (notifier_key) DO UPDATE SET
       last_update_id = GREATEST(telegram_update_cursor.last_update_id, EXCLUDED.last_update_id),
       updated_at = NOW()`,
    [notifierKey, lastUpdateId],
  );
}
