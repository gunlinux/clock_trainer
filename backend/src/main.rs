use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use argon2::password_hash::rand_core::OsRng as SaltRng;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use axum::extract::{ConnectInfo, State};
use axum::http::header::AUTHORIZATION;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use rand::rngs::OsRng as TokenRng;
use rand::RngCore;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::json;

const SCHEMA: &str = r#"
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    username     TEXT NOT NULL,
    username_key TEXT NOT NULL UNIQUE,
    pin_hash     TEXT NOT NULL,
    created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token        TEXT PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    started_at   INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    ended_at     INTEGER,
    user_agent   TEXT
);

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id, started_at);

CREATE TABLE IF NOT EXISTS answers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL REFERENCES sessions(token),
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game        TEXT NOT NULL,
    mode        INTEGER,
    level       INTEGER NOT NULL,
    correct     INTEGER NOT NULL,
    given       TEXT,
    expected    TEXT,
    response_ms INTEGER,
    created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS answers_user_idx ON answers(user_id, created_at);
CREATE INDEX IF NOT EXISTS answers_session_idx ON answers(session_id);
"#;

#[derive(Clone)]
struct AppState {
    db: Arc<Mutex<Connection>>,
    failures: Arc<Mutex<HashMap<String, Attempts>>>,
}

struct Attempts {
    count: u32,
    window_start: Instant,
    blocked_until: Option<Instant>,
}

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn new(status: StatusCode, message: &str) -> Self {
        Self {
            status,
            message: message.to_string(),
        }
    }

    fn bad_request(message: &str) -> Self {
        Self::new(StatusCode::BAD_REQUEST, message)
    }

    fn unauthorized() -> Self {
        Self::new(StatusCode::UNAUTHORIZED, "Нужно войти заново")
    }

    fn internal() -> Self {
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Внутренняя ошибка сервера",
        )
    }

    fn too_many() -> Self {
        Self::new(
            StatusCode::TOO_MANY_REQUESTS,
            "Слишком много попыток. Подожди немного",
        )
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(json!({ "error": self.message }))).into_response()
    }
}

