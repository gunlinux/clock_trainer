# API тренажёров

Небольшой сервер на Rust для аккаунтов и статистики двух игр. Обе страницы уже подключены к API через общий модуль `account.js`, но вход остаётся необязательным: без аккаунта игры работают как раньше.

- **Стек:** Rust (Axum), SQLite (rusqlite со встроенным SQLite), Argon2 для PIN.
- **Адрес:** `127.0.0.1:6021`; наружу отдаётся через nginx по `/clock_trainer/api/`.
- **База:** `/home/loki/www/clock_trainer/backend/data/clock_trainer.db` (WAL, права `700`).
- **Служба:** `clock-trainer-api.service` (systemd, пользователь `loki`).

## Сборка и запуск

```bash
cd /home/loki/www/clock_trainer/backend
cargo build --release
BIND_ADDR=127.0.0.1:6021 DATABASE_PATH=data/clock_trainer.db \
  ./target/release/clock-trainer-api
```

Переменные окружения:

| Переменная | По умолчанию | Назначение |
| --- | --- | --- |
| `BIND_ADDR` | `127.0.0.1:6021` | Адрес и порт; наружу не выставлять. |
| `DATABASE_PATH` | `data/clock_trainer.db` | Файл SQLite; каталог создаётся сам. |

Управление службой:

```bash
sudo systemctl status clock-trainer-api
sudo systemctl restart clock-trainer-api
sudo journalctl -u clock-trainer-api -n 50 --no-pager
```

nginx проксирует префикс со срезанием:

```nginx
location /clock_trainer/api/ {
  proxy_pass http://127.0.0.1:6021/;
  ...
}
```

Поэтому снаружи `https://gunlinux.ru/clock_trainer/api/health` — это `GET /health` на сервере.

## Аккаунты и сессии

- Имя: 2–24 символа, буквы, цифры, пробел, дефис, подчёркивание. Регистр не важен: «Аня» и «аня» — одно имя (ключ хранится в нижнем регистре, Unicode-aware).
- PIN: ровно 4 цифры, хранится как Argon2-хеш.
- Сессия начинается при регистрации или входе и заканчивается при выходе. Токен — 32 случайных байта (64 hex-символа), передаётся как `Authorization: Bearer <token>`.
- После 10 неудачных попыток входа с одного имени и IP вход блокируется на 5 минут (в памяти процесса).

## Эндпоинты

Все тела — JSON, ответы — JSON. Ошибки: `{"error": "текст"}` с кодом 400/401/409/429/500.

| Метод | Путь | Тело | Что делает |
| --- | --- | --- | --- |
| `GET` | `/health` | — | `{"ok":true}` |
| `POST` | `/register` | `{username, pin}` | Создаёт пользователя и сессию, `201`. Занятое имя — `409`. |
| `POST` | `/login` | `{username, pin}` | Проверяет PIN и создаёт новую сессию. |
| `POST` | `/logout` | — | Закрывает текущую сессию (нужен токен). |
| `GET` | `/me` | — | Пользователь и начало текущей сессии. |
| `POST` | `/answers` | см. ниже | Сохраняет один ответ, `201` с `{id}`. |
| `GET` | `/stats` | — | Сводная статистика пользователя. |

Успешный вход и регистрация возвращают:

```json
{
  "token": "…64 hex…",
  "user": { "id": 1, "username": "Аня" },
  "session": { "started_at": 1793813627 }
}
```

### `POST /answers`

```json
{
  "game": "clock",
  "mode": 1,
  "level": 2,
  "correct": true,
  "given": "13:45",
  "expected": "01:45 / 13:45",
  "response_ms": 4200
}
```

- `game`: `clock` или `counter`.
- `mode`: 1–4 для часов, `null` для счёта.
- `level`: 1–3.
- `given`, `expected`: необязательные строки, обрезаются до 64 символов.
- `response_ms`: необязательное время ответа, зажимается в 0…3 600 000.

### `GET /stats`

