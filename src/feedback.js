import { game, API, safeStorage, animRunning, setAnimRunning } from './state.js';
import { render } from './render.js';

export function toggleFeedbackChat() {
  const body = document.getElementById('feedback-body');
  const icon = document.getElementById('feedback-toggle-icon');
  if (!body) return;
  if (body.style.display === 'none') {
    body.style.display = 'block';
    if (icon) icon.textContent = '\u25BC';
    document.getElementById('feedback-input')?.focus();
  } else {
    body.style.display = 'none';
    if (icon) icon.textContent = '\u25B6';
  }
}

// ── Client-side rate limiting ──
let _fbSendTimes = [];
const _FB_CLIENT_COOLDOWN_MS = 15000;  // 15s between messages
const _FB_CLIENT_MAX_PER_HOUR = 10;

export async function sendFeedback() {
  const input = document.getElementById('feedback-input');
  const msg = input.value.trim();
  if (!msg) return;

  // Client-side cooldown
  const now = Date.now();
  _fbSendTimes = _fbSendTimes.filter(t => now - t < 3600000);
  if (_fbSendTimes.length > 0 && now - _fbSendTimes[_fbSendTimes.length - 1] < _FB_CLIENT_COOLDOWN_MS) {
    const wait = Math.ceil((_FB_CLIENT_COOLDOWN_MS - (now - _fbSendTimes[_fbSendTimes.length - 1])) / 1000);
    const messagesDiv = document.getElementById('feedback-messages');
    const hint = document.createElement('div');
    hint.style.cssText = 'color:#8a8578;font-size:12px;padding:4px 12px';
    hint.textContent = `Please wait ${wait}s before sending another message.`;
    messagesDiv.appendChild(hint);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    return;
  }
  if (_fbSendTimes.length >= _FB_CLIENT_MAX_PER_HOUR) {
    const messagesDiv = document.getElementById('feedback-messages');
    const hint = document.createElement('div');
    hint.style.cssText = 'color:#8a8578;font-size:12px;padding:4px 12px';
    hint.textContent = 'Hourly feedback limit reached. Thanks for all your input!';
    messagesDiv.appendChild(hint);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    return;
  }
  _fbSendTimes.push(now);

  const messagesDiv = document.getElementById('feedback-messages');

  // Show user message
  const userBubble = document.createElement('div');
  userBubble.style.cssText = 'color:#e8e0d0;font-size:13px;line-height:1.4;padding:8px 12px;background:#252a25;border-radius:8px;align-self:flex-end;max-width:85%';
  userBubble.textContent = msg;
  messagesDiv.appendChild(userBubble);

  input.value = '';
  messagesDiv.scrollTop = messagesDiv.scrollHeight;

  // Show typing indicator
  const typing = document.createElement('div');
  typing.style.cssText = 'color:#8a8578;font-size:12px;padding:4px 12px';
  typing.textContent = 'Reviewing...';
  messagesDiv.appendChild(typing);

  try {
    // Gather game state context
    const gameContext = game ? {
      turn: game.turn,
      gold: game.gold,
      military: game.military,
      population: game.population,
      score: game.score,
    } : null;

    const res = await fetch(API + '/api/feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-visitor-id': safeStorage.getItem('uncivilised_visitor_id') || '',
      },
      body: JSON.stringify({
        message: msg,
        visitor_id: safeStorage.getItem('uncivilised_visitor_id') || null,
        player_name: safeStorage.getItem('uncivilised_username') || null,
        game_state: gameContext,
        admin_secret: safeStorage.getItem('uncivilised_admin_secret') || undefined,
      }),
    });

    typing.remove();

    const data = await res.json();

    if (data.success && data.response) {
      const aiBubble = document.createElement('div');
      aiBubble.style.cssText = 'color:#b8b0a0;font-size:13px;line-height:1.4;padding:8px 12px;background:#1a1f1a;border-radius:8px;border-left:2px solid #c9a84c40';
      aiBubble.textContent = data.response;
      messagesDiv.appendChild(aiBubble);

      if (data.category) {
        const tag = document.createElement('div');
        const colors = { bug_report: '#d9534f', feature_request: '#5b8dd9', gameplay_feedback: '#c9a84c', question: '#8a8578' };
        tag.style.cssText = 'font-size:10px;padding:2px 8px;border-radius:4px;display:inline-block;margin-top:4px;background:' + (colors[data.category] || '#555') + '20;color:' + (colors[data.category] || '#888');
        tag.textContent = data.category.replace('_', ' ');
        messagesDiv.appendChild(tag);
      }
    } else {
      const errBubble = document.createElement('div');
      errBubble.style.cssText = 'color:#d9534f;font-size:12px;padding:4px 12px';
      errBubble.textContent = 'Could not process feedback. Please try again.';
      messagesDiv.appendChild(errBubble);
    }
  } catch (e) {
    typing.remove();
    const errBubble = document.createElement('div');
    errBubble.style.cssText = 'color:#d9534f;font-size:12px;padding:4px 12px';
    errBubble.textContent = 'Connection error. Please try again.';
    messagesDiv.appendChild(errBubble);
  }

  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Animation loop for pulsing selection ring
export function startAnimLoop() {
  if (animRunning) return;
  setAnimRunning(true);
  function tick() {
    if (!game || !game.selectedUnitId) { setAnimRunning(false); return; }
    render();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