fn db_error(err: rusqlite::Error) -> ApiError {
    eprintln!("database error: {err}");
    ApiError::internal()
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn random_token() -> String {
    let mut bytes = [0u8; 32];
    TokenRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn hash_pin(pin: &str) -> Result<String, ApiError> {
    let salt = SaltString::generate(&mut SaltRng);
    Argon2::default()
        .hash_password(pin.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|err| {
            eprintln!("pin hash error: {err}");
            ApiError::internal()
        })
}

fn verify_pin(hash: &str, pin: &str) -> bool {
    PasswordHash::new(hash)
        .map(|parsed| {
            Argon2::default()
                .verify_password(pin.as_bytes(), &parsed)
                .is_ok()
        })
        .unwrap_or(false)
}

fn validate_username(raw: &str) -> Result<String, ApiError> {
    let name = raw.trim();
    let len = name.chars().count();
    if !(2..=24).contains(&len) {
        return Err(ApiError::bad_request(
            "Имя должно быть от 2 до 24 символов",
        ));
    }
    if !name
        .chars()
        .all(|c| c.is_alphanumeric() || c == ' ' || c == '-' || c == '_')
    {
        return Err(ApiError::bad_request(
            "В имени можно использовать буквы, цифры, пробел, дефис и подчёркивание",
        ));
    }
    Ok(name.to_string())
}

fn username_key(name: &str) -> String {
    name.trim().to_lowercase()
}

fn validate_pin(pin: &str) -> Result<(), ApiError> {
    if pin.len() == 4 && pin.chars().all(|c| c.is_ascii_digit()) {
        Ok(())
    } else {
        Err(ApiError::bad_request("PIN — это ровно 4 цифры"))
    }
}

fn bearer_token(headers: &HeaderMap) -> Option<String> {
    let value = headers.get(AUTHORIZATION)?.to_str().ok()?;
    value
        .strip_prefix("Bearer ")
        .map(|token| token.trim().to_string())
        .filter(|token| !token.is_empty())
}

fn client_key(headers: &HeaderMap, peer: SocketAddr, username: &str) -> String {
    let ip = headers
        .get("x-real-ip")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string())
        .unwrap_or_else(|| peer.ip().to_string());
    format!("{}|{}", username.to_lowercase(), ip)
}

fn is_blocked(state: &AppState, key: &str) -> bool {
    let mut failures = state.failures.lock().unwrap();
    let now = Instant::now();
    match failures.get_mut(key) {
        Some(attempts) => {
            if let Some(until) = attempts.blocked_until {
                if now < until {
                    return true;
                }
                failures.remove(key);
            }
            false
        }
        None => false,
    }
}

fn record_failure(state: &AppState, key: &str) {
    let mut failures = state.failures.lock().unwrap();
    let now = Instant::now();
    let attempts = failures.entry(key.to_string()).or_insert(Attempts {
        count: 0,
        window_start: now,
        blocked_until: None,
    });
    if now.duration_since(attempts.window_start) > Duration::from_secs(15 * 60) {
        attempts.count = 0;
        attempts.window_start = now;
    }
    attempts.count += 1;
    if attempts.count >= 10 {
        attempts.blocked_until = Some(now + Duration::from_secs(5 * 60));
        attempts.count = 0;
    }
}

fn clear_failures(state: &AppState, key: &str) {
    state.failures.lock().unwrap().remove(key);
}

fn create_session(
    conn: &Connection,
    user_id: i64,
    user_agent: Option<&str>,
) -> Result<String, ApiError> {
    let token = random_token();
    let ts = now();
    conn.execute(
        "INSERT INTO sessions (token, user_id, started_at, last_seen_at, user_agent)
         VALUES (?1, ?2, ?3, ?3, ?4)",
        params![token, user_id, ts, user_agent],
    )
    .map_err(db_error)?;
    Ok(token)
}

struct AuthUser {
    user_id: i64,
    username: String,
    token: String,
    session_started_at: i64,
}

fn authenticate(state: &AppState, headers: &HeaderMap) -> Result<AuthUser, ApiError> {
    let token = bearer_token(headers).ok_or_else(ApiError::unauthorized)?;
    let conn = state.db.lock().unwrap();
    let found = conn
        .query_row(
            "SELECT s.token, s.user_id, u.username, s.started_at
             FROM sessions s
             JOIN users u ON u.id = s.user_id
             WHERE s.token = ?1 AND s.ended_at IS NULL",
            params![token],
            |row| {
                Ok(AuthUser {
                    token: row.get(0)?,
                    user_id: row.get(1)?,
                    username: row.get(2)?,
                    session_started_at: row.get(3)?,
                })
            },
        )
        .optional()
        .map_err(db_error)?;

    let user = found.ok_or_else(ApiError::unauthorized)?;
    conn.execute(
        "UPDATE sessions SET last_seen_at = ?1 WHERE token = ?2",
        params![now(), user.token],
    )
    .map_err(db_error)?;
    Ok(user)
}

#[derive(Deserialize)]
struct Credentials {
    username: String,
    pin: String,
}

#[derive(Serialize)]
struct UserOut {
    id: i64,
    username: String,
}

#[derive(Serialize)]
struct SessionOut {
    started_at: i64,
}

#[derive(Serialize)]
struct AuthOut {
    token: String,
    user: UserOut,
    session: SessionOut,
}

async fn health() -> Json<serde_json::Value> {
    Json(json!({ "ok": true }))
}

async fn register(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<Credentials>,
) -> Result<(StatusCode, Json<AuthOut>), ApiError> {
    let username = validate_username(&body.username)?;
    validate_pin(&body.pin)?;
    let key = client_key(&headers, peer, &format!("register:{username}"));
    if is_blocked(&state, &key) {
        return Err(ApiError::too_many());
    }

    let pin_hash = hash_pin(&body.pin)?;
    let ts = now();
    let user_agent = headers
        .get("user-agent")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.chars().take(200).collect::<String>());

    let conn = state.db.lock().unwrap();
    let inserted = conn.execute(
        "INSERT INTO users (username, username_key, pin_hash, created_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![username, username_key(&username), pin_hash, ts],
    );
    if let Err(err) = inserted {
        let message = err.to_string();
        if message.contains("UNIQUE") {
            record_failure(&state, &key);
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "Такое имя уже занято",
            ));
        }
        return Err(db_error(err));
    }
    let user_id = conn.last_insert_rowid();
    let token = create_session(&conn, user_id, user_agent.as_deref())?;
    clear_failures(&state, &key);
    Ok((
        StatusCode::CREATED,
        Json(AuthOut {
            token,
            user: UserOut { id: user_id, username },
            session: SessionOut { started_at: ts },
        }),
    ))
}

