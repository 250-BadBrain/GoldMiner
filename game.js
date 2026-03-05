const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const LOGIC_WIDTH = 1600;
const LOGIC_HEIGHT = 900;
canvas.width = LOGIC_WIDTH;
canvas.height = LOGIC_HEIGHT;

// --- 数值调整：低速平衡模式 ---
const SWING_SPEED = 0.006;      
const FIRE_SPEED = 2.5;         
const RETRACT_SPEED_BASE = 3.5; 

// --- 网络配置 ---
const peerConfig = { config: { 'iceServers': [{ url: 'stun:stun.l.google.com:19302' }, { url: 'stun:stun1.l.google.com:19302' }] } };
let peer = new Peer(peerConfig); 
let conn = null;
let isHost = false;

peer.on('open', id => { document.getElementById('myId').innerText = id; });
document.getElementById('myId').onclick = () => {
    navigator.clipboard.writeText(document.getElementById('myId').innerText);
    document.getElementById('copyTip').innerText = "已复制";
    setTimeout(() => document.getElementById('copyTip').innerText = "点击复制", 2000);
};

peer.on('connection', c => { 
    conn = c; 
    isHost = true; 
    setupConn(); 
});

document.getElementById('connectBtn').onclick = () => {
    const pId = document.getElementById('peerIdInput').value.trim();
    if (!pId) return alert("请输入 ID");
    conn = peer.connect(pId, { reliable: true });
    isHost = false; 
    setupConn();
};

function setupConn() {
    if (!conn) return;
    conn.on('open', () => {
        document.getElementById('connection-panel').style.display = 'none';
        document.getElementById('game-info').style.display = 'flex';
        myStartX = isHost ? (LOGIC_WIDTH/2 - 380) : (LOGIC_WIDTH/2 + 380);
        peerStartX = isHost ? (LOGIC_WIDTH/2 + 380) : (LOGIC_WIDTH/2 - 380);
        showWaitingOverlay();
    });
    conn.on('data', data => {
        switch(data.type) {
            case 'START_GAME': 
                startLevel(data.level, data.myContrib, data.peerContrib, data.bombs, data.items, data.globalTotal); 
                break;
            case 'SYNC_LEVEL': applyLevelData(data); break;
            case 'TIME_SYNC': timeLeft = data.time; document.getElementById('timeDisplay').innerText = timeLeft; break;
            case 'LEVEL_END': showEndOverlay(data.isWin, data.total, data.shopItems); break;
            case 'HOOK_POS': peerHook.angle = data.angle; peerHook.length = data.length; break;
            case 'ITEM_MOVE':
                let item = gameItems.find(it => it.id === data.itemId);
                if (item) { item.x = data.x; item.y = data.y; item.isCaught = true; }
                break;
            case 'ITEM_COLLECTED':
                gameItems = gameItems.filter(it => it.id !== data.itemId);
                const added = data.contribution - peerContribution;
                createScorePopup(peerStartX, HOOK_Y, added);
                peerContribution = data.contribution; 
                updateGlobalTotal();
                updateUI();
                break;
            case 'BOMB_SYNC':
                bombs = data.bombs;
                if (data.itemId) gameItems = gameItems.filter(it => it.id !== data.itemId);
                updateUI();
                break;
            case 'POWER_UP': hasPowerUp = true; toast("大力药水已生效！"); break;
            case 'BUY_SYNC': 
                totalScore = data.newTotal;
                applyShopEffect(data.effect);
                const cards = document.querySelectorAll('.shop-item-card');
                if (cards[data.itemIndex]) cards[data.itemIndex].classList.add('sold');
                updateUI();
                break;
            case 'BAG_REWARD':
                if (data.rewardType === 'money') { 
                    createScorePopup(peerStartX, HOOK_Y, data.value);
                    peerContribution += data.value; 
                    toast(`队友开出了 $${data.value}！`);
                    updateGlobalTotal(); 
                } else if (data.rewardType === 'bomb') { 
                    bombs += 1; 
                    toast("队友开出了 炸弹+1！");
                }
                updateUI();
                break;
        }
    });
}

// --- 游戏变量 ---
let currentLevel = 1, myContribution = 0, peerContribution = 0, totalScore = 0;
let targetScore = 1200, timeLeft = 60, bombs = 3; 
let gameActive = false, gameItems = [];
let timerInterval = null;
let hasPowerUp = false, stoneBookEffect = false, cloverEffect = false;
let scorePopups = [];

