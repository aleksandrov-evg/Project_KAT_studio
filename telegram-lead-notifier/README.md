# Telegram ops-бот: алерты, воронка CRM, секретарь

Сервис проверяет PostgreSQL `leads` и:

1. шлёт новые заявки в **закрытую супергруппу** с inline-кнопками воронки;
2. при `CRM_SYNC_ENABLED=true` вызывает WF-01 `POST {TWENTY_API_URL}/s/studio/leads`;
3. принимает **callback** кнопок и **reply** на карточку → `POST /s/studio/lead-actions`
   (стадии, Notes, Tasks в Twenty);
4. разбирает свободный текст reply как **секретарь** (шаблоны вроде «нет ответа», «пообщались», «потерян: цена»).

Telegram outbound и CRM ingest — независимые ветки. Ops inbound требует включённый CRM sync
и применённый `katfit-studio` с Logic Function `studio-lead-actions`.

Контракт действий: `crm-twenty/packages/twenty-apps/internal/katfit-studio/docs/lead-actions.md`.

Подключение к базе — через SSH-туннель (порт PostgreSQL не в интернет).

## Архитектура

```text
Landing → leads (PG)
            ↓
     lead-notifier
       ├─ WF-01 /s/studio/leads
       ├─ sendMessage + keyboard → супергруппа
       └─ getUpdates / webhook
            └─ /s/studio/lead-actions → Note + stages
```

Таблица `telegram_lead_messages` связывает `message_id` с `lead_id` для reply и edit после действия.
Колонка `status_history` (JSONB) хранит append-only лог статусов с меткой времени; при каждом дейвлении карточка в Telegram пересобирается со всей историей.

## Где что находится

| Машина | Назначение |
|---|---|
| Рабочий ПК | Подготовка кода и SSH-ключа. Здесь ничего не деплоится. |
| Сервер Dokploy | Только панель управления. Контейнеры приложения здесь не запускаются. |
| Сервер приложения | Deployment-сервер Dokploy: `ssh-tunnel` + `lead-notifier`. |
| Удалённый сервер PostgreSQL | PostgreSQL и SSH для туннеля. |

```text
lead-notifier → ssh-tunnel → SSH → PostgreSQL 127.0.0.1:5432
```

## Что понадобится

- Telegram-бот и **закрытая супергруппа** (не канал — для кнопок и reply);
- бот — админ группы с правом писать и читать сообщения;
- SSH/DB как раньше;
- Twenty с применённым `katfit-studio` (WF-01 + lead-actions);
- опционально публичный HTTPS для `TELEGRAM_MODE=webhook`.

```bash
cd /Users/evgenijaleksandrov/Desktop/repo/repo/Kate/Pilates_studio/telegram-lead-notifier
```

## Шаг 1. Бот и супергруппа

1. `@BotFather` → `/newbot` → сохранить `TELEGRAM_BOT_TOKEN`.
2. Создайте закрытую супергруппу, добавьте бота администратором.
3. Напишите любое сообщение в группе, затем:

```bash
curl -s "https://api.telegram.org/botBOT_TOKEN/getUpdates"
```

Найдите `message.chat.id` (обычно `-100…`) → `TELEGRAM_CHAT_ID`.

Проверка:

```bash
curl -X POST "https://api.telegram.org/botBOT_TOKEN/sendMessage" \
  -H 'Content-Type: application/json' \
  -d '{"chat_id":"-1001234567890","text":"Проверка бота"}'
```

Узнайте свой `telegram user id` (например через `@userinfobot`) для whitelist:

```text
TELEGRAM_MANAGER_WHITELIST=111111111:Анна,222222222:Борис
```

Пустой whitelist = любой участник группы может жать кнопки (только для доверенной группы).

## Сценарий для менеджера

1. В супергруппе появляется карточка заявки + кнопки.
2. **Первое касание — два шага:**
   - выбрать канал (Звонок / SMS / MAX / Telegram / WhatsApp) → Note «Попытка» + `lastContactChannel`;
   - исход: **Нет ответа** / **Ответили** / **Думает** (Task «Вернуться к думающим», +2 дня).