async fn login(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<Credentials>,
) -> Result<Json<AuthOut>, ApiError> {
    let username = body.username.trim().to_string();
    let key = client_key(&headers, peer, &format!("login:{username}"));
    if is_blocked(&state, &key) {
        return Err(ApiError::too_many());
    }

    let row: Option<(i64, String, String)> = {
        let conn = state.db.lock().unwrap();
        conn.query_row(
            "SELECT id, username, pin_hash FROM users WHERE username_key = ?1",
            params![username_key(&username)],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(db_error)?
    };

    let (user_id, stored_name, pin_hash) = match row {
        Some(found) => found,
        None => {
            record_failure(&state, &key);
            return Err(ApiError::new(
                StatusCode::UNAUTHORIZED,
                "Неверное имя или PIN",
            ));
        }
    };

    if !verify_pin(&pin_hash, &body.pin) {
        record_failure(&state, &key);
        return Err(ApiError::new(
            StatusCode::UNAUTHORIZED,
            "Неверное имя или PIN",
        ));
    }

    let ts = now();
    let user_agent = headers
        .get("user-agent")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.chars().take(200).collect::<String>());
    let conn = state.db.lock().unwrap();
    let token = create_session(&conn, user_id, user_agent.as_deref())?;
    clear_failures(&state, &key);
    Ok(Json(AuthOut {
        token,
        user: UserOut {
            id: user_id,
            username: stored_name,
        },
        session: SessionOut { started_at: ts },
    }))
}

async fn logout(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user = authenticate(&state, &headers)?;
    let conn = state.db.lock().unwrap();
    conn.execute(
        "UPDATE sessions SET ended_at = ?1, last_seen_at = ?1
         WHERE token = ?2 AND ended_at IS NULL",
        params![now(), user.token],
    )
    .map_err(db_error)?;
    Ok(Json(json!({ "ok": true })))
}

async fn me(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user = authenticate(&state, &headers)?;
    Ok(Json(json!({
        "user": { "id": user.user_id, "username": user.username },
        "session": { "started_at": user.session_started_at }
    })))
}

#[derive(Deserialize)]
struct AnswerIn {
    game: String,
    mode: Option<i64>,
    level: i64,
    correct: bool,
    given: Option<String>,
    expected: Option<String>,
    response_ms: Option<i64>,
}

fn clamp_text(value: Option<String>) -> Option<String> {
    value.map(|text| text.chars().take(64).collect())
}

async fn add_answer(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<AnswerIn>,
) -> Result<(StatusCode, Json<serde_json::Value>), ApiError> {
    let user = authenticate(&state, &headers)?;
    let game = body.game.trim().to_lowercase();
    if game != "clock" && game != "counter" {
        return Err(ApiError::bad_request(
            "game должен быть clock или counter",
        ));
    }
    if !(1..=3).contains(&body.level) {
        return Err(ApiError::bad_request("level должен быть от 1 до 3"));
    }
    if let Some(mode) = body.mode {
        if !(1..=4).contains(&mode) {
            return Err(ApiError::bad_request("mode должен быть от 1 до 4"));
        }
    }
    let response_ms = body
        .response_ms
        .map(|ms| ms.clamp(0, 3_600_000));

    let conn = state.db.lock().unwrap();
    conn.execute(
        "INSERT INTO answers
            (session_id, user_id, game, mode, level, correct, given, expected, response_ms, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            user.token,
            user.user_id,
            game,
            body.mode,
            body.level,
            body.correct as i64,
            clamp_text(body.given),
            clamp_text(body.expected),
            response_ms,
            now()
        ],
    )
    .map_err(db_error)?;
    let id = conn.last_insert_rowid();
    Ok((StatusCode::CREATED, Json(json!({ "id": id }))))
}

