/**
 * PlanItAesthetic - Modern Planning Poker Client
 * Fully client-side, real-time collaboration using MQTT over Secure WebSockets.
 */

// ==========================================================================
// Application Configuration & Constants
// ==========================================================================
const DECK_VALUES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '?', 'C'];

// Public secure WebSocket MQTT brokers to try in sequence
const BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt'
];

// ==========================================================================
// Application State
// ==========================================================================
const state = {
  // User Profile
  username: '',
  userId: '',

  // Room Status
  roomName: '',
  roomId: '',
  invitedRoomId: '',
  invitedRoomName: '',
  currentStory: 'Story #1',
  gameState: 'voting', // 'voting' | 'revealed'

  // Timer State
  timerSeconds: 0,
  timerInterval: null,
  heartbeatInterval: null,
  presenceCheckInterval: null,
  isTimerHost: false, // The oldest online user maintains/broadcasts the timer

  // Players (Real and Simulated)
  players: {}, // Map of userId -> player details

  // Local User Selection
  currentVote: null,
  voteTime: 0, // Time when local user voted
  voteTimerStart: 0,

  // Connection and Mode
  mqttClient: null,
  currentBrokerIndex: 0,
  isOfflineMode: false,
  connectionTimeout: null,

  // Card templates state
  deckType: 'sequential',
  deckValues: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '?', 'C'],

  // UI Accordion State
  isInviteOpen: false
};

// ==========================================================================
// Core Initialization
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
  generateUserId();
  loadProfileFromCache();
  initRouting();
  setupEventListeners();
  renderDeck();
});

// Generate a random unique ID for the user
function generateUserId() {
  let id = localStorage.getItem('poker_user_id');
  if (!id) {
    id = 'user_' + Math.random().toString(36).substring(2, 11);
    localStorage.setItem('poker_user_id', id);
  }
  state.userId = id;
}

// Load profile and room history
function loadProfileFromCache() {
  const profile = JSON.parse(localStorage.getItem('poker_user_profile') || '{}');
  if (profile.username) {
    state.username = profile.username;
    document.getElementById('usernameInput').value = profile.username;
  }
  renderRecentRooms();
}

