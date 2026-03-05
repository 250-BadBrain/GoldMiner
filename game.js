const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const LOGIC_WIDTH = 1600;
const LOGIC_HEIGHT = 900;
canvas.width = LOGIC_WIDTH;
canvas.height = LOGIC_HEIGHT;

const SWING_SPEED = 0.008;      
const FIRE_SPEED = 3.5;         
const RETRACT_SPEED_BASE = 4.5; 

let peer = new Peer();
let conn = null;
let isHost = false;

// 游戏状态
let currentLevel = 1, myContribution = 0, peerContribution = 0, totalScore = 0;
let targetScore = 2000, timeLeft = 60, bombs = 3;
let gameActive = false, gameItems = [];
let timerInterval = null;

const HOOK_Y = 120;
const HOOK_OFFSET = 380; 
let myStartX, peerStartX;

let myHook = { angle: 0, dir: 1, length: 80, state: 'SWING', caughtItem: null };
let peerHook = { angle: 0, length: 80 };

const ITEM_TYPES = {
    DIAMOND:    { r: 15, score: 600, weight: 0.8, color: '#00ffff', label: '钻' },
    GOLD_SMALL: { r: 25, score: 100, weight: 1.5, color: '#FFD700', label: '金' },
    STONE_SMALL:{ r: 22, score: 20,  weight: 1.5, color: '#888',    label: '石' },
    GOLD_BIG:   { r: 55, score: 500, weight: 3.5, color: '#FFD700', label: '大金' },
    STONE_BIG:  { r: 60, score: 50,  weight: 4.0, color: '#666',    label: '大石' }
};

// --- 联机逻辑 ---
peer.on('open', id => document.getElementById('myId').innerText = id);
document.getElementById('myId').onclick = () => {
    navigator.clipboard.writeText(document.getElementById('myId').innerText);
    document.getElementById('copyTip').innerText = "已复制";
    setTimeout(() => document.getElementById('copyTip').innerText = "点击复制", 2000);
};

peer.on('connection', c => { conn = c; isHost = true; setupConn(); });
document.getElementById('connectBtn').onclick = () => {
    const pId = document.getElementById('peerIdInput').value.trim();
    if (!pId) return;
    conn = peer.connect(pId);
    isHost = false; setupConn();
};

function setupConn() {
    conn.on('open', () => {
        document.getElementById('connection-panel').style.display = 'none';
        document.getElementById('game-info').style.display = 'flex';
        
        // 核心修改：主机永远在左，客机永远在右
        myStartX = isHost ? (LOGIC_WIDTH/2 - HOOK_OFFSET) : (LOGIC_WIDTH/2 + HOOK_OFFSET);
        peerStartX = isHost ? (LOGIC_WIDTH/2 + HOOK_OFFSET) : (LOGIC_WIDTH/2 - HOOK_OFFSET);
        
        showWaitingOverlay();
    });

    conn.on('data', data => {
        switch(data.type) {
            case 'START_GAME': 
                startLevel(data.level, data.score, data.bombs, data.items);
                break;
            case 'SYNC_LEVEL': 
                applyLevelData(data);
                break;
            case 'TIME_SYNC':
                timeLeft = data.time;
                document.getElementById('timeDisplay').innerText = timeLeft;
                break;
            case 'LEVEL_END':
                showEndOverlay(data.isWin, data.total);
                break;
            case 'HOOK_POS':
                peerHook.angle = data.angle; peerHook.length = data.length;
                break;
            case 'ITEM_MOVE':
                let item = gameItems.find(it => it.id === data.itemId);
                if (item) { item.x = data.x; item.y = data.y; }
                break;
            case 'ITEM_COLLECTED':
                // 客机传来的贡献度，就是主机的 peerContribution
                gameItems = gameItems.filter(it => it.id !== data.itemId);
                peerContribution = data.contribution; 
                totalScore = myContribution + peerContribution; // 实时计算总分
                updateUI();
                break;
            case 'BOMB_SYNC':
                bombs = data.bombs;
                if (data.itemId) gameItems = gameItems.filter(it => it.id !== data.itemId);
                updateUI();
                break;
        }
    });
}

