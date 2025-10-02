import sqlite3
import os
from typing import List, Dict, Any

# 데이터베이스 파일 경로 설정
DB_FILE = os.path.join("data", "data.db")

def init_db():
    """데이터베이스와 테이블들을 초기화합니다."""
    os.makedirs("data", exist_ok=True)
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()

    # chat_logs 테이블 생성
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS chat_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room TEXT NOT NULL,
        username TEXT NOT NULL,
        message TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        type TEXT NOT NULL DEFAULT 'chat',
        url TEXT,
        filename TEXT,
        color TEXT,
        reply_to_id INTEGER,
        reactions TEXT DEFAULT '{}'
    )
    """)

    # 기존 테이블에 새 컬럼 추가 (마이그레이션)
    try:
        cursor.execute("ALTER TABLE chat_logs ADD COLUMN reply_to_id INTEGER")
    except sqlite3.OperationalError:
        pass  # 컬럼이 이미 존재

    try:
        cursor.execute("ALTER TABLE chat_logs ADD COLUMN reactions TEXT DEFAULT '{}'")
    except sqlite3.OperationalError:
        pass  # 컬럼이 이미 존재

    # rooms 테이블 생성
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS rooms (
        name TEXT PRIMARY KEY,
        password TEXT NOT NULL,
        pinned_message_id INTEGER
    )
    """)

    # 마이그레이션: 기존 rooms 테이블에 pinned_message_id 컬럼 추가
    try:
        cursor.execute("ALTER TABLE rooms ADD COLUMN pinned_message_id INTEGER")
    except sqlite3.OperationalError:
        pass  # 이미 존재

    # rooms 테이블이 비어있으면 기본 방 추가
    cursor.execute("SELECT COUNT(*) FROM rooms")
    if cursor.fetchone()[0] == 0:
        cursor.execute("INSERT INTO rooms (name, password) VALUES (?, ?)", ("dev", "devpass123"))
        cursor.execute("INSERT INTO rooms (name, password) VALUES (?, ?)", ("general", "hello1234"))

    conn.commit()
    conn.close()

