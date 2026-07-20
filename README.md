# 🃏 PokerPlanner

A real-time, serverless Planning Poker web app for Agile teams — built with pure HTML, CSS, and JavaScript. No backend, no build step, fully hosted on GitHub Pages.

🔗 **Live App**: [https://nipun96.github.io/PokerPlanner](https://nipun96.github.io/PokerPlanner)

---

## ✨ Features

- 🎴 **Real-time collaboration** — players join a shared room and vote simultaneously
- 🔒 **Vote privacy** — estimates are hidden until the host flips the cards; only `hasVoted` status is broadcast during voting
- 🎉 **Consensus celebration** — confetti explosion when all players agree on the same estimate
- 🌗 **Light / Dark mode** — smooth theme toggle with persistent preference
- 📱 **Responsive design** — works on desktop and mobile browsers
- 💾 **Session memory** — username and recent rooms are saved in `localStorage`
- 🔗 **Shareable room links** — invite teammates via a URL like `index.html#/room/your-room-id`
- ⏱️ **Synchronized timer** — shared countdown across all players in the room
- 👥 **Presence detection** — players are removed after 12 seconds of inactivity via heartbeat

---

## 🚀 Getting Started

### Play Online
Just open the live link and:
1. Enter your name
2. Create or join a room
3. Share the room link with your team
4. Start estimating!

### Run Locally
No installation required — just open the file directly in your browser:

```bash
git clone git@github.com:Nipun96/PokerPlanner.git
cd PokerPlanner
# Open index.html in your browser
open index.html   # macOS
start index.html  # Windows
```

---

## 🏗️ Architecture

This app runs entirely in the browser with **no backend server**.

```
Browser (HTML + CSS + JS)
    │
    ├── localStorage  →  saves username, avatar, room history
    │
    └── MQTT over WebSockets  →  real-time sync between players
            │
            └── Public EMQX Broker (wss://broker.emqx.io:8084/mqtt)
                    │
                    └── Fallback: wss://test.mosquitto.org:8081/mqtt
```

### Room Communication
- Each room uses a unique MQTT topic: `antigravity-poker/rooms/{roomId}`
- During voting, only `{ hasVoted: true }` is broadcast — actual vote values are kept private
- When cards are flipped, each client publishes their real vote simultaneously

---

## 🗂️ Project Structure

```
PokerPlanner/
├── index.html   # App entry point — layout, CDN imports, screens
├── style.css    # Design system — themes, card animations, glassmorphism
└── app.js       # App logic — state, MQTT sync, UI rendering
```

---

## 🎨 Tech Stack

| Technology | Purpose |
|---|---|
| HTML5 / CSS3 / Vanilla JS | Core app — no frameworks |
| MQTT.js (CDN) | Real-time WebSocket messaging |
| canvas-confetti (CDN) | Consensus celebration animation |
| Google Fonts — Outfit | Typography |
| Lucide Icons | UI icons |
| GitHub Pages | Hosting |

---

## 🌐 How Real-Time Works (No Backend!)

1. When a player joins, they subscribe to the room's MQTT topic
2. Every 5 seconds, each client sends a **heartbeat** with their name and status
3. If no heartbeat is received from a player for 12 seconds, they are removed from the board
4. Voting, flipping, clearing, and timer sync are all handled via MQTT messages

This means the app works entirely for free, with zero server costs.

---

## 🔐 Room Privacy

- Room IDs are high-entropy random strings (or custom names you choose)
- Vote values are **never sent over the network during the voting phase**
- Only after the host flips the cards does each client broadcast their estimate
- This prevents anyone from inspecting network traffic to see others' votes early

---

## 🤝 Collaborative Controls

By design, all players in a room can:
- **Flip** — reveal all votes
- **Clear** — reset votes for the next story
- **Reset Timer** — restart the countdown

A visible action log shows who triggered each action (e.g. *"nip cleared the votes"*).

---

## 🛠️ Contributing

1. Fork the repo
2. Make your changes to `index.html`, `style.css`, or `app.js`
3. Test by opening `index.html` locally in two browser tabs
4. Submit a pull request

---

## 📄 License

MIT License — free to use, modify, and distribute.

---

*Built for Agile teams who want a fast, beautiful, zero-cost planning poker tool.*
