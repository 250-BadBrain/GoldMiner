const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const scoreElement = document.getElementById('scoreDisplay');
const bombElement = document.getElementById('bombDisplay');
const timeElement = document.getElementById('timeDisplay');
const levelElement = document.getElementById('levelDisplay');
const targetElement = document.getElementById('targetDisplay');
const overlay = document.getElementById('overlay');

// --- 游戏平衡参数 ---
const FIRE_SPEED = 2.5;         // 伸钩速度
const ANGLE_LIMIT = 1.3;        
let angleSpeed = 0.01;          

// 速度分级配置 (拉回速度)
const RETRACT_SPEEDS = {
    EMPTY: 4.0,     // 空钩
    SMALL: 2.0,     // 所有小矿物 (小金、钻石、小石头)
    BIG: 0.8,       // 大矿物 (大金、大石头)
    HEAVY_ROCK: 0.4 // 专门给大石头的惩罚速度
};

// --- 核心变量 ---
let level = 1;
let totalScore = 0;
let targetScore = 1000;
let timeLeft = 60;
let bombs = 3;
let gameActive = true;
let timerInterval = null;

let angle = 0;
let length = 60;
const originX = 400;
const originY = 50;

let isFiring = false;
let isRetracting = false;
let caughtItem = null;
let isExploding = false;        
let explosionTimer = 0;         

// 物体配置
const ITEM_TYPES = {
    DIAMOND:    { r: 10, score: 600, size: 'SMALL', color: '#00ffff', label: '钻' },
    GOLD_SMALL: { r: 15, score: 100, size: 'SMALL', color: '#FFD700', label: '金' },
    STONE_SMALL:{ r: 15, score: 20,  size: 'SMALL', color: '#888',    label: '石' },
    GOLD_BIG:   { r: 40, score: 500, size: 'BIG',   color: '#FFD700', label: '大金' },
    STONE_BIG:  { r: 45, score: 50,  size: 'HEAVY', color: '#666',    label: '大石' }
};

let gameItems = [];

// --- 防重叠生成函数 ---
function initLevel(lvl) {
    gameActive = true;
    timeLeft = 60;
    length = 60;
    isFiring = false;
    isRetracting = false;
    caughtItem = null;
    isExploding = false;
    
    targetScore = lvl * 1500 - 500;
    levelElement.innerText = lvl;
    targetElement.innerText = targetScore;
    timeElement.innerText = timeLeft;
    bombElement.innerText = bombs;
    overlay.style.display = 'none';

    gameItems = [];
    const itemCount = 12 + lvl; 
    
    for (let i = 0; i < itemCount; i++) {
        let newItem;
        let attempts = 0;
        let overlapping = true;

        // 尝试生成不重叠的物体
        while (overlapping && attempts < 50) {
            const rand = Math.random();
            let type;
            if (rand > 0.9) type = ITEM_TYPES.DIAMOND;
            else if (rand > 0.7) type = ITEM_TYPES.STONE_BIG;
            else if (rand > 0.5) type = ITEM_TYPES.GOLD_BIG;
            else if (rand > 0.2) type = ITEM_TYPES.GOLD_SMALL;
            else type = ITEM_TYPES.STONE_SMALL;

            newItem = {
                x: 60 + Math.random() * 680,
                y: 180 + Math.random() * 260,
                ...type
            };

            // 检测与已生成物体的距离
            overlapping = gameItems.some(item => {
                const dist = Math.sqrt((newItem.x - item.x)**2 + (newItem.y - item.y)**2);
                return dist < (newItem.r + item.r + 10); // 额外留10像素间距
            });
            attempts++;
        }
        if (!overlapping) gameItems.push(newItem);
    }

    if(timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        if(gameActive) {
            timeLeft--;
            timeElement.innerText = timeLeft;
            if(timeLeft <= 0) endGame();
        }
    }, 1000);
}

