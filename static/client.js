function initChat({room, name, password, hooks={}}) {
    let myName = name;
    let myColor = localStorage.getItem('chat_color') || '#1a73e8';
    const colorPicker = document.getElementById('nameColor');
    if(colorPicker){ colorPicker.value = myColor; colorPicker.oninput = ()=> {
      myColor = colorPicker.value || '#1a73e8';
      localStorage.setItem('chat_color', myColor);
    };}
  
    // 🔔 탭 배지
    let unread = 0; function setTitle(){ document.title = (unread>0?`(${unread}) `:'') + `${room} 채팅방`; }
    setTitle();
    function bumpUnread(){ if(document.hidden){ unread++; setTitle(); } }
    function resetUnread(){ unread=0; setTitle(); }
    document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) resetUnread(); });
    window.addEventListener('focus', resetUnread);
  
    const log = document.getElementById('log');
    const msg = document.getElementById('msg');
    const btn = document.getElementById('send');
    const fileInput = document.getElementById('file');
    const sendFileBtn = document.getElementById('sendFile');
  
    const btnLeave  = document.getElementById('btnLeave');
    const btnRename = document.getElementById('btnRename');
    if(btnLeave)  btnLeave.onclick  = ()=> hooks.leave && hooks.leave();
    if(btnRename) btnRename.onclick = ()=>{
      const now = myName;
      const next = prompt('새 닉네임', now || '');
      if(next && next.trim() && next.trim() !== now){
        const newName = next.trim();
        // 서버에 rename 이벤트 전달
        ws.send(JSON.stringify({type:'rename', new:newName}));
        myName = newName;
      }
    };
  
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
  
    function addLine(html){
      const div = document.createElement('div');
      div.innerHTML = html;
      log.appendChild(div);
      log.scrollTop = log.scrollHeight;
    }
    const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  
    ws.onopen = () => {
      ws.send(JSON.stringify({type:"join", room, username:myName, password, color: myColor}));
      
      // 알림 권한 요청
      if (window.Notification && Notification.permission === 'default') {
        Notification.requestPermission();
      }
    };
  
    ws.onmessage = (ev) => {
      try{
        const d = JSON.parse(ev.data);
        if(d.type === 'error'){
          alert('입장 실패: ' + d.message); location.href='/';
        }else if(d.type === 'system'){
          addLine(`<div class="sys">[알림] ${esc(d.message)}</div>`);
          bumpUnread();
        }else if(d.type === 'chat'){
          const self = d.from === myName;
          const color = d.color || '#1a73e8';
          const label = `<b style="color:${esc(color)}">${esc(d.from)}</b>`;
          addLine(`<div class="chatline ${self?'me':''}">${label}: <span class="bubble">${esc(d.message)}</span></div>`);
          if(!self) bumpUnread();

          // 멘션 알림 처리
          if (d.message.includes('@' + myName)) {
            if (window.Notification && Notification.permission === 'granted') {
              new Notification(`'${room}' 방에서 새 멘션`, {
                body: `${d.from}: ${d.message}`
              });
            }
          }
        }else if(d.type === 'file'){
          const self = d.from === myName;
          const color = d.color || '#1a73e8';
          const label = `<b style="color:${esc(color)}">${esc(d.from)}</b>`;
          
          const isImage = /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(d.filename || '');
          let fileElement;

          if (isImage) {
            fileElement = `<a href="${esc(d.url)}" target="_blank" rel="noopener">
                             <img src="${esc(d.url)}" alt="${esc(d.filename)}" style="max-width: 300px; max-height: 250px; border-radius: 8px; margin-top: 4px; display: block;">
                           </a>`;
          } else {
            fileElement = `📎 <a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.filename || '파일')}</a>`;
          }

          addLine(`<div class="chatline ${self?'me':''}">${label}: ${fileElement}</div>`);
          if(!self) bumpUnread();
        }
      }catch(e){}
    };
  
    ws.onclose = () => addLine(`<div class="sys">[알림] 서버와 연결이 종료되었습니다.</div>`);
  
    // 채팅 전송 시 현재 색상 포함
    btn.onclick = () => {
      const text = msg.value.trim();
      if(!text) return;
      ws.send(JSON.stringify({type:"chat", message:text, color: myColor}));
      msg.value = ''; msg.focus();
    };
    msg.addEventListener('keydown', e => { if(e.key === 'Enter') btn.click(); });
  
    // 파일 업로드 시에도 색상을 실어 보내고 싶으면 서버쪽 폼 처리 확장 필요(선택)
    async function uploadFile(){
      const f = fileInput.files && fileInput.files[0];
      if(!f){ alert('전송할 파일을 선택하세요.'); return; }
      const fd = new FormData();
      fd.append('room', room);
      fd.append('username', myName);
      fd.append('file', f);
      // 색상을 서버에 함께 보내려면 server.py 업로드 API에 color: str = Form(None) 추가 후 아래 라인 주석 해제
      // fd.append('color', myColor);
      const res = await fetch('/api/upload', { method:'POST', body: fd });
      if(!res.ok){
        const e = await res.json().catch(()=>({detail:'unknown'}));
        alert('업로드 실패: ' + (e.detail || res.status));
        return;
      }
      fileInput.value = '';
    }
    sendFileBtn.onclick = uploadFile;
  }
  