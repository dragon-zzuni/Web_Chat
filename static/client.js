// /static/client.js
// Simplified client without encryption - works on local networks

function initChat({room, name, password, hooks={}}) {
  let myName = name;
  let myColor = localStorage.getItem('chat_color') || '#1a73e8';
  let replyingTo = null; // {id, from, message} for reply feature
  let typingTimer = null;
  let typingUsers = new Set(); // Track who's typing
  let currentPinnedId = null; // Pinned message id (room-scoped)

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
  const searchInput = document.getElementById('searchInput');
  const clearSearch = document.getElementById('clearSearch');

  // Pinned message bar (in right pane, above controls)
  const rightPane = document.querySelector('main.right');
  let pinBar = document.getElementById('pinbar');
  if (!pinBar) {
    pinBar = document.createElement('div');
    pinBar.id = 'pinbar';
    pinBar.style.cssText = 'display:none;margin:8px 0;padding:8px 12px;border:1px solid var(--border);background:var(--chip);border-radius:10px;font-size:13px;color:var(--text);';
    const inner = document.createElement('div');
    inner.style.display = 'flex';
    inner.style.alignItems = 'center';
    inner.style.gap = '8px';
    const icon = document.createElement('span');
    icon.textContent = '📌';
    const text = document.createElement('div');
    text.id = 'pinbar-text';
    text.style.flex = '1';
    const btn = document.createElement('button');
    btn.textContent = '고정 해제';
    btn.style.cssText = 'border:1px solid var(--border);background:var(--bg);color:var(--text);padding:6px 10px;border-radius:8px;cursor:pointer;';
    btn.onclick = () => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: 'pin', action: 'clear' }));
    };
    inner.appendChild(icon);
    inner.appendChild(text);
    inner.appendChild(btn);
    pinBar.appendChild(inner);
    if (rightPane) rightPane.prepend(pinBar);
  }

  function renderPinned(data) {
    if (data && data.msg_id) {
      currentPinnedId = data.msg_id;
      const who = data.from ? `<b style="color:${esc(data.color||'#1a73e8')}">${esc(data.from)}</b>` : '';
      const stamp = renderTimestamp(data.timestamp);
      const snippet = (data.message || '').slice(0, 140);
      const el = document.getElementById('pinbar-text');
      if (el) el.innerHTML = `${stamp} ${who}: ${esc(snippet)}${(data.message||'').length>140?'...':''}`;
      pinBar.style.display = '';
    } else {
      currentPinnedId = null;
      const el = document.getElementById('pinbar-text');
      if (el) el.textContent = '';
      pinBar.style.display = 'none';
    }
  }

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
  let ws = null;
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let isIntentionallyClosed = false;

  // Create connection status indicator
  let statusIndicator = document.getElementById('connection-status');
  if (!statusIndicator) {
    statusIndicator = document.createElement('div');
    statusIndicator.id = 'connection-status';
    statusIndicator.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      padding: 8px 16px;
      border-radius: 20px;
      background: #4caf50;
      color: white;
      font-size: 12px;
      display: none;
      z-index: 1000;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      transition: all 0.3s;
    `;
    document.body.appendChild(statusIndicator);
  }

  function showStatus(message, type = 'success') {
    statusIndicator.textContent = message;
    statusIndicator.style.display = 'block';
    statusIndicator.style.background = type === 'success' ? '#4caf50' : type === 'error' ? '#f44336' : '#ff9800';

    if (type === 'success') {
      setTimeout(() => {
        statusIndicator.style.display = 'none';
      }, 3000);
    }
  }

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

  // HTTP-compatible notification: play sound
  function playNotificationSound() {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.frequency.value = 800;
      oscillator.type = 'sine';
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.5);
    } catch (e) {
      console.log('Could not play sound:', e);
    }
  }

  // Flash title for mentions
  let flashInterval = null;
  function flashTitle(text) {
    if (flashInterval) return; // Already flashing
    const originalTitle = document.title;
    let isOriginal = true;
    let count = 0;
    flashInterval = setInterval(() => {
      document.title = isOriginal ? text : originalTitle;
      isOriginal = !isOriginal;
      count++;
      if (count >= 6) {
        clearInterval(flashInterval);
        flashInterval = null;
        document.title = originalTitle;
      }
    }, 500);
  }

  // Highlight @mentions in text
  function highlightMentions(text) {
    return text.replace(/@(\w+)/g, '<span style="background:#fff3cd;padding:2px 4px;border-radius:3px;font-weight:bold">@$1</span>');
  }

  // Render reactions
  function renderReactions(reactions, msgId) {
    if (!reactions || Object.keys(reactions).length === 0) return '';
    let html = '<div class="reactions" style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap;">';
    for (const [emoji, users] of Object.entries(reactions)) {
      const count = users.length;
      const title = users.join(', ');
      html += `<button class="reaction-btn" onclick="window.toggleReaction(${msgId}, '${emoji}')"
                style="border:1px solid #e0e0e0;background:#f0f0f0;border-radius:14px;padding:3px 10px;cursor:pointer;font-size:13px;font-weight:500;transition:all 0.2s;"
                title="${esc(title)}"
                onmouseover="this.style.background='#e5e5e5';this.style.transform='scale(1.05)'"
                onmouseout="this.style.background='#f0f0f0';this.style.transform='scale(1)'">${emoji} ${count}</button>`;
    }
    html += '</div>';
    return html;
  }

  // Setup reply UI
  function setupReplyUI() {
    const existingReplyBox = document.getElementById('reply-box');
    if (existingReplyBox) return existingReplyBox;

    const replyBox = document.createElement('div');
    replyBox.id = 'reply-box';
    replyBox.style.cssText = 'display:none;background:#f8f9fa;border-left:3px solid #1a73e8;padding:8px;margin-top:10px;border-radius:4px;position:relative;';
    replyBox.innerHTML = `
      <div style="font-size:12px;color:#666;margin-bottom:4px;">답장하기</div>
      <div id="reply-preview" style="font-size:13px;"></div>
      <button id="cancel-reply" style="position:absolute;top:4px;right:4px;border:none;background:transparent;cursor:pointer;font-size:18px;color:#666;">&times;</button>
    `;
    msg.parentElement.insertBefore(replyBox, msg.parentElement.firstChild);
    document.getElementById('cancel-reply').onclick = () => {
      replyingTo = null;
      replyBox.style.display = 'none';
    };
    return replyBox;
  }

  const replyBox = setupReplyUI();

  // Global function for toggling reactions (called from onclick in HTML)
  window.toggleReaction = (msgId, emoji) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // Check if current user already reacted with this emoji
    // We'll send 'add' by default, server will handle toggle logic
    ws.send(JSON.stringify({type: 'reaction', msg_id: msgId, emoji, action: 'add'}));
  };

  // Global function for setting reply target
  window.setReplyTo = (msgId, from, message) => {
    replyingTo = {id: msgId, from, message};
    replyBox.style.display = 'block';
    document.getElementById('reply-preview').innerHTML = `<b>${esc(from)}</b>: ${esc(message.substring(0, 100))}${message.length > 100 ? '...' : ''}`;
    msg.focus();
  };

  // Create custom context menu
  let contextMenu = document.getElementById('custom-context-menu');
  if (!contextMenu) {
    contextMenu = document.createElement('div');
    contextMenu.id = 'custom-context-menu';
    contextMenu.style.cssText = `
      position: fixed;
      background: white;
      border: 1px solid #dadce0;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.15);
      padding: 4px 0;
      display: none;
      z-index: 10000;
      min-width: 180px;
    `;
    document.body.appendChild(contextMenu);
  }

  // Show context menu
  function showContextMenu(e, msgId, from, message) {
    e.preventDefault();
    const isPinned = currentPinnedId && String(currentPinnedId) === String(msgId);
    contextMenu.innerHTML = `
      <div style="padding: 8px 12px; font-size: 12px; color: #666; border-bottom: 1px solid #f0f0f0; font-weight: 500;">메시지 작업</div>
      <button class="ctx-item" data-action="reply" style="width:100%;text-align:left;border:none;background:transparent;padding:8px 16px;cursor:pointer;font-size:14px;display:flex;align-items:center;gap:8px;">
        <span>↩️</span><span>답장하기</span>
      </button>
      <button class="ctx-item" data-action="${isPinned ? 'unpin' : 'pin'}" style="width:100%;text-align:left;border:none;background:transparent;padding:8px 16px;cursor:pointer;font-size:14px;display:flex;align-items:center;gap:8px;">
        <span>📌</span><span>${isPinned ? '고정 해제' : '핀으로 고정'}</span>
      </button>
      <div style="border-top: 1px solid #f0f0f0; margin: 4px 0;"></div>
      <div style="padding: 4px 12px; font-size: 11px; color: #999;">빠른 반응</div>
      <button class="ctx-item" data-action="react" data-emoji="👍" style="width:100%;text-align:left;border:none;background:transparent;padding:6px 16px;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:8px;">
        <span style="font-size:16px;">👍</span><span>좋아요</span>
      </button>
      <button class="ctx-item" data-action="react" data-emoji="❤️" style="width:100%;text-align:left;border:none;background:transparent;padding:6px 16px;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:8px;">
        <span style="font-size:16px;">❤️</span><span>하트</span>
      </button>
      <button class="ctx-item" data-action="react" data-emoji="😂" style="width:100%;text-align:left;border:none;background:transparent;padding:6px 16px;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:8px;">
        <span style="font-size:16px;">😂</span><span>웃음</span>
      </button>
      <button class="ctx-item" data-action="react" data-emoji="🎉" style="width:100%;text-align:left;border:none;background:transparent;padding:6px 16px;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:8px;">
        <span style="font-size:16px;">🎉</span><span>축하</span>
      </button>
    `;

    // Position menu at cursor
    contextMenu.style.left = e.pageX + 'px';
    contextMenu.style.top = e.pageY + 'px';
    contextMenu.style.display = 'block';

    // Add hover effects
    const items = contextMenu.querySelectorAll('.ctx-item');
    items.forEach(item => {
      item.onmouseover = () => item.style.background = '#f8f9fa';
      item.onmouseout = () => item.style.background = 'transparent';

      item.onclick = () => {
        const action = item.getAttribute('data-action');
        if (action === 'reply') {
          window.setReplyTo(msgId, from, message);
        } else if (action === 'pin') {
          if (!ws || ws.readyState !== WebSocket.OPEN) return;
          ws.send(JSON.stringify({ type: 'pin', action: 'set', msg_id: msgId }));
        } else if (action === 'unpin') {
          if (!ws || ws.readyState !== WebSocket.OPEN) return;
          ws.send(JSON.stringify({ type: 'pin', action: 'clear' }));
        } else if (action === 'react') {
          const emoji = item.getAttribute('data-emoji');
          window.toggleReaction(msgId, emoji);
        }
        contextMenu.style.display = 'none';
      };
    });
  }

  // Hide context menu on click anywhere
  document.addEventListener('click', () => {
    if (contextMenu) contextMenu.style.display = 'none';
  });

  // Global function to show context menu
  window.showMessageMenu = showContextMenu;

  // Show typing indicator
  function updateTypingIndicator() {
    let indicator = document.getElementById('typing-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'typing-indicator';
      indicator.style.cssText = 'font-size:12px;color:#666;font-style:italic;margin:8px 0;height:18px;';
      log.parentElement.insertBefore(indicator, log.nextSibling);
    }
    if (typingUsers.size > 0) {
      const names = Array.from(typingUsers).join(', ');
      indicator.textContent = `${names}님이 입력 중...`;
    } else {
      indicator.textContent = '';
    }
  }

  function connectWebSocket() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
      return;
    }

    ws = new WebSocket(`${proto}://${location.host}/ws`);

    ws.onopen = () => {
      reconnectAttempts = 0;
      showStatus('✅ 연결됨', 'success');
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

    ws.onclose = (event) => {
      if (!isIntentionallyClosed) {
        addLine(`<div class="sys">[알림] 연결이 끊어졌습니다. 재연결 시도 중...</div>`);

        // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
        reconnectAttempts++;

        showStatus(`🔄 재연결 중... (${reconnectAttempts}번째 시도)`, 'warning');

        reconnectTimer = setTimeout(() => {
          connectWebSocket();
        }, delay);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  // Initial connection
  connectWebSocket();

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
    if (d.type === 'typing') {
      if (d.from && d.from !== myName) {
        typingUsers.add(d.from);
        updateTypingIndicator();
        // Clear typing after 3 seconds
        setTimeout(() => {
          typingUsers.delete(d.from);
          updateTypingIndicator();
        }, 3000);
      }
      return;
    }
    if (d.type === 'pin_update') {
      renderPinned(d.msg_id ? d : null);
      return;
    }
    if (d.type === 'reaction_update') {
      // Update existing message reactions
      const msgElement = document.querySelector(`[data-msg-id="${d.msg_id}"]`);
      if (msgElement) {
        const existingReactions = msgElement.querySelector('.reactions');
        if (existingReactions) existingReactions.remove();
        const reactionsHtml = renderReactions(d.reactions, d.msg_id);
        if (reactionsHtml) {
          msgElement.insertAdjacentHTML('beforeend', reactionsHtml);
        }
      }
      return;
    }
    if (d.type === 'chat') {
      const self = d.from === myName;
      const color = d.color || '#1a73e8';
      const label = `<b style="color:${esc(color)}">${esc(d.from)}</b>`;
      const stamp = renderTimestamp(d.timestamp);

      // Reply context
      let replyHtml = '';
      if (d.reply_to_id) {
        const replyMsg = document.querySelector(`[data-msg-id="${d.reply_to_id}"]`);
        if (replyMsg) {
          const replyText = replyMsg.getAttribute('data-msg-text') || '';
          const replyFrom = replyMsg.getAttribute('data-msg-from') || '';
          replyHtml = `<div style="background:#e8eaed;border-left:3px solid #1a73e8;padding:4px 8px;margin-bottom:4px;font-size:12px;border-radius:4px;">
            <b>${esc(replyFrom)}</b>: ${esc(replyText.substring(0, 50))}${replyText.length > 50 ? '...' : ''}
          </div>`;
        }
      }

      // Message with @mentions highlighted
      const messageHtml = highlightMentions(esc(d.message));

      const reactionsHtml = d.reactions ? renderReactions(d.reactions, d.id) : '';

      // Escape message for context menu
      const escapedMsg = d.message.replace(/'/g, "\\'").replace(/"/g, '&quot;');

      addLine(`<div class="chatline ${self?'me':''}" data-msg-id="${d.id || ''}" data-msg-from="${esc(d.from)}" data-msg-text="${esc(d.message)}" style="margin-bottom:8px;display:block;padding:6px;border-radius:8px;transition:background 0.15s;" oncontextmenu="window.showMessageMenu(event, ${d.id}, '${esc(d.from)}', '${escapedMsg}'); return false;" onmouseover="this.style.background='#f8f9fa'" onmouseout="this.style.background='transparent'">
        <div style="display:flex;align-items:flex-end;gap:6px;">${stamp}${label}: <span class="bubble">${replyHtml}${messageHtml}</span></div>
        ${reactionsHtml}
      </div>`);

      if (!self) bumpUnread();

      // HTTP-compatible @mention notification
      if (!self && d.message && d.message.includes('@' + myName)) {
        playNotificationSound();
        flashTitle(`💬 ${d.from}님이 멘션`);
        // Try browser notification if available
        if (window.Notification && Notification.permission === 'granted') {
          new Notification(`'${room}' 방에서 새 멘션`, { body: `${d.from}: ${d.message}` });
        }
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
    const payload = {type:'chat', message:text, color: myColor};
    if (replyingTo) {
      payload.reply_to_id = replyingTo.id;
    }
    ws.send(JSON.stringify(payload));
    msg.value = '';
    // Clear reply state
    replyingTo = null;
    replyBox.style.display = 'none';
    msg.focus();
  };
  msg.addEventListener('keydown', e => { if (e.key === 'Enter') btn.click(); });

  // Send typing indicator
  msg.addEventListener('input', () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // Debounce typing event
    if (typingTimer) clearTimeout(typingTimer);
    ws.send(JSON.stringify({type: 'typing'}));
    typingTimer = setTimeout(() => {
      typingTimer = null;
    }, 1000);
  });

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

  // --- Message Search ---
  if (searchInput && clearSearch) {
    searchInput.addEventListener('input', () => {
      const query = searchInput.value.trim().toLowerCase();
      const messages = log.querySelectorAll('.chatline, .sys');

      if (query) {
        clearSearch.style.display = 'block';
        let matchCount = 0;

        messages.forEach(msgEl => {
          const text = msgEl.textContent.toLowerCase();
          if (text.includes(query)) {
            msgEl.style.display = '';
            msgEl.style.background = '#fff3cd'; // Highlight matches
            matchCount++;
          } else {
            msgEl.style.display = 'none';
          }
        });

        // Show match count
        if (matchCount === 0) {
          searchInput.style.borderColor = '#f44336';
        } else {
          searchInput.style.borderColor = '#4caf50';
        }
      } else {
        clearSearch.style.display = 'none';
        searchInput.style.borderColor = '';
        messages.forEach(msgEl => {
          msgEl.style.display = '';
          msgEl.style.background = '';
        });
      }
    });

    clearSearch.onclick = () => {
      searchInput.value = '';
      searchInput.dispatchEvent(new Event('input'));
      searchInput.focus();
    };

    // Ctrl+K to focus search
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        searchInput.focus();
      }
    });
  }

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