function update() {
    if (!gameActive) return;

    if (!isFiring && !isRetracting) {
        angle += angleSpeed;
        if (Math.abs(angle) > ANGLE_LIMIT) angleSpeed *= -1;
    } 
    else if (isFiring) {
        length += FIRE_SPEED;
        const hookX = originX + length * Math.sin(angle);
        const hookY = originY + length * Math.cos(angle);

        for (let i = 0; i < gameItems.length; i++) {
            const item = gameItems[i];
            const dist = Math.sqrt((hookX - item.x)**2 + (hookY - item.y)**2);
            if (dist < item.r) {
                caughtItem = item;
                isFiring = false;
                isRetracting = true;
                break;
            }
        }
        if (length > 550 || hookX < 0 || hookX > 800 || hookY > 500) {
            isFiring = false; isRetracting = true;
        }
    } 
    else if (isRetracting) {
        // --- 速度分级逻辑 ---
        let currentRetractSpeed;
        if (!caughtItem || isExploding) {
            currentRetractSpeed = RETRACT_SPEEDS.EMPTY;
        } else {
            if (caughtItem.size === 'SMALL') currentRetractSpeed = RETRACT_SPEEDS.SMALL;
            else if (caughtItem.size === 'BIG') currentRetractSpeed = RETRACT_SPEEDS.BIG;
            else if (caughtItem.size === 'HEAVY') currentRetractSpeed = RETRACT_SPEEDS.HEAVY_ROCK;
        }

        length -= currentRetractSpeed;

        if (caughtItem && !isExploding) {
            caughtItem.x = originX + length * Math.sin(angle);
            caughtItem.y = originY + length * Math.cos(angle);
        }

        if (length <= 60) {
            isRetracting = false;
            length = 60;
            if (caughtItem && !isExploding) {
                totalScore += caughtItem.score;
                scoreElement.innerText = totalScore;
                const index = gameItems.indexOf(caughtItem);
                if (index > -1) gameItems.splice(index, 1);
            }
            caughtItem = null;
            isExploding = false; 
        }
    }
}

function draw() {
    ctx.clearRect(0, 0, 800, 500);

    gameItems.forEach(item => {
        ctx.beginPath();
        ctx.arc(item.x, item.y, item.r, 0, Math.PI * 2);
        ctx.fillStyle = item.color;
        ctx.fill();
        ctx.strokeStyle = '#222'; ctx.lineWidth = 2; ctx.stroke();
        
        ctx.fillStyle = 'black'; 
        ctx.font = `bold ${item.r > 20 ? 14 : 10}px Arial`; 
        ctx.textAlign = 'center';
        ctx.fillText(item.label, item.x, item.y + (item.r > 20 ? 5 : 4));
    });

    const endX = originX + length * Math.sin(angle);
    const endY = originY + length * Math.cos(angle);

    if (isExploding) {
        ctx.beginPath();
        ctx.arc(endX, endY, explosionTimer * 5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 69, 0, ${1 - explosionTimer/20})`;
        ctx.fill();
        explosionTimer++;
    }

    ctx.beginPath();
    ctx.strokeStyle = '#d2b48c'; ctx.lineWidth = 3;
    ctx.moveTo(originX, originY); ctx.lineTo(endX, endY); ctx.stroke();

    ctx.save();
    ctx.translate(endX, endY); ctx.rotate(-angle);
    ctx.beginPath(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
    ctx.arc(0, 0, 12, 0, Math.PI); ctx.stroke();
    ctx.restore();

    update();
    requestAnimationFrame(draw);
}

function useBomb() {
    if (isRetracting && caughtItem && !isExploding && bombs > 0) {
        bombs--;
        bombElement.innerText = bombs;
        isExploding = true;
        explosionTimer = 0;
        const index = gameItems.indexOf(caughtItem);
        if (index > -1) gameItems.splice(index, 1);
        caughtItem = null; 
    }
}

function endGame() {
    gameActive = false;
    clearInterval(timerInterval);
    overlay.style.display = 'flex';
    if (totalScore >= targetScore) {
        document.getElementById('overlayTitle').innerText = "挑战成功！";
        document.getElementById('overlayText').innerText = `当前得分: ${totalScore} / 目标: ${targetScore}`;
        document.getElementById('nextBtn').style.display = 'block';
        document.getElementById('restartBtn').style.display = 'none';
    } else {
        document.getElementById('overlayTitle').innerText = "遗憾落败";
        document.getElementById('overlayText').innerText = `得分未达标。最终得分: ${totalScore}`;
        document.getElementById('nextBtn').style.display = 'none';
        document.getElementById('restartBtn').style.display = 'block';
    }
}

function startNextLevel() { level++; initLevel(level); }
function resetGame() { level = 1; totalScore = 0; bombs = 3; scoreElement.innerText = totalScore; initLevel(level); }

window.addEventListener('keydown', (e) => {
    if (!gameActive) return;
    if (e.code === 'Space' && !isFiring && !isRetracting) isFiring = true;
    if (e.code === 'KeyE' || e.code === 'ArrowUp') useBomb();
});

initLevel(1);
draw();