3. На CONTACTED: **Предложила intro** / **Согласилась на intro** / **Записала intro** / **Написать снова** / **Потерян**.
4. **Ответом на сообщение** — секретарь (те же action в CRM).
5. Ссылка **Открыть в CRM** (если sync и `TWENTY_APP_BASE_URL`).
6. **Открыть TG / Открыть WA** — только deep link; MAX — по номеру в приложении.

Канал связи попадает в Note и в `Person.lastContactChannel`.

Booking в Class Session из Telegram **не создаётся** — только стадия и текст слота в Note.

## Режим входящих апдейтов

| `TELEGRAM_MODE` | Как работает |
|---|---|
| `polling` (default) | `getUpdates` в фоне; публичный URL не нужен |
| `webhook` | `POST /telegram/webhook` на том же порту, что `/health`; задайте `TELEGRAM_WEBHOOK_URL` и опционально `TELEGRAM_WEBHOOK_SECRET` |

## CRM env

```text
CRM_SYNC_ENABLED=true
TWENTY_API_URL=https://crm.example.com
TWENTY_API_KEY=…
TWENTY_APP_BASE_URL=https://crm.example.com
```

Без `CRM_SYNC_ENABLED` алерты уходят, но кнопки/reply в CRM не пишутся.

### 403 FORBIDDEN на WF-01 / lead-actions

Ответ вида `Logic function execution failed … FORBIDDEN_EXCEPTION` почти всегда значит, что **Twenty не исполняет Logic Functions**, а не что payload бота неверный.

Проверьте на инстансе CRM:

1. Env `LOGIC_FUNCTION_TYPE` = `LOCAL` или `LAMBDA` (не `DISABLED`).
2. Settings → Applications → **KATFIT Studio** не в статусе stopped.
3. Логи `twenty-server` в момент вызова — там будет исходная причина (`Logic function execution is disabled` / application stopped / …).
4. `TWENTY_API_KEY` — API key или application token того же workspace, куда сделан `twenty apply`.

После починки исполнялки сбросьте залипший лид:

```sql
DELETE FROM lead_crm_state WHERE lead_id = 33 AND status = 'permanent_error';
```

## Локальные проверки

```bash
npm test
# или
node --test
```

## Шаг 2. Создайте SSH-ключ

Ключ создаётся **на рабочем ПК**, с которого вы настраиваете сервис. Не создавайте
его на сервере Dokploy, сервере приложения, сервере PostgreSQL или в контейнере.

В этой инструкции ключ хранится в директории проекта:

```text
telegram-lead-notifier/.local-secrets/
```

Технически директория может быть любой. Она влияет только на пути в командах и
не влияет на работу SSH. `.local-secrets` выбрана для удобства: она уже добавлена
в `.gitignore`, поэтому приватный ключ не попадёт в Git. Если выберете другую
директорию, замените путь `.local-secrets/...` во всех следующих командах и
обязательно исключите эту директорию из Git и резервных копий общего доступа.

Убедитесь, что текущая директория — `telegram-lead-notifier`:

```bash
pwd
```

Затем создайте отдельный ключ для сервиса:

```bash
mkdir -p .local-secrets
chmod 700 .local-secrets
ssh-keygen -t ed25519 -N '' -C 'katfit-lead-notifier' -f .local-secrets/id_ed25519
```

Команда создаст на вашем компьютере два файла:

```text
.local-secrets/id_ed25519      — приватный ключ, никому не передавать;
.local-secrets/id_ed25519.pub  — публичный ключ, его можно установить на сервер.
```

Проверьте наличие файлов и права доступа:

```bash
ls -la .local-secrets/id_ed25519 .local-secrets/id_ed25519.pub
chmod 600 .local-secrets/id_ed25519
chmod 644 .local-secrets/id_ed25519.pub
```

Добавьте публичный ключ на удалённый сервер PostgreSQL, подставив SSH-пользователя,
адрес и порт этого сервера:

```bash
ssh-copy-id -i .local-secrets/id_ed25519.pub -p 22 deploy@postgres-server.example.com
```

