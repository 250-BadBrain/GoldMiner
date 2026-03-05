const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const LOGIC_WIDTH = 1600;
const LOGIC_HEIGHT = 900;
canvas.width = LOGIC_WIDTH;
canvas.height = LOGIC_HEIGHT;

const SWING_SPEED = 0.008;      
const FIRE_SPEED = 3.5;         
const RETRACT_SPEED_BASE = 4.5; 

// --- 强力连接配置 ---
const peerConfig = {
    config: {
        'iceServers': [
            { url: 'stun:stun.l.google.com:19302' },
            { url: 'stun:stun1.l.google.com:19302' },
            { url: 'stun:stun2.l.google.com:19302' },
            { url: 'stun:stun3.l.google.com:19302' },
            { url: 'stun:stun4.l.google.com:19302' }
        ]
    }
};

let peer = new Peer(peerConfig); 
let conn = null;
let isHost = false;

peer.on('open', id => {
    console.log('%c[PeerJS] 调度服务器就绪。ID: ' + id, 'color: #00ff00; font-weight: bold;');
    document.getElementById('myId').innerText = id;
});

peer.on('error', err => {
    console.error('[PeerJS] 错误:', err.type);
    if(err.type === 'peer-unavailable') alert("找不到对方ID，请检查是否输入正确且对方在线");
});

document.getElementById('myId').onclick = () => {
    navigator.clipboard.writeText(document.getElementById('myId').innerText);
    document.getElementById('copyTip').innerText = "已复制";
    setTimeout(() => document.getElementById('copyTip').innerText = "点击复制", 2000);
};

// 主机端
peer.on('connection', c => {
    console.log('%c[PeerJS] 监听到连接请求...', 'color: #ffcc00;');
    conn = c;
    isHost = true;
    setupConn();
});

// 客机端
document.getElementById('connectBtn').onclick = () => {
    const pId = document.getElementById('peerIdInput').value.trim();
    if (!pId) return alert("请输入 ID");
    console.log('[PeerJS] 正在连接: ' + pId);
    conn = peer.connect(pId, { reliable: true });
    isHost = false;
    setupConn();
};

function setupConn() {
    if (!conn) return;

    conn.on('open', () => {
        console.log('%c[PeerJS] 通道开启成功！数据现在可以传输。', 'color: #00ff00; font-size: 16px;');
        document.getElementById('connection-panel').style.display = 'none';
        document.getElementById('game-info').style.display = 'flex';
        
        myStartX = isHost ? (LOGIC_WIDTH/2 - 380) : (LOGIC_WIDTH/2 + 380);
        peerStartX = isHost ? (LOGIC_WIDTH/2 + 380) : (LOGIC_WIDTH/2 - 380);
        
        showWaitingOverlay();
    });

    conn.on('data', data => {
        switch(data.type) {
            case 'START_GAME': startLevel(data.level, data.score, data.bombs, data.items); break;
            case 'SYNC_LEVEL': applyLevelData(data); break;
            case 'TIME_SYNC': timeLeft = data.time; document.getElementById('timeDisplay').innerText = timeLeft; break;
            case 'LEVEL_END': showEndOverlay(data.isWin, data.total); break;
            case 'HOOK_POS': peerHook.angle = data.angle; peerHook.length = data.length; break;
            case 'ITEM_MOVE':
                let item = gameItems.find(it => it.id === data.itemId);
                if (item) { item.x = data.x; item.y = data.y; }
                break;
            case 'ITEM_COLLECTED':
                gameItems = gameItems.filter(it => it.id !== data.itemId);
                peerContribution = data.contribution; 
                totalScore = myContribution + peerContribution;
                updateUI();
                break;
            case 'BOMB_SYNC':
                bombs = data.bombs;
                if (data.itemId) gameItems = gameItems.filter(it => it.id !== data.itemId);
                updateUI();
                break;
            case 'POWER_UP': hasPowerUp = true; toast("队友获得了大力药水！"); break;
            case 'BAG_REWARD':
                if (data.rewardType === 'money') { peerContribution += data.value; totalScore = myContribution + peerContribution; }
                else if (data.rewardType === 'bomb') { bombs += 1; }
                updateUI();
                break;
        }
    });

    conn.on('close', () => { alert("队友已断开连接"); location.reload(); });
}

