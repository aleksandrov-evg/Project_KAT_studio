# Деплой Telegram Lead Notifier через Dokploy

Эта инструкция разворачивает два связанных контейнера:

```text
lead-notifier → ssh-tunnel → SSH-сервер PostgreSQL → 127.0.0.1:5432
```

`ssh-tunnel` не публикует порт PostgreSQL наружу. `lead-notifier` не принимает
внешние запросы: HTTP-порт `3000` нужен только для его healthcheck. Поэтому домен,
HTTPS и опубликованные порты для этого Compose-сервиса не нужны.

## Перед началом

Нужны:

- репозиторий с этой директорией в Git;
- проект и окружение в Dokploy, привязанные к **серверу приложения**;
- доступ этого сервера к `SSH_HOST:SSH_PORT` и `https://api.telegram.org`;
- Telegram-бот с правом публикации в закрытый канал;
- SSH-ключ, публичная часть которого добавлена на сервер PostgreSQL, и проверенный
  файл `known_hosts` для этого сервера.

Сервер, где установлена панель Dokploy, может отличаться от сервера приложения.
Контейнеры запускаются на deployment target, выбранном у окружения.

Перед настройкой в панели проверьте с сервера приложения:

```bash
nc -zv postgres-server.example.com 22
curl -fsSI https://api.telegram.org
```

Прямой доступ к PostgreSQL на `5432` проверять и открывать не нужно.

## 1. Подготовьте секреты

На доверенном рабочем компьютере создайте отдельный SSH-ключ, установите только
его публичную часть в `~/.ssh/authorized_keys` SSH-пользователя на сервере
PostgreSQL и подтвердите fingerprint host key. Полная пошаговая процедура — в
[README.md](README.md#шаг-2-создайте-ssh-ключ).

Значения приватного ключа и `known_hosts` должны быть base64 **одной строкой**:

```bash
openssl base64 -A -in .local-secrets/id_ed25519
openssl base64 -A -in .local-secrets/known_hosts
```

Не добавляйте результат, `.env` или `.local-secrets/` в Git, тикеты и логи.

Если в логине или пароле PostgreSQL есть `@`, `:`, `/`, `#` или пробел, используйте
URL-кодированное значение в `DATABASE_URL`.

## 2. Создайте Compose-сервис

1. В Dokploy откройте нужные Project и Environment.
2. Создайте сервис: **Create Service → Compose**.
3. В General выберите тип **Docker Compose**, а не Docker Stack. Сервис использует
   `depends_on` с ожиданием healthcheck; Docker Stack это условие не поддерживает.
4. Выберите Git-провайдер, репозиторий и ветку с актуальным кодом.
5. В поле **Compose Path** укажите `telegram-lead-notifier/compose.yaml`.
6. Сохраните настройки.

Не задавайте `container_name`, не добавляйте порты и не настраивайте Domains для
этого сервиса. В Preview Compose оба сервиса должны остаться во внутренней сети;
у `lead-notifier` не должно быть опубликованного порта `3000`.

## 3. Добавьте переменные окружения

Откройте вкладку **Environment** созданного Compose-сервиса и внесите переменные
в формате `ИМЯ=значение`. Dokploy создаёт `.env` рядом с Compose-файлом и подставит
его значения в `${…}` из `compose.yaml` во время деплоя.

Отметьте как secrets по возможности следующие значения: `DATABASE_URL`,
`SSH_PRIVATE_KEY_BASE64`, `SSH_KNOWN_HOSTS_BASE64`, `TELEGRAM_BOT_TOKEN`.

```dotenv
DATABASE_URL=postgresql://db_user:db_password@ssh-tunnel:15432/database_name

SSH_HOST=postgres-server.example.com
SSH_PORT=22
SSH_USER=deploy
SSH_PRIVATE_KEY_BASE64=<base64 приватного ключа, одной строкой>
SSH_KNOWN_HOSTS_BASE64=<base64 known_hosts, одной строкой>
DB_REMOTE_HOST=127.0.0.1
DB_REMOTE_PORT=5432

TELEGRAM_BOT_TOKEN=<токен BotFather>
TELEGRAM_CHAT_ID=-1001234567890
TELEGRAM_THREAD_ID=

NOTIFIER_KEY=pilates-leads-main
POLL_INTERVAL_MS=5000
BATCH_SIZE=20
SEND_EXISTING=false
```

Обязательные переменные: `DATABASE_URL`, `SSH_HOST`, `SSH_USER`,
`SSH_PRIVATE_KEY_BASE64`, `SSH_KNOWN_HOSTS_BASE64`, `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_CHAT_ID`. Остальные имеют значения по умолчанию, но лучше сохранить
их явно, чтобы конфигурацию можно было восстановить.

В `DATABASE_URL` хост должен быть именно `ssh-tunnel`, а порт — `15432`: это имя
и внутренний порт первого контейнера из `compose.yaml`, а не адрес удалённой БД.

Для первого production-запуска оставьте `SEND_EXISTING=false`. При этом сервис
пропустит уже существующие заявки и начнёт отправлять только новые. Не запускайте
вторую реплику с тем же `NOTIFIER_KEY`.

## 4. Деплой и проверка

1. Нажмите **Deploy** и дождитесь завершения build/deployment logs.
2. В контейнерах или логах убедитесь, что `ssh-tunnel` стал `healthy`.
3. Убедитесь, что `lead-notifier` стал `healthy` и появился лог:

   ```text
   Lead notifier started
   ```

4. Отправьте новую тестовую заявку через лендинг.
5. Проверьте в логах `Lead notification sent` и получение сообщения в закрытом
   Telegram-канале.

После изменения любой переменной в Environment сохраните её и выполните новый
**Deploy**: действующие контейнеры не получают обновлённую конфигурацию сами.

## Ошибки и быстрые действия

| Симптом | Проверка / действие |
| --- | --- |
| `Permission denied (publickey)` | `SSH_USER`, соответствие приватного ключа установленному публичному ключу и SSH-порт. |
| `Host key verification failed` | Пересоздать `known_hosts` для фактического `SSH_HOST:SSH_PORT`, сверить fingerprint, обновить base64. |
| `administratively prohibited` | Разрешить TCP forwarding для SSH-пользователя на сервере PostgreSQL. |
| `Connection refused` | `DB_REMOTE_HOST` и `DB_REMOTE_PORT` с точки зрения SSH-сервера; обычно `127.0.0.1:5432`. |
| `chat not found` | `TELEGRAM_CHAT_ID` и наличие бота в канале. |
| `not enough rights` | Выдать боту право публикации в канале. |
| `ssh-tunnel` не `healthy` | Сначала устранить проблему туннеля: notifier намеренно ждёт его healthcheck. |

## Откат

Если новая версия не проходит healthcheck, в Dokploy выберите предыдущий успешный
deployment и выполните redeploy (либо верните ветку на предыдущий commit и
запустите Deploy). Не меняйте `NOTIFIER_KEY` при обычном откате — он хранит
состояние уже обработанных заявок и защищает от повторных уведомлений.

## Контроль безопасности

- Не публикуйте `15432` или `3000` в интернет.
- Telegram-канал должен быть закрытым: уведомления содержат контакты клиентов.
- Используйте отдельный SSH-ключ только для notifier и, по возможности, отдельного
  SSH-пользователя с ограниченными правами.
- После компрометации токена Telegram или SSH-ключа немедленно отзовите его,
  обновите переменную в Dokploy и заново задеплойте сервис.
