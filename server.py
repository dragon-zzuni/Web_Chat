from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, HTTPException, Depends
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi import Body
from typing import Dict, Any
import json, os
from fastapi import UploadFile, File, Form
from uuid import uuid4
from fastapi import Header
import base64
import hashlib
import secrets
from datetime import datetime, timezone

# Database integration
from database import (
    init_db, log_message, get_past_logs,
    add_room, get_room_password, get_all_rooms, delete_room_db, room_exists
)

from dotenv import load_dotenv
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

load_dotenv()

PROTECTED_ROOMS = {"구글"} # These rooms cannot be deleted
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "del")
PACKET_SECRET = os.environ.get("PACKET_SECRET", "changeme")

_aes_key = hashlib.sha256(PACKET_SECRET.encode("utf-8")).digest()
_aesgcm = AESGCM(_aes_key)
PACKET_FINGERPRINT = hashlib.sha256(PACKET_SECRET.encode("utf-8")).hexdigest()


def encrypt_payload(payload: Dict[str, Any]) -> str:
    data = json.dumps(payload).encode("utf-8")
    nonce = secrets.token_bytes(12)
    cipher = _aesgcm.encrypt(nonce, data, associated_data=None)
    token = base64.urlsafe_b64encode(nonce + cipher)
    return token.decode("utf-8")


def decrypt_payload(token: str) -> Dict[str, Any]:
    raw = base64.urlsafe_b64decode(token.encode("utf-8"))
    nonce, cipher = raw[:12], raw[12:]
    data = _aesgcm.decrypt(nonce, cipher, associated_data=None)
    return json.loads(data.decode("utf-8"))

app = FastAPI()

@app.on_event("startup")
async def startup_event():
    init_db()

templates = Jinja2Templates(directory="templates")
app.mount("/static", StaticFiles(directory="static"), name="static")

# In-memory store for active websocket connections
rooms: Dict[str, Dict[WebSocket, str]] = {}


async def room_auth(room: str, password: str):
    expected = get_room_password(room)
    if expected is None:
        raise HTTPException(status_code=404, detail="room not found")
    if expected != password:
        raise HTTPException(status_code=403, detail="wrong password")

os.makedirs("uploads", exist_ok=True)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")


@app.get("/api/rooms")
def list_rooms():
    return {"rooms": sorted(get_all_rooms())}

@app.post("/api/rooms")
async def create_room(request: Request):
    # JSON 또는 Form 모두 허용
    try:
        data = await request.json()
    except Exception:
        form = await request.form()
        data = {"name": form.get("name"), "password": form.get("password")}

    name = str(data.get("name") or "").strip()
    password = str(data.get("password") or "").strip()

    if not name or not password:
        raise HTTPException(status_code=400, detail="name and password are required")
    if room_exists(name):
        raise HTTPException(status_code=409, detail="room already exists")

    add_room(name, password)
    return {"ok": True, "room": name}

@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.get("/room", response_class=HTMLResponse)
def room_page(request: Request, room: str):
    # 방 존재 체크를 프론트에서 막지 말고, WS에서 비번 검증으로 처리
    return templates.TemplateResponse("room.html", {"request": request, "room": room})