fn accuracy(correct: i64, total: i64) -> f64 {
    if total == 0 {
        0.0
    } else {
        ((correct as f64 / total as f64) * 10000.0).round() / 10000.0
    }
}

#[derive(Serialize)]
struct Totals {
    sessions: i64,
    answers: i64,
    correct: i64,
    wrong: i64,
    accuracy: f64,
    play_seconds: i64,
    average_response_ms: i64,
    best_streak: i64,
    current_streak: i64,
}

#[derive(Serialize)]
struct GameStat {
    game: String,
    answers: i64,
    correct: i64,
    accuracy: f64,
    last_played_at: Option<i64>,
}

#[derive(Serialize)]
struct ModeStat {
    game: String,
    mode: Option<i64>,
    level: i64,
    answers: i64,
    correct: i64,
    accuracy: f64,
}

#[derive(Serialize)]
struct DayStat {
    day: String,
    answers: i64,
    correct: i64,
    accuracy: f64,
}

#[derive(Serialize)]
struct RecentAnswer {
    id: i64,
    game: String,
    mode: Option<i64>,
    level: i64,
    correct: bool,
    given: Option<String>,
    expected: Option<String>,
    response_ms: Option<i64>,
    created_at: i64,
}

async fn stats(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user = authenticate(&state, &headers)?;
    let conn = state.db.lock().unwrap();

    let (sessions, play_seconds): (i64, i64) = conn
        .query_row(
            "SELECT COUNT(*),
                    COALESCE(SUM(MAX(0, COALESCE(ended_at, last_seen_at) - started_at)), 0)
             FROM sessions WHERE user_id = ?1",
            params![user.user_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(db_error)?;

    let (answers, correct, avg_ms): (i64, i64, f64) = conn
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(correct), 0), COALESCE(AVG(response_ms), 0)
             FROM answers WHERE user_id = ?1",
            params![user.user_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(db_error)?;

    let mut stmt = conn
        .prepare("SELECT correct FROM answers WHERE user_id = ?1 ORDER BY created_at, id")
        .map_err(db_error)?;
    let results: Vec<i64> = stmt
        .query_map(params![user.user_id], |row| row.get(0))
        .map_err(db_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db_error)?;
    let mut best_streak = 0;
    let mut current_streak = 0;
    for value in &results {
        if *value == 1 {
            current_streak += 1;
            best_streak = best_streak.max(current_streak);
        } else {
            current_streak = 0;
        }
    }
    drop(stmt);

    let mut stmt = conn
        .prepare(
            "SELECT game, COUNT(*), COALESCE(SUM(correct), 0), MAX(created_at)
             FROM answers WHERE user_id = ?1
             GROUP BY game ORDER BY game",
        )
        .map_err(db_error)?;
    let by_game = stmt
        .query_map(params![user.user_id], |row| {
            let game: String = row.get(0)?;
            let count: i64 = row.get(1)?;
            let right: i64 = row.get(2)?;
            Ok(GameStat {
                game,
                answers: count,
                correct: right,
                accuracy: accuracy(right, count),
                last_played_at: row.get(3)?,
            })
        })
        .map_err(db_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db_error)?;
    drop(stmt);

    let mut stmt = conn
        .prepare(
            "SELECT game, mode, level, COUNT(*), COALESCE(SUM(correct), 0)
             FROM answers WHERE user_id = ?1
             GROUP BY game, mode, level
             ORDER BY game, mode, level",
        )
        .map_err(db_error)?;
    let by_mode = stmt
        .query_map(params![user.user_id], |row| {
            let game: String = row.get(0)?;
            let mode: Option<i64> = row.get(1)?;
            let level: i64 = row.get(2)?;
            let count: i64 = row.get(3)?;
            let right: i64 = row.get(4)?;
            Ok(ModeStat {
                game,
                mode,
                level,
                answers: count,
                correct: right,
                accuracy: accuracy(right, count),
            })
        })
        .map_err(db_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db_error)?;
    drop(stmt);

    let mut stmt = conn
        .prepare(
            "SELECT date(created_at, 'unixepoch', 'localtime') AS day,
                    COUNT(*), COALESCE(SUM(correct), 0)
             FROM answers WHERE user_id = ?1
             GROUP BY day ORDER BY day DESC LIMIT 30",
        )
        .map_err(db_error)?;
    let by_day = stmt
        .query_map(params![user.user_id], |row| {
            let day: String = row.get(0)?;
            let count: i64 = row.get(1)?;
            let right: i64 = row.get(2)?;
            Ok(DayStat {
                day,
                answers: count,
                correct: right,
                accuracy: accuracy(right, count),
            })
        })
        .map_err(db_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db_error)?;
    drop(stmt);

    let mut stmt = conn
        .prepare(
            "SELECT id, game, mode, level, correct, given, expected, response_ms, created_at
             FROM answers WHERE user_id = ?1
             ORDER BY created_at DESC, id DESC LIMIT 20",
        )
        .map_err(db_error)?;
    let recent = stmt
        .query_map(params![user.user_id], |row| {
            Ok(RecentAnswer {
                id: row.get(0)?,
                game: row.get(1)?,
                mode: row.get(2)?,
                level: row.get(3)?,
                correct: row.get::<_, i64>(4)? == 1,
                given: row.get(5)?,
                expected: row.get(6)?,
                response_ms: row.get(7)?,
                created_at: row.get(8)?,
            })
        })
        .map_err(db_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db_error)?;

    Ok(Json(json!({
        "user": { "id": user.user_id, "username": user.username },
        "totals": Totals {
            sessions,
            answers,
            correct,
            wrong: answers - correct,
            accuracy: accuracy(correct, answers),
            play_seconds,
            average_response_ms: avg_ms.round() as i64,
            best_streak,
            current_streak,
        },
        "by_game": by_game,
        "by_mode": by_mode,
        "by_day": by_day,
        "recent": recent,
    })))
}

fn init_db(path: &str) -> rusqlite::Result<Connection> {
    if let Some(parent) = Path::new(path).parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).ok();
        }
    }
    let conn = Connection::open(path)?;
    conn.execute_batch(SCHEMA)?;
    Ok(conn)
}