// Safely parse room ID and name from URL hash fragment
function parseRoomHash(hashStr) {
  if (!hashStr || !hashStr.startsWith('#/room/')) return null;

  const raw = hashStr.substring(7);
  const qIndex = raw.indexOf('?');
  let rawPath = raw;
  let queryString = '';

  if (qIndex !== -1) {
    rawPath = raw.substring(0, qIndex);
    queryString = raw.substring(qIndex + 1);
  }

  rawPath = rawPath.replace(/\/+$|#+$/g, '');
  if (!rawPath) return null;

  const roomId = decodeURIComponent(rawPath);
  let roomName = '';

  if (queryString) {
    const urlParams = new URLSearchParams(queryString);
    roomName = urlParams.get('name') || '';
  }

  return { roomId, roomName };
}

// Check URL hash for room auto-routing
function initRouting() {
  const parsed = parseRoomHash(window.location.hash);
  if (parsed && parsed.roomId) {
    state.roomId = parsed.roomId;
    state.invitedRoomId = parsed.roomId;

    if (parsed.roomName) {
      state.roomName = parsed.roomName;
      state.invitedRoomName = parsed.roomName;
    } else {
      // Fallback: extract from roomId
      const parts = parsed.roomId.split('-');
      if (parts.length > 1) {
        state.roomName = parts.slice(0, -1).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
      } else {
        state.roomName = parsed.roomId;
      }
      state.invitedRoomName = state.roomName;
    }

    // Fill the room input
    document.getElementById('roomInput').value = state.roomName;

    // If username is cached, auto-join, otherwise wait for submit
    if (state.username) {
      joinRoom();
    } else {
      showScreen('welcomeScreen');
    }
  } else {
    // Welcome screen default
    showScreen('welcomeScreen');
    generateRandomRoomName();
  }
}

// Generate a random fun name for rooms
function generateRandomRoomName() {
  const adjs = ['agile', 'scrum', 'sprint', 'retro', 'velocity', 'poker', 'feature', 'epic'];
  const nouns = ['ninjas', 'wizards', 'titans', 'builders', 'coders', 'masters', 'squad'];
  const adj = adjs[Math.floor(Math.random() * adjs.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(100 + Math.random() * 900);

  const randomName = `${adj}-${noun}-${num}`;
  document.getElementById('roomInput').value = randomName;
}

// Screen management
function showScreen(screenId) {
  document.querySelectorAll('.screen-panel').forEach(screen => {
    screen.style.display = 'none';
    screen.classList.remove('active-screen');
  });
  const screen = document.getElementById(screenId);
  screen.style.display = screenId === 'boardScreen' ? 'grid' : 'flex';
  screen.classList.add('active-screen');

  if (screenId === 'boardScreen') {
    document.getElementById('leaveRoomBtn').style.display = 'flex';
  } else {
    document.getElementById('leaveRoomBtn').style.display = 'none';
  }
}

// Card template choices mapping
const DECK_TEMPLATES = {
  sequential: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '?', 'C'],
  fibonacci: ['0', '1', '2', '3', '5', '8', '13', '21', '34', '55', '89', '?', 'C'],
  modified_fibonacci: ['0', '0.5', '1', '2', '3', '5', '8', '13', '20', '40', '100', '?', 'C'],
  tshirt: ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '?', 'C'],
  powers_of_2: ['0', '1', '2', '4', '8', '16', '32', '64', '?', 'C'],
  custom1: ['0.5', '1.', '1.5', '2', '2.5', '3', '3.5', '4', '4.5', '5', '5.5', '?', 'C']
};

function updateDeckValues(deckType) {
  state.deckType = deckType || 'sequential';
  state.deckValues = DECK_TEMPLATES[state.deckType] || DECK_TEMPLATES.sequential;
}

// Local Inactivity Session Expiry (15 minutes)
let localActivityTimeout = null;

function resetLocalActivityTimer() {
  if (localActivityTimeout) clearTimeout(localActivityTimeout);
  if (state.roomId) {
    localActivityTimeout = setTimeout(() => {
      alert("Your session has expired due to 15 minutes of inactivity.");
      leaveRoom();
    }, 15 * 60 * 1000); // 15 minutes
  }
}

function setupLocalActivityTracking() {
  const events = ['mousemove', 'keypress', 'click', 'scroll', 'touchstart'];
  events.forEach(evt => {
    window.addEventListener(evt, resetLocalActivityTimer);
  });
  resetLocalActivityTimer();
}

function destroyLocalActivityTracking() {
  if (localActivityTimeout) clearTimeout(localActivityTimeout);
  const events = ['mousemove', 'keypress', 'click', 'scroll', 'touchstart'];
  events.forEach(evt => {
    window.removeEventListener(evt, resetLocalActivityTimer);
  });
}

// ==========================================================================
// UI Rendering Functions
// ==========================================================================

// Render the card deck
function renderDeck() {
  const grid = document.getElementById('deckGrid');
  grid.innerHTML = '';

  state.deckValues.forEach((val, idx) => {
    const card = document.createElement('div');
    card.className = 'poker-card-container';
    card.dataset.value = val;

    // Determine card value content
    let centerValue = val;
    if (val === 'C') {
      // SVG Coffee Cup Icon
      centerValue = `
        <svg class="coffee-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 8h1a4 4 0 1 1 0 8h-1" />
          <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" />
          <line x1="6" y1="2" x2="6" y2="4" />
          <line x1="10" y1="2" x2="10" y2="4" />
          <line x1="14" y1="2" x2="14" y2="4" />
        </svg>
      `;
    }

    card.innerHTML = `
      <div class="poker-card-inner">
        <div class="card-front">
          <div class="card-corner top-left">${val}</div>
          <div class="card-value">${centerValue}</div>
          <div class="card-corner bottom-right">${val}</div>
        </div>
      </div>
    `;

    card.addEventListener('click', () => handleCardSelection(val));
    grid.appendChild(card);
  });
}

// Render dynamic players list
function renderPlayersList() {
  const list = document.getElementById('playersList');
  list.innerHTML = '';

  const sortedUserIds = Object.keys(state.players).sort();

  sortedUserIds.forEach(id => {
    const player = state.players[id];
    const isMe = id === state.userId;
    const hasVoted = player.hasVoted;

    const li = document.createElement('li');
    li.className = `player-row ${isMe ? 'me' : ''}`;

    // Initial letter for avatar
    const initial = (player.name || '?').substring(0, 2);

    // Format timer value
    const voteTimeStr = player.timeToVote > 0 ? formatTimer(player.timeToVote) : '';

    // Right-side card indicator status
    let rightStatusHTML = '';
    if (state.gameState === 'voting') {
      if (hasVoted) {
        // Card face down
        rightStatusHTML = `
          <div class="mini-vote-card voted" title="Voted!">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </div>
        `;
      } else {
        // Thinking pulse
        rightStatusHTML = `<div class="mini-vote-card thinking" title="Thinking...">...</div>`;
      }
    } else {
      // Game state is REVEALED
      if (player.vote !== null && player.vote !== undefined) {
        // Show actual value
        let displayVote = player.vote;
        if (player.vote === 'C') {
          displayVote = '☕';
        }
        rightStatusHTML = `<div class="mini-vote-card revealed-card" title="Estimate: ${player.vote}">${displayVote}</div>`;
      } else {
        rightStatusHTML = `<div class="mini-vote-card did-not-vote" title="Did not vote">-</div>`;
      }
    }

    li.innerHTML = `
      <div class="player-left">
        <div class="player-avatar-container">
          <div class="player-avatar">${initial}</div>
          <div class="player-status-badge ${player.status === 'online' ? 'online' : ''}"></div>
        </div>
        <div class="player-info">
          <span class="player-name">${player.name} ${isMe ? '<span class="player-tag-me">(you)</span>' : ''}</span>
          ${voteTimeStr ? `<span class="player-vote-duration">Voted in ${voteTimeStr}</span>` : ''}
        </div>
      </div>
      <div class="player-right">
        ${rightStatusHTML}
      </div>
    `;

    list.appendChild(li);
  });
}

// Render recent rooms history list
function renderRecentRooms() {
  const history = JSON.parse(localStorage.getItem('poker_room_history') || '[]');
  const list = document.getElementById('recentRoomsList');
  const section = document.getElementById('recentRoomsSection');

  if (history.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  list.innerHTML = '';

  // Show last 5 rooms
  history.slice(0, 5).forEach(item => {
    const li = document.createElement('li');
    li.className = 'recent-room-item';

    // Format timestamp
    const date = new Date(item.timestamp);
    const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    li.innerHTML = `
      <span class="recent-room-name">${item.roomName}</span>
      <span class="recent-room-time">${dateStr}</span>
    `;

    li.addEventListener('click', () => {
      document.getElementById('roomInput').value = item.roomName;
      state.roomId = item.roomId; // Set room ID to rejoin the exact same room
      if (state.username) {
        state.roomName = item.roomName;
        joinRoom();
      } else {
        document.getElementById('usernameInput').focus();
      }
    });

    list.appendChild(li);
  });
}

// Update the game state banner in sidebar
function updateStateBanner() {
  const banner = document.getElementById('gameStateIndicator');

  if (state.gameState === 'voting') {
    // Count players voted
    const totalPlayers = Object.keys(state.players).length;
    const votedCount = Object.values(state.players).filter(p => p.hasVoted).length;

    banner.className = 'state-banner state-waiting';

    if (votedCount === 0) {
      banner.innerText = 'Waiting for votes';
    } else if (votedCount < totalPlayers) {
      // Find who hasn't voted yet
      const missing = Object.values(state.players)
        .filter(p => !p.hasVoted)
        .map(p => p.name);

      if (missing.length === 1) {
        banner.innerText = `Waiting for ${missing[0]} to vote`;
      } else {
        banner.innerText = `Waiting for ${missing.length} players to vote`;
      }
    } else {
      banner.innerText = 'All players have voted!';
    }
  } else {
    banner.className = 'state-banner state-revealed';
    banner.innerText = 'Cards Revealed!';
  }
}

// Calculate and render estimate statistics
function renderStats() {
  const panel = document.getElementById('statsPanel');
  const deck = document.getElementById('deckGrid');

  if (state.gameState === 'voting') {
    panel.style.display = 'none';
    deck.style.display = 'grid';
    return;
  }

  // Revealed state
  deck.style.display = 'none';
  panel.style.display = 'block';

  const votes = Object.values(state.players)
    .map(p => p.vote)
    .filter(v => v !== null && v !== undefined && v !== '');

  if (votes.length === 0) {
    document.getElementById('statAverage').innerText = '-';
    document.getElementById('statMedian').innerText = '-';
    document.getElementById('statRange').innerText = '-';
    document.getElementById('statAgreement').innerText = '0%';
    document.getElementById('distributionBarChart').innerHTML = '<div style="color:var(--text-secondary);font-size:0.9rem;padding:10px 0;">No votes recorded</div>';
    return;
  }

  // Determine if current deck values are numeric (ignoring '?' and 'C')
  const isNumericDeck = state.deckValues
    .filter(v => v !== '?' && v !== 'C')
    .every(v => !isNaN(parseFloat(v)));

  let average = '-';
  let median = '-';
  let voteRange = '-';

  if (isNumericDeck) {
    const numericVotes = votes
      .map(v => parseFloat(v))
      .filter(v => !isNaN(v))
      .sort((a, b) => a - b);

    if (numericVotes.length > 0) {
      // Average
      const sum = numericVotes.reduce((acc, curr) => acc + curr, 0);
      average = (sum / numericVotes.length).toFixed(1);

      // Median
      const mid = Math.floor(numericVotes.length / 2);
      if (numericVotes.length % 2 === 0) {
        median = ((numericVotes[mid - 1] + numericVotes[mid]) / 2).toFixed(1);
      } else {
        median = numericVotes[mid].toString();
      }

      // Range
      const min = numericVotes[0];
      const max = numericVotes[numericVotes.length - 1];
      voteRange = min === max ? min.toString() : `${min} - ${max}`;
    }
  } else {
    // Non-numeric (T-Shirt Size, etc.)
    const validVotes = votes
      .filter(v => v !== '?' && v !== 'C')
      .sort((a, b) => {
        return state.deckValues.indexOf(a) - state.deckValues.indexOf(b);
      });

    if (validVotes.length > 0) {
      // Median
      const mid = Math.floor(validVotes.length / 2);
      median = validVotes[mid];

      // Range
      const min = validVotes[0];
      const max = validVotes[validVotes.length - 1];
      voteRange = min === max ? min : `${min} - ${max}`;
    }
  }

  // Agreement percentage
  // Find highest frequency count of any vote
  const freqMap = {};
  votes.forEach(v => {
    freqMap[v] = (freqMap[v] || 0) + 1;
  });

  let maxFreq = 0;
  let consensusValue = null;
  Object.keys(freqMap).forEach(v => {
    if (freqMap[v] > maxFreq) {
      maxFreq = freqMap[v];
      consensusValue = v;
    }
  });

  const agreement = Math.round((maxFreq / votes.length) * 100);

  // Populate UI
  document.getElementById('statAverage').innerText = average;
  document.getElementById('statMedian').innerText = median;
  document.getElementById('statRange').innerText = voteRange;
  document.getElementById('statAgreement').innerText = `${agreement}%`;

  // Render distribution chart & pie chart
  const chartContainer = document.getElementById('distributionBarChart');
  chartContainer.innerHTML = '';

  // Sort keys based on our custom deck sorting
  const sortedVoteKeys = Object.keys(freqMap).sort((a, b) => {
    return state.deckValues.indexOf(a) - state.deckValues.indexOf(b);
  });

  const colors = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899', '#06b6d4', '#f97316', '#6366f1'];

  sortedVoteKeys.forEach((voteVal, idx) => {
    const count = freqMap[voteVal];
    const percentage = Math.round((count / votes.length) * 100);
    const color = colors[idx % colors.length];
    const row = document.createElement('div');
    row.className = 'chart-row';

    row.innerHTML = `
      <span class="chart-value-label">${voteVal === 'C' ? '☕' : voteVal}</span>
      <div class="chart-bar-container">
        <div class="chart-bar" style="width: ${percentage}%; background: ${color};"></div>
      </div>
      <span class="chart-count-label">${count} vote${count > 1 ? 's' : ''} (${percentage}%)</span>
    `;
    chartContainer.appendChild(row);
  });

  // Render Pie Chart
  renderPieChart(sortedVoteKeys, freqMap, votes.length);

  // Trigger confetti if consensus is 100% agreement and at least 2 real votes
  if (agreement === 100 && votes.length >= 2 && consensusValue !== '?' && consensusValue !== 'C') {
    triggerConfetti();
  }
}

// Render interactive SVG Pie/Donut Chart with Legend
function renderPieChart(sortedVoteKeys, freqMap, totalVotes) {
  const pieContainer = document.getElementById('distributionPieChart');
  if (!pieContainer) return;
  pieContainer.innerHTML = '';

  if (totalVotes === 0 || sortedVoteKeys.length === 0) {
    pieContainer.innerHTML = '<div class="no-votes-msg">No votes recorded</div>';
    return;
  }

  const colors = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899', '#06b6d4', '#f97316', '#6366f1'];
  const size = 140;
  const center = size / 2;
  const outerR = 60;
  const innerR = 36;

  let startAngle = -Math.PI / 2; // Start from 12 o'clock

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('class', 'pie-chart-svg');

  const gSlices = document.createElementNS('http://www.w3.org/2000/svg', 'g');

  const legendContainer = document.createElement('div');
  legendContainer.className = 'pie-legend';

  sortedVoteKeys.forEach((voteVal, idx) => {
    const count = freqMap[voteVal];
    const fraction = count / totalVotes;
    const angle = fraction * 2 * Math.PI;
    const endAngle = startAngle + angle;
    const color = colors[idx % colors.length];
    const displayLabel = voteVal === 'C' ? '☕' : voteVal;
    const percentage = Math.round(fraction * 100);

    const legendItem = document.createElement('div');
    legendItem.className = 'legend-item';
    legendItem.innerHTML = `
      <span class="legend-color-dot" style="background-color: ${color}"></span>
      <span class="legend-label">${displayLabel}</span>
      <span class="legend-value">${count} (${percentage}%)</span>
    `;

    if (fraction >= 0.999) {
      // 100% single slice / single vote: use a stroke-width ring circle to prevent SVG arc degeneracies
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', center);
      circle.setAttribute('cy', center);
      circle.setAttribute('r', (outerR + innerR) / 2);
      circle.setAttribute('fill', 'none');
      circle.setAttribute('stroke', color);
      circle.setAttribute('stroke-width', outerR - innerR);
      circle.setAttribute('class', 'pie-slice');
      circle.dataset.vote = voteVal;
      circle.innerHTML = `<title>${displayLabel}: ${count} vote${count > 1 ? 's' : ''} (${percentage}%)</title>`;

      circle.addEventListener('mouseenter', () => legendItem.classList.add('active'));
      circle.addEventListener('mouseleave', () => legendItem.classList.remove('active'));
      legendItem.addEventListener('mouseenter', () => circle.classList.add('active'));
      legendItem.addEventListener('mouseleave', () => circle.classList.remove('active'));

      gSlices.appendChild(circle);
      legendContainer.appendChild(legendItem);
      return;
    }

    const x1 = center + outerR * Math.cos(startAngle);
    const y1 = center + outerR * Math.sin(startAngle);
    const x2 = center + outerR * Math.cos(endAngle);
    const y2 = center + outerR * Math.sin(endAngle);

    const ix1 = center + innerR * Math.cos(endAngle);
    const iy1 = center + innerR * Math.sin(endAngle);
    const ix2 = center + innerR * Math.cos(startAngle);
    const iy2 = center + innerR * Math.sin(startAngle);

    const largeArc = fraction > 0.5 ? 1 : 0;

    const pathD = `
      M ${x1.toFixed(2)} ${y1.toFixed(2)}
      A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}
      L ${ix1.toFixed(2)} ${iy1.toFixed(2)}
      A ${innerR} ${innerR} 0 ${largeArc} 0 ${ix2.toFixed(2)} ${iy2.toFixed(2)}
      Z
    `;

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathD);
    path.setAttribute('fill', color);
    path.setAttribute('class', 'pie-slice');
    path.dataset.vote = voteVal;
    path.innerHTML = `<title>${displayLabel}: ${count} vote${count > 1 ? 's' : ''} (${percentage}%)</title>`;

    path.addEventListener('mouseenter', () => legendItem.classList.add('active'));
    path.addEventListener('mouseleave', () => legendItem.classList.remove('active'));
    legendItem.addEventListener('mouseenter', () => path.classList.add('active'));
    legendItem.addEventListener('mouseleave', () => path.classList.remove('active'));

    gSlices.appendChild(path);
    legendContainer.appendChild(legendItem);

    startAngle = endAngle;
  });

  svg.appendChild(gSlices);

  const centerTextG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  centerTextG.setAttribute('class', 'pie-center-text');

  const textVal = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  textVal.setAttribute('x', center);
  textVal.setAttribute('y', center - 6);
  textVal.setAttribute('text-anchor', 'middle');
  textVal.setAttribute('class', 'center-value');
  textVal.textContent = totalVotes.toString();

  const textLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  textLabel.setAttribute('x', center);
  textLabel.setAttribute('y', center + 12);
  textLabel.setAttribute('text-anchor', 'middle');
  textLabel.setAttribute('class', 'center-label');
  textLabel.textContent = totalVotes === 1 ? 'Vote' : 'Votes';

  centerTextG.appendChild(textVal);
  centerTextG.appendChild(textLabel);
  svg.appendChild(centerTextG);

  const wrapper = document.createElement('div');
  wrapper.className = 'pie-chart-flex';
  wrapper.appendChild(svg);
  wrapper.appendChild(legendContainer);

  pieContainer.appendChild(wrapper);
}

// Confetti blast animation
function triggerConfetti() {
  if (window.confetti) {
    const duration = 2.5 * 1000;
    const animationEnd = Date.now() + duration;
    const defaults = { startVelocity: 25, spread: 360, ticks: 50, zIndex: 1000 };

    function randomInRange(min, max) {
      return Math.random() * (max - min) + min;
    }

    const interval = setInterval(function () {
      const timeLeft = animationEnd - Date.now();

      if (timeLeft <= 0) {
        return clearInterval(interval);
      }

      const particleCount = 50 * (timeLeft / duration);
      // Confetti burst from left and right corners
      confetti(Object.assign({}, defaults, { particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } }));
      confetti(Object.assign({}, defaults, { particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } }));
    }, 250);
  }
}

