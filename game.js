const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Game Constants
const GRAVITY = 0.4;
const JUMP_FORCE = -7;
const GAME_SPEED_INITIAL = 4;
const SPAWN_RATE_OBSTACLE = 150; // Frames
const SPAWN_RATE_TOKEN = 100; // Frames

// Game State
let gameSpeed = GAME_SPEED_INITIAL;
let score = 0;
let multiplier = 1;
let highScore = localStorage.getItem('dolphinDashHighScore') || 0;
let frameCount = 0;
let isGameOver = false;
let isPlaying = false;
let isPaused = false;
let debugMode = false;
let animationId;

// Assets
const dolphinImg = new Image();
dolphinImg.src = 'assets/dolphin.svg';

const boatSources = [
    'assets/boat.svg',
    'assets/boat_sail_blue.svg',
    'assets/boat_sail_red.svg',
    'assets/boat_power_white.svg',
    'assets/boat_power_yellow.svg'
];
const boatImages = boatSources.map(src => {
    const img = new Image();
    img.src = src;
    return img;
});

const tokenImg = new Image();
tokenImg.src = 'assets/token.svg';

const bgImg = new Image();
bgImg.src = 'assets/background.svg';

// Entities
let dolphin;
let obstacles = [];
let tokens = [];
let particles = [];
let background;
let soundController;

// Inputs
const startBtn = document.getElementById('start-btn');
const restartBtn = document.getElementById('restart-btn');
const startScreen = document.getElementById('start-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const scoreDisplay = document.getElementById('score-display');
const scoreSpan = document.getElementById('score');
const finalScoreSpan = document.getElementById('final-score');
const multiplierDisplay = document.getElementById('multiplier-display');
const multiplierSpan = document.getElementById('multiplier');
const highScoreDisplay = document.getElementById('high-score-display');
const highScoreSpan = document.getElementById('high-score');
// Resize Canvas
function resize() {
    canvas.width = 800;
    canvas.height = 450;
}
resize();

class SoundController {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.enabled = true;
    }

    playTone(freq, type, duration) {
        if (!this.enabled) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    }

    jump() { this.playTone(400, 'sine', 0.1); }
    collect() { this.playTone(800, 'sine', 0.1); this.playTone(1200, 'sine', 0.1); }
    gameOver() { this.playTone(150, 'sawtooth', 0.5); }
}

class Background {
    constructor() {
        this.x = 0;
        this.width = 800; // Assuming SVG is designed for this width or scalable
        this.speed = 1; // Parallax factor
    }

    update() {
        this.x -= gameSpeed * 0.5; // Move slower than foreground
        if (this.x <= -this.width) {
            this.x = 0;
        }
    }

    draw() {
        // Draw two images to create seamless loop
        ctx.drawImage(bgImg, this.x, 0, this.width, canvas.height);
        ctx.drawImage(bgImg, this.x + this.width, 0, this.width, canvas.height);
        // If screen is wider than 2 images (unlikely here fixed 800), might need more
    }
}

class Particle {
    constructor(x, y, color) {
        this.x = x;
        this.y = y;
        this.size = Math.random() * 5 + 2;
        this.speedX = Math.random() * 2 - 1;
        this.speedY = Math.random() * 2 - 1;
        this.color = color;
        this.life = 1.0;
    }

    update() {
        this.x += this.speedX - gameSpeed; // Move with world
        this.y += this.speedY;
        this.life -= 0.02;
    }

    draw() {
        ctx.globalAlpha = this.life;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1.0;
    }
}

class Dolphin {
    constructor() {
        this.width = 80;
        this.height = 40;
        this.x = 100;
        this.y = canvas.height / 2;
        this.velocity = 0;
    }

    update() {
        this.velocity += GRAVITY;
        this.y += this.velocity;

        // Floor Collision
        if (this.y + this.height > canvas.height) {
            this.y = canvas.height - this.height;
            this.velocity = 0;
        }

        // Ceiling Collision
        if (this.y < 0) {
            this.y = 0;
            this.velocity = 0;
        }
    }

    draw() {
        ctx.drawImage(dolphinImg, this.x, this.y, this.width, this.height);
        if (debugMode) {
            const hb = this.getHitbox();
            ctx.strokeStyle = 'red';
            ctx.lineWidth = 2;
            ctx.strokeRect(hb.x, hb.y, hb.width, hb.height);
        }
    }