// --- 状态与得分 ---

function showWaitingOverlay() {
    gameActive = false;
    const overlay = document.getElementById('overlay');
    overlay.style.display = 'flex';
    document.getElementById('overlayTitle').innerText = "黄金搭档已就绪";
    document.getElementById('overlayStatus').innerText = isHost ? "你是主机（左侧），点击开始" : "你是客机（右侧），等待主机开始...";
    
    if (isHost) {
        const btn = document.getElementById('nextLevelBtn');
        btn.style.display = 'inline-block';
        btn.innerText = "开始游戏";
        btn.onclick = () => {
            const items = generateItems();
            if (conn) conn.send({ type: 'START_GAME', level: 1, score: 0, bombs: 3, items: items });
            startLevel(1, 0, 3, items);
        };
    }
}

function startLevel(lvl, score, bmb, items) {
    document.getElementById('overlay').style.display = 'none';
    currentLevel = lvl;
    totalScore = score;
    bombs = bmb;
    // 重置本关贡献度，但由于 totalScore 是累加的，这里清空贡献度以计算本关得分
    // 注意：如果是保持跨关卡总分，贡献度也应对应处理。这里设定每关贡献重新从0开始
    myContribution = 0; peerContribution = 0; 
    
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
    gameItems = data.items;
    targetScore = data.target;
    currentLevel = data.level;
    totalScore = data.total;
    bombs = data.bombs;
    myContribution = 0; peerContribution = 0;
    document.getElementById('overlay').style.display = 'none';
    resetHooks();
    gameActive = true;
    updateUI();
}

function updateUI() {
    document.getElementById('totalScoreDisplay').innerText = totalScore;
    document.getElementById('targetScoreDisplay').innerText = targetScore;
    document.getElementById('levelDisplay').innerText = `第 ${currentLevel} 关`;
    document.getElementById('bombDisplay').innerText = bombs;
}