// Timer layout format
function formatTimer(totalSeconds) {
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  return [
    hrs.toString().padStart(2, '0'),
    mins.toString().padStart(2, '0'),
    secs.toString().padStart(2, '0')
  ].join(':');
}

// Update Local Timer display
function renderTimer() {
  document.getElementById('roomTimer').innerText = formatTimer(state.timerSeconds);
}

// ==========================================================================
// Event Handler Callbacks
// ==========================================================================

function setupEventListeners() {
  // Join Form submit
  document.getElementById('joinForm').addEventListener('submit', (e) => {
    e.preventDefault();
    state.username = document.getElementById('usernameInput').value.trim();
    const inputRoomName = document.getElementById('roomInput').value.trim();

    if (state.username && inputRoomName) {
      // Preserve invitedRoomId if user kept the invited room name
      if (state.invitedRoomName && state.invitedRoomId &&
          inputRoomName.toLowerCase() === state.invitedRoomName.toLowerCase()) {
        state.roomId = state.invitedRoomId;
        state.roomName = state.invitedRoomName;
      } else {
        // User manually entered a different room name, clear invitedRoomId
        state.roomId = '';
        state.roomName = inputRoomName;
      }

      // Save profile to localstorage
      localStorage.setItem('poker_user_profile', JSON.stringify({ username: state.username }));
      joinRoom();
    }
  });

  // Dynamic hash change listener for shared link clicks while app is open
  window.addEventListener('hashchange', () => {
    const parsed = parseRoomHash(window.location.hash);
    if (parsed && parsed.roomId && parsed.roomId !== state.roomId) {
      initRouting();
    }
  });

  // Random room name generator
  document.getElementById('randomRoomBtn').addEventListener('click', generateRandomRoomName);

  // Leave room button
  document.getElementById('leaveRoomBtn').addEventListener('click', leaveRoom);

  // Edit Story Button clicks
  document.getElementById('editStoryBtn').addEventListener('click', showStoryEdit);
  document.getElementById('saveStoryBtn').addEventListener('click', saveStoryEdit);
  document.getElementById('cancelStoryBtn').addEventListener('click', cancelStoryEdit);

  // Allow edit submit on Enter key inside story text input
  document.getElementById('storyInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      saveStoryEdit();
    } else if (e.key === 'Escape') {
      cancelStoryEdit();
    }
  });

  // Theme Toggle Switcher
  document.getElementById('themeToggle').addEventListener('click', toggleTheme);

  // Sidebar room control commands
  document.getElementById('resetTimerBtn').addEventListener('click', () => sendRoomEvent('timer_reset'));
  document.getElementById('clearVotesBtn').addEventListener('click', () => sendRoomEvent('clear_votes'));
  document.getElementById('flipCardsBtn').addEventListener('click', () => sendRoomEvent('flip_cards'));
  document.getElementById('skipStoryBtn').addEventListener('click', () => sendRoomEvent('skip_story'));

  // Invite Accordion Toggle
  document.getElementById('inviteAccordionToggle').addEventListener('click', toggleInviteAccordion);

  // Copy Invite link
  document.getElementById('copyInviteLinkBtn').addEventListener('click', copyInviteLink);

  // Deck template change dropdown select
  document.getElementById('deckTemplateSelect').addEventListener('change', (e) => {
    sendRoomEvent('change_template', { deckType: e.target.value });
  });

  // Chart view toggle listeners
  const chartsContainer = document.getElementById('chartsContainer');
  const btnBoth = document.getElementById('chartViewBothBtn');
  const btnBar = document.getElementById('chartViewBarBtn');
  const btnPie = document.getElementById('chartViewPieBtn');

  if (chartsContainer && btnBoth && btnBar && btnPie) {
    const setChartView = (mode) => {
      [btnBoth, btnBar, btnPie].forEach(btn => btn.classList.remove('active'));
      chartsContainer.classList.remove('view-both', 'view-bars', 'view-pie');

      if (mode === 'both') {
        btnBoth.classList.add('active');
        chartsContainer.classList.add('view-both');
      } else if (mode === 'bars') {
        btnBar.classList.add('active');
        chartsContainer.classList.add('view-bars');
      } else if (mode === 'pie') {
        btnPie.classList.add('active');
        chartsContainer.classList.add('view-pie');
      }
    };

    btnBoth.addEventListener('click', () => setChartView('both'));
    btnBar.addEventListener('click', () => setChartView('bars'));
    btnPie.addEventListener('click', () => setChartView('pie'));
  }
}

