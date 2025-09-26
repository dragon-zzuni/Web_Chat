// /static/client.js (full file)
// Implements: chat, file upload, paste-to-send, async clipboard button, drag-and-drop.

function initChat({room, name, password, hooks={}}) {
  let myName = name;
  let myColor = localStorage.getItem('chat_color') || '#1a73e8';
  const colorPicker = document.getElementById('nameColor');
  if (colorPicker) {
    colorPicker.value = myColor;
    colorPicker.oninput = () => {
      myColor = colorPicker.value || '#1a73e8';
      localStorage.setItem('chat_color', myColor);
    };
  }

  let unread = 0;
  function setTitle(){ document.title = (unread>0?`(${unread}) `:'') + `${room} 채팅방`; }
  function bumpUnread(){ if(document.hidden){ unread++; setTitle(); } }
  function resetUnread(){ unread=0; setTitle(); }
  setTitle();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) resetUnread(); });
  window.addEventListener('focus', resetUnread);

  const log = document.getElementById('log');
  const msg = document.getElementById('msg');
  const btn = document.getElementById('send');
  const fileInput = document.getElementById('file');
  const sendFileBtn = document.getElementById('sendFile');
  const pasteBtn = document.getElementById('pasteFromClipboard');
  const dropOverlay = document.getElementById('dropOverlay');

  const btnLeave  = document.getElementById('btnLeave');
  const btnRename = document.getElementById('btnRename');
  if (btnLeave)  btnLeave.onclick  = () => hooks.leave && hooks.leave();
  if (btnRename) btnRename.onclick = () => {
    const now = myName;
    const next = prompt('새 닉네임', now || '');
    if (next && next.trim() && next.trim() !== now) {
      const newName = next.trim();
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
  const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));

  ws.onopen = () => {
    ws.send(JSON.stringify({type:"join", room, username:myName, password, color: myColor}));
    if (window.Notification && Notification.permission === 'default') Notification.requestPermission();
  };

  ws.onmessage = (ev) => {
    try {
      const d = JSON.parse(ev.data);
      if (d.type === 'error') {
        alert('입장 실패: ' + d.message); location.href='/';
      } else if (d.type === 'system') {
        addLine(`<div class="sys">[알림] ${esc(d.message)}</div>`);
        bumpUnread();
      } else if (d.type === 'chat') {
        const self = d.from === myName;
        const color = d.color || '#1a73e8';
        const label = `<b style="color:${esc(color)}">${esc(d.from)}</b>`;
        addLine(`<div class="chatline ${self?'me':''}">${label}: <span class="bubble">${esc(d.message)}</span></div>`);
        if (!self) bumpUnread();
        if (!self && d.message.includes('@' + myName) && window.Notification && Notification.permission === 'granted') {
          new Notification(`'${room}' 방에서 새 멘션`, { body: `${d.from}: ${d.message}` });
        }
      } else if (d.type === 'file') {
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
        if (!self) bumpUnread();
      } else if (d.type === 'participants') {
        const pList = document.getElementById('participant-list');
        const pCount = document.getElementById('p-count');
        if (!pList || !pCount) return;
        pCount.textContent = d.users.length;
        pList.innerHTML = '';
        d.users.forEach(user => {
          const li = document.createElement('li');
          li.style.margin = '4px 0';
          if (user === myName) li.innerHTML = `<b>${esc(user)} (나)</b>`;
          else li.textContent = esc(user);
          pList.appendChild(li);
        });
      }
    } catch (e) {}
  };

  ws.onclose = () => addLine(`<div class="sys">[알림] 서버와 연결이 종료되었습니다.</div>`);

  btn.onclick = () => {
    const text = msg.value.trim();
    if (!text) return;
    ws.send(JSON.stringify({type:"chat", message:text, color: myColor}));
    msg.value = ''; msg.focus();
  };
  msg.addEventListener('keydown', e => { if (e.key === 'Enter') btn.click(); });

  // --- File upload primitive ---
  const MAX_IMAGE_BYTES = 25 * 1024 * 1024; // safety cap
  async function sendFile(file) {
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) { alert('파일이 너무 큽니다.'); return; }
    const fd = new FormData();
    fd.append('room', room);
    fd.append('username', myName);
    fd.append('file', file);
    try {
      const res = await fetch('/api/upload', { method:'POST', body: fd });
      if (!res.ok) {
        const e = await res.json().catch(()=>({detail:'unknown'}));
        alert('업로드 실패: ' + (e.detail || res.status));
      }
    } catch (e) {
      alert('업로드 중 에러 발생: ' + e.message);
    }
  }

  async function uploadFile(){
    const f = fileInput.files && fileInput.files[0];
    if(!f){ alert('전송할 파일을 선택하세요.'); return; }
    await sendFile(f);
    fileInput.value = '';
  }
  sendFileBtn.onclick = uploadFile;

  // --- Paste to send (document-wide) ---
  let lastPastedSignature = null;
  function fileSignature(file) { return `${file.type}:${file.size}`; }

  function findClipboardImageFromEvent(e) {
    if (!e.clipboardData) return null;
    if (e.clipboardData.files && e.clipboardData.files.length) {
      for (const f of e.clipboardData.files) if (f.type.startsWith('image/')) return f;
    }
    if (e.clipboardData.items && e.clipboardData.items.length) {
      for (const item of e.clipboardData.items) if (item.type && item.type.startsWith('image/')) return item.getAsFile();
    }
    return null;
  }

  document.addEventListener('paste', async (e) => {
    const imageFile = findClipboardImageFromEvent(e);
    if (!imageFile) return;
    e.preventDefault();
    const sig = fileSignature(imageFile);
    if (sig === lastPastedSignature) return;
    lastPastedSignature = sig;
    const timestamp = new Date().toISOString().replace(/[-:.]/g, '');
    const ext = (imageFile.type.split('/')[1] || 'png').toLowerCase();
    const fileName = `clipboard-${timestamp}.${ext}`;
    const newFile = new File([imageFile], fileName, { type: imageFile.type || 'image/png' });
    const ok = confirm('클립보드의 이미지를 전송하시겠습니까?');
    if (ok) await sendFile(newFile);
  });

  // --- Async Clipboard API button (secure context, user gesture required) ---
  pasteBtn?.addEventListener('click', async () => {
    if (!navigator.clipboard || !navigator.clipboard.read) {
      alert('이 브라우저에서는 클립보드 읽기를 지원하지 않습니다.');
      return;
    }
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            const blob = await item.getType(type);
            const timestamp = new Date().toISOString().replace(/[-:.]/g, '');
            const ext = (blob.type.split('/')[1] || 'png').toLowerCase();
            const fileName = `clipboard-${timestamp}.${ext}`;
            const file = new File([blob], fileName, { type: blob.type || 'image/png' });
            const ok = confirm('클립보드의 이미지를 전송하시겠습니까?');
            if (ok) await sendFile(file);
            return;
          }
        }
      }
      alert('클립보드에서 이미지를 찾을 수 없습니다.');
    } catch (err) {
      alert('클립보드 읽기가 차단되었거나 실패했습니다.');
    }
  });

  // --- Drag and drop to log area ---
  function isDragWithFiles(evt){ return evt.dataTransfer && Array.from(evt.dataTransfer.types||[]).includes('Files'); }

  ['dragenter','dragover'].forEach(t => {
    document.addEventListener(t, (e) => {
      if (isDragWithFiles(e)) { e.preventDefault(); dropOverlay.classList.add('active'); }
    });
  });
  ['dragleave','drop'].forEach(t => {
    document.addEventListener(t, (e) => {
      if (t === 'dragleave' && e.relatedTarget && document.documentElement.contains(e.relatedTarget)) return;
      dropOverlay.classList.remove('active');
    });
  });

  log.addEventListener('drop', async (e) => {
    if (!isDragWithFiles(e)) return;
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files || []);
    const images = files.filter(f => f.type.startsWith('image/'));
    const others = files.filter(f => !f.type.startsWith('image/'));
    for (const f of images) await sendFile(f);
    for (const f of others) await sendFile(f);
  });
}