const SHOP_CATALOG = [
    { name: "大力药水", price: 300, effect: 'POWER', icon: "💪" },
    { name: "炸弹", price: 150, effect: 'BOMB', icon: "💣" },
    { name: "石头之书", price: 200, effect: 'STONE_BOOK', icon: "📖" },
    { name: "优质四叶草", price: 250, effect: 'CLOVER', icon: "🍀" }
];

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
    if(el) { el.innerText = msg; el.style.display = 'block'; setTimeout(() => { el.style.display = 'none'; }, 2000); }
}

function createScorePopup(x, y, score) {
    if (score <= 0) return;
    scorePopups.push({ x, y, score: `+$${score}`, opacity: 1, life: 60 });
}

function updateGlobalTotal() {
    totalScore = myContribution + peerContribution;
}

function handleLuckyBag() {
    const boost = cloverEffect ? 1.5 : 1.0;
    const rand = Math.random();
    if (rand < 0.4) {
        const money = Math.floor((Math.random() * 701 + 100) * boost);
        createScorePopup(myStartX, HOOK_Y, money); 
        myContribution += money; updateGlobalTotal();
        toast(`💰 幸运口袋: $${money}`);
        if (conn) conn.send({ type: 'BAG_REWARD', rewardType: 'money', value: money });
    } else if (rand < 0.7) {
        bombs += 1; toast("💣 幸运口袋: 炸弹 +1");
        if (conn) conn.send({ type: 'BAG_REWARD', rewardType: 'bomb' });
    } else {
        hasPowerUp = true; toast("💪 幸运口袋: 大力药水！");
        if (conn) conn.send({ type: 'POWER_UP' });
    }
}

function startLevel(lvl, myStartScore, peerStartScore, bmb, items, globalTotal) {
    document.getElementById('overlay').style.display = 'none';
    document.getElementById('shop-area').style.display = 'none';
    currentLevel = lvl;
    bombs = bmb;
    myContribution = myStartScore; 
    peerContribution = peerStartScore; 
    totalScore = globalTotal; 
    hasPowerUp = false; 
    targetScore = lvl * 1000 + (lvl > 1 ? 1500 : 200); 
    gameItems = items;
    scorePopups = [];
    resetHooks();
    gameActive = true; 
    if (isHost && conn) {
        conn.send({ type: 'SYNC_LEVEL', items: gameItems, target: targetScore, level: currentLevel, myContrib: peerContribution, peerContrib: myContribution, bombs: bombs, globalTotal: totalScore });
        resetTimer();
    }
    updateUI();
}

function applyLevelData(data) {
    gameItems = data.items; targetScore = data.target; currentLevel = data.level; 
    myContribution = data.myContrib; peerContribution = data.peerContrib; 
    totalScore = data.globalTotal; bombs = data.bombs;
    hasPowerUp = false;
    document.getElementById('overlay').style.display = 'none';
    document.getElementById('shop-area').style.display = 'none';
    resetHooks(); gameActive = true; updateUI();
}

