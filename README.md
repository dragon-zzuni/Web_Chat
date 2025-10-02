# 🚀 웹 채팅 애플리케이션

## 📝 프로젝트 설명

FastAPI와 WebSocket을 기반으로 한 **실시간 웹 채팅 애플리케이션**입니다.

Discord, Slack과 유사한 현대적인 채팅 경험을 제공하며, 로컬 네트워크 환경에서 **암호화 없이도 안전하게** 사용할 수 있도록 설계되었습니다. SQLite 데이터베이스를 사용하여 채팅 기록을 영구 저장하며, 파일 공유, 메시지 반응, 답장 등 다양한 소셜 기능을 지원합니다.

### 🎯 주요 특징
- ✅ **HTTP 환경에서도 완벽 작동** - localhost 또는 로컬 IP로 접근 가능
- ✅ **풍부한 인터랙션** - 답장, 리액션, 멘션, 타이핑 표시
- ✅ **다크 모드 지원** - 눈의 피로를 줄이는 테마
- ✅ **자동 재연결** - 네트워크 끊김 시 자동 복구
- ✅ **파일 공유** - 드래그 앤 드롭, 클립보드 이미지 전송

## ✨ 주요 기능

### 💬 채팅 기능
*   실시간 양방향 채팅 (WebSocket 기반)
*   다중 채팅방 지원
*   비밀번호로 보호되는 비공개 방 생성 기능
*   채팅방 참여자 목록 표시
*   답장 기능 (특정 메시지에 답장)
*   메시지 리액션 (👍 ❤️ 😂 🎉)
*   @멘션 기능 (HTTP 호환 알림: 소리 + 제목 깜빡임)
*   타이핑 인디케이터

### 📁 파일 & 미디어
*   파일 업로드 및 공유
*   클립보드 이미지 붙여넣기(Ctrl+V)로 전송
*   드래그 앤 드롭 파일 업로드
*   이미지 자동 미리보기

### 🎨 UI/UX
*   다크 모드 토글 (🌙/☀️)
*   메시지 검색 기능 (Ctrl+K)
*   우클릭 컨텍스트 메뉴
*   자동 재연결 (WebSocket)

### 🔧 관리 기능
*   관리자 토큰을 이용한 채팅방 삭제

## ⚙️ 설정

채팅방을 삭제하려면 관리자 토큰이 필요합니다. 서버 실행 전, 아래와 같이 환경 변수 `ADMIN_TOKEN`을 설정해야 합니다.

-   **Windows (Command Prompt):**
    ```sh
    set ADMIN_TOKEN=your-secret-token
    ```

-   **Windows (PowerShell):**
    ```sh
    $env:ADMIN_TOKEN="your-secret-token"
    ```

-   **macOS / Linux / WSL:**
    ```sh
    export ADMIN_TOKEN=your-secret-token
    ```

## 📁 프로젝트 구조

```
Web_Chat/
├── src/                    # 소스 코드
│   ├── server.py          # FastAPI 서버
│   └── database.py        # 데이터베이스 로직
├── static/                # 정적 파일
│   └── client.js         # 클라이언트 JavaScript
├── templates/             # HTML 템플릿
│   ├── index.html        # 로그인 페이지
│   └── room.html         # 채팅방 페이지
├── scripts/               # 테스트/디버그 스크립트
├── data/                  # SQLite 데이터베이스
├── uploads/               # 업로드된 파일
├── run.py                # 서버 실행 스크립트
└── requirements.txt      # Python 의존성
```

## 🚀 시작하기

### 사전 준비

-   Python 3.8 이상

### 설치 및 실행

1.  **가상 환경 생성 및 활성화**

    프로젝트 루트 디렉토리에서 아래 명령어를 실행하여 가상 환경을 생성하고 활성화합니다.

    ```bash
    # 'venv' 라는 이름의 가상환경 생성
    python -m venv venv
    ```

    ```bash
    # Windows에서 활성화
    .\venv\Scripts\activate
    ```

    ```bash
    # macOS/Linux/WSL에서 활성화
    source venv/bin/activate
    ```

2.  **의존성 설치**

    아래 명령어로 프로젝트에 필요한 라이브러리를 설치합니다.

    ```bash
    pip install -r requirements.txt
    ```

3.  **서버 실행**

    간단하게 run.py 스크립트를 실행하거나 uvicorn을 직접 사용할 수 있습니다.

    **방법 1: run.py 사용 (권장)**
    ```bash
    python run.py
    ```

    **방법 2: uvicorn 직접 사용**
    ```bash
    uvicorn src.server:app --host 0.0.0.0 --port 8000 --reload
    ```

4.  **애플리케이션 접속**

    서버가 실행되면 웹 브라우저를 열고 아래 주소로 접속합니다.
    *   로컬: [http://127.0.0.1:8000](http://127.0.0.1:8000)
    *   네트워크: `http://<your-ip>:8000`