// --- 游戏循环 ---

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
        let s = myHook.caughtItem ? Math.max(0.5, RETRACT_SPEED_BASE - myHook.caughtItem.weight) : RETRACT_SPEED_BASE;
        myHook.length -= s;
        if (myHook.caughtItem) {
            myHook.caughtItem.x = myStartX + myHook.length * Math.sin(myHook.angle);
            myHook.caughtItem.y = HOOK_Y + myHook.length * Math.cos(myHook.angle);
            if (conn && conn.open) conn.send({ type: 'ITEM_MOVE', itemId: myHook.caughtItem.id, x: myHook.caughtItem.x, y: myHook.caughtItem.y });
        }
        if (myHook.length <= 80) {
            if (myHook.caughtItem) {
                myContribution += myHook.caughtItem.score; 
                totalScore = myContribution + peerContribution; // 计算加权总分
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
    // 渲染背景
    ctx.fillStyle = "#87ceeb"; ctx.fillRect(0, 0, LOGIC_WIDTH, LOGIC_HEIGHT * 0.18);
    ctx.fillStyle = "#3d2b1f"; ctx.fillRect(0, LOGIC_HEIGHT * 0.18, LOGIC_WIDTH, LOGIC_HEIGHT * 0.82);
    ctx.fillStyle = "#5d3a1a"; ctx.fillRect(0, LOGIC_HEIGHT * 0.18, LOGIC_WIDTH, 12);
    
    // 渲染矿石
    gameItems.forEach(item => {
        ctx.beginPath(); ctx.arc(item.x, item.y, item.r, 0, Math.PI*2);
        ctx.fillStyle = item.color; ctx.fill(); ctx.strokeStyle = "#000"; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = "black"; ctx.font = "bold 18px Arial"; ctx.textAlign = "center";
        ctx.fillText(item.label, item.x, item.y + 8);
    });

    // 渲染钩子与个人分数
    renderHook(myStartX, HOOK_Y, myHook.angle, myHook.length, "#ffcc00", "我", myContribution);
    if (conn && conn.open) renderHook(peerStartX, HOOK_Y, peerHook.angle, peerHook.length, "#ff4444", "队友", peerContribution);
    
    update();
    requestAnimationFrame(draw);
}

function renderHook(x, y, angle, len, color, label, score) {
    const endX = x + len * Math.sin(angle);
    const endY = y + len * Math.cos(angle);
    
    // 画绳子
    ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 4;
    ctx.moveTo(x, y); ctx.lineTo(endX, endY); ctx.stroke();
    
    // 画钩子头
    ctx.save(); ctx.translate(endX, endY); ctx.rotate(-angle);
    ctx.beginPath(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 5;
    ctx.arc(0, 0, 18, 0, Math.PI); ctx.stroke();
    ctx.restore();
    
    // 渲染矿工下方分数
    ctx.fillStyle = color; ctx.font = "bold 24px Arial"; ctx.textAlign = "center";
    ctx.fillText(label, x, y - 45);
    ctx.fillStyle = "#fff"; ctx.font = "18px Arial";
    ctx.fillText(`$${score}`, x, y + 40); // 渲染在矿工支点下方
}

// 矿石生成
function generateItems() {
    const items = [];
    for (let i = 0; i < 20; i++) {
        let attempts = 0;
        while (attempts < 50) {
            const rand = Math.random();
            let type = rand > 0.9 ? ITEM_TYPES.DIAMOND : (rand > 0.7 ? ITEM_TYPES.STONE_BIG : (rand > 0.4 ? ITEM_TYPES.GOLD_BIG : (rand > 0.2 ? ITEM_TYPES.GOLD_SMALL : ITEM_TYPES.STONE_SMALL)));
            let newItem = { id: Math.random(), x: 150 + Math.random() * (LOGIC_WIDTH - 300), y: 300 + Math.random() * (LOGIC_HEIGHT - 450), ...type };
            let overlap = items.some(e => Math.sqrt((e.x-newItem.x)**2 + (e.y-newItem.y)**2) < (e.r+newItem.r+35));
            if (!overlap) { items.push(newItem); break; }
            attempts++;
        }
    }
    return items;
}

// 计时逻辑
function resetTimer() {
    if (!isHost) return;
    timeLeft = 60;
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        if (gameActive) {
            timeLeft--;
            document.getElementById('timeDisplay').innerText = timeLeft;
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
    const title = document.getElementById('overlayTitle');
    const status = document.getElementById('overlayStatus');
    const nextBtn = document.getElementById('nextLevelBtn');
    const restartBtn = document.getElementById('restartBtn');

    if (isWin) {
        title.innerText = "🎉 恭喜通过本关！";
        title.style.color = "#00ff00";
        status.innerText = `第 ${currentLevel} 关目标达成。当前总分: ${finalTotal}`;
        if (isHost) {
            nextBtn.style.display = 'inline-block';
            nextBtn.innerText = "开启下一关";
            nextBtn.onclick = () => {
                const items = generateItems();
                if (conn) conn.send({ type: 'START_GAME', level: currentLevel+1, score: totalScore, bombs: bombs, items: items });
                startLevel(currentLevel + 1, totalScore, bombs, items);
            };
        }
    } else {
        title.innerText = "❌ 挑战失败";
        title.style.color = "#ff4444";
        status.innerText = `最终总分: ${finalTotal} / 目标: ${targetScore}`;
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

function resetHooks() {
    myHook = { angle: 0, dir: 1, length: 80, state: 'SWING', caughtItem: null };
    peerHook = { angle: 0, length: 80 };
}

window.onkeydown = e => {
    if (!gameActive) return;
    if (e.code === 'Space' && myHook.state === 'SWING') myHook.state = 'FIRE';
    if ((e.code === 'KeyE' || e.code === 'ArrowUp') && myHook.state === 'RETRACT' && myHook.caughtItem) {
        if (bombs > 0) {
            bombs--;
            const itemId = myHook.caughtItem.id;
            gameItems = gameItems.filter(it => it.id !== itemId);
            myHook.caughtItem = null;
            updateUI();
            if (conn) conn.send({ type: 'BOMB_SYNC', bombs: bombs, itemId: itemId });
        }
    }
};

draw();