// Toggle light/dark stylesheet themes
function toggleTheme() {
  const body = document.body;
  const sunIcon = document.querySelector('.sun-icon');
  const moonIcon = document.querySelector('.moon-icon');

  if (body.classList.contains('light-theme')) {
    body.classList.replace('light-theme', 'dark-theme');
    sunIcon.style.display = 'none';
    moonIcon.style.display = 'block';
    localStorage.setItem('poker_theme', 'dark');
  } else {
    body.classList.replace('dark-theme', 'light-theme');
    sunIcon.style.display = 'block';
    moonIcon.style.display = 'none';
    localStorage.setItem('poker_theme', 'light');
  }
}

// Set theme on load based on user cache preference
(function applySavedTheme() {
  const savedTheme = localStorage.getItem('poker_theme');
  if (savedTheme === 'dark') {
    document.addEventListener('DOMContentLoaded', () => {
      document.body.classList.replace('light-theme', 'dark-theme');
      document.querySelector('.sun-icon').style.display = 'none';
      document.querySelector('.moon-icon').style.display = 'block';
    });
  }
})();

// Story label actions
function showStoryEdit() {
  document.getElementById('storyTitleWrapper').style.display = 'none';
  document.getElementById('storyEditWrapper').style.display = 'flex';
  document.getElementById('storyInput').value = state.currentStory;
  document.getElementById('storyInput').focus();
}