Эта команда не копирует приватный ключ. Она добавляет публичный ключ на сервер
PostgreSQL в файл SSH-пользователя `deploy`:

```text
/home/deploy/.ssh/authorized_keys
```

Если у пользователя другая домашняя директория, фактический путь будет
`~deploy/.ssh/authorized_keys`. Для SSH-сервера расположение имеет значение:
обычно `sshd` читает ключи именно из `.ssh/authorized_keys` домашней директории.
Размещать публичный ключ рядом с PostgreSQL или в произвольной директории сервера
не нужно.

Проверьте подключение:

```bash
ssh -i .local-secrets/id_ed25519 -p 22 deploy@postgres-server.example.com 'echo SSH OK'
```

Ожидаемый ответ:

```text
SSH OK
```

При деплое приватный ключ не копируется на сервер PostgreSQL. Его base64-
представление сохраняется в Environment сервиса Dokploy. Dokploy передаёт секрет
на сервер приложения, где tunnel-контейнер временно создаёт `/run/ssh/id_key`.
После удаления контейнера этот файл исчезает. На сервере управления Dokploy
отдельный файл ключа создавать не нужно.

## Шаг 3. Подготовьте SSH host key

Файл `known_hosts` также создаётся **на рабочем ПК** в `.local-secrets`.
Он содержит публичный host key сервера и позволяет контейнеру убедиться, что он
подключается к правильному SSH-серверу.

Получите публичный host key удалённого сервера PostgreSQL:

```bash
ssh-keyscan -H -p 22 postgres-server.example.com > .local-secrets/known_hosts
```

Покажите fingerprint:

```bash
ssh-keygen -lf .local-secrets/known_hosts
```

Сверьте fingerprint с администратором сервера. После проверки закодируйте оба
файла в base64:

```bash
openssl base64 -A -in .local-secrets/id_ed25519
openssl base64 -A -in .local-secrets/known_hosts
```

Первый результат — `SSH_PRIVATE_KEY_BASE64`, второй —
`SSH_KNOWN_HOSTS_BASE64`.

## Шаг 4. Создайте `.env`

Скопируйте шаблон:

```bash
cp .env.example .env
chmod 600 .env
```

Откройте файл:

```bash
nano .env
```

Заполните обязательные значения:

```dotenv
DATABASE_URL=postgresql://postgres:db_password@ssh-tunnel:15432/database_name

SSH_HOST=postgres-server.example.com
SSH_PORT=22
SSH_USER=deploy
SSH_PRIVATE_KEY_BASE64=BASE64_ПРИВАТНОГО_КЛЮЧА
SSH_KNOWN_HOSTS_BASE64=BASE64_KNOWN_HOSTS

DB_REMOTE_HOST=127.0.0.1
DB_REMOTE_PORT=5432

TELEGRAM_BOT_TOKEN=ТОКЕН_ОТ_BOTFATHER
TELEGRAM_CHAT_ID=-1001234567890
TELEGRAM_MODE=polling
TELEGRAM_MANAGER_WHITELIST=

CRM_SYNC_ENABLED=true
TWENTY_API_URL=https://crm.example.com
TWENTY_API_KEY=
TWENTY_APP_BASE_URL=https://crm.example.com

NOTIFIER_KEY=pilates-leads-main
POLL_INTERVAL_MS=5000
BATCH_SIZE=20
SEND_EXISTING=false
```

Так как SSH и PostgreSQL находятся на одном удалённом сервере, оставьте
`DB_REMOTE_HOST=127.0.0.1`.

Если логин или пароль PostgreSQL содержат `@`, `:`, `/`, `#` или пробелы,
закодируйте их командой:

```bash
node -e "console.log(encodeURIComponent('ЗНАЧЕНИЕ'))"
```

Сохранение в `nano`: `Ctrl+O`, `Enter`, затем `Ctrl+X`.

## Шаг 5. Необязательно проверьте на рабочем ПК

Это временный тест, а не деплой. После него контейнеры будут удалены. Если рабочий
ПК не имеет сетевого доступа к SSH-порту сервера PostgreSQL, пропустите запуск
Compose и выполните проверку после деплоя.