#[tokio::main]
async fn main() {
    let bind_addr = std::env::var("BIND_ADDR").unwrap_or_else(|_| "127.0.0.1:6021".to_string());
    let db_path =
        std::env::var("DATABASE_PATH").unwrap_or_else(|_| "data/clock_trainer.db".to_string());

    let conn = match init_db(&db_path) {
        Ok(conn) => conn,
        Err(err) => {
            eprintln!("cannot open database {db_path}: {err}");
            std::process::exit(1);
        }
    };

    let state = AppState {
        db: Arc::new(Mutex::new(conn)),
        failures: Arc::new(Mutex::new(HashMap::new())),
    };

    let app = Router::new()
        .route("/health", get(health))
        .route("/register", post(register))
        .route("/login", post(login))
        .route("/logout", post(logout))
        .route("/me", get(me))
        .route("/answers", post(add_answer))
        .route("/stats", get(stats))
        .with_state(state);

    let listener = match tokio::net::TcpListener::bind(&bind_addr).await {
        Ok(listener) => listener,
        Err(err) => {
            eprintln!("cannot bind {bind_addr}: {err}");
            std::process::exit(1);
        }
    };

    eprintln!("clock-trainer-api listening on {bind_addr}, database {db_path}");

    let shutdown = async {
        #[cfg(unix)]
        {
            let mut terminate = tokio::signal::unix::signal(
                tokio::signal::unix::SignalKind::terminate(),
            )
            .expect("cannot install SIGTERM handler");
            tokio::select! {
                _ = tokio::signal::ctrl_c() => {},
                _ = terminate.recv() => {},
            }
        }
        #[cfg(not(unix))]
        {
            let _ = tokio::signal::ctrl_c().await;
        }
    };

    if let Err(err) = axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown)
    .await
    {
        eprintln!("server error: {err}");
        std::process::exit(1);
    }
}
