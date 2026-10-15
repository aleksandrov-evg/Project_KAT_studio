# Telegram ops-бот: алерты, воронка CRM, секретарь

Сервис читает PostgreSQL `leads` по прямому `DATABASE_URL` и:

1. отправляет новые заявки в закрытую Telegram-супергруппу с inline-кнопками;
2. при `CRM_SYNC_ENABLED=true` вызывает WF-01 `POST {TWENTY_API_URL}/s/studio/leads`;
3. принимает callback кнопок и reply на карточку через `POST /s/studio/lead-actions`;
4. разбирает свободный текст reply как секретарь;
5. по `ID36` или `/resend 36` отправляет актуальную карточку из CRM.

Подключение к PostgreSQL прямое: deployment-сервер должен иметь сетевой доступ к
адресу и порту, указанным в `DATABASE_URL`. SSH-туннель не используется.

## Архитектура

```text
Landing → PostgreSQL leads → lead-notifier → Telegram / Twenty CRM
```

Таблица `telegram_lead_messages` связывает `message_id` с `lead_id` для reply и
редактирования после действия. `status_history` (JSONB) хранит историю статусов.

Контракт действий находится в
`crm-twenty/packages/twenty-apps/internal/katfit-studio/docs/lead-actions.md`.

## Что понадобится

- Telegram-бот и закрытая супергруппа; бот должен быть её администратором;
- строка прямого подключения PostgreSQL в `DATABASE_URL`;
- доступ deployment-сервера к PostgreSQL и `https://api.telegram.org`;
- Twenty с приложением `katfit-studio`, если нужна CRM-синхронизация;
- публичный HTTPS только для `TELEGRAM_MODE=webhook`.

## Настройка

Скопируйте `.env.example` в `.env` и задайте как минимум:

```dotenv
DATABASE_URL=postgresql://db_user:db_password@postgres.example.com:5432/database_name
TELEGRAM_BOT_TOKEN=ТОКЕН_ОТ_BOTFATHER
TELEGRAM_CHAT_ID=-1001234567890
TELEGRAM_MODE=polling
```

Если логин или пароль содержат `@`, `:`, `/`, `#` или пробелы, URL-кодируйте их.
Не добавляйте `.env` в Git.

Остальные параметры и CRM-переменные описаны в `.env.example`. Production-деплой:
[DEPLOY_DOKPLOY.md](DEPLOY_DOKPLOY.md).

## Бот и супергруппа

1. В `@BotFather` создайте бота и сохраните `TELEGRAM_BOT_TOKEN`.
2. Создайте закрытую супергруппу и добавьте бота администратором.
3. Отправьте в группе сообщение и получите `message.chat.id`:

```bash
curl -s "https://api.telegram.org/botBOT_TOKEN/getUpdates"
```

Обычно идентификатор группы начинается с `-100`; сохраните его в
`TELEGRAM_CHAT_ID`. Whitelist менеджеров задаётся как
`TELEGRAM_MANAGER_WHITELIST=111111111:Анна,222222222:Борис`.

## Сценарий для менеджера

1. В супергруппе появляется карточка заявки с кнопками.
2. Первое касание состоит из выбора канала (звонок, SMS, MAX, Telegram или
   WhatsApp), затем результата: «Нет ответа», «Ответили» или «Думает».
3. На стадии CONTACTED доступны «Предложила intro», «Согласилась на intro»,
   «Записала intro», «Написать снова» и «Потерян».
4. Reply на карточку обрабатывается секретарём; действия записываются в CRM при
   включённой синхронизации.
5. Команды `ID36`, `id 36`, `/resend 36` и `/card 36` отправляют новую карточку
   со стадией и историей из CRM; при недоступной CRM используется локальная
   запись `telegram_lead_messages`.

Booking в Class Session из Telegram не создаётся: бот меняет стадию и сохраняет
текст слота в Note.

## Режим входящих апдейтов

| `TELEGRAM_MODE` | Как работает |
| --- | --- |
| `polling` | Значение по умолчанию; публичный URL не нужен. |
| `webhook` | Нужен публичный `TELEGRAM_WEBHOOK_URL` на `/telegram/webhook`; можно задать `TELEGRAM_WEBHOOK_SECRET`. |

## CRM sync

```dotenv
CRM_SYNC_ENABLED=true
TWENTY_API_URL=https://crm.example.com
TWENTY_API_KEY=…
TWENTY_APP_BASE_URL=https://crm.example.com
```

Ошибка `FORBIDDEN` от WF-01 или `lead-actions` обычно означает, что Twenty не
исполняет Logic Functions. Проверьте `LOGIC_FUNCTION_TYPE` (`LOCAL` или `LAMBDA`),
статус приложения **KATFIT Studio**, логи `twenty-server` и соответствие
`TWENTY_API_KEY` нужному workspace.

## Проверка

```bash
npm ci
npm test
docker compose --env-file .env config --quiet
docker compose --env-file .env up -d --build
docker compose --env-file .env logs --tail=100 lead-notifier
```

В логах ожидается `Lead notifier started`. Остановить локальный запуск:

```bash
docker compose --env-file .env down
```

## Важные настройки

`SEND_EXISTING=false` при первом запуске пропускает старые заявки; `true` также
отправляет их. Не используйте несколько реплик с одинаковым `NOTIFIER_KEY`.

При `CRM_SYNC_ENABLED=true` обязательны `TWENTY_API_URL` и `TWENTY_API_KEY`.
Без CRM-синхронизации Telegram-алерты продолжают работать, но действия кнопок и
reply в CRM не записываются.