def log_message(room: str, payload: Dict[str, Any]):
    """채팅 메시지 페이로드를 데이터베이스에 저장합니다."""
    msg_type = payload.get("type")
    if msg_type not in ["chat", "file", "system"]:
        return

    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()

    cursor.execute("""
    INSERT INTO chat_logs (room, username, message, type, url, filename, color, reply_to_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        room,
        payload.get("from", "system"),
        payload.get("message"),
        msg_type,
        payload.get("url"),
        payload.get("filename"),
        payload.get("color"),
        payload.get("reply_to_id")
    ))

    msg_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return msg_id

def get_past_logs(room: str, limit: int = 50) -> List[Dict[str, Any]]:
    """특정 방의 과거 채팅 기록을 가져옵니다."""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute("""
    SELECT * FROM (
        SELECT * FROM chat_logs WHERE room = ? ORDER BY timestamp DESC LIMIT ?
    ) ORDER BY timestamp ASC
    """, (room, limit))
    
    logs = cursor.fetchall()
    conn.close()
    
    return [dict(log) for log in logs]

# --- Room Management Functions ---

def add_room(name: str, password: str):
    """새로운 방을 데이터베이스에 추가합니다."""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("INSERT INTO rooms (name, password) VALUES (?, ?)", (name, password))
    conn.commit()
    conn.close()

def get_room_password(name: str) -> str | None:
    """방 이름으로 비밀번호를 조회합니다."""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("SELECT password FROM rooms WHERE name = ?", (name,))
    result = cursor.fetchone()
    conn.close()
    return result[0] if result else None

def get_all_rooms() -> List[str]:
    """모든 방의 이름 목록을 조회합니다."""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM rooms")
    rooms = [row[0] for row in cursor.fetchall()]
    conn.close()
    return rooms

def delete_room_db(name: str):
    """데이터베이스에서 방을 삭제합니다."""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM rooms WHERE name = ?", (name,))
    conn.commit()
    conn.close()

def room_exists(name: str) -> bool:
    """방 존재 여부를 확인합니다."""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("SELECT 1 FROM rooms WHERE name = ?", (name,))
    result = cursor.fetchone()
    conn.close()
    return result is not None

# --- Pinned Message Functions ---

def set_pinned_message(room: str, msg_id: int | None):
    """방에 고정된 메시지를 설정하거나 해제합니다."""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("UPDATE rooms SET pinned_message_id = ? WHERE name = ?", (msg_id, room))
    conn.commit()
    conn.close()

    # Also ensure legacy DBs are migrated if present
    try:
        migrate_if_old_schema(DB_FILE)
    except Exception:
        pass
    legacy_path = os.path.join("tmp", "data.db")
    if os.path.exists(legacy_path):
        try:
            migrate_if_old_schema(legacy_path)
        except Exception:
            pass

def get_pinned_message_id(room: str) -> int | None:
    """방의 고정 메시지 ID를 반환합니다."""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("SELECT pinned_message_id FROM rooms WHERE name = ?", (room,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        return None
    return row[0]

# --- Reaction Functions ---

def add_reaction(msg_id: int, emoji: str, username: str):
    """메시지에 리액션을 추가합니다."""
    import json
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()

    cursor.execute("SELECT reactions FROM chat_logs WHERE id = ?", (msg_id,))
    result = cursor.fetchone()
    if not result:
        conn.close()
        return

    reactions = json.loads(result[0] or "{}")
    if emoji not in reactions:
        reactions[emoji] = []
    if username not in reactions[emoji]:
        reactions[emoji].append(username)

    cursor.execute("UPDATE chat_logs SET reactions = ? WHERE id = ?",
                   (json.dumps(reactions), msg_id))
    conn.commit()
    conn.close()
    return reactions

def remove_reaction(msg_id: int, emoji: str, username: str):
    """메시지에서 리액션을 제거합니다."""
    import json
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()

    cursor.execute("SELECT reactions FROM chat_logs WHERE id = ?", (msg_id,))
    result = cursor.fetchone()
    if not result:
        conn.close()
        return

    reactions = json.loads(result[0] or "{}")
    if emoji in reactions and username in reactions[emoji]:
        reactions[emoji].remove(username)
        if not reactions[emoji]:
            del reactions[emoji]

    cursor.execute("UPDATE chat_logs SET reactions = ? WHERE id = ?",
                   (json.dumps(reactions), msg_id))
    conn.commit()
    conn.close()
    return reactions

def get_message_by_id(msg_id: int) -> Dict[str, Any] | None:
    """메시지 ID로 메시지를 조회합니다."""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM chat_logs WHERE id = ?", (msg_id,))
    result = cursor.fetchone()
    conn.close()

    return dict(result) if result else None

# --- Schema Migration Helpers ---

def _get_columns(conn: sqlite3.Connection, table: str) -> set:
    cur = conn.execute(f"PRAGMA table_info({table})")
    return {row[1] for row in cur.fetchall()}

def migrate_if_old_schema(db_path: str):
    """
    Ensure the SQLite database at db_path has all required columns.
    Adds missing columns for backward compatibility with older schemas.
    - chat_logs: reply_to_id, reactions
    - rooms: pinned_message_id
    """
    os.makedirs(os.path.dirname(db_path or '.'), exist_ok=True)
    conn = sqlite3.connect(db_path)
    try:
        cur = conn.cursor()

        # chat_logs table may be missing new columns in older DBs
        try:
            cols = _get_columns(conn, 'chat_logs')
            if 'reply_to_id' not in cols:
                cur.execute("ALTER TABLE chat_logs ADD COLUMN reply_to_id INTEGER")
            if 'reactions' not in cols:
                cur.execute("ALTER TABLE chat_logs ADD COLUMN reactions TEXT DEFAULT '{}' ")
        except sqlite3.OperationalError:
            pass

        # rooms table: ensure pinned_message_id exists
        try:
            cols = _get_columns(conn, 'rooms')
            if 'pinned_message_id' not in cols:
                cur.execute("ALTER TABLE rooms ADD COLUMN pinned_message_id INTEGER")
        except sqlite3.OperationalError:
            pass

        conn.commit()
    finally:
        conn.close()