async def broadcast_participants(room: str):
    if room in rooms:
        participants = list(rooms[room].values())
        await broadcast(room, {"type": "participants", "users": sorted(participants)})


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    try:
        join_msg = await ws.receive_json()
        if join_msg.get("type") != "join":
            await ws.close(code=4000); return

        room = join_msg.get("room") or ""
        username = join_msg.get("username") or "anon"
        password = join_msg.get("password") or ""
        color = join_msg.get("color") or "#1a73e8"

        try:
            await room_auth(room, password)
        except HTTPException as e:
            await ws.send_json({"type": "error", "message": e.detail})
            await ws.close(code=4001); return

        await ws.send_json({"type": "key_hint", "hash": PACKET_FINGERPRINT})

        # Send past logs to the newly joined user
        past_logs = get_past_logs(room)
        for log in past_logs:
            if log['type'] == 'system':
                payload = {"type": "system", "message": log["message"]}
            else:
                payload = {
                    "type": log["type"],
                    "from": log["username"],
                    "message": log["message"],
                    "url": log["url"],
                    "filename": log["filename"],
                    "color": log["color"],
                }
            ts = log.get("timestamp")
            if ts:
                payload["timestamp"] = ts if "T" in ts else f"{ts.replace(' ', 'T')}Z"
            await send_cipher(ws, payload)

        rooms.setdefault(room, {})[ws] = username
        await broadcast(room, {"type": "system", "message": f"{username}님이 입장했습니다."})
        await broadcast_participants(room)

        while True:
            incoming = await ws.receive_json()
            if incoming.get("type") != "cipher":
                continue

            try:
                payload = decrypt_payload(incoming.get("payload", ""))
            except Exception:
                await ws.send_json({"type": "error", "message": "encryption error"})
                await ws.close(code=4003)
                return

            msg_type = payload.get("type")

            if msg_type == "chat":
                msg = str(payload.get("message") or "")
                color = payload.get("color") or color
                await broadcast(room, {"type": "chat", "from": username, "message": msg, "color": color})

            elif msg_type == "rename":
                new_name = (payload.get("new") or "").strip()
                if new_name and new_name != username:
                    old = username
                    username = new_name
                    rooms[room][ws] = new_name
                    await broadcast(room, {"type": "system", "message": f"{old} → {username} 닉네임 변경"})
                    await broadcast_participants(room)

            elif msg_type == "ping":
                await send_cipher(ws, {"type": "pong"})
    except WebSocketDisconnect:
        pass
    finally:
        room_left, user_left = None, None
        for r, conns in list(rooms.items()):
            if ws in conns:
                user_left = conns.pop(ws)
                room_left = r
                if not conns:
                    rooms.pop(r, None)
                break
        
        if room_left and user_left:
            await broadcast(room_left, {"type": "system", "message": f"{user_left}님이 나갔습니다."})
            await broadcast_participants(room_left)


async def broadcast(room: str, payload: dict):
    # Log first, then broadcast
    if "timestamp" not in payload:
        payload["timestamp"] = datetime.now(timezone.utc).isoformat(timespec='seconds')
    if payload.get("type") in ["chat", "file", "system"]:
        log_message(room, payload)

    conns = rooms.get(room, {}).copy()
    for w in conns:
        try:
            await send_cipher(w, payload)
        except Exception:
            if room in rooms and w in rooms[room]:
                del rooms[room][w]

async def send_cipher(ws: WebSocket, payload: Dict[str, Any]):
    token = encrypt_payload(payload)
    await ws.send_json({"type": "cipher", "payload": token})


def safe_name(filename: str) -> str:
    # 확장자 보존 + UUID로 파일명 치환
    ext = ""
    if "." in filename:
        ext = "." + filename.split(".")[-1].lower()
    return f"{uuid4().hex}{ext}"

@app.post("/api/upload")
async def upload_file(room: str = Form(...), username: str = Form(...), file: UploadFile = File(...)):
    # 방 존재 확인
    if not room_exists(room):
        raise HTTPException(status_code=404, detail="room not found")

    # 저장 경로 준비
    os.makedirs(os.path.join("uploads", room), exist_ok=True)
    fname = safe_name(file.filename)
    fpath = os.path.join("uploads", room, fname)

    # 파일 저장
    with open(fpath, "wb") as out:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)

    public_url = f"/uploads/{room}/{fname}"

    # 업로드 알림을 방에 브로드캐스트
    await broadcast(room, {
        "type": "file",
        "from": username,
        "filename": file.filename,
        "url": public_url,
        # 파일 메시지도 보낸 사용자의 색상을 넣고 싶다면
        "color": "#1a73e8"  # 고정이 아닌 클라이언트에서 같이 보내고 싶다면 form에도 color를 추가하세요
    })


    return {"ok": True, "url": public_url, "filename": file.filename}

@app.delete("/api/rooms/{name}")
async def delete_room(name: str, x_admin_token: str = Header(None)):
    if x_admin_token != ADMIN_TOKEN:
        raise HTTPException(status_code=401, detail="invalid admin token")

    name = name.strip()
    if not room_exists(name):
        raise HTTPException(status_code=404, detail="room not found")
    if name in PROTECTED_ROOMS:
        raise HTTPException(status_code=403, detail="protected room")

    # 1) 접속자에게 공지 후 연결 종료
    if name in rooms:
        try:
            await broadcast(name, {"type": "system", "message": f"방 '{name}'이(가) 삭제되었습니다."})
        except Exception:
            pass
        for ws in list(rooms[name]):
            try:
                await ws.close(code=4002)
            except Exception:
                pass
        rooms.pop(name, None)

    # 2) DB에서 방 제거
    delete_room_db(name)

    return {"ok": True, "deleted": name}
