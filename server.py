# server.py
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, HTTPException, Depends
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi import Body
from typing import Dict, Set
import json, os
from fastapi import UploadFile, File, Form
from uuid import uuid4
from fastapi import Header

DATA_FILE = "room_passwords.json"
PROTECTED_ROOMS = set()
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "del")

app = FastAPI()
templates = Jinja2Templates(directory="templates")
app.mount("/static", StaticFiles(directory="static"), name="static")

# 방 비밀번호 (원하면 파일로 분리 가능)
ROOM_PASSWORDS: Dict[str, str] = {
    "dev": "devpass123",
    "general": "hello1234"
}

def load_rooms():
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"dev":"devpass123", "general":"hello1234"}

def save_rooms(rooms_dict):
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(rooms_dict, f, ensure_ascii=False, indent=2)

ROOM_PASSWORDS = load_rooms()
rooms: Dict[str, Dict[WebSocket, str]] = {}


async def room_auth(room: str, password: str):
    expected = ROOM_PASSWORDS.get(room)
    if expected is None:
        raise HTTPException(status_code=404, detail="room not found")
    if expected != password:
        raise HTTPException(status_code=403, detail="wrong password")

os.makedirs("uploads", exist_ok=True)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")


@app.get("/api/rooms")
def list_rooms():
    # 방 이름만 노출(비번은 숨김)
    return {"rooms": sorted(list(ROOM_PASSWORDS.keys()))}

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
    if name in ROOM_PASSWORDS:
        raise HTTPException(status_code=409, detail="room already exists")

    ROOM_PASSWORDS[name] = password
    save_rooms(ROOM_PASSWORDS)
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
        color = join_msg.get("color") or "#1a73e8"  # 닉네임 색 기본

        try:
            await room_auth(room, password)
        except HTTPException as e:
            await ws.send_json({"type": "error", "message": e.detail})
            await ws.close(code=4001); return

        rooms.setdefault(room, {})[ws] = username
        await broadcast(room, {"type": "system", "message": f"{username}님이 입장했습니다."})
        await broadcast_participants(room)

        while True:
            data = await ws.receive_json()
            t = data.get("type")

            if t == "chat":
                msg = str(data.get("message") or "")
                # 클라이언트가 보낸 최신 색상 반영
                color = data.get("color") or color
                await broadcast(room, {"type": "chat", "from": username, "message": msg, "color": color})

            elif t == "rename":
                new_name = (data.get("new") or "").strip()
                if new_name and new_name != username:
                    old = username
                    username = new_name
                    rooms[room][ws] = new_name
                    await broadcast(room, {"type": "system", "message": f"{old} → {username} 닉네임 변경"})
                    await broadcast_participants(room)

            elif t == "ping":
                await ws.send_json({"type":"pong"})
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
    conns = rooms.get(room, {}).copy()
    for w in conns:
        try:
            await w.send_json(payload)
        except Exception:
            # 깨진 연결 제거
            if room in rooms and w in rooms[room]:
                del rooms[room][w]

def safe_name(filename: str) -> str:
    # 확장자 보존 + UUID로 파일명 치환
    ext = ""
    if "." in filename:
        ext = "." + filename.split(".")[-1].lower()
    return f"{uuid4().hex}{ext}"

@app.post("/api/upload")
async def upload_file(room: str = Form(...), username: str = Form(...), file: UploadFile = File(...)):
    # 방 존재 확인
    if room not in ROOM_PASSWORDS:
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
    if name not in ROOM_PASSWORDS:
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

    # 2) 저장된 비밀번호/목록에서 제거
    ROOM_PASSWORDS.pop(name, None)
    save_rooms(ROOM_PASSWORDS)

    return {"ok": True, "deleted": name}