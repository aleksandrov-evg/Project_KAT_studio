# Деплой Telegram Lead Notifier через Dokploy

Сервис запускается одним контейнером и подключается к PostgreSQL напрямую по
`DATABASE_URL`.

```text
lead-notifier → PostgreSQL
```

HTTP-порт `3000` используется только для healthcheck. Домен, HTTPS и публикация
этого порта для Compose-сервиса не требуются.

## Перед началом

Нужны репозиторий с этой директорией, Project и Environment в Dokploy на сервере
приложения, Telegram-бот с правом писать в закрытую супергруппу и доступ сервера
приложения к PostgreSQL и `https://api.telegram.org`.

Проверьте доступность базы с deployment-сервера, подставив её адрес и порт:

```bash
nc -zv postgres.example.com 5432
curl -fsSI https://api.telegram.org
```

## 1. Создайте Compose-сервис

1. В Dokploy откройте нужные Project и Environment.
2. Создайте сервис: **Create Service → Compose**.
3. Выберите репозиторий и актуальную ветку.
4. В поле **Compose Path** укажите `telegram-lead-notifier/compose.yaml`.
5. Сохраните настройки.

Не задавайте `container_name`, не добавляйте порты и не настраивайте Domains.

## 2. Добавьте переменные окружения

В Environment добавьте значения в формате `ИМЯ=значение`. В качестве секрета
отметьте `DATABASE_URL`, `TELEGRAM_BOT_TOKEN` и `TWENTY_API_KEY` (если CRM включена).

```dotenv
DATABASE_URL=postgresql://db_user:db_password@postgres.example.com:5432/database_name

TELEGRAM_BOT_TOKEN=<токен BotFather>
TELEGRAM_CHAT_ID=-1001234567890
TELEGRAM_THREAD_ID=

NOTIFIER_KEY=pilates-leads-main
POLL_INTERVAL_MS=5000
BATCH_SIZE=20
SEND_EXISTING=false
```

`DATABASE_URL` — прямая строка подключения, выданная для PostgreSQL; имя хоста и
порт должны указывать на сам сервер базы, не на Docker-сервис. Если логин или
пароль содержат `@`, `:`, `/`, `#` или пробел, URL-кодируйте их.

Обязательны `DATABASE_URL`, `TELEGRAM_BOT_TOKEN` и `TELEGRAM_CHAT_ID`.
Для первого production-запуска оставьте `SEND_EXISTING=false` и не запускайте
вторую реплику с тем же `NOTIFIER_KEY`.

## 3. Деплой и проверка

1. Нажмите **Deploy**.
2. Убедитесь, что `lead-notifier` стал `healthy` и в логах есть `Lead notifier started`.
3. Отправьте тестовую заявку через лендинг.
4. Проверьте лог `Lead notification sent` и сообщение в закрытой Telegram-группе.

После изменения переменных выполните новый **Deploy**.

## Ошибки и быстрые действия

| Симптом | Проверка / действие |
| --- | --- |
| `ECONNREFUSED`, timeout или ошибка DNS | Доступ с deployment-сервера к адресу и порту из `DATABASE_URL`, firewall и корректность DSN. |
| Ошибка аутентификации PostgreSQL | Логин, пароль, имя базы и разрешение пользователя подключаться с сервера приложения. |
| `chat not found` | `TELEGRAM_CHAT_ID` и наличие бота в группе. |
| `not enough rights` | Выдать боту право публикации в группе. |

## Безопасность

- Не публикуйте порт `3000` в интернет.
- Telegram-группа должна быть закрытой: уведомления содержат контакты клиентов.
- Храните DSN и токены только в секретах Dokploy; после компрометации замените их
  и заново разверните сервис.
