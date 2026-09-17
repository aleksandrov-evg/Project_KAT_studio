# Работа с waitlist-лидами

Источник правды — PostgreSQL-таблица `leads`. На первом этапе Екатерина
обновляет лиды через DBeaver или Dokploy; админка сайта не нужна.

## Статусы

| Статус | Когда ставить |
|---|---|
| `new` | Новая заявка; значение по умолчанию. |
| `in_progress` | Екатерина начала разбор или связалась с человеком. |
| `qualified` | Контакт валидный, человеку подходит формат или он ждёт открытия. |
| `unqualified` | Контакт не подходит продукту; причину можно записать в `loss_reason`. |
| `lost` | Лид потерян; `loss_reason` обязателен. |

## Очередь на разбор

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

## Обновление лида

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