// --- 游戏逻辑 ---
let currentLevel = 1, myContribution = 0, peerContribution = 0, totalScore = 0;
let targetScore = 2000, timeLeft = 60, bombs = 3;
let gameActive = false, gameItems = [];
let timerInterval = null, hasPowerUp = false;

const HOOK_Y = 120;
let myStartX, peerStartX;
let myHook = { angle: 0, dir: 1, length: 80, state: 'SWING', caughtItem: null };
let peerHook = { angle: 0, length: 80 };

const ITEM_TYPES = {
    DIAMOND:    { r: 15, score: 600, weight: 0.8, color: '#00ffff', label: '钻' },
    GOLD_SMALL: { r: 25, score: 100, weight: 1.5, color: '#FFD700', label: '金' },
    STONE_SMALL:{ r: 22, score: 20,  weight: 1.5, color: '#888',    label: '石' },
    GOLD_BIG:   { r: 55, score: 500, weight: 3.5, color: '#FFD700', label: '大金' },
    STONE_BIG:  { r: 60, score: 50,  weight: 4.0, color: '#666',    label: '大石' },
    LUCKY_BAG:  { r: 30, score: 0,   weight: 1.2, color: '#ff9933', label: '?' }
};

function toast(msg) {
    const el = document.getElementById('reward-toast');
    el.innerText = msg; el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 2000);
}

function handleLuckyBag() {
    const rand = Math.random();
    if (rand < 0.4) {
        const money = Math.floor(Math.random() * 701) + 100;
        myContribution += money; toast(`💰 幸运口袋: $${money}`);
        if (conn) conn.send({ type: 'BAG_REWARD', rewardType: 'money', value: money });
    } else if (rand < 0.7) {
        bombs += 1; toast("💣 幸运口袋: 炸弹 +1");
        if (conn) conn.send({ type: 'BAG_REWARD', rewardType: 'bomb' });
    } else {
        hasPowerUp = true; toast("💪 幸运口袋: 大力药水！");
        if (conn) conn.send({ type: 'POWER_UP' });
    }
}

function startLevel(lvl, score, bmb, items) {
    document.getElementById('overlay').style.display = 'none';
    currentLevel = lvl; totalScore = score; bombs = bmb;
    myContribution = 0; peerContribution = 0; hasPowerUp = false;
    targetScore = lvl * 1800 + 500;
    gameItems = items;
    resetHooks();
    gameActive = true; 
    if (isHost && conn) {
        conn.send({ type: 'SYNC_LEVEL', items: gameItems, target: targetScore, level: currentLevel, total: totalScore, bombs: bombs });
        resetTimer();
    }
    updateUI();
}

function applyLevelData(data) {
    gameItems = data.items; targetScore = data.target; currentLevel = data.level; totalScore = data.total; bombs = data.bombs;
    myContribution = 0; peerContribution = 0; hasPowerUp = false;
    document.getElementById('overlay').style.display = 'none';
    resetHooks(); gameActive = true; updateUI();
}

