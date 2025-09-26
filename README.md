# 웹 채팅 프로젝트

## 📝 프로젝트 설명

FastAPI와 WebSocket을 기반으로 한 실시간 웹 채팅 애플리케이션입니다. 사용자는 여러 채팅방을 만들고, 비밀번호를 설정하여 비공개로 대화할 수 있습니다. 파일 공유 및 클립보드 이미지 전송 기능도 지원합니다.

## ✨ 주요 기능

*   실시간 양방향 채팅 (WebSocket 기반)
*   다중 채팅방 지원
*   비밀번호로 보호되는 비공개 방 생성 기능
*   채팅방 참여자 목록 표시
*   파일 업로드 및 공유
*   클립보드에 복사된 이미지 붙여넣기(Ctrl+V)로 전송
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

    Uvicorn을 사용하여 FastAPI 서버를 실행합니다. `--reload` 옵션은 코드 변경 시 서버를 자동으로 재시작해 주어 개발에 편리합니다.

    ```bash
    uvicorn server:app --reload
    ```

4.  **애플리케이션 접속**

    서버가 실행되면 웹 브라우저를 열고 아래 주소로 접속합니다.
    [http://127.0.0.1:8000](http://127.0.0.1:8000)
