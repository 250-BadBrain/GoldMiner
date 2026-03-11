const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const LOGIC_WIDTH = 1600;
const LOGIC_HEIGHT = 900;
canvas.width = LOGIC_WIDTH;
canvas.height = LOGIC_HEIGHT;

// --- 数值调整：更贴近原版体验 ---
const SWING_SPEED = 0.005;      
const FIRE_SPEED = 2;         
const RETRACT_SPEED_BASE = 2; 

// --- 网络配置与调试 ---
// 注意：如果校园网防火墙很严，可能需要更换或增加更多的 STUN/TURN 服务器
const peerConfig = { 
    config: { 
        'iceServers': [
            { url: 'stun:stun.l.google.com:19302' }, 
            { urls: 'stun:stun.miwifi.com:3478' },
            { urls: 'stun:stun.qq.com:3478' }
        ] 
    },
    debug: 3 // 开启 PeerJS 详细日志：3 表示全部信息
};

let peer = new Peer(peerConfig); 
let conn = null;
let isHost = false;

// 监听 Peer 实例错误
peer.on('error', err => {
    console.error('【网络错误】PeerJS 发生错误:', err.type, err);
    alert(`网络错误: ${err.type}。如果是校园网环境，可能是防火墙拦截了 UDP 流量。`);
});

peer.on('open', id => { 
    console.log('【网络状态】我的 Peer ID 已生成:', id);
    document.getElementById('myId').innerText = id; 
});

document.getElementById('myId').onclick = () => {
    navigator.clipboard.writeText(document.getElementById('myId').innerText);
    document.getElementById('copyTip').innerText = "已复制";
    setTimeout(() => document.getElementById('copyTip').innerText = "点击复制", 2000);
};

// 被动连接监听 (作为主机)
peer.on('connection', c => { 
    console.log('【连接尝试】收到来自远程的连接请求:', c.peer);
    conn = c; 
    isHost = true; 
    setupConn(); 
});

// 主动发起连接 (作为客机)
document.getElementById('connectBtn').onclick = () => {
    const pId = document.getElementById('peerIdInput').value.trim();
    if (!pId) return alert("请输入 ID");
    console.log('【发起连接】尝试连接目标 ID:', pId);
    conn = peer.connect(pId, { reliable: true });
    isHost = false; 
    setupConn();
};