    getHitbox() {
        return {
            x: this.x + 10,
            y: this.y + 10,
            width: this.width - 20,
            height: this.height - 20
        };
    }

    jump() {
        this.velocity = JUMP_FORCE;
        soundController.jump();
        // Create bubbles
        for (let i = 0; i < 5; i++) {
            particles.push(new Particle(this.x + 20, this.y + 30, 'rgba(255, 255, 255, 0.8)'));
        }
    }
}

class Obstacle {
    constructor() {
        this.width = 100;
        this.height = 60;
        this.x = canvas.width;
        this.y = Math.random() * (canvas.height - this.height);
        this.markedForDeletion = false;
        this.image = boatImages[Math.floor(Math.random() * boatImages.length)];
    }

    update() {
        this.x -= gameSpeed;
        if (this.x + this.width < 0) this.markedForDeletion = true;
    }

    draw() {
        ctx.drawImage(this.image, this.x, this.y, this.width, this.height);
        if (debugMode) {
            const hb = this.getHitbox();
            ctx.strokeStyle = 'red';
            ctx.lineWidth = 2;
            ctx.strokeRect(hb.x, hb.y, hb.width, hb.height);
        }
    }

    getHitbox() {
        // Shrink significantly: 70% width, 50% height, offset to bottom-center
        const hbWidth = this.width * 0.7;
        const hbHeight = this.height * 0.5;
        return {
            x: this.x + (this.width - hbWidth) / 2,
            y: this.y + (this.height - hbHeight), // Align to bottom
            width: hbWidth,
            height: hbHeight
        };
    }
}

class Token {
    constructor() {
        this.size = 40;
        this.x = canvas.width;
        this.y = Math.random() * (canvas.height - this.size * 2) + this.size;
        this.markedForDeletion = false;
        this.oscillation = Math.random() * Math.PI * 2;
    }

    update() {
        this.x -= gameSpeed;
        this.oscillation += 0.1;
        this.y += Math.sin(this.oscillation) * 0.5; // Bobbing effect

        if (this.x + this.size < 0) this.markedForDeletion = true;
    }

    draw() {
        ctx.drawImage(tokenImg, this.x, this.y, this.size, this.size);
        if (debugMode) {
            const hb = this.getHitbox();
            ctx.strokeStyle = 'red';
            ctx.lineWidth = 2;
            ctx.strokeRect(hb.x, hb.y, hb.width, hb.height);
        }
    }

    getHitbox() {
        const padding = 5;
        return {
            x: this.x + padding,
            y: this.y + padding,
            width: this.size - padding * 2,
            height: this.size - padding * 2
        };
    }
}

function init() {
    dolphin = new Dolphin();
    obstacles = [];
    tokens = [];
    particles = [];
    background = new Background();
    soundController = new SoundController();
    score = 0;
    multiplier = 1;
    gameSpeed = GAME_SPEED_INITIAL;
    frameCount = 0;
    isGameOver = false;
    isPaused = false;
    scoreSpan.innerText = score;
    multiplierSpan.innerText = multiplier;
    highScoreSpan.innerText = highScore;
}

function handleInput(e) {
    if (e.code === 'KeyD' && e.type === 'keydown') {
        debugMode = !debugMode;
        return;
    }
    if (e.code === 'KeyP' || e.code === 'Escape') {
        togglePause();
        return;
    }
    if ((e.code === 'Space' || e.type === 'click') && isPlaying && !isPaused) {
        dolphin.jump();
    }
}

function togglePause() {
    if (!isPlaying || isGameOver) return;
    isPaused = !isPaused;
    if (!isPaused) {
        animate();
    } else {
        // Draw Pause Screen
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'white';
        ctx.font = '40px Outfit';
        ctx.textAlign = 'center';
        ctx.fillText('PAUSED', canvas.width / 2, canvas.height / 2);
    }
}

