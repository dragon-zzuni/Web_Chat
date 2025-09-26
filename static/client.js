// /static/client.js (full file)
// Implements: chat, file upload, paste-to-send, async clipboard button, drag-and-drop.

const subtle = window.crypto && window.crypto.subtle;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const makeCryptoError = (code, message) => {
  const err = new Error(message);
  err.code = code;
  return err;
};

const base64UrlEncode = (buffer) => {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const base64UrlDecode = (input) => {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  const base64 = (input + pad).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

async function deriveAesKey(passphrase) {
  if (!subtle) {
    throw makeCryptoError('UNSUPPORTED', 'WebCrypto not supported');
  }
  const material = await subtle.digest('SHA-256', textEncoder.encode(passphrase));
  return subtle.importKey('raw', material, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptWithKey(key, payload) {
  if (!subtle) {
    throw makeCryptoError('UNSUPPORTED', 'WebCrypto not supported');
  }
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encoded = textEncoder.encode(JSON.stringify(payload));
  const cipher = await subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  const combined = new Uint8Array(iv.byteLength + cipher.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipher), iv.byteLength);
  return base64UrlEncode(combined);
}

async function decryptWithKey(key, token) {
  if (!subtle) {
    throw makeCryptoError('UNSUPPORTED', 'WebCrypto not supported');
  }
  const raw = base64UrlDecode(token);
  if (raw.length <= 12) {
    throw makeCryptoError('DECRYPT_FAIL', 'cipher too short');
  }
  const iv = raw.slice(0, 12);
  const cipher = raw.slice(12);
  try {
    const plain = await subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
    return JSON.parse(textDecoder.decode(plain));
  } catch (err) {
    throw makeCryptoError('DECRYPT_FAIL', 'unable to decrypt');
  }
}

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

  const storageKey = 'chat_packet_key';
  let packetKey = localStorage.getItem(storageKey) || '';
  let cryptoKey = null;
  const encryptedQueue = [];
  let keyNoticeShown = false;
  let serverKeyHash = null;
  let fingerprintCheckId = 0;

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
  const dropHintOverlay = document.getElementById('dropOverlay');
  const keyInput = document.getElementById('packetKey');
  const keyApplyBtn = document.getElementById('applyPacketKey');
  const keyStatus = document.getElementById('packetKeyStatus');

  const btnLeave  = document.getElementById('btnLeave');
  const btnRename = document.getElementById('btnRename');
  if (btnLeave)  btnLeave.onclick  = () => hooks.leave && hooks.leave();
  if (btnRename) btnRename.onclick = async () => {
    const applyRename = async (candidate) => {
      const trimmed = (candidate || '').trim();
      if (!trimmed || trimmed === myName) return;
      const ok = await sendSecure({type:'rename', new: trimmed});
      if (ok) myName = trimmed;
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

  ws.onopen = () => {
    ws.send(JSON.stringify({type:"join", room, username:myName, password, color: myColor}));
    if (window.Notification && Notification.permission === 'default') Notification.requestPermission();
  };

  ws.onmessage = async (ev) => {
    let envelope;
    try {
      envelope = JSON.parse(ev.data);
    } catch (e) {
      return;
    }

    if (envelope.type === 'key_hint') {
      serverKeyHash = (envelope.hash || '').toLowerCase() || null;
      fingerprintCheckId++;
      if (serverKeyHash && packetKey) verifyKeyFingerprint();
      return;
    }

    if (envelope.type === 'error') {
      handlePayload(envelope);
      return;
    }

    if (envelope.type !== 'cipher') {
      handlePayload(envelope);
      return;
    }

    try {
      const payload = await decryptPayload(envelope.payload);
      handlePayload(payload);
      keyNoticeShown = false;
      await processQueue();
    } catch (err) {
      if (err.code === 'NO_KEY') {
        encryptedQueue.push(envelope.payload);
        if (!keyNoticeShown) {
          addLine('<div class="sys">[암호화] 메시지를 보려면 로그인 화면 하단에서 공유된 코드를 저장하세요.</div>');
          keyNoticeShown = true;
        }
      } else if (err.code === 'DECRYPT_FAIL') {
        encryptedQueue.push(envelope.payload);
        updateKeyStatus('복호화 실패 - 키를 확인하세요', false);
      } else if (err.code === 'UNSUPPORTED') {
        updateKeyStatus('브라우저가 WebCrypto를 지원하지 않습니다.', false);
      } else {
        console.error('decrypt error', err);
      }
    }
  };

  function handlePayload(d) {
    if (!d || !d.type) return;
    if (d.type === 'key_hint') {
      serverKeyHash = (d.hash || '').toLowerCase() || null;
      fingerprintCheckId++;
      if (serverKeyHash && packetKey) verifyKeyFingerprint();
      return;
    }
    if (d.type === 'error') {
      if ((d.message || '') === 'encryption error') {
        updateKeyStatus('암호화 실패 - 서버와 공유한 코드를 확인하세요.', false);
        alert('암호화 키가 서버 설정과 다릅니다. 로그인 화면에서 동일한 코드를 저장한 뒤 다시 접속하세요.');
      } else {
        alert('입장 실패: ' + (d.message || '오류'));
      }
      location.href = '/';
      return;
    }
    if (d.type === 'system') {
      addLine(`<div class="sys">[알림] ${esc(d.message || '')}</div>`);
      bumpUnread();
      return;
    }
    if (d.type === 'chat') {
      const self = d.from === myName;
      const color = d.color || '#1a73e8';
      const label = `<b style="color:${esc(color)}">${esc(d.from)}</b>`;
      addLine(`<div class="chatline ${self?'me':''}">${label}: <span class="bubble">${esc(d.message)}</span></div>`);
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

  const defaultStatusMsg = '키 미설정 - 로그인 화면 하단에서 코드를 입력하세요.';

  async function verifyKeyFingerprint() {
    if (!subtle) return;
    if (!serverKeyHash) return;
    if (!packetKey) {
      fingerprintCheckId++;
      updateKeyStatus(defaultStatusMsg, false);
      return;
    }

    const currentCheck = ++fingerprintCheckId;
    try {
      const digest = await subtle.digest('SHA-256', textEncoder.encode(packetKey));
      if (currentCheck !== fingerprintCheckId) return;
      const hex = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
      if (hex === serverKeyHash) {
        updateKeyStatus('키 적용됨 (서버와 일치)', true);
      } else {
        updateKeyStatus('키 불일치 - 로그인 화면에서 서버와 동일한 코드를 저장하세요.', false);
      }
    } catch (err) {
      console.error('verifyKeyFingerprint error', err);
    }
  }

  function updateKeyStatus(text, ok = true) {
    if (!keyStatus) return;
    keyStatus.textContent = text;
    keyStatus.style.color = ok ? '#1a73e8' : '#d93025';
  }

  function setPacketKey(value, persist = true) {
    packetKey = (value || '').trim();
    cryptoKey = null;
    if (packetKey) {
      if (persist) localStorage.setItem(storageKey, packetKey);
      updateKeyStatus('키 적용됨 (로컬 저장)', true);
      processQueue();
      verifyKeyFingerprint();
    } else {
      if (persist) localStorage.removeItem(storageKey);
      updateKeyStatus(defaultStatusMsg, false);
      fingerprintCheckId++;
    }
  }

  async function getCryptoKey() {
    if (!packetKey) throw makeCryptoError('NO_KEY', 'packet key missing');
    if (cryptoKey) return cryptoKey;
    cryptoKey = await deriveAesKey(packetKey);
    return cryptoKey;
  }

  async function encryptPayload(payload) {
    const key = await getCryptoKey();
    return encryptWithKey(key, payload);
  }

  async function decryptPayload(token) {
    const key = await getCryptoKey();
    return decryptWithKey(key, token);
  }

  async function processQueue() {
    if (!packetKey || !encryptedQueue.length) return;
    const pending = encryptedQueue.splice(0, encryptedQueue.length);
    for (const token of pending) {
      try {
        const payload = await decryptPayload(token);
        handlePayload(payload);
        keyNoticeShown = false;
      } catch (err) {
        if (err.code === 'NO_KEY') {
          encryptedQueue.push(token);
          return;
        }
        if (err.code === 'DECRYPT_FAIL') {
          encryptedQueue.unshift(token);
          updateKeyStatus('복호화 실패 - 키를 확인하세요', false);
          return;
        }
        if (err.code === 'UNSUPPORTED') {
          updateKeyStatus('브라우저가 WebCrypto를 지원하지 않습니다.', false);
          return;
        }
        console.error('processQueue error', err);
        return;
      }
    }
  }

  async function sendSecure(payload) {
    try {
      const cipher = await encryptPayload(payload);
      ws.send(JSON.stringify({type:'cipher', payload: cipher}));
      return true;
    } catch (err) {
      if (err.code === 'NO_KEY') {
        updateKeyStatus(defaultStatusMsg, false);
        alert('암호화 키를 먼저 입력하세요. 로그인 화면 하단에서 코드를 저장하세요.');
      } else if (err.code === 'UNSUPPORTED') {
        updateKeyStatus('브라우저가 WebCrypto를 지원하지 않습니다.', false);
        alert('이 브라우저에서는 암호화를 사용할 수 없습니다.');
      } else {
        updateKeyStatus('암호화 실패 - 키를 확인하세요', false);
        alert('메시지를 암호화하지 못했습니다. 콘솔을 확인하세요.');
      }
      console.error('sendSecure error', err);
      return false;
    }
  }

  if (keyInput) {
    keyInput.value = packetKey;
    keyInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') setPacketKey(keyInput.value);
    });
  }
  if (keyApplyBtn) keyApplyBtn.onclick = () => setPacketKey(keyInput ? keyInput.value : '');
  if (packetKey) setPacketKey(packetKey, false); else updateKeyStatus(defaultStatusMsg, false);
  window.addEventListener('storage', (event) => {
    if (event.key === storageKey) {
      setPacketKey(event.newValue || '', false);
    }
  });
  if (!subtle) updateKeyStatus('브라우저가 WebCrypto를 지원하지 않습니다.', false);

  ws.onclose = () => addLine(`<div class="sys">[알림] 서버와 연결이 종료되었습니다.</div>`);

  btn.onclick = async () => {
    const text = msg.value.trim();
    if (!text) return;
    const ok = await sendSecure({type:'chat', message:text, color: myColor});
    if (ok) {
      msg.value = '';
      msg.focus();
    }
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
      const items = e.clipboardData.items;
      if (!items) return;

      const imageItem = Array.from(items).find(item => item.type.startsWith('image/'));
      if (!imageItem) return; // 이미지가 아니면 기본 동작을 막지 않음

      // 이미지가 있으면 기본 붙여넣기 동작(예: contenteditable에 이미지 태그 삽입)을 막음
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
    const dropOverlay = document.getElementById('drop-overlay');

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
      if (isDragWithFiles(e) && dropHintOverlay) { e.preventDefault(); dropHintOverlay.classList.add('active'); }
    });
  });
  ['dragleave','drop'].forEach(t => {
    document.addEventListener(t, (e) => {
      if (t === 'dragleave' && e.relatedTarget && document.documentElement.contains(e.relatedTarget)) return;
      if (dropHintOverlay) dropHintOverlay.classList.remove('active');
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