function setupConn() {
    if (!conn) return;

    // 监听连接成功
    conn.on('open', () => {
        console.log('【连接成功】P2P 通道已建立！');
        document.getElementById('connection-panel').style.display = 'none';
        document.getElementById('game-info').style.display = 'flex';
        myStartX = isHost ? (LOGIC_WIDTH/2 - 380) : (LOGIC_WIDTH/2 + 380);
        peerStartX = isHost ? (LOGIC_WIDTH/2 + 380) : (LOGIC_WIDTH/2 - 380);
        showWaitingOverlay();
    });

    // 监听连接关闭
    conn.on('close', () => {
        console.warn('【连接断开】P2P 通道已关闭');
        alert("与队友的连接已断开");
        location.reload(); 
    });

    // 监听数据接收
    conn.on('data', data => {
        // 注释掉高频日志防止刷屏，调试时可开启
        // console.log('【数据接收】', data.type, data);

        switch(data.type) {
            case 'START_GAME': 
                startLevel(data.level, data.hostContrib, data.guestContrib, data.bombs, data.items, data.globalTotal); 
                break;
            case 'SYNC_LEVEL': applyLevelData(data); break;
            case 'TIME_SYNC': timeLeft = data.time; document.getElementById('timeDisplay').innerText = timeLeft; break;
            case 'LEVEL_END': showEndOverlay(data.isWin, data.total, data.shopItems); break;
            case 'HOOK_POS': peerHook.angle = data.angle; peerHook.length = data.length; break;
            case 'ITEM_MOVE':
                let itemMove = gameItems.find(it => it.id === data.itemId);
                if (itemMove) { 
                    itemMove.x = data.x; itemMove.y = data.y; itemMove.isCaught = true; 
                    if (!isHost && myHook.caughtItem && myHook.caughtItem.id === data.itemId) {
                        myHook.caughtItem = null;
                        myHook.state = 'RETRACT';
                    }
                }
                break;
            case 'ITEM_COLLECTED':
                gameItems = gameItems.filter(it => it.id !== data.itemId);
                const added = data.contribution - peerContribution;
                createScorePopup(peerStartX, HOOK_Y, added);
                peerContribution = data.contribution;
                totalScore += added;
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
                    totalScore += data.value;
                    toast(`队友开出了 $${data.value}！`);
                } else if (data.rewardType === 'bomb') { 
                    bombs += 1; 
                    toast("队友开出了 炸弹+1！");
                }
                updateUI();
                break;
            case 'BARREL_EXPLODE':
                gameItems = gameItems.filter(it => it.id !== data.itemId);
                handleExplosion(data.x, data.y, 150);
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
let hasPowerUp = false, stoneBookEffect = false, cloverEffect = false, diamondBoostEffect = false;
let scorePopups = [];
let explosionEffects = [];

const SHOP_CATALOG = [
    { name: "大力药水", effect: 'POWER', icon: "💪", getPrice: () => Math.floor(Math.random() * 211) + 10 },
    { name: "炸药", effect: 'BOMB', icon: "💣", getPrice: () => Math.floor(Math.random() * 328) + 10 },
    { name: "石头收藏书", effect: 'STONE_BOOK', icon: "📖", getPrice: () => Math.floor(Math.random() * 224) + 10 },
    { name: "幸运草", effect: 'CLOVER', icon: "🍀", getPrice: () => Math.floor(Math.random() * 194) + 10 },
    { name: "优质钻石液", effect: 'DIAMOND_BOOST', icon: "💎", getPrice: () => Math.floor(Math.random() * 338) + 10 }
];

const HOOK_Y = 120;
let myStartX, peerStartX;
let myHook = { angle: 0, dir: 1, length: 80, state: 'SWING', caughtItem: null };
let peerHook = { angle: 0, length: 80 };

const ITEM_TYPES = {
    DIAMOND:     { r: 15, score: 600, weight: 0,    color: '#00ffff', label: '钻', type: 'DIAMOND' },
    GOLD_HUGE:   { r: 60, score: 500, weight: 13.5, color: '#FFD700', label: '$500', type: 'GOLD_HUGE' },
    GOLD_LARGE:  { r: 45, score: 250, weight: 12.0, color: '#FFD700', label: '$250', type: 'GOLD_LARGE' },
    GOLD_MEDIUM: { r: 30, score: 100, weight: 9.0,  color: '#FFD700', label: '$100', type: 'GOLD_MEDIUM' },
    GOLD_SMALL:  { r: 20, score: 50,  weight: 5.0,  color: '#FFD700', label: '$50', type: 'GOLD_SMALL' },
    STONE_HUGE:  { r: 55, score: 20,  weight: 14.0, color: '#666',    label: '$20', type: 'STONE_HUGE' },
    STONE_SMALL: { r: 25, score: 11,  weight: 11.0, color: '#888',    label: '$11', type: 'STONE_SMALL' },
    LUCKY_BAG:   { r: 30, score: 0,   weight: 0,    color: '#ff9933', label: '?', type: 'LUCKY_BAG' },
    BARREL:      { r: 35, score: 0,   weight: 0,    color: '#8B4513', label: 'TNT', isBarrel: true, type: 'BARREL' },
    MOUSE:       { r: 20, score: 2,   weight: 0,    color: '#A9A9A9', label: '鼠', isMouse: true, speed: 2, dir: 1, type: 'MOUSE' },
    MOUSE_DIAMOND: { r: 20, score: 602, weight: 0,  color: '#00ffff', label: '钻鼠', isMouse: true, hasDiamond: true, speed: 2, dir: 1, type: 'MOUSE_DIAMOND' },
    BOMBER:      { r: 25, score: 0,   weight: 0,    color: '#8B0000', label: '炸药鼠', isBarrel: true, speed: 1.5, dir: 1, type: 'BOMBER' }
};

// --- 固定关卡设计 (原版体验前10关) ---
const LEVEL_CONFIGS = [
    {   // 第 1 关: 基础热身，大金小金小石头
        targetScore: 650,
        items: [
            { type: 'GOLD_HUGE', x: 800, y: 650 },
            { type: 'GOLD_LARGE', x: 400, y: 400 },
            { type: 'GOLD_LARGE', x: 1200, y: 450 },
            { type: 'GOLD_MEDIUM', x: 700, y: 500 },
            { type: 'GOLD_SMALL', x: 900, y: 500 },
            { type: 'GOLD_SMALL', x: 500, y: 450 },
            { type: 'STONE_SMALL', x: 600, y: 350 },
            { type: 'STONE_SMALL', x: 1000, y: 380 },
            { type: 'STONE_HUGE', x: 800, y: 400 },
            { type: 'LUCKY_BAG', x: 200, y: 600 },
            { type: 'LUCKY_BAG', x: 1400, y: 580 }
        ]
    },
    {   // 第 2 关: 石头增多，出现了更远的金子
        targetScore: 3150,
        items: [
            { type: 'GOLD_HUGE', x: 300, y: 700 },
            { type: 'GOLD_HUGE', x: 1300, y: 650 },
            { type: 'GOLD_LARGE', x: 800, y: 750 },
            { type: 'GOLD_MEDIUM', x: 500, y: 500 },
            { type: 'GOLD_MEDIUM', x: 1100, y: 500 },
            { type: 'GOLD_SMALL', x: 800, y: 450 },
            { type: 'STONE_HUGE', x: 750, y: 600 },
            { type: 'STONE_HUGE', x: 950, y: 600 },
            { type: 'STONE_SMALL', x: 450, y: 650 },
            { type: 'STONE_SMALL', x: 1150, y: 600 },
            { type: 'STONE_SMALL', x: 650, y: 500 },
            { type: 'LUCKY_BAG', x: 400, y: 800 },
            { type: 'LUCKY_BAG', x: 1200, y: 800 }
        ]
    },
    {   // 第 3 关: 引入钻石与炸药桶
        targetScore: 5450,
        items: [
            { type: 'DIAMOND', x: 400, y: 750 },
            { type: 'DIAMOND', x: 1200, y: 750 },
            { type: 'BARREL', x: 450, y: 650 },
            { type: 'BARREL', x: 1150, y: 650 },
            { type: 'GOLD_HUGE', x: 800, y: 750 },
            { type: 'STONE_HUGE', x: 700, y: 650 },
            { type: 'STONE_HUGE', x: 900, y: 650 },
            { type: 'GOLD_LARGE', x: 600, y: 550 },
            { type: 'GOLD_LARGE', x: 1000, y: 550 },
            { type: 'GOLD_MEDIUM', x: 800, y: 500 },
            { type: 'LUCKY_BAG', x: 800, y: 350 },
            { type: 'LUCKY_BAG', x: 200, y: 450 },
            { type: 'LUCKY_BAG', x: 1400, y: 450 },
            { type: 'STONE_SMALL', x: 300, y: 500 },
            { type: 'STONE_SMALL', x: 1300, y: 500 }
        ]
    },
    {   // 第 4 关: 骨头(用小石头代替)阵，狭缝抓钻
        targetScore: 7750,
        items: [
            { type: 'DIAMOND', x: 800, y: 800 },
            { type: 'DIAMOND', x: 700, y: 800 },
            { type: 'DIAMOND', x: 900, y: 800 },
            { type: 'STONE_SMALL', x: 750, y: 650 },
            { type: 'STONE_SMALL', x: 850, y: 650 },
            { type: 'STONE_SMALL', x: 700, y: 550 },
            { type: 'STONE_SMALL', x: 900, y: 550 },
            { type: 'STONE_HUGE', x: 800, y: 600 },
            { type: 'GOLD_HUGE', x: 250, y: 700 },
            { type: 'GOLD_HUGE', x: 1350, y: 700 },
            { type: 'GOLD_LARGE', x: 450, y: 600 },
            { type: 'GOLD_LARGE', x: 1150, y: 600 },
            { type: 'BARREL', x: 350, y: 650 },
            { type: 'BARREL', x: 1250, y: 650 },
            { type: 'LUCKY_BAG', x: 100, y: 400 },
            { type: 'LUCKY_BAG', x: 1500, y: 400 }
        ]
    },
    {   // 第 5 关: 巨型金块与很多炸药，加入了移动的小动物
        targetScore: 10050,
        items: [
            { type: 'GOLD_HUGE', x: 800, y: 800 },
            { type: 'GOLD_HUGE', x: 600, y: 750 },
            { type: 'GOLD_HUGE', x: 1000, y: 750 },
            { type: 'GOLD_HUGE', x: 400, y: 700 },
            { type: 'GOLD_HUGE', x: 1200, y: 700 },
            { type: 'BARREL', x: 700, y: 680 },
            { type: 'BARREL', x: 900, y: 680 },
            { type: 'BARREL', x: 500, y: 620 },
            { type: 'BARREL', x: 1100, y: 620 },
            { type: 'DIAMOND', x: 800, y: 650 },
            { type: 'STONE_HUGE', x: 300, y: 500 },
            { type: 'STONE_HUGE', x: 1300, y: 500 },
            { type: 'MOUSE', x: 200, y: 400 },
            { type: 'MOUSE_DIAMOND', x: 1400, y: 450 },
            { type: 'BOMBER', x: 800, y: 350 },
            { type: 'GOLD_SMALL', x: 800, y: 400 },
            { type: 'GOLD_SMALL', x: 700, y: 500 },
            { type: 'GOLD_SMALL', x: 900, y: 500 }
        ]
    },
    {   // 第 6 关: 钻石群与石头海
        targetScore: 12350,
        items: [
            { type: 'DIAMOND', x: 200, y: 800 },
            { type: 'DIAMOND', x: 300, y: 800 },
            { type: 'DIAMOND', x: 1300, y: 800 },
            { type: 'DIAMOND', x: 1400, y: 800 },
            { type: 'STONE_HUGE', x: 250, y: 650 },
            { type: 'STONE_HUGE', x: 1350, y: 650 },
            { type: 'STONE_HUGE', x: 600, y: 550 },
            { type: 'STONE_HUGE', x: 1000, y: 550 },
            { type: 'STONE_HUGE', x: 800, y: 600 },
            { type: 'GOLD_LARGE', x: 800, y: 750 },
            { type: 'GOLD_LARGE', x: 600, y: 750 },
            { type: 'GOLD_LARGE', x: 1000, y: 750 },
            { type: 'LUCKY_BAG', x: 400, y: 500 },
            { type: 'LUCKY_BAG', x: 1200, y: 500 },
            { type: 'BARREL', x: 800, y: 500 }
        ]
    },
    {   // 第 7 关: 金字塔型分布
        targetScore: 14650,
        items: [
            { type: 'DIAMOND', x: 800, y: 820 },
            { type: 'GOLD_HUGE', x: 700, y: 750 },
            { type: 'GOLD_HUGE', x: 900, y: 750 },
            { type: 'GOLD_LARGE', x: 600, y: 680 },
            { type: 'GOLD_LARGE', x: 800, y: 680 },
            { type: 'GOLD_LARGE', x: 1000, y: 680 },
            { type: 'STONE_HUGE', x: 500, y: 600 },
            { type: 'STONE_HUGE', x: 1100, y: 600 },
            { type: 'STONE_SMALL', x: 400, y: 500 },
            { type: 'STONE_SMALL', x: 1200, y: 500 },
            { type: 'BARREL', x: 700, y: 600 },
            { type: 'BARREL', x: 900, y: 600 },
            { type: 'LUCKY_BAG', x: 800, y: 500 },
            { type: 'LUCKY_BAG', x: 300, y: 400 },
            { type: 'LUCKY_BAG', x: 1300, y: 400 }
        ]
    },
    {   // 第 8 关: 星星点点的碎片
        targetScore: 16950,
        items: [
            { type: 'DIAMOND', x: 100, y: 700 },
            { type: 'DIAMOND', x: 300, y: 800 },
            { type: 'DIAMOND', x: 1500, y: 700 },
            { type: 'DIAMOND', x: 1300, y: 800 },
            { type: 'GOLD_SMALL', x: 200, y: 500 },
            { type: 'GOLD_SMALL', x: 400, y: 600 },
            { type: 'GOLD_SMALL', x: 1400, y: 500 },
            { type: 'GOLD_SMALL', x: 1200, y: 600 },
            { type: 'GOLD_SMALL', x: 700, y: 500 },
            { type: 'GOLD_SMALL', x: 900, y: 500 },
            { type: 'STONE_HUGE', x: 800, y: 650 },
            { type: 'STONE_HUGE', x: 800, y: 800 },
            { type: 'GOLD_HUGE', x: 600, y: 800 },
            { type: 'GOLD_HUGE', x: 1000, y: 800 },
            { type: 'BARREL', x: 250, y: 750 },
            { type: 'BARREL', x: 1350, y: 750 },
            { type: 'LUCKY_BAG', x: 800, y: 400 }
        ]
    },
    {   // 第 9 关: 黄金盆地
        targetScore: 19250,
        items: [
            { type: 'GOLD_HUGE', x: 400, y: 800 },
            { type: 'GOLD_HUGE', x: 600, y: 800 },
            { type: 'GOLD_HUGE', x: 800, y: 800 },
            { type: 'GOLD_HUGE', x: 1000, y: 800 },
            { type: 'GOLD_HUGE', x: 1200, y: 800 },
            { type: 'DIAMOND', x: 800, y: 700 },
            { type: 'BARREL', x: 500, y: 750 },
            { type: 'BARREL', x: 1100, y: 750 },
            { type: 'STONE_HUGE', x: 500, y: 650 },
            { type: 'STONE_HUGE', x: 1100, y: 650 },
            { type: 'STONE_SMALL', x: 400, y: 550 },
            { type: 'STONE_SMALL', x: 1200, y: 550 },
            { type: 'GOLD_MEDIUM', x: 700, y: 600 },
            { type: 'GOLD_MEDIUM', x: 900, y: 600 },
            { type: 'LUCKY_BAG', x: 200, y: 600 },
            { type: 'LUCKY_BAG', x: 1400, y: 600 },
            { type: 'LUCKY_BAG', x: 800, y: 500 }
        ]
    },
    {   // 第 10 关: 钻石风暴与动物乱窜，最难的一关
        targetScore: 21550,
        items: [
            { type: 'DIAMOND', x: 200, y: 850 },
            { type: 'DIAMOND', x: 500, y: 850 },
            { type: 'DIAMOND', x: 800, y: 850 },
            { type: 'DIAMOND', x: 1100, y: 850 },
            { type: 'DIAMOND', x: 1400, y: 850 },
            { type: 'BARREL', x: 350, y: 800 },
            { type: 'BARREL', x: 650, y: 800 },
            { type: 'BARREL', x: 950, y: 800 },
            { type: 'BARREL', x: 1250, y: 800 },
            { type: 'BOMBER', x: 800, y: 650 },
            { type: 'BOMBER', x: 400, y: 600 },
            { type: 'BOMBER', x: 1200, y: 600 },
            { type: 'MOUSE_DIAMOND', x: 800, y: 550 },
            { type: 'MOUSE', x: 300, y: 500 },
            { type: 'MOUSE', x: 1300, y: 500 },
            { type: 'STONE_HUGE', x: 350, y: 700 },
            { type: 'STONE_HUGE', x: 650, y: 700 },
            { type: 'STONE_HUGE', x: 950, y: 700 },
            { type: 'STONE_HUGE', x: 1250, y: 700 },
            { type: 'GOLD_LARGE', x: 200, y: 600 },
            { type: 'GOLD_LARGE', x: 800, y: 600 },
            { type: 'GOLD_LARGE', x: 1400, y: 600 },
            { type: 'LUCKY_BAG', x: 500, y: 500 },
            { type: 'LUCKY_BAG', x: 1100, y: 500 }
        ]
    },
    {   // 第 11 关: 遮天蔽日的石头与猪突猛进（纯静态替代）的炸药结构
        targetScore: 23850,
        items: [
            { type: 'GOLD_HUGE', x: 800, y: 800 },
            { type: 'DIAMOND', x: 900, y: 800 },
            { type: 'STONE_HUGE', x: 750, y: 650 },
            { type: 'STONE_HUGE', x: 850, y: 650 },
            { type: 'STONE_SMALL', x: 700, y: 550 },
            { type: 'STONE_SMALL', x: 900, y: 550 },
            { type: 'BARREL', x: 800, y: 500 },
            { type: 'LUCKY_BAG', x: 600, y: 450 },
            { type: 'LUCKY_BAG', x: 1000, y: 450 },
            { type: 'GOLD_LARGE', x: 300, y: 700 },
            { type: 'GOLD_LARGE', x: 1300, y: 700 },
            { type: 'STONE_HUGE', x: 300, y: 550 },
            { type: 'STONE_HUGE', x: 1300, y: 550 },
            { type: 'DIAMOND', x: 200, y: 800 },
            { type: 'DIAMOND', x: 1400, y: 800 }
        ]
    },
    {   // 第 12 关: 丰富的金库
        targetScore: 26150,
        items: [
            { type: 'GOLD_HUGE', x: 400, y: 750 },
            { type: 'GOLD_HUGE', x: 800, y: 750 },
            { type: 'GOLD_HUGE', x: 1200, y: 750 },
            { type: 'GOLD_LARGE', x: 250, y: 600 },
            { type: 'GOLD_LARGE', x: 550, y: 600 },
            { type: 'GOLD_LARGE', x: 1050, y: 600 },
            { type: 'GOLD_LARGE', x: 1350, y: 600 },
            { type: 'GOLD_MEDIUM', x: 700, y: 500 },
            { type: 'GOLD_MEDIUM', x: 900, y: 500 },
            { type: 'STONE_SMALL', x: 800, y: 400 },
            { type: 'LUCKY_BAG', x: 150, y: 450 },
            { type: 'LUCKY_BAG', x: 1450, y: 450 }
        ]
    },
    {   // 第 13 关: 密集骨矿（用石头和炸药代替）
        targetScore: 28450,
        items: [
            { type: 'DIAMOND', x: 800, y: 850 },
            { type: 'STONE_SMALL', x: 700, y: 750 },
            { type: 'STONE_SMALL', x: 900, y: 750 },
            { type: 'STONE_SMALL', x: 600, y: 650 },
            { type: 'STONE_SMALL', x: 1000, y: 650 },
            { type: 'STONE_SMALL', x: 500, y: 550 },
            { type: 'STONE_SMALL', x: 1100, y: 550 },
            { type: 'BARREL', x: 800, y: 650 },
            { type: 'GOLD_HUGE', x: 200, y: 800 },
            { type: 'GOLD_HUGE', x: 1400, y: 800 },
            { type: 'STONE_HUGE', x: 250, y: 650 },
            { type: 'STONE_HUGE', x: 1350, y: 650 },
            { type: 'LUCKY_BAG', x: 400, y: 400 },
            { type: 'LUCKY_BAG', x: 1200, y: 400 }
        ]
    },
    {   // 第 14 关: 大量钻石与福袋
        targetScore: 30750,
        items: [
            { type: 'DIAMOND', x: 300, y: 800 },
            { type: 'DIAMOND', x: 500, y: 800 },
            { type: 'DIAMOND', x: 1100, y: 800 },
            { type: 'DIAMOND', x: 1300, y: 800 },
            { type: 'LUCKY_BAG', x: 350, y: 600 },
            { type: 'LUCKY_BAG', x: 450, y: 600 },
            { type: 'LUCKY_BAG', x: 1150, y: 600 },
            { type: 'LUCKY_BAG', x: 1250, y: 600 },
            { type: 'STONE_HUGE', x: 800, y: 700 },
            { type: 'STONE_HUGE', x: 800, y: 500 },
            { type: 'LUCKY_BAG', x: 700, y: 600 },
            { type: 'LUCKY_BAG', x: 900, y: 600 },
            { type: 'BARREL', x: 400, y: 700 },
            { type: 'BARREL', x: 1200, y: 700 }
        ]
    },
    {   // 第 15 关: 终极组合
        targetScore: 33050,
        items: [
            { type: 'GOLD_HUGE', x: 800, y: 850 },
            { type: 'GOLD_HUGE', x: 400, y: 850 },
            { type: 'GOLD_HUGE', x: 1200, y: 850 },
            { type: 'BARREL', x: 600, y: 800 },
            { type: 'BARREL', x: 1000, y: 800 },
            { type: 'DIAMOND', x: 600, y: 850 },
            { type: 'DIAMOND', x: 1000, y: 850 },
            { type: 'STONE_HUGE', x: 400, y: 700 },
            { type: 'STONE_HUGE', x: 800, y: 700 },
            { type: 'STONE_HUGE', x: 1200, y: 700 },
            { type: 'GOLD_MEDIUM', x: 200, y: 600 },
            { type: 'GOLD_MEDIUM', x: 1400, y: 600 },
            { type: 'LUCKY_BAG', x: 600, y: 500 },
            { type: 'LUCKY_BAG', x: 1000, y: 500 }
        ]
    }
];

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

function handleExplosion(x, y, radius = 150) {
    explosionEffects.push({ x, y, radius, life: 30 });
    const itemsToRemove = [];
    for (let i = gameItems.length - 1; i >= 0; i--) {
        const item = gameItems[i];
        if (item.isDestroyed) continue;
        const dist = Math.sqrt((item.x - x)**2 + (item.y - y)**2);
        if (dist < radius && dist >= 0) {
            item.isDestroyed = true;
            if (item.isBarrel) {
                handleExplosion(item.x, item.y, radius);
                itemsToRemove.push(i);
            } else if (item.label !== '?') {
                itemsToRemove.push(i);
            }
        }
    }
    itemsToRemove.sort((a, b) => b - a);
    for (let i of itemsToRemove) {
        gameItems.splice(i, 1);
    }
}

function handleLuckyBag() {
    const boost = cloverEffect ? 1.5 : 1.0;
    const rand = Math.random();
    if (rand < 0.4) {
        const money = Math.floor((Math.random() * 701 + 100) * boost);
        createScorePopup(myStartX, HOOK_Y, money); 
        myContribution += money;
        totalScore += money;
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

function startLevel(lvl, hostScore, guestScore, bmb, items, globalTotal) {
    console.log('【游戏指令】开始关卡:', lvl);
    document.getElementById('overlay').style.display = 'none';
    document.getElementById('shop-area').style.display = 'none';
    currentLevel = lvl;
    bombs = bmb;
    myContribution = isHost ? hostScore : guestScore; 
    peerContribution = isHost ? guestScore : hostScore; 
    totalScore = globalTotal; 
    hasPowerUp = false; 
    
    // 应用关卡设计中的目标分数或计算目标分数
    if (LEVEL_CONFIGS[lvl - 1]) {
        targetScore = LEVEL_CONFIGS[lvl - 1].targetScore;
    } else {
        // 第一关 650，第二关 3150，之后每关增加 2300，或者简单的递增
        targetScore = 3150 + (lvl - 2) * 2300; 
    }
    
    gameItems = items;
    scorePopups = [];
    explosionEffects = [];
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
    explosionEffects = [];
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
    for (let i = explosionEffects.length - 1; i >= 0; i--) {
        explosionEffects[i].life--;
        if (explosionEffects[i].life <= 0) explosionEffects.splice(i, 1);
    }

    // 独立更新带有移动属性的物品（老鼠等）
    gameItems.forEach(item => {
        if (!item.isCaught && item.speed) {
            item.x += item.speed * (item.dir || 1);
            if (item.x < item.r || item.x > LOGIC_WIDTH - item.r) {
                item.dir = (item.dir || 1) * -1;
            }
        }
    });

    if (myHook.state === 'SWING') {
        myHook.angle += SWING_SPEED * myHook.dir;
        if (Math.abs(myHook.angle) > 1.3) myHook.dir *= -1;
    } else if (myHook.state === 'FIRE') {
        myHook.length += FIRE_SPEED;
        const hX = myStartX + myHook.length * Math.sin(myHook.angle);
        const hY = HOOK_Y + myHook.length * Math.cos(myHook.angle);
        for (let item of gameItems) {
            if (!item.isCaught && Math.sqrt((hX - item.x)**2 + (hY - item.y)**2) < item.r) {
                if (item.isBarrel) {
                    handleExplosion(hX, hY, 150);
                    if (conn) conn.send({ type: 'BARREL_EXPLODE', itemId: item.id, x: hX, y: hY });
                    gameItems = gameItems.filter(it => it.id !== item.id);
                } else {
                    item.isCaught = true; myHook.caughtItem = item; myHook.state = 'RETRACT';
                }
                break;
            }
        }
        if (myHook.length > 1100 || hX < 0 || hX > LOGIC_WIDTH || hY > LOGIC_HEIGHT) myHook.state = 'RETRACT';
    } else if (myHook.state === 'RETRACT') {
        let baseSpeed = hasPowerUp ? (RETRACT_SPEED_BASE * 2.5) : RETRACT_SPEED_BASE;
        // 原版中不同重量对应不同的回收速度，基础为 RETRACT_SPEED_BASE
        // 这里使用公式将重量转化为速度的影响。重量为 0 会保持原速，重量很大则速度变慢。
        let s = myHook.caughtItem ? baseSpeed / (1 + myHook.caughtItem.weight * 0.25) : baseSpeed;
        // 如果是老鼠，且没带钻石，速度和空钩一样快。但上面的重量都是0，所以会自动按照原速返回
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
                    if (diamondBoostEffect && myHook.caughtItem.label.includes('钻')) score = 900; 
                    createScorePopup(myStartX, HOOK_Y, score);
                    myContribution += score;
                    totalScore += score;
                }
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
        if (item.type === 'DIAMOND') {
            ctx.beginPath();
            ctx.moveTo(item.x, item.y - item.r);
            ctx.lineTo(item.x + item.r, item.y);
            ctx.lineTo(item.x, item.y + item.r);
            ctx.lineTo(item.x - item.r, item.y);
            ctx.closePath();
            ctx.fillStyle = item.color; ctx.fill(); ctx.strokeStyle = "#000"; ctx.lineWidth = 2; ctx.stroke();
            
            // 钻石的内切线表现折射
            ctx.beginPath();
            ctx.moveTo(item.x - item.r*0.5, item.y - item.r*0.2);
            ctx.lineTo(item.x + item.r*0.5, item.y - item.r*0.2);
            ctx.lineTo(item.x, item.y + item.r*0.6);
            ctx.closePath();
            ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.stroke();
        } else if (item.label.includes('$')) {
            // 金块，稍微不规则的椭圆，原版是个黄包包的形状
            ctx.beginPath();
            ctx.ellipse(item.x, item.y, item.r, item.r * 0.8, Math.PI / 4, 0, Math.PI * 2);
            ctx.fillStyle = item.color; ctx.fill(); ctx.strokeStyle = "#8B6508"; ctx.lineWidth = 2; ctx.stroke();
        } else if (item.label.includes('石')) {
            // 石头，深灰色多边形
            ctx.beginPath();
            const sides = 6;
            for (let i = 0; i < sides; i++) {
                const angle = (i / sides) * Math.PI * 2;
                const rOffset = item.r * (0.8 + 0.2 * Math.cos(i * 13));
                const px = item.x + rOffset * Math.cos(angle);
                const py = item.y + rOffset * Math.sin(angle);
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.fillStyle = item.color; ctx.fill(); ctx.strokeStyle = "#333"; ctx.lineWidth = 2; ctx.stroke();
        } else {
            // 其他物品（老鼠、炸药桶、福袋）保持圆形或可以加上贴图字
            ctx.beginPath(); ctx.arc(item.x, item.y, item.r, 0, Math.PI*2);
            ctx.fillStyle = item.color; ctx.fill(); ctx.strokeStyle = "#000"; ctx.lineWidth = 2; ctx.stroke();
        }

        if (item.label === '?' || item.label === 'TNT' || item.label === '鼠' || item.label === '钻鼠' || item.label === '炸药鼠') {
            ctx.fillStyle = "black"; ctx.font = "bold 16px Arial"; ctx.textAlign = "center";
            ctx.fillText(item.label, item.x, item.y + 6);
        }
    });

    if(myStartX !== undefined) renderHook(myStartX, HOOK_Y, myHook.angle, myHook.length, "#ffcc00", "我", myContribution);
    if (conn && conn.open && peerStartX !== undefined) renderHook(peerStartX, HOOK_Y, peerHook.angle, peerHook.length, "#ff4444", "队友", peerContribution);
    
    scorePopups.forEach(p => {
        ctx.fillStyle = `rgba(255, 255, 0, ${p.opacity})`; ctx.font = "bold 36px Arial";
        ctx.textAlign = "center"; ctx.fillText(p.score, p.x, p.y);
    });
    
    explosionEffects.forEach(exp => {
        const alpha = (exp.life / 30) * 0.6;
        ctx.fillStyle = `rgba(255, 100, 0, ${alpha})`;
        ctx.beginPath();
        ctx.arc(exp.x, exp.y, exp.radius, 0, Math.PI * 2);
        ctx.fill();
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

function generateItems(levelStr = 1) {
    const items = [];
    
    // 如果存在固定关卡配置，则加载固定位置的矿物
    const config = LEVEL_CONFIGS[levelStr - 1];
    if (config) {
        config.items.forEach(itemData => {
            const typeDef = ITEM_TYPES[itemData.type];
            items.push({
                id: Math.random(),
                x: itemData.x,
                y: itemData.y,
                isCaught: false,
                ...typeDef
            });
        });
        return items;
    }

    // 默认情况或超过内置关卡时：使用随机生成
    for (let i = 0; i < 24; i++) {
        let attempts = 0;
        while (attempts < 50) {
            const rand = Math.random();
            let type = rand > 0.96 ? ITEM_TYPES.BARREL : (rand > 0.93 ? ITEM_TYPES.DIAMOND : (rand > 0.88 ? ITEM_TYPES.LUCKY_BAG : (rand > 0.85 ? ITEM_TYPES.MOUSE_DIAMOND : (rand > 0.80 ? ITEM_TYPES.MOUSE : (rand > 0.77 ? ITEM_TYPES.BOMBER : (rand > 0.65 ? ITEM_TYPES.STONE_HUGE : (rand > 0.4 ? ITEM_TYPES.GOLD_HUGE : (rand > 0.2 ? ITEM_TYPES.GOLD_SMALL : ITEM_TYPES.STONE_SMALL))))))));
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
        shopItems = shuffled.slice(0, 3).map(item => ({ name: item.name, effect: item.effect, icon: item.icon, price: item.getPrice() }));
    }
    showEndOverlay(isWin, finalTotal, shopItems);
    if (conn) conn.send({ type: 'LEVEL_END', isWin: isWin, total: finalTotal, shopItems: shopItems });
}

function showEndOverlay(isWin, finalTotal, shopItems) {
    gameActive = false;
    stoneBookEffect = false; cloverEffect = false; diamondBoostEffect = false;
    const overlay = document.getElementById('overlay');
    overlay.style.display = 'flex';
    const nextBtn = document.getElementById('nextLevelBtn');
    const restartBtn = document.getElementById('restartBtn');
    const shopArea = document.getElementById('shop-area');
    const shopContainer = document.getElementById('shop-items');
    
    nextBtn.style.display = 'none'; restartBtn.style.display = 'none'; shopArea.style.display = 'none';

    if (isWin) {
        document.getElementById('overlayTitle').innerText = "🎉 挑战成功！";
        document.getElementById('overlayStatus').innerText = `当前总钱数: $${totalScore}`; 
        
        if (shopItems && shopItems.length > 0) {
            shopArea.style.display = 'block';
            shopContainer.innerHTML = '';
            
            let existingTip = document.getElementById('guestWaitTip');
            if (existingTip) existingTip.remove();
            if (!isHost) {
                const guestTip = document.createElement('div');
                guestTip.id = 'guestWaitTip';
                guestTip.style.color = '#ffcc00';
                guestTip.style.fontSize = '18px';
                guestTip.style.marginTop = '15px';
                guestTip.innerText = "等待主机购买并进入下一关...";
                shopArea.appendChild(guestTip);
            }

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
                        updateUI(); 
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
                const nextLevel = currentLevel + 1;
                const items = generateItems(nextLevel);
                const hostScore = isHost ? myContribution : peerContribution;
                const guestScore = isHost ? peerContribution : myContribution;
                if (conn) conn.send({ type: 'START_GAME', level: nextLevel, hostContrib: hostScore, guestContrib: guestScore, bombs: bombs, items: items, globalTotal: totalScore });
                startLevel(nextLevel, hostScore, guestScore, bombs, items, totalScore);
            };
        }
    } else {
        document.getElementById('overlayTitle').innerText = "❌ 分数未达标";
        document.getElementById('overlayStatus').innerText = `总分: ${totalScore} / 目标: ${targetScore}`;
        if (isHost) {
            restartBtn.style.display = 'inline-block'; restartBtn.innerText = "从头开始";
            restartBtn.onclick = () => {
                const items = generateItems(1);
                if (conn) conn.send({ type: 'START_GAME', level: 1, hostContrib: 0, guestContrib: 0, bombs: 3, items: items, globalTotal: 0 });
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
    if (effect === 'DIAMOND_BOOST') diamondBoostEffect = true;
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
            const items = generateItems(1);
            if (conn) conn.send({ type: 'START_GAME', level: 1, hostContrib: 0, guestContrib: 0, bombs: 3, items: items, globalTotal: 0 });
            startLevel(1, 0, 0, 3, items, 0);
        };
    } else {
        nextBtn.style.display = 'none';
    }
}

function resetHooks() { myHook = { angle: 0, dir: 1, length: 80, state: 'SWING', caughtItem: null }; peerHook = { angle: 0, length: 80 }; }

function updateUI() {
    document.getElementById('totalScoreDisplay').innerText = `$${totalScore}`;
    document.getElementById('targetScoreDisplay').innerText = `$${targetScore}`;
    document.getElementById('levelDisplay').innerText = `第 ${currentLevel} 关`;
    document.getElementById('bombDisplay').innerText = bombs;
    
    const overlay = document.getElementById('overlay');
    const overlayStatus = document.getElementById('overlayStatus');
    if (overlay.style.display === 'flex' && !gameActive) {
        if (totalScore >= targetScore) {
            overlayStatus.innerText = `当前总钱数: $${totalScore}`;
        } else {
            overlayStatus.innerText = `总钱: $${totalScore} / 目标: $${targetScore}`;
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