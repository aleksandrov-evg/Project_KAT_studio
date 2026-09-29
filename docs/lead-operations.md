# Работа с waitlist-лидами

## Где работать

| Контур | Роль |
| --- | --- |
| **Twenty CRM** | Операционный источник правды для менеджера: views «Новые лиды», «Нарушение SLA», задачи «Написать клиенту», статусы и заметки |
| **PostgreSQL `leads`** | Технический outbox лендинга: форма пишет сюда; отсюда poller шлёт Telegram и `POST /s/studio/leads` (WF-01) |
| **Telegram** | Ops-бот в супергруппе: алерт, deep-link, кнопки/reply → CRM ([сценарий](telegram-ops-manager.md)) |

SQL ниже — только аварийная сверка или fallback, если CRM недоступна. Не ведите параллельный Excel.

Соответствие статусов CRM: [инструкция менеджера](../../crm/crm-twenty/docs/katfit-balance-crm-manager-guide.ru.md)  
(в workspace: `crm/crm-twenty/docs/katfit-balance-crm-manager-guide.ru.md`).

Автозаведение ставит Opportunity в **`WAITLIST`**. Стадию `NEW_LEAD` менеджер ставит, когда уже можно писать с предложением intro после открытия записи.

## Статусы в PostgreSQL (технические)

| Статус | Когда ставить |
|---|---|
| `new` | Новая заявка; значение по умолчанию. |
| `in_progress` | Начали разбор (предпочтительно отражайте прогресс в CRM). |
| `qualified` | Контакт валидный, человеку подходит формат или он ждёт открытия. |
| `unqualified` | Контакт не подходит продукту; причину можно записать в `loss_reason`. |
| `lost` | Лид потерян; `loss_reason` обязателен. |

## Очередь на разбор (fallback SQL)

```sql
SELECT
  id,
  created_at,
  name,
  contact,
  interests,
  utm_source,
  utm_campaign,
  status,
  owner,
  first_response_at,
  CASE
    WHEN first_response_at IS NULL THEN NULL
    ELSE ROUND(EXTRACT(EPOCH FROM (first_response_at - created_at)) / 60)
  END AS first_response_minutes
FROM leads
ORDER BY created_at DESC;
```

## Обновление лида (fallback)

Начать работу:

```sql
UPDATE leads
SET status = 'in_progress',
    owner = 'Екатерина',
    first_response_at = COALESCE(first_response_at, NOW()),
    status_updated_at = NOW()
WHERE id = 123;
```

Закрыть как валидный:

```sql
UPDATE leads
SET status = 'qualified', status_updated_at = NOW()
WHERE id = 123;
```

Закрыть как потерянный:

```sql
UPDATE leads
SET status = 'lost',
    loss_reason = 'Нет интереса к доступным форматам',
    status_updated_at = NOW()
WHERE id = 123;
```

Не сохраняйте в `loss_reason` медицинские сведения, платёжные данные или лишние персональные данные.