function checkCollisions() {
    const dolphinBox = dolphin.getHitbox();

    // Obstacles (Simple AABB)
    obstacles.forEach(obstacle => {
        const obsBox = obstacle.getHitbox();

        if (
            dolphinBox.x < obsBox.x + obsBox.width &&
            dolphinBox.x + dolphinBox.width > obsBox.x &&
            dolphinBox.y < obsBox.y + obsBox.height &&
            dolphinBox.y + dolphinBox.height > obsBox.y
        ) {
            gameOver();
        }
    });

    // Tokens
    tokens.forEach((token, index) => {
        const tokenBox = token.getHitbox();

        if (
            dolphinBox.x < tokenBox.x + tokenBox.width &&
            dolphinBox.x + dolphinBox.width > tokenBox.x &&
            dolphinBox.y < tokenBox.y + tokenBox.height &&
            dolphinBox.y + dolphinBox.height > tokenBox.y
        ) {
            tokens.splice(index, 1);
            multiplier++;
            score += 10 * multiplier;
            scoreSpan.innerText = score;
            multiplierSpan.innerText = multiplier;
            soundController.collect();
            // Sparkles
            for (let i = 0; i < 8; i++) {
                particles.push(new Particle(token.x + token.size / 2, token.y + token.size / 2, '#ffd700'));
            }
        }
    });
}

function gameOver() {
    isGameOver = true;
    isPlaying = false;
    soundController.gameOver();

    if (score > highScore) {
        highScore = score;
        localStorage.setItem('dolphinDashHighScore', highScore);
        highScoreSpan.innerText = highScore;
    }

    finalScoreSpan.innerText = score;
    gameOverScreen.classList.remove('hidden');
    gameOverScreen.classList.add('active');
    scoreDisplay.classList.add('hidden');
    multiplierDisplay.classList.add('hidden');
    highScoreDisplay.classList.add('hidden');
    cancelAnimationFrame(animationId);
}

function checkSpawnCollision(token) {
    const tokenBox = token.getHitbox();
    const buffer = 20; // Buffer distance
    
    for (const obstacle of obstacles) {
        const obsBox = obstacle.getHitbox();
        
        if (
            tokenBox.x < obsBox.x + obsBox.width + buffer &&
            tokenBox.x + tokenBox.width + buffer > obsBox.x &&
            tokenBox.y < obsBox.y + obsBox.height + buffer &&
            tokenBox.y + tokenBox.height + buffer > obsBox.y
        ) {
            return true;
        }
    }
    return false;
}

function animate() {
    if (!isPlaying || isPaused) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw Background
    background.update();
    background.draw();

    // Update & Draw Dolphin
    dolphin.update();
    dolphin.draw();

    // Handle Obstacles
    // Dynamic spawn rate: Spawn faster as speed increases
    // Base rate 150, decreases as gameSpeed increases
    const currentSpawnRate = Math.max(60, Math.floor(SPAWN_RATE_OBSTACLE - (gameSpeed * 10)));

    if (frameCount % currentSpawnRate === 0) {
        obstacles.push(new Obstacle());
    }
    obstacles.forEach((obstacle, index) => {
        obstacle.update();
        obstacle.draw();
        if (obstacle.markedForDeletion) obstacles.splice(index, 1);
    });

    // Handle Tokens
    if (frameCount % SPAWN_RATE_TOKEN === 0) {
        let newToken = new Token();
        let safe = false;
        // Try up to 10 times to find a safe spawn location
        for (let i = 0; i < 10; i++) {
            if (!checkSpawnCollision(newToken)) {
                safe = true;
                break;
            }
            newToken.y = Math.random() * (canvas.height - newToken.size * 2) + newToken.size;
        }
        if (safe) {
            tokens.push(newToken);
        }
    }
    tokens.forEach((token, index) => {
        token.update();
        token.draw();
        if (token.markedForDeletion) {
            tokens.splice(index, 1);
            // Reset multiplier if token is missed
            if (token.x + token.size < 0) {
                multiplier = 1;
                multiplierSpan.innerText = multiplier;
            }
        }
    });

    // Handle Particles
    particles.forEach((particle, index) => {
        particle.update();
        particle.draw();
        if (particle.life <= 0) particles.splice(index, 1);
    });

    checkCollisions();

    frameCount++;
    gameSpeed += 0.001; // Slowly increase speed

    animationId = requestAnimationFrame(animate);
}

function startGame() {
    init();
    isPlaying = true;
    startScreen.classList.remove('active');
    startScreen.classList.add('hidden');
    gameOverScreen.classList.remove('active');
    gameOverScreen.classList.add('hidden');
    scoreDisplay.classList.remove('hidden');
    multiplierDisplay.classList.remove('hidden');
    highScoreDisplay.classList.remove('hidden');
    animate();
}

// Event Listeners
window.addEventListener('keydown', handleInput);
canvas.addEventListener('click', handleInput);
startBtn.addEventListener('click', startGame);
restartBtn.addEventListener('click', startGame);