```json
{
  "user": { "id": 1, "username": "Аня" },
  "totals": {
    "sessions": 2, "answers": 2, "correct": 1, "wrong": 1,
    "accuracy": 0.5, "play_seconds": 0, "average_response_ms": 6600,
    "best_streak": 1, "current_streak": 0
  },
  "by_game": [{ "game": "clock", "answers": 1, "correct": 1,
                "accuracy": 1.0, "last_played_at": 1793813628 }],
  "by_mode": [{ "game": "clock", "mode": 1, "level": 2, "answers": 1,
                "correct": 1, "accuracy": 1.0 }],
  "by_day":  [{ "day": "2026-11-04", "answers": 2, "correct": 1, "accuracy": 0.5 }],
  "recent":  [{ "id": 2, "game": "counter", "mode": null, "level": 3,
                "correct": false, "given": "12", "expected": "13",
                "response_ms": 9000, "created_at": 1793813628 }]
}
```

- `accuracy` — доля верных от 0 до 1 с точностью до 4 знаков.
- `play_seconds` — сумма длительностей закрытых сессий; у активной берётся последняя активность.
- `best_streak` / `current_streak` — серии верных ответов по всей истории.
- `by_day` — последние 30 дней по локальному времени сервера, новые сверху.
- `recent` — 20 последних ответов.

## Подключение страниц

`account.js` и `account.css` лежат в корне репозитория и подключены к `index.html` и `counter.html`.

- Кнопка **Войти** в шапке открывает окно с вкладками «Вход» и «Регистрация»; после входа там же показывается статистика (ответы, точность, серия, время, разбивка по играм и последним дням).
- Токен хранится в `localStorage` под ключом `clockTrainerAccount` и общий для обеих страниц. «Выйти» закрывает сессию и на сервере.
- Запросы идут на относительный `api/`, то есть со страницы `/clock_trainer/` на `/clock_trainer/api/`. Для другого адреса задайте `window.CLOCK_API_BASE` перед подключением `account.js`.
- Каждый проверенный ответ отправляется в `POST /answers`:

| Игра | `game` | `mode` | `given` | `expected` |
| --- | --- | --- | --- | --- |
| «Выбери время» | `clock` | `1` | выбранный вариант как `01:45 / 13:45` | правильное время так же |
| «Запиши время» | `clock` | `2` | введённое `ЧЧ:ММ` | правильное время как `01:45 / 13:45` |
| «Поставь время» | `clock` | `3` | выставленное время как `01:45 / 13:45` | то же |
| «Учимся считать» | `counter` | `null` | выбранное или введённое число | правильный ответ |

- В «Поставь время» ответ появляется только когда стрелки совпали с целью; промежуточные перетаскивания не логируются.
- Неверный ввод в полях («Запиши время» и «Сложно» в счёте) не отправляется: событие создаётся только после проверенного ответа.
- Если сервер недоступен, игра продолжает работать; ответ просто не сохраняется.

## Схема базы

```sql
users(id, username, username_key UNIQUE, pin_hash, created_at)
sessions(token PK, user_id → users, started_at, last_seen_at, ended_at, user_agent)
answers(id PK, session_id → sessions, user_id → users, game, mode,
        level, correct, given, expected, response_ms, created_at)
```

Схема создаётся при старте (`CREATE TABLE IF NOT EXISTS`) и дополняется индексами по пользователю и сессии. Отдельных миграций нет: при изменении схемы нужно добавить идемпотентный `ALTER`/`CREATE` в `SCHEMA` и перезапустить службу.

## Резервная копия

```bash
systemctl stop clock-trainer-api   # необязательно, WAL переживает копию
sqlite3 /home/loki/www/clock_trainer/backend/data/clock_trainer.db \
  ".backup '/home/loki/backup/clock_trainer-$(date +%F).db'"
systemctl start clock-trainer-api
```

PIN из четырёх цифр перебирается быстро даже с Argon2, поэтому не используйте эти аккаунты для чего-то, кроме детского тренажёра. Сервер слушает только localhost и доступен снаружи лишь через nginx.