function update() {
    if (!gameActive) return;
    if (myHook.state === 'SWING') {
        myHook.angle += SWING_SPEED * myHook.dir;
        if (Math.abs(myHook.angle) > 1.3) myHook.dir *= -1;
    } else if (myHook.state === 'FIRE') {
        myHook.length += FIRE_SPEED;
        const hX = myStartX + myHook.length * Math.sin(myHook.angle);
        const hY = HOOK_Y + myHook.length * Math.cos(myHook.angle);
        for (let item of gameItems) {
            if (Math.sqrt((hX - item.x)**2 + (hY - item.y)**2) < item.r) {
                myHook.caughtItem = item; myHook.state = 'RETRACT'; break;
            }
        }
        if (myHook.length > 1100 || hX < 0 || hX > LOGIC_WIDTH || hY > LOGIC_HEIGHT) myHook.state = 'RETRACT';
    } else if (myHook.state === 'RETRACT') {
        let baseSpeed = hasPowerUp ? (RETRACT_SPEED_BASE * 2.5) : RETRACT_SPEED_BASE;
        let s = myHook.caughtItem ? Math.max(0.8, baseSpeed - myHook.caughtItem.weight) : baseSpeed;
        myHook.length -= s;
        if (myHook.caughtItem) {
            myHook.caughtItem.x = myStartX + myHook.length * Math.sin(myHook.angle);
            myHook.caughtItem.y = HOOK_Y + myHook.length * Math.cos(myHook.angle);
            if (conn && conn.open) conn.send({ type: 'ITEM_MOVE', itemId: myHook.caughtItem.id, x: myHook.caughtItem.x, y: myHook.caughtItem.y });
        }
        if (myHook.length <= 80) {
            if (myHook.caughtItem) {
                if (myHook.caughtItem.label === '?') handleLuckyBag();
                else myContribution += myHook.caughtItem.score;
                totalScore = myContribution + peerContribution;
                if (conn) conn.send({ type: 'ITEM_COLLECTED', itemId: myHook.caughtItem.id, contribution: myContribution });
                gameItems = gameItems.filter(it => it.id !== myHook.caughtItem.id);
                updateUI();
            }
            myHook.state = 'SWING'; myHook.length = 80; myHook.caughtItem = null;
        }
    }
    if (conn && conn.open) conn.send({ type: 'HOOK_POS', angle: myHook.angle, length: myHook.length });
}

function draw() {
    ctx.clearRect(0, 0, LOGIC_WIDTH, LOGIC_HEIGHT);
    ctx.fillStyle = "#87ceeb"; ctx.fillRect(0, 0, LOGIC_WIDTH, LOGIC_HEIGHT * 0.18);
    ctx.fillStyle = "#3d2b1f"; ctx.fillRect(0, LOGIC_HEIGHT * 0.18, LOGIC_WIDTH, LOGIC_HEIGHT * 0.82);
    ctx.fillStyle = "#5d3a1a"; ctx.fillRect(0, LOGIC_HEIGHT * 0.18, LOGIC_WIDTH, 12);
    gameItems.forEach(item => {
        ctx.beginPath(); ctx.arc(item.x, item.y, item.r, 0, Math.PI*2);
        ctx.fillStyle = item.color; ctx.fill(); ctx.strokeStyle = "#000"; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = "black"; ctx.font = "bold 18px Arial"; ctx.textAlign = "center";
        ctx.fillText(item.label, item.x, item.y + 8);
    });
    renderHook(myStartX, HOOK_Y, myHook.angle, myHook.length, "#ffcc00", "我", myContribution);
    if (conn && conn.open) renderHook(peerStartX, HOOK_Y, peerHook.angle, peerHook.length, "#ff4444", "队友", peerContribution);
    update();
    requestAnimationFrame(draw);
}

function renderHook(x, y, angle, len, color, label, score) {
    const endX = x + len * Math.sin(angle);
    const endY = y + len * Math.cos(angle);
    ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.moveTo(x, y); ctx.lineTo(endX, endY); ctx.stroke();
    ctx.save(); ctx.translate(endX, endY); ctx.rotate(-angle);
    ctx.beginPath(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 5; ctx.arc(0, 0, 18, 0, Math.PI); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = color; ctx.font = "bold 24px Arial"; ctx.textAlign = "center";
    ctx.fillText(label, x, y - 45);
    ctx.fillStyle = "#fff"; ctx.font = "18px Arial"; ctx.fillText(`$${score}`, x, y + 40);
    if (label === "我" && hasPowerUp) { ctx.fillStyle = "#ffcc00"; ctx.font = "bold 14px Arial"; ctx.fillText("POWER UP!", x, y - 75); }
}

function generateItems() {
    const items = [];
    for (let i = 0; i < 22; i++) {
        let attempts = 0;
        while (attempts < 50) {
            const rand = Math.random();
            let type = rand > 0.92 ? ITEM_TYPES.DIAMOND : (rand > 0.85 ? ITEM_TYPES.LUCKY_BAG : (rand > 0.7 ? ITEM_TYPES.STONE_BIG : (rand > 0.4 ? ITEM_TYPES.GOLD_BIG : (rand > 0.2 ? ITEM_TYPES.GOLD_SMALL : ITEM_TYPES.STONE_SMALL))));
            let newItem = { id: Math.random(), x: 150 + Math.random() * (LOGIC_WIDTH - 300), y: 300 + Math.random() * (LOGIC_HEIGHT - 450), ...type };
            let overlap = items.some(e => Math.sqrt((e.x-newItem.x)**2 + (e.y-newItem.y)**2) < (e.r+newItem.r+35));
            if (!overlap) { items.push(newItem); break; }
            attempts++;
        }
    }
    return items;
}

function resetTimer() {
    if (!isHost) return;
    timeLeft = 60; if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        if (gameActive) {
            timeLeft--; document.getElementById('timeDisplay').innerText = timeLeft;
            if (conn) conn.send({ type: 'TIME_SYNC', time: timeLeft });
            if (timeLeft <= 0) checkLevelEnd();
        }
    }, 1000);
}

