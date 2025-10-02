// /static/client.js
// Simplified client without encryption - works on local networks

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
  const dropOverlay = document.getElementById('drop-overlay');

  const btnLeave  = document.getElementById('btnLeave');
  const btnRename = document.getElementById('btnRename');
  if (btnLeave)  btnLeave.onclick  = () => hooks.leave && hooks.leave();
  if (btnRename) btnRename.onclick = async () => {
    const applyRename = async (candidate) => {
      const trimmed = (candidate || '').trim();
      if (!trimmed || trimmed === myName) return;
      ws.send(JSON.stringify({type:'rename', new: trimmed}));
      myName = trimmed;
    };

    if (hooks.rename) {
      await hooks.rename(() => myName, applyRename);
      return;
    }

    const now = myName;
    const next = prompt('새 닉네임', now || '');
    await applyRename(next);
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
  function renderTimestamp(ts) {
    if (!ts) return '';
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return '';
    const display = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const title = date.toLocaleString();
    const iso = date.toISOString();
    return '<time class="timestamp" datetime="' + iso + '" title="' + esc(title) + '">' + esc(display) + '</time>';
  }

  ws.onopen = () => {
    ws.send(JSON.stringify({type:"join", room, username:myName, password, color: myColor}));
    if (window.Notification && Notification.permission === 'default') Notification.requestPermission();
  };

  ws.onmessage = async (ev) => {
    let payload;
    try {
      payload = JSON.parse(ev.data);
    } catch (e) {
      return;
    }
    handlePayload(payload);
  };

  function handlePayload(d) {
    if (!d || !d.type) return;
    if (d.type === 'error') {
      alert('입장 실패: ' + (d.message || '오류'));
      location.href = '/';
      return;
    }
    if (d.type === 'system') {
      const stamp = renderTimestamp(d.timestamp);
      addLine(`<div class="sys">${stamp}<span>[알림] ${esc(d.message || '')}</span></div>`);
      bumpUnread();
      return;
    }
    if (d.type === 'chat') {
      const self = d.from === myName;
      const color = d.color || '#1a73e8';
      const label = `<b style="color:${esc(color)}">${esc(d.from)}</b>`;
      const stamp = renderTimestamp(d.timestamp);
      addLine(`<div class="chatline ${self?'me':''}">${stamp}${label}: <span class="bubble">${esc(d.message)}</span></div>`);
      if (!self) bumpUnread();
      if (!self && d.message && d.message.includes('@' + myName) && window.Notification && Notification.permission === 'granted') {
        new Notification(`'${room}' 방에서 새 멘션`, { body: `${d.from}: ${d.message}` });
      }
      return;
    }
    if (d.type === 'file') {
      const self = d.from === myName;
      const color = d.color || '#1a73e8';
      const label = `<b style="color:${esc(color)}">${esc(d.from)}</b>`;
      const stamp = renderTimestamp(d.timestamp);
      const isImage = /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(d.filename || '');
      let fileElement;
      if (isImage) {
        fileElement = `<a href="${esc(d.url)}" target="_blank" rel="noopener">
                         <img src="${esc(d.url)}" alt="${esc(d.filename)}" style="max-width: 300px; max-height: 250px; border-radius: 8px; margin-top: 4px; display: block;">
                       </a>`;
      } else {
        fileElement = `📎 <a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.filename || '파일')}</a>`;
      }
      addLine(`<div class="chatline ${self?'me':''}">${stamp}${label}: ${fileElement}</div>`);
      if (!self) bumpUnread();
      return;
    }
    if (d.type === 'participants') {
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
      return;
    }
    if (d.type === 'pong') {
      return;
    }
  }

  ws.onclose = () => addLine(`<div class="sys">[알림] 서버와 연결이 종료되었습니다.</div>`);

  btn.onclick = async () => {
    const text = msg.value.trim();
    if (!text) return;
    ws.send(JSON.stringify({type:'chat', message:text, color: myColor}));
    msg.value = '';
    msg.focus();
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
  document.addEventListener('paste', async (e) => {
    const items = e.clipboardData.items;
    if (!items) return;

    const imageItem = Array.from(items).find(item => item.type.startsWith('image/'));
    if (!imageItem) return;

    e.preventDefault();

    const imageFile = imageItem.getAsFile();
    const timestamp = new Date().toISOString().replace(/[-:.]/g, '');
    const fileName = `clipboard-${timestamp}.png`;
    const newFile = new File([imageFile], fileName, {type: imageFile.type});

    if (confirm('클립보드의 이미지를 전송하시겠습니까? (Send image from clipboard?)')) {
      await sendFile(newFile);
    }
  });

  // 드래그 앤 드롭 파일 업로드
  if (dropOverlay) {
    document.body.addEventListener('dragenter', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropOverlay.style.display = 'flex';
    });

    dropOverlay.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    dropOverlay.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.target === dropOverlay) {
        dropOverlay.style.display = 'none';
      }
    });

    dropOverlay.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropOverlay.style.display = 'none';

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        if (confirm(`총 ${files.length}개의 파일을 전송하시겠습니까? (Upload ${files.length} file(s)?)`)) {
          for (const file of files) {
            await sendFile(file);
          }
        }
      }
    });
  }

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
      if (isDragWithFiles(e) && dropOverlay) { e.preventDefault(); dropOverlay.classList.add('active'); }
    });
  });
  ['dragleave','drop'].forEach(t => {
    document.addEventListener(t, (e) => {
      if (t === 'dragleave' && e.relatedTarget && document.documentElement.contains(e.relatedTarget)) return;
      if (dropOverlay) dropOverlay.classList.remove('active');
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