function update() {
    if (!gameActive) return;
    for (let i = scorePopups.length - 1; i >= 0; i--) {
        scorePopups[i].y -= 1.2; scorePopups[i].life--;
        scorePopups[i].opacity = scorePopups[i].life / 60;
        if (scorePopups[i].life <= 0) scorePopups.splice(i, 1);
    }

    if (myHook.state === 'SWING') {
        myHook.angle += SWING_SPEED * myHook.dir;
        if (Math.abs(myHook.angle) > 1.3) myHook.dir *= -1;
    } else if (myHook.state === 'FIRE') {
        myHook.length += FIRE_SPEED;
        const hX = myStartX + myHook.length * Math.sin(myHook.angle);
        const hY = HOOK_Y + myHook.length * Math.cos(myHook.angle);
        for (let item of gameItems) {
            if (!item.isCaught && Math.sqrt((hX - item.x)**2 + (hY - item.y)**2) < item.r) {
                item.isCaught = true; myHook.caughtItem = item; myHook.state = 'RETRACT'; break;
            }
        }
        if (myHook.length > 1100 || hX < 0 || hX > LOGIC_WIDTH || hY > LOGIC_HEIGHT) myHook.state = 'RETRACT';
    } else if (myHook.state === 'RETRACT') {
        let baseSpeed = hasPowerUp ? (RETRACT_SPEED_BASE * 2.5) : RETRACT_SPEED_BASE;
        let s = myHook.caughtItem ? Math.max(0.6, baseSpeed - myHook.caughtItem.weight) : baseSpeed;
        myHook.length -= s;
        if (myHook.caughtItem) {
            myHook.caughtItem.x = myStartX + myHook.length * Math.sin(myHook.angle);
            myHook.caughtItem.y = HOOK_Y + myHook.length * Math.cos(myHook.angle);
            if (conn && conn.open) conn.send({ type: 'ITEM_MOVE', itemId: myHook.caughtItem.id, x: myHook.caughtItem.x, y: myHook.caughtItem.y });
        }
        if (myHook.length <= 80) {
            if (myHook.caughtItem) {
                if (myHook.caughtItem.label === '?') handleLuckyBag();
                else {
                    let score = myHook.caughtItem.score;
                    if (stoneBookEffect && myHook.caughtItem.label.includes('石')) score *= 3;
                    createScorePopup(myStartX, HOOK_Y, score);
                    myContribution += score;
                }
                updateGlobalTotal();
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
    ctx.fillStyle = "#87ceeb"; ctx.fillRect(0, 0, LOGIC_WIDTH, 160); 
    ctx.fillStyle = "#3d2b1f"; ctx.fillRect(0, 160, LOGIC_WIDTH, LOGIC_HEIGHT - 160); 
    ctx.fillStyle = "#5d3a1a"; ctx.fillRect(0, 160, LOGIC_WIDTH, 12); 
    
    gameItems.forEach(item => {
        ctx.beginPath(); ctx.arc(item.x, item.y, item.r, 0, Math.PI*2);
        ctx.fillStyle = item.color; ctx.fill(); ctx.strokeStyle = "#000"; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = "black"; ctx.font = "bold 18px Arial"; ctx.textAlign = "center";
        ctx.fillText(item.label, item.x, item.y + 8);
    });

    if(myStartX !== undefined) renderHook(myStartX, HOOK_Y, myHook.angle, myHook.length, "#ffcc00", "我", myContribution);
    if (conn && conn.open && peerStartX !== undefined) renderHook(peerStartX, HOOK_Y, peerHook.angle, peerHook.length, "#ff4444", "队友", peerContribution);
    
    scorePopups.forEach(p => {
        ctx.fillStyle = `rgba(255, 255, 0, ${p.opacity})`; ctx.font = "bold 36px Arial";
        ctx.textAlign = "center"; ctx.fillText(p.score, p.x, p.y);
    });
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
    ctx.fillStyle = color; ctx.font = "bold 32px Arial"; ctx.textAlign = "center";
    ctx.fillText(label, x, y - 55);
    ctx.fillStyle = "#ffffff"; ctx.font = "bold 28px Arial"; ctx.fillText(`$${score}`, x, y + 45);
}

function generateItems() {
    const items = [];
    for (let i = 0; i < 24; i++) {
        let attempts = 0;
        while (attempts < 50) {
            const rand = Math.random();
            let type = rand > 0.93 ? ITEM_TYPES.DIAMOND : (rand > 0.86 ? ITEM_TYPES.LUCKY_BAG : (rand > 0.7 ? ITEM_TYPES.STONE_BIG : (rand > 0.4 ? ITEM_TYPES.GOLD_BIG : (rand > 0.2 ? ITEM_TYPES.GOLD_SMALL : ITEM_TYPES.STONE_SMALL))));
            let newItem = { id: Math.random(), x: 150 + Math.random() * (LOGIC_WIDTH - 300), y: 300 + Math.random() * (LOGIC_HEIGHT - 450), isCaught: false, ...type };
            if (!items.some(e => Math.sqrt((e.x-newItem.x)**2 + (e.y-newItem.y)**2) < (e.r+newItem.r+40))) { items.push(newItem); break; }
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
    const finalTotal = myContribution + peerContribution;
    const isWin = finalTotal >= targetScore;
    let shopItems = [];
    if (isWin) {
        const shuffled = [...SHOP_CATALOG].sort(() => 0.5 - Math.random());
        shopItems = shuffled.slice(0, 3).map(item => ({ ...item, price: item.price + Math.floor(Math.random()*100) }));
    }
    showEndOverlay(isWin, finalTotal, shopItems);
    if (conn) conn.send({ type: 'LEVEL_END', isWin: isWin, total: finalTotal, shopItems: shopItems });
}

function showEndOverlay(isWin, finalTotal, shopItems) {
    gameActive = false;
    stoneBookEffect = false; cloverEffect = false;
    const overlay = document.getElementById('overlay');
    overlay.style.display = 'flex';
    const nextBtn = document.getElementById('nextLevelBtn');
    const restartBtn = document.getElementById('restartBtn');
    const shopArea = document.getElementById('shop-area');
    const shopContainer = document.getElementById('shop-items');
    
    nextBtn.style.display = 'none'; restartBtn.style.display = 'none'; shopArea.style.display = 'none';

    if (isWin) {
        document.getElementById('overlayTitle').innerText = "🎉 挑战成功！";
        document.getElementById('overlayStatus').innerText = `当前总分: ${totalScore}`; // 使用全局变量
        
        if (shopItems && shopItems.length > 0) {
            shopArea.style.display = 'block';
            shopContainer.innerHTML = '';
            shopItems.forEach((item, index) => {
                const el = document.createElement('div');
                el.className = 'shop-item-card';
                if (!isHost) el.style.cursor = 'default';
                el.innerHTML = `<span style="font-size:30px">${item.icon}</span><br><span class="item-name">${item.name}</span><span class="item-price">$${item.price}</span>`;
                
                el.onclick = () => {
                    if (!isHost) return; 
                    if (totalScore >= item.price && !el.classList.contains('sold')) {
                        totalScore -= item.price;
                        applyShopEffect(item.effect);
                        el.classList.add('sold');
                        updateUI(); // 核心：刷新顶部 UI 和 商店弹窗文字
                        if (conn) conn.send({ type: 'BUY_SYNC', newTotal: totalScore, effect: item.effect, itemIndex: index });
                    } else if (totalScore < item.price) {
                        alert("钱不够啊，老铁！");
                    }
                };
                shopContainer.appendChild(el);
            });
        }

        if (isHost) {
            nextBtn.style.display = 'inline-block'; nextBtn.innerText = "进入下一关";
            nextBtn.onclick = () => {
                const items = generateItems();
                if (conn) conn.send({ type: 'START_GAME', level: currentLevel+1, myContrib: myContribution, peerContrib: peerContribution, bombs: bombs, items: items, globalTotal: totalScore });
                startLevel(currentLevel + 1, myContribution, peerContribution, bombs, items, totalScore);
            };
        }
    } else {
        document.getElementById('overlayTitle').innerText = "❌ 分数未达标";
        document.getElementById('overlayStatus').innerText = `总分: ${totalScore} / 目标: ${targetScore}`;
        if (isHost) {
            restartBtn.style.display = 'inline-block'; restartBtn.innerText = "从头开始";
            restartBtn.onclick = () => {
                const items = generateItems();
                if (conn) conn.send({ type: 'START_GAME', level: 1, myContrib: 0, peerContrib: 0, bombs: 3, items: items, globalTotal: 0 });
                startLevel(1, 0, 0, 3, items, 0);
            };
        }
    }
}

function applyShopEffect(effect) {
    if (effect === 'BOMB') bombs++;
    if (effect === 'POWER') hasPowerUp = true;
    if (effect === 'STONE_BOOK') stoneBookEffect = true;
    if (effect === 'CLOVER') cloverEffect = true;
}

function showWaitingOverlay() {
    gameActive = false; 
    const overlay = document.getElementById('overlay');
    overlay.style.display = 'flex';
    document.getElementById('overlayTitle').innerText = "黄金搭档已就绪";
    document.getElementById('overlayStatus').innerText = isHost ? "你是主机，点击开始" : "你是客机，等待主机开始...";
    
    const nextBtn = document.getElementById('nextLevelBtn');
    if (isHost) {
        nextBtn.style.display = 'inline-block'; nextBtn.innerText = "开始游戏";
        nextBtn.onclick = () => {
            const items = generateItems();
            if (conn) conn.send({ type: 'START_GAME', level: 1, myContrib: 0, peerContrib: 0, bombs: 3, items: items, globalTotal: 0 });
            startLevel(1, 0, 0, 3, items, 0);
        };
    } else {
        nextBtn.style.display = 'none';
    }
}

function resetHooks() { myHook = { angle: 0, dir: 1, length: 80, state: 'SWING', caughtItem: null }; peerHook = { angle: 0, length: 80 }; }

// 修改后的 UI 刷新函数：同时刷新主 UI 和商店弹窗文字
function updateUI() {
    // 刷新主 UI
    document.getElementById('totalScoreDisplay').innerText = totalScore;
    document.getElementById('targetScoreDisplay').innerText = targetScore;
    document.getElementById('levelDisplay').innerText = `第 ${currentLevel} 关`;
    document.getElementById('bombDisplay').innerText = bombs;
    
    // 核心修复：如果商店弹窗正开着，实时刷新弹窗里的状态文字
    const overlay = document.getElementById('overlay');
    const overlayStatus = document.getElementById('overlayStatus');
    if (overlay.style.display === 'flex' && !gameActive) {
        // 如果是过关状态
        if (totalScore >= targetScore) {
            overlayStatus.innerText = `当前总分: ${totalScore}`;
        } else {
            overlayStatus.innerText = `总分: ${totalScore} / 目标: ${targetScore}`;
        }
    }
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