function checkLevelEnd() {
    if (!isHost) return;
    const isWin = totalScore >= targetScore;
    showEndOverlay(isWin, totalScore);
    if (conn) conn.send({ type: 'LEVEL_END', isWin: isWin, total: totalScore });
}

function showEndOverlay(isWin, finalTotal) {
    gameActive = false;
    const overlay = document.getElementById('overlay');
    overlay.style.display = 'flex';
    const nextBtn = document.getElementById('nextLevelBtn');
    const restartBtn = document.getElementById('restartBtn');
    nextBtn.style.display = 'none'; restartBtn.style.display = 'none';
    if (isWin) {
        document.getElementById('overlayTitle').innerText = "🎉 恭喜通过本关！";
        document.getElementById('overlayStatus').innerText = `总分: ${finalTotal}`;
        if (isHost) {
            nextBtn.style.display = 'inline-block'; nextBtn.innerText = "开启下一关";
            nextBtn.onclick = () => {
                const items = generateItems();
                if (conn) conn.send({ type: 'START_GAME', level: currentLevel+1, score: totalScore, bombs: bombs, items: items });
                startLevel(currentLevel + 1, totalScore, bombs, items);
            };
        }
    } else {
        document.getElementById('overlayTitle').innerText = "❌ 挑战失败";
        document.getElementById('overlayStatus').innerText = `总分: ${finalTotal} / 目标: ${targetScore}`;
        if (isHost) {
            restartBtn.style.display = 'inline-block';
            restartBtn.onclick = () => {
                const items = generateItems();
                if (conn) conn.send({ type: 'START_GAME', level: 1, score: 0, bombs: 3, items: items });
                startLevel(1, 0, 3, items);
            };
        }
    }
}

function showWaitingOverlay() {
    gameActive = false; document.getElementById('overlay').style.display = 'flex';
    document.getElementById('overlayTitle').innerText = "黄金搭档已就绪";
    document.getElementById('overlayStatus').innerText = isHost ? "你是主机（左），点击开始" : "你是客机（右），等待主机开始...";
    if (isHost) {
        const btn = document.getElementById('nextLevelBtn'); btn.style.display = 'inline-block'; btn.innerText = "开始游戏";
        btn.onclick = () => {
            const items = generateItems();
            if (conn) conn.send({ type: 'START_GAME', level: 1, score: 0, bombs: 3, items: items });
            startLevel(1, 0, 3, items);
        };
    }
}

function resetHooks() { myHook = { angle: 0, dir: 1, length: 80, state: 'SWING', caughtItem: null }; peerHook = { angle: 0, length: 80 }; }
function updateUI() {
    document.getElementById('totalScoreDisplay').innerText = totalScore;
    document.getElementById('targetScoreDisplay').innerText = targetScore;
    document.getElementById('levelDisplay').innerText = `第 ${currentLevel} 关`;
    document.getElementById('bombDisplay').innerText = bombs;
}

window.onkeydown = e => {
    if (!gameActive) return;
    if (e.code === 'Space' && myHook.state === 'SWING') myHook.state = 'FIRE';
    if ((e.code === 'KeyE' || e.code === 'ArrowUp') && myHook.state === 'RETRACT' && myHook.caughtItem) {
        if (bombs > 0) {
            bombs--;
            const itemId = myHook.caughtItem.id;
            gameItems = gameItems.filter(it => it.id !== itemId);
            myHook.caughtItem = null; updateUI();
            if (conn) conn.send({ type: 'BOMB_SYNC', bombs: bombs, itemId: itemId });
        }
    }
};

draw();