Запустите тесты и проверьте Compose:

```bash
npm ci
npm test
docker compose --env-file .env config --quiet
```

Запустите сервисы:

```bash
docker compose --env-file .env up -d --build
```

Проверьте состояние и логи:

```bash
docker compose --env-file .env ps
docker compose --env-file .env logs --tail=100 ssh-tunnel lead-notifier
```

В логах должна появиться строка:

```text
{"level":"info","message":"Lead notifier started"}
```

Остановить локальный запуск:

```bash
docker compose --env-file .env down
```

## Шаг 6. Разверните в Dokploy

Подробная production-инструкция: [DEPLOY_DOKPLOY.md](DEPLOY_DOKPLOY.md). Ниже —
краткая версия основных действий.

Сначала отправьте код в Git-репозиторий:

```bash
git add telegram-lead-notifier
git commit -m "Add Telegram lead notifier"
git push -u origin "$(git branch --show-current)"
```

В Dokploy откройте проект, настроенный на **сервер приложения**, и создайте
Compose-сервис:

```text
Project → Create Service → Compose
```

Подключите репозиторий и укажите путь:

```text
telegram-lead-notifier/compose.yaml
```

В разделе Environment вставьте те же значения, что находятся в локальном `.env`.
Сам файл `.env` в Git отправлять нельзя.

Убедитесь, что deployment target — сервер приложения, а не сервер панели Dokploy.

До деплоя подключитесь к серверу приложения и проверьте исходящие соединения:

```bash
ssh app-user@app-server.example.com
nc -zv postgres-server.example.com 22
curl -I https://api.telegram.org
exit
```

Замените `app-user@app-server.example.com` адресом сервера приложения, а
`postgres-server.example.com` и `22` — адресом и SSH-портом сервера PostgreSQL.
Проверять прямой доступ к `5432` не нужно: этот порт намеренно закрыт.

Нажмите:

```text
Deploy
```

Проверьте в Dokploy:

1. Контейнер `ssh-tunnel` имеет статус `healthy`.
2. Контейнер `lead-notifier` имеет статус `healthy`.
3. В логах есть `Lead notifier started`.

Контейнеры и их логи находятся на сервере приложения. На сервере Dokploy
контейнеры этого проекта не запускаются.

## Шаг 7. Проверьте новую заявку

Отправьте тестовую заявку через форму лендинга. В логах бота должна появиться
запись:

```text
{"level":"info","message":"Lead notification sent","leadId":"..."}
```

После этого заявка должна появиться в закрытой Telegram-супергруппе.

## Важные настройки

`SEND_EXISTING=false` — при первом запуске пропустить старые заявки и отправлять
только новые.

`SEND_EXISTING=true` — при первом запуске отправить также существующие заявки.

Менять это значение после первого запуска обычно не требуется.

## Если сервис не запускается

Посмотрите логи:

```bash
docker compose --env-file .env logs --tail=200 ssh-tunnel lead-notifier
```

| Ошибка | Что проверить |
|---|---|
| `Permission denied (publickey)` | `SSH_USER` и приватный ключ |
| `Host key verification failed` | `SSH_KNOWN_HOSTS_BASE64` |
| `administratively prohibited` | Разрешён ли TCP forwarding на SSH-сервере |
| `Connection refused` | `DB_REMOTE_HOST` и `DB_REMOTE_PORT` |
| Telegram `chat not found` | `TELEGRAM_CHAT_ID` и добавлен ли бот в супергруппу |
| Telegram `not enough rights` | Право бота публиковать сообщения |

## Безопасность

- Используйте только закрытую Telegram-супергруппу: сообщения содержат контакты клиентов.
- Не добавляйте `.env` и `.local-secrets` в Git.
- Не публикуйте порт `15432`; Compose оставляет его только во внутренней сети.
- Используйте отдельный SSH-ключ для этого сервиса.
- Не запускайте несколько реплик с одинаковым `NOTIFIER_KEY`.

Проверить, что секреты игнорируются Git:

```bash
git check-ignore .env .local-secrets/id_ed25519
```