function cancelStoryEdit() {
  document.getElementById('storyTitleWrapper').style.display = 'flex';
  document.getElementById('storyEditWrapper').style.display = 'none';
}

function saveStoryEdit() {
  const newTitle = document.getElementById('storyInput').value.trim();
  if (newTitle) {
    sendRoomEvent('edit_story', { title: newTitle });
  }
  cancelStoryEdit();
}

// Invite teammates accordion toggle
function toggleInviteAccordion() {
  const toggle = document.getElementById('inviteAccordionToggle');
  const content = document.getElementById('inviteAccordionContent');
  state.isInviteOpen = !state.isInviteOpen;

  if (state.isInviteOpen) {
    toggle.classList.add('open');
    content.style.display = 'block';
    // Focus invite URL link
    document.getElementById('inviteLinkInput').select();
  } else {
    toggle.classList.remove('open');
    content.style.display = 'none';
  }
}

// Copy URL to Clipboard with fallback support
function copyInviteLink() {
  const copyText = document.getElementById('inviteLinkInput');
  const baseUrl = window.location.href.split('#')[0];
  const targetHash = window.location.hash || `#/room/${encodeURIComponent(state.roomId)}?name=${encodeURIComponent(state.roomName)}`;
  copyText.value = baseUrl + targetHash;

  copyText.select();
  copyText.setSelectionRange(0, 99999); // Mobile compatibility

  const textToCopy = copyText.value;

  const handleSuccess = () => {
    const copyBtn = document.getElementById('copyInviteLinkBtn');
    const originalText = copyBtn.innerText;
    copyBtn.innerText = 'Copied!';
    copyBtn.style.backgroundColor = 'var(--accent-green)';

    setTimeout(() => {
      copyBtn.innerText = originalText;
      copyBtn.style.backgroundColor = 'var(--primary-color)';
    }, 2000);
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(textToCopy).then(handleSuccess).catch(() => {
      try {
        document.execCommand('copy');
        handleSuccess();
      } catch (err) {
        console.error('Failed to copy text: ', err);
      }
    });
  } else {
    try {
      document.execCommand('copy');
      handleSuccess();
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  }
}

// Highlight cards in board deck
function handleCardSelection(value) {
  if (state.gameState === 'revealed') return; // Cannot change selection after reveal

  const cards = document.querySelectorAll('.poker-card-container');
  let selected = false;

  cards.forEach(card => {
    if (card.dataset.value === value) {
      if (card.classList.contains('selected')) {
        // Toggle off
        card.classList.remove('selected');
        state.currentVote = null;
        state.voteTime = 0;
      } else {
        // Select
        card.classList.add('selected');
        state.currentVote = value;
        state.voteTime = Math.round((Date.now() - state.voteTimerStart) / 1000);
        selected = true;
      }
    } else {
      card.classList.remove('selected');
    }
  });

  // Update own record locally
  state.players[state.userId].hasVoted = selected;
  state.players[state.userId].vote = state.currentVote;
  state.players[state.userId].timeToVote = state.voteTime;

  renderPlayersList();
  updateStateBanner();

  // Publish vote status to room
  sendRoomEvent('vote_status', {
    hasVoted: selected,
    vote: state.currentVote, // Simpler architecture: send vote value, masked in player-list UI until reveal
    voteTime: state.voteTime
  });
}

// ==========================================================================
// MQTT Network & Room Collaboration Handler
// ==========================================================================

// Establish connection and subscribe to room
function joinRoom() {
  // Set room names
  state.roomId = state.roomId || slugify(state.roomName) + '-' + Math.random().toString(36).substring(2, 6);
  const targetHash = `#/room/${encodeURIComponent(state.roomId)}?name=${encodeURIComponent(state.roomName)}`;

  if (window.location.hash !== targetHash) {
    window.location.hash = targetHash;
  }

  document.getElementById('roomTitleDisplay').innerText = state.roomName;
  document.getElementById('storyTitleDisplay').innerText = state.currentStory;

  // Generate invite link URL reliably without opaque origin issues
  const baseUrl = window.location.href.split('#')[0];
  const inviteUrl = baseUrl + targetHash;
  document.getElementById('inviteLinkInput').value = inviteUrl;

  // Add room to recent localstorage cache
  addRoomToHistory(state.roomName, state.roomId);

  // Initialize self details
  state.players[state.userId] = {
    name: state.username,
    vote: null,
    hasVoted: false,
    status: 'online',
    lastActive: Date.now(),
    timeToVote: 0
  };

  state.voteTimerStart = Date.now();

  // Display loading/connecting banner
  updateConnectionStatus('connecting', 'Connecting...');
  showScreen('boardScreen');
  setupLocalActivityTracking();
  renderPlayersList();
  updateStateBanner();

  // Connect to MQTT Broker
  connectToBroker();
}

// Make a URL-safe room slug
function slugify(text) {
  return text.toString().toLowerCase()
    .replace(/\s+/g, '-')           // Replace spaces with -
    .replace(/[^\w\-]+/g, '')       // Remove all non-word chars
    .replace(/\-\-+/g, '-')         // Replace multiple - with single -
    .replace(/^-+/, '')             // Trim - from start
    .replace(/-+$/, '');            // Trim - from end
}

// Save rooms inside Cache history
function addRoomToHistory(name, id) {
  let history = JSON.parse(localStorage.getItem('poker_room_history') || '[]');
  // Avoid duplicates
  history = history.filter(item => item.roomId !== id);
  history.unshift({ roomName: name, roomId: id, timestamp: Date.now() });
  localStorage.setItem('poker_room_history', JSON.stringify(history.slice(0, 10)));
}

// Try connecting to MQTT broker
function connectToBroker() {
  const brokerUrl = BROKERS[state.currentBrokerIndex];
  console.log(`Attempting to connect to broker: ${brokerUrl}`);

  // Set a backup connection timeout
  if (state.connectionTimeout) clearTimeout(state.connectionTimeout);
  state.connectionTimeout = setTimeout(() => {
    console.warn(`Connection timeout for broker ${brokerUrl}`);
    handleConnectionFailure();
  }, 12000); // Wait 12 seconds before failing over

  try {
    const options = {
      keepalive: 30,
      clientId: 'poker_' + state.userId,
      clean: true,
      connectTimeout: 5000,
      reconnectPeriod: 0 // We handle reconnecting ourselves manually
    };

    state.mqttClient = mqtt.connect(brokerUrl, options);

    state.mqttClient.on('connect', () => {
      clearTimeout(state.connectionTimeout);
      state.isOfflineMode = false;
      updateConnectionStatus('online', 'Connected');
      console.log('Connected to MQTT broker successfully.');

      // Subscribe to room events topic
      const topic = `planit-aesthetic/rooms/${state.roomId}`;
      state.mqttClient.subscribe(topic, { qos: 1 }, (err) => {
        if (err) {
          console.error('Subscription error:', err);
        } else {
          // Announce arrival to room
          sendRoomEvent('join', { name: state.username });
          // Start presence timers
          startPresenceHeartbeat();
          startTimerProcess();
        }
      });
    });

    state.mqttClient.on('message', (topic, message) => {
      try {
        const payload = JSON.parse(message.toString());
        if (payload.senderId !== state.userId) {
          handleIncomingEvent(payload);
        }
      } catch (e) {
        console.error('Failed to parse incoming room payload message:', e);
      }
    });

    state.mqttClient.on('error', (err) => {
      console.error('MQTT connection error:', err);
      clearTimeout(state.connectionTimeout);
      handleConnectionFailure();
    });

    state.mqttClient.on('close', () => {
      console.log('MQTT connection closed');
    });

  } catch (err) {
    console.error('Error instantiating MQTT client:', err);
    clearTimeout(state.connectionTimeout);
    handleConnectionFailure();
  }
}

// Failover to next broker or offline mode
function handleConnectionFailure() {
  if (state.mqttClient) {
    try {
      state.mqttClient.end(true);
    } catch (e) { }
    state.mqttClient = null;
  }

  state.currentBrokerIndex++;
  if (state.currentBrokerIndex < BROKERS.length) {
    console.log(`Retrying with fallback broker: ${BROKERS[state.currentBrokerIndex]}`);
    connectToBroker();
  } else {
    // All brokers failed. Go to Offline Demo simulation mode!
    activateOfflineMode();
  }
}

// Activate Mock/Simulation offline demo play
function activateOfflineMode() {
  state.isOfflineMode = true;
  updateConnectionStatus('offline', 'Demo Play (Offline)');
  console.warn('Real-time connection failed. Activating mock offline simulation.');

  // Setup mock players to make application feel live
  const mockNames = ['Alice (Dev)', 'Bob (QA)', 'Charlie (Product)'];
  mockNames.forEach((name, idx) => {
    const mockId = `mock_user_${idx}`;
    state.players[mockId] = {
      name: name,
      vote: null,
      hasVoted: false,
      status: 'online',
      lastActive: Date.now() + 100000000, // Never timeout
      timeToVote: 0
    };
  });

  renderPlayersList();
  updateStateBanner();
  startTimerProcess();

  // Show an alert/tip to user
  const tipBanner = document.createElement('div');
  tipBanner.id = 'demoTipBanner';
  tipBanner.style.cssText = 'background:var(--danger-light);color:var(--danger-color);padding:10px;text-align:center;font-size:0.85rem;font-weight:500;border-bottom:1px solid var(--border-color);';
  tipBanner.innerHTML = '⚠️ Realtime servers unavailable. Running in <strong>Local Demo Mode</strong>. Open multiple tabs to collaborate is disabled, but you can play with AI teammates!';
  document.body.insertBefore(tipBanner, document.querySelector('header').nextSibling);
}

// Update Header status indicator
function updateConnectionStatus(status, text) {
  const indicator = document.getElementById('connectionStatus');
  indicator.className = `connection-status ${status}`;
  indicator.querySelector('.status-text').innerText = text;
}

// Broadcast room events
function sendRoomEvent(type, payload = {}) {
  const event = {
    senderId: state.userId,
    senderName: state.username,
    timestamp: Date.now(),
    type: type,
    ...payload
  };

  // If in offline mode, process own action locally and trigger mock responses
  if (state.isOfflineMode) {
    handleOfflineSimulationEvent(event);
    return;
  }

  // Process locally first for instant UI response in online mode
  handleIncomingEvent(event);

  // If online, publish message
  if (state.mqttClient && state.mqttClient.connected) {
    const topic = `planit-aesthetic/rooms/${state.roomId}`;
    state.mqttClient.publish(topic, JSON.stringify(event), { qos: 1 });
  }
}

// Handle network events
function handleIncomingEvent(event) {
  const now = Date.now();

  switch (event.type) {
    case 'join':
      // New player joined
      state.players[event.senderId] = {
        name: event.senderName,
        vote: null,
        hasVoted: false,
        status: 'online',
        lastActive: now,
        timeToVote: 0
      };
      console.log(`${event.senderName} joined the room.`);
      renderPlayersList();
      updateStateBanner();

      // Since we are already in the room, reply with our current status so they sync instantly (only if it wasn't ourselves joining)
      if (event.senderId !== state.userId) {
        sendRoomEvent('sync_state_reply', {
          targetUserId: event.senderId,
          username: state.username,
          hasVoted: state.currentVote !== null,
          vote: state.gameState === 'revealed' ? state.currentVote : null, // Only send card details if revealed
          voteTime: state.voteTime,
          gameState: state.gameState,
          currentStory: state.currentStory,
          timerSeconds: state.timerSeconds,
          deckType: state.deckType
        });
      }
      break;

    case 'sync_state_reply':
      // Reply received from existing room members
      if (event.targetUserId === state.userId) {
        state.players[event.senderId] = {
          name: event.username,
          vote: event.vote,
          hasVoted: event.hasVoted,
          status: 'online',
          lastActive: now,
          timeToVote: event.voteTime
        };

        // Sync room state (story name, game mode, timer) from the oldest player in the room
        if (event.gameState === 'revealed') {
          state.gameState = 'revealed';
        }
        if (event.currentStory && event.currentStory !== state.currentStory) {
          state.currentStory = event.currentStory;
          document.getElementById('storyTitleDisplay').innerText = state.currentStory;
        }

        // Sync active template from existing members
        if (event.deckType && state.deckType !== event.deckType) {
          updateDeckValues(event.deckType);
          renderDeck();
          const templateSelect = document.getElementById('deckTemplateSelect');
          if (templateSelect) {
            templateSelect.value = event.deckType;
          }
        }

        // Sync local timer if others have higher progress timer
        if (event.timerSeconds > state.timerSeconds) {
          state.timerSeconds = event.timerSeconds;
          renderTimer();
        }

        renderPlayersList();
        updateStateBanner();
        renderStats();
      }
      break;

    case 'ping':
      // Periodic heartbeat
      if (!state.players[event.senderId]) {
        state.players[event.senderId] = { name: event.senderName };
      }
      state.players[event.senderId].name = event.senderName;
      state.players[event.senderId].hasVoted = event.hasVoted;
      state.players[event.senderId].vote = event.vote; // Will be null in voting, populated in revealed
      state.players[event.senderId].timeToVote = event.voteTime;
      state.players[event.senderId].status = 'online';
      state.players[event.senderId].lastActive = now;

      renderPlayersList();
      updateStateBanner();
      break;

    case 'vote_status':
      // Player changed vote
      if (state.players[event.senderId]) {
        state.players[event.senderId].hasVoted = event.hasVoted;
        state.players[event.senderId].vote = event.vote;
        state.players[event.senderId].timeToVote = event.voteTime;
        state.players[event.senderId].lastActive = now;
      }
      renderPlayersList();
      updateStateBanner();
      break;

    case 'flip_cards':
      // Flip deck revealed
      state.gameState = 'revealed';
      renderPlayersList();
      updateStateBanner();
      renderStats();
      break;

    case 'clear_votes':
      // Clear estimates
      resetVotingStateLocally();
      break;

    case 'skip_story':
      // Advance room story estimate
      resetVotingStateLocally();
      // Increment or default story description
      state.currentStory = 'Next Estimating Story';
      document.getElementById('storyTitleDisplay').innerText = state.currentStory;
      state.timerSeconds = 0;
      renderTimer();
      break;

    case 'edit_story':
      // Story label name edit
      state.currentStory = event.title;
      document.getElementById('storyTitleDisplay').innerText = state.currentStory;
      break;

    case 'change_template':
      // Change deck template format
      updateDeckValues(event.deckType);
      renderDeck();
      const templateSelect = document.getElementById('deckTemplateSelect');
      if (templateSelect) {
        templateSelect.value = event.deckType;
      }
      resetVotingStateLocally();
      break;

    case 'timer_reset':
      // Reset timer
      state.timerSeconds = 0;
      renderTimer();
      break;

    case 'timer_sync':
      // Sync clock timer from oldest user (timer master)
      // Only accept if we are not the timer host ourselves
      if (!state.isTimerHost) {
        state.timerSeconds = event.seconds;
        renderTimer();
      }
      break;
  }
}

// Reset variables locally
function resetVotingStateLocally() {
  state.gameState = 'voting';
  state.currentVote = null;
  state.voteTime = 0;
  state.voteTimerStart = Date.now();

  // Clear CSS selections
  document.querySelectorAll('.poker-card-container').forEach(card => {
    card.classList.remove('selected');
  });

  // Clear all player votes
  Object.keys(state.players).forEach(id => {
    state.players[id].vote = null;
    state.players[id].hasVoted = false;
    state.players[id].timeToVote = 0;
  });

  renderPlayersList();
  updateStateBanner();
  renderStats();
}

// Heartbeat background loop
function startPresenceHeartbeat() {
  // Send own ping immediately
  sendPing();

  if (state.heartbeatInterval) clearInterval(state.heartbeatInterval);
  if (state.presenceCheckInterval) clearInterval(state.presenceCheckInterval);

  // Set intervals: send ping every 5 minutes (300000ms)
  state.heartbeatInterval = setInterval(() => {
    if (state.mqttClient && state.mqttClient.connected) {
      sendPing();
    }
  }, 300000);

  // Check online status of peers every 10 seconds
  state.presenceCheckInterval = setInterval(() => {
    const now = Date.now();
    let changed = false;

    Object.keys(state.players).forEach(id => {
      if (id === state.userId) return; // Skip self

      const player = state.players[id];
      // Skip simulated players in offline mode
      if (state.isOfflineMode && id.startsWith('mock_user_')) return;

      // Mark offline if no heartbeat for 10 minutes (600000ms)
      if (player.status === 'online' && now - player.lastActive > 600000) {
        player.status = 'offline';
        changed = true;
      }

      // Expire session (remove player) if no heartbeat for 15 minutes (900000ms)
      if (now - player.lastActive > 900000) {
        delete state.players[id];
        changed = true;
        console.log(`Player ${player.name} timed out and was removed.`);
      }
    });

    if (changed) {
      renderPlayersList();
      updateStateBanner();
      renderStats();
    }
  }, 10000);
}

function sendPing() {
  sendRoomEvent('ping', {
    hasVoted: state.currentVote !== null,
    vote: state.currentVote,
    voteTime: state.voteTime
  });
}

// Stopwatch loop
function startTimerProcess() {
  if (state.timerInterval) clearInterval(state.timerInterval);

  state.timerInterval = setInterval(() => {
    // Determine if we should maintain/broadcast the timer:
    // We are the timer master if we are the oldest player online in our list.
    const sortedUserIds = Object.keys(state.players).sort();
    state.isTimerHost = sortedUserIds[0] === state.userId;

    if (state.isTimerHost || state.isOfflineMode) {
      state.timerSeconds++;
      renderTimer();

      // Broadcast timer sync online
      if (!state.isOfflineMode && state.timerSeconds % 2 === 0) {
        sendRoomEvent('timer_sync', { seconds: state.timerSeconds });
      }
    }
  }, 1000);
}

// Leave room return to welcome screen
function leaveRoom() {
  destroyLocalActivityTracking();
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
  if (state.heartbeatInterval) {
    clearInterval(state.heartbeatInterval);
    state.heartbeatInterval = null;
  }
  if (state.presenceCheckInterval) {
    clearInterval(state.presenceCheckInterval);
    state.presenceCheckInterval = null;
  }

  if (state.mqttClient) {
    try {
      // Broadcast leave notice if possible
      state.mqttClient.end(true);
    } catch (e) { }
    state.mqttClient = null;
  }

  // Clear tip banner if any
  const tip = document.getElementById('demoTipBanner');
  if (tip) tip.remove();

  // Reset states
  state.players = {};
  state.roomId = '';
  state.roomName = '';
  state.currentVote = null;
  state.gameState = 'voting';
  state.timerSeconds = 0;

  // Reset card grid selections
  document.querySelectorAll('.poker-card-container').forEach(card => {
    card.classList.remove('selected');
  });

  window.location.hash = '';
  showScreen('welcomeScreen');
  renderRecentRooms();
  generateRandomRoomName();
}

// ==========================================================================
// Offline Mode Mock/AI Players Simulation Engine
// ==========================================================================

function handleOfflineSimulationEvent(event) {
  console.log('Processing offline event:', event);
  const now = Date.now();

  switch (event.type) {
    case 'vote_status':
      // The user voted or unvoted
      state.players[state.userId].hasVoted = event.hasVoted;
      state.players[state.userId].vote = event.vote;
      state.players[state.userId].timeToVote = event.voteTime;

      renderPlayersList();
      updateStateBanner();

      // Trigger simulated voters after 1-3 seconds
      if (event.hasVoted) {
        Object.keys(state.players).forEach(id => {
          if (id === state.userId) return;
          const player = state.players[id];
          if (!player.hasVoted) {
            const delay = 1000 + Math.random() * 2000;
            setTimeout(() => {
              // Ensure we are still in voting state
              if (state.gameState === 'voting') {
                player.hasVoted = true;

                // Select a dynamic reasonable estimate from the current deck (bias towards middle values)
                const validValues = state.deckValues.filter(v => v !== '?' && v !== 'C');
                let selectedVal = '5';
                if (validValues.length > 0) {
                  const midIdx = Math.floor(validValues.length / 2);
                  const weightedList = [];
                  validValues.forEach((val, idx) => {
                    const weight = Math.max(1, 4 - Math.abs(idx - midIdx));
                    for (let w = 0; w < weight; w++) {
                      weightedList.push(val);
                    }
                  });
                  selectedVal = weightedList[Math.floor(Math.random() * weightedList.length)];
                } else {
                  selectedVal = state.deckValues[Math.floor(Math.random() * state.deckValues.length)] || '5';
                }

                player.vote = selectedVal;
                player.timeToVote = Math.round((Date.now() - state.voteTimerStart) / 1000);

                renderPlayersList();
                updateStateBanner();
              }
            }, delay);
          }
        });
      }
      break;

    case 'flip_cards':
      state.gameState = 'revealed';
      // Force all mock players to vote if they haven't yet, so we have stats
      Object.keys(state.players).forEach(id => {
        if (id === state.userId) return;
        const player = state.players[id];
        if (!player.hasVoted) {
          player.hasVoted = true;
          const midIdx = Math.max(0, Math.floor(state.deckValues.length / 2) - 1);
          player.vote = state.deckValues[midIdx] || '5'; // Use middle deck value
          player.timeToVote = 2;
        }
      });
      renderPlayersList();
      updateStateBanner();
      renderStats();
      break;

    case 'clear_votes':
      resetVotingStateLocally();
      break;

    case 'change_template':
      updateDeckValues(event.deckType);
      renderDeck();
      const templateSelect = document.getElementById('deckTemplateSelect');
      if (templateSelect) {
        templateSelect.value = event.deckType;
      }
      resetVotingStateLocally();
      break;

    case 'skip_story':
      resetVotingStateLocally();
      state.currentStory = 'Next Estimating Story';
      document.getElementById('storyTitleDisplay').innerText = state.currentStory;
      state.timerSeconds = 0;
      renderTimer();
      break;

    case 'edit_story':
      state.currentStory = event.title;
      document.getElementById('storyTitleDisplay').innerText = state.currentStory;
      break;

    case 'timer_reset':
      state.timerSeconds = 0;
      renderTimer();
      break;
  }
}
