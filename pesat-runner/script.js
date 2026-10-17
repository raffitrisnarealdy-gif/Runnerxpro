import * as THREE from 'three';

const canvas = document.getElementById('gameCanvas');
const scoreValue = document.getElementById('scoreValue');
const coinValue = document.getElementById('coinValue');
const speedValue = document.getElementById('speedValue');
const menuOverlay = document.getElementById('menuOverlay');
const howToPlayOverlay = document.getElementById('howToPlayOverlay');
const gameOverOverlay = document.getElementById('gameOverOverlay');
const hud = document.getElementById('hud');
const menuHighScore = document.getElementById('menuHighScore');
const finalScoreValue = document.getElementById('finalScoreValue');
const finalCoinsValue = document.getElementById('finalCoinsValue');
const finalHighScoreValue = document.getElementById('finalHighScoreValue');
const playButton = document.getElementById('playButton');
const playAgainButton = document.getElementById('playAgainButton');
const mainMenuButton = document.getElementById('mainMenuButton');
const howToPlayButton = document.getElementById('howToPlayButton');
const closeInstructionsButton = document.getElementById('closeInstructionsButton');
const touchButtons = document.querySelectorAll('.touch-button');
const speedLines = document.getElementById('speedLines');

const lanePositions = [-3, 0, 3];
const segmentLength = 24;
const activeObstacles = [];
const activeCoins = [];
const roadSegments = [];
const environmentSegments = [];
const floatingTexts = [];

let scene;
let camera;
let renderer;
let player;
let clock;
let audioContext;
let musicTimer;
let musicStep = 0;
let parryTimer = 0;

let currentLane = 1;
let targetLane = 1;
let jumpVelocity = 0;
let isJumping = false;
let score = 0;
let coinCount = 0;
let gameRunning = false;
let gameOver = false;
let spawnTimer = 1.4;
let elapsedTime = 0;
let speedMultiplier = 1;
let baseSpeed = 14;
let lastDirection = 0;
const flingGravity = 12;
let parryCooldown = 0;

const storageKey = 'pesatRunnerHighScore';
let highScore = 0;

try {
  highScore = Number(window.localStorage.getItem(storageKey)) || 0;
} catch (error) {
  highScore = 0;
}

function formatNumber(value, digits = 4) {
  return String(Math.floor(value)).padStart(digits, '0');
}

function updateHUD() {
  scoreValue.textContent = formatNumber(score, 4);
  coinValue.textContent = String(coinCount).padStart(2, '0');
  speedValue.textContent = `${speedMultiplier.toFixed(1)}x`;
}

function updateHighScoreDisplays() {
  menuHighScore.textContent = formatNumber(highScore, 4);
  finalHighScoreValue.textContent = formatNumber(highScore, 4);
}

function initAudio() {
  if (!audioContext) {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (AudioCtor) {
      audioContext = new AudioCtor();
    }
  }

  if (audioContext && audioContext.state === 'suspended') {
    audioContext.resume();
  }
}

function playTone(frequency, duration, type = 'sine', volume = 0.04) {
  if (!audioContext) {
    return;
  }

  const now = audioContext.currentTime;
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, now);

  gainNode.gain.setValueAtTime(volume, now);
  gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + duration);
}

function playJumpSound() {
  playTone(420, 0.12, 'square', 0.04);
}

function playCoinSound() {
  playTone(880, 0.08, 'triangle', 0.05);
}

function playGameOverSound() {
  playTone(180, 0.2, 'sawtooth', 0.05);
  setTimeout(() => playTone(120, 0.22, 'sawtooth', 0.05), 100);
}

function startMusic() {
  if (!audioContext || musicTimer) {
    return;
  }

  const melody = [523.25, 659.25, 783.99, 659.25, 587.33, 698.46, 880, 698.46];
  musicStep = 0;
  musicTimer = window.setInterval(() => {
    if (!gameRunning || gameOver || audioContext.state !== 'running') {
      return;
    }

    playTone(melody[musicStep % melody.length], 0.2, 'triangle', 0.012);
    if (musicStep % 4 === 0) {
      playTone([130.81, 164.81, 146.83, 196][Math.floor(musicStep / 4) % 4], 0.35, 'sine', 0.018);
    }
    musicStep += 1;
  }, 240);
}

function stopMusic() {
  if (musicTimer) {
    window.clearInterval(musicTimer);
    musicTimer = undefined;
  }
}

function setOverlayVisibility(overlay, isVisible) {
  overlay.classList.toggle('hidden', !isVisible);
}

function createRoadSegment(index) {
  const roadGroup = new THREE.Group();
  const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x2d2d2d, roughness: 0.82, metalness: 0.12 });
  const curbMaterial = new THREE.MeshStandardMaterial({ color: 0x5f5f5f });
  const lineMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });

  const road = new THREE.Mesh(new THREE.BoxGeometry(12, 0.75, segmentLength), roadMaterial);
  road.position.set(0, -0.35, 0);
  road.castShadow = false;
  road.receiveShadow = true;
  roadGroup.add(road);

  const leftCurb = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, segmentLength), curbMaterial);
  leftCurb.position.set(-6.5, 0.1, 0);
  roadGroup.add(leftCurb);

  const rightCurb = leftCurb.clone();
  rightCurb.position.x = 6.5;
  roadGroup.add(rightCurb);

  for (let lane = 1; lane < 3; lane += 1) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 4.2), lineMaterial);
    line.position.set((lane * 3) - 4.5, 0.35, 0);
    roadGroup.add(line);
  }

  roadGroup.position.z = -index * segmentLength;
  roadSegments.push(roadGroup);
  scene.add(roadGroup);
}

function createEnvironmentSegment(index) {
  const group = new THREE.Group();
  const buildingColors = [0xf4b942, 0x5ec4a0, 0x4a93d8, 0xe67252, 0x73c9c3, 0xe7c75a];

  for (let side = -1; side <= 1; side += 2) {
    const buildingCount = 4;
    for (let i = 0; i < buildingCount; i += 1) {
      const width = 2.4 + Math.random() * 1.3;
      const height = 3 + Math.random() * 7.2;
      const depth = 2.5 + Math.random() * 2.5;
      const building = new THREE.Mesh(
        new THREE.BoxGeometry(width, height, depth),
        new THREE.MeshStandardMaterial({ color: buildingColors[(index + i + side + buildingColors.length) % buildingColors.length] })
      );
      building.position.set(side * (11 + i * 2.3), height / 2, -4 + i * 2.6);
      building.castShadow = true;
      building.receiveShadow = true;
      group.add(building);
    }

    for (let i = 0; i < 3; i += 1) {
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.2, 0.25, 1.2, 6),
        new THREE.MeshStandardMaterial({ color: 0x7a4b28 })
      );
      trunk.position.y = 0.6;
      tree.add(trunk);

      const foliage = new THREE.Mesh(
        new THREE.ConeGeometry(0.85, 2.1, 6),
        new THREE.MeshStandardMaterial({ color: 0x2f9e44 })
      );
      foliage.position.y = 2.2;
      tree.add(foliage);

      tree.position.set(side * (8 + i * 2.3), 0, -5 + i * 3.1);
      group.add(tree);
    }

    for (let i = 0; i < 2; i += 1) {
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, 3.3, 8),
        new THREE.MeshStandardMaterial({ color: 0x5c5c5c })
      );
      pole.position.set(side * (7.8 + i * 4.2), 1.65, -6 + i * 5.8);
      const lamp = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 10, 10),
        new THREE.MeshStandardMaterial({ color: 0xfff0a7, emissive: 0xffdb66, emissiveIntensity: 0.7 })
      );
      lamp.position.set(side * (7.8 + i * 4.2), 3.4, -6 + i * 5.8);
      group.add(pole);
      group.add(lamp);
    }
  }

  group.position.z = -index * segmentLength;
  environmentSegments.push(group);
  scene.add(group);
}

function createRoad() {
  for (let i = 0; i < 13; i += 1) {
    createRoadSegment(i);
  }
}

function createEnvironment() {
  for (let i = 0; i < 13; i += 1) {
    createEnvironmentSegment(i);
  }
}

function createWorld() {
  createRoad();
  createEnvironment();
}

function createPlayer() {
  player = new THREE.Group();
  const torsoMaterial = new THREE.MeshStandardMaterial({ color: 0x800020, roughness: 0.68 });
  const pantsMaterial = new THREE.MeshStandardMaterial({ color: 0x29313d, roughness: 0.82 });
  const skinMaterial = new THREE.MeshStandardMaterial({ color: 0xf1c6a5, roughness: 0.95 });
  const shoeMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
  const hairMaterial = new THREE.MeshStandardMaterial({ color: 0x30201d, roughness: 0.95 });
  const jointGeometry = new THREE.SphereGeometry(0.16, 8, 6);
  const segment = (topRadius, bottomRadius, height, material) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(topRadius, bottomRadius, height, 8), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };

  const torso = new THREE.Group();
  torso.position.y = 1.55;
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.92, 1.05, 0.55), torsoMaterial);
  body.castShadow = true;
  body.receiveShadow = true;
  torso.add(body);
  player.add(torso);

  const neck = segment(0.16, 0.18, 0.25, skinMaterial);
  neck.position.y = 2.15;
  player.add(neck);

  const headPivot = new THREE.Group();
  headPivot.position.set(0, 2.45, 0);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.82, 0.72), skinMaterial);
  head.castShadow = true;
  headPivot.add(head);
  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.28, 0.76), hairMaterial);
  hair.position.set(0, 0.43, 0.015);
  hair.castShadow = true;
  headPivot.add(hair);
  for (const eyeX of [-0.18, 0.18]) {
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x241916 })
    );
    eye.position.set(eyeX, 0.03, -0.36);
    headPivot.add(eye);
  }
  player.add(headPivot);

  const arms = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.59, 1.98, 0);
    const shoulderJoint = new THREE.Mesh(jointGeometry, torsoMaterial);
    const upperArm = segment(0.16, 0.14, 0.58, torsoMaterial);
    upperArm.position.y = -0.29;
    const elbowJoint = new THREE.Mesh(jointGeometry, skinMaterial);
    elbowJoint.scale.setScalar(0.82);
    elbowJoint.position.y = -0.59;
    const elbow = new THREE.Group();
    elbow.position.y = -0.59;
    const forearm = segment(0.13, 0.11, 0.48, skinMaterial);
    forearm.position.y = -0.24;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), skinMaterial);
    hand.position.y = -0.49;
    elbow.add(forearm, hand);
    shoulder.add(shoulderJoint, upperArm, elbowJoint, elbow);
    player.add(shoulder);
    arms.push({ shoulder, elbow, hand });
  }

  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.25, 0.96, 0);
    const upperLeg = segment(0.2, 0.17, 0.46, pantsMaterial);
    upperLeg.position.y = -0.23;
    const kneeJoint = new THREE.Mesh(jointGeometry, pantsMaterial);
    kneeJoint.scale.set(0.9, 0.9, 0.9);
    kneeJoint.position.y = -0.46;
    const knee = new THREE.Group();
    knee.position.y = -0.46;
    const lowerLeg = segment(0.14, 0.12, 0.36, pantsMaterial);
    lowerLeg.position.y = -0.18;
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.2, 0.58), shoeMaterial);
    shoe.position.set(0, -0.4, -0.12);
    shoe.castShadow = true;
    shoe.receiveShadow = true;
    knee.add(lowerLeg, shoe);
    hip.add(upperLeg, kneeJoint, knee);
    player.add(hip);
    legs.push({ hip, knee, shoe });
  }

  const flameGroup = new THREE.Group();
  const flames = [];
  const flameColors = [0xff4a12, 0xffa51f, 0xffe45e, 0xff5722, 0xffbd35];
  for (let i = 0; i < flameColors.length; i += 1) {
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(i % 2 === 0 ? 0.3 : 0.22, i % 2 === 0 ? 0.9 : 0.65, 6),
      new THREE.MeshStandardMaterial({
        color: flameColors[i],
        emissive: flameColors[i],
        emissiveIntensity: 0.75,
        transparent: true,
        opacity: 0.88,
      })
    );
    flame.position.set((i - 2) * 0.25, 0.85 + (i % 2) * 0.65, 0.12);
    flame.rotation.z = (i - 2) * -0.16;
    flame.castShadow = false;
    flameGroup.add(flame);
    flames.push(flame);
  }
  flameGroup.visible = false;
  player.add(flameGroup);

  player.userData = { torso, headPivot, arms, legs, flames, flameGroup };

  player.position.set(0, 0, 0);
  scene.add(player);
}

function createObstacle(type, lane = 1, z = -45) {
  const group = new THREE.Group();
  const orangeMaterial = new THREE.MeshStandardMaterial({ color: 0xff8a1d, roughness: 0.85 });
  const redMaterial = new THREE.MeshStandardMaterial({ color: 0xdc2d2d, roughness: 0.8 });
  const woodMaterial = new THREE.MeshStandardMaterial({ color: 0x8d5a2b, roughness: 0.85 });
  const stripeMaterial = new THREE.MeshStandardMaterial({ color: 0xfafafa });

  if (type === 'cone') {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.72, 1.8, 8), orangeMaterial);
    cone.position.y = 0.9;
    cone.castShadow = true;
    cone.receiveShadow = true;
    group.add(cone);
    group.userData.type = 'cone';
    group.userData.jumpHeight = 1.3;
  } else if (type === 'barrier') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.9, 0.9), redMaterial);
    body.position.y = 0.6;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const stripe1 = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.14, 0.12), stripeMaterial);
    stripe1.position.set(0, 0.7, 0.46);
    const stripe2 = stripe1.clone();
    stripe2.position.z = -0.46;
    group.add(stripe1, stripe2);
    group.userData.type = 'barrier';
    group.userData.jumpHeight = 1.7;
  } else {
    const crate = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.9, 1.9), woodMaterial);
    crate.position.y = 0.95;
    crate.castShadow = true;
    crate.receiveShadow = true;
    group.add(crate);
    group.userData.type = 'crate';
    group.userData.jumpHeight = 0;
  }

  group.position.set(lanePositions[lane], 0, z);
  scene.add(group);
  activeObstacles.push(group);
  return group;
}

function createCoin(lane, startZ, count = 5, type = 'gold') {
  const coinValues = { silver: 5, gold: 10, rainbow: 25 };
  const coinColors = {
    silver: { color: 0xd9e1e8, emissive: 0x657483 },
    gold: { color: 0xf6d24a, emissive: 0xffd640 },
    rainbow: { color: 0xff45dc, emissive: 0xb820ff },
  };
  for (let i = 0; i < count; i += 1) {
    const material = new THREE.MeshStandardMaterial({
      color: coinColors[type].color,
      emissive: coinColors[type].emissive,
      emissiveIntensity: type === 'rainbow' ? 1.15 : 0.65,
      metalness: 0.65,
      roughness: 0.28,
    });
    const coin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.42, 0.12, 18),
      material
    );
    coin.rotation.x = Math.PI / 2;
    coin.position.set(lanePositions[lane], 1.5 + (i % 2) * 0.35, startZ - i * 2.2);
    coin.castShadow = true;
    coin.userData = { type, value: coinValues[type] };
    scene.add(coin);
    activeCoins.push(coin);
  }
}

function createCoinRow(lane, startZ, count = 5, type = 'gold') {
  createCoin(lane, startZ, count, type);
}

function removeObstacle(obstacle) {
  scene.remove(obstacle);
  disposeObject(obstacle);
  const index = activeObstacles.indexOf(obstacle);
  if (index > -1) {
    activeObstacles.splice(index, 1);
  }
}

function removeCoin(coin) {
  scene.remove(coin);
  disposeObject(coin);
  const index = activeCoins.indexOf(coin);
  if (index > -1) {
    activeCoins.splice(index, 1);
  }
}

function disposeObject(object) {
  object.traverse((child) => {
    if (child.geometry) {
      child.geometry.dispose();
    }
    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => material.dispose());
    }
  });
}

function addFloatingText(text, x, y, z) {
  const div = document.createElement('div');
  div.textContent = text;
  div.className = 'floating-text';
  div.style.position = 'absolute';
  div.style.left = '50%';
  div.style.top = '50%';
  div.style.transform = 'translate(-50%, -50%)';
  div.style.color = '#ffd700';
  div.style.fontWeight = '700';
  div.style.fontSize = '1.2rem';
  div.style.zIndex = '40';
  div.style.pointerEvents = 'none';
  document.body.appendChild(div);

  floatingTexts.push({
    element: div,
    timer: 0.7,
    x,
    y,
    z,
  });
}

function updateFloatingTexts() {
  for (let i = floatingTexts.length - 1; i >= 0; i -= 1) {
    const item = floatingTexts[i];
    item.timer -= 1 / 60;
    if (item.timer <= 0) {
      item.element.remove();
      floatingTexts.splice(i, 1);
    } else {
      const screenPoint = item.x, y = item.y, z = item.z;
      const projection = new THREE.Vector3(screenPoint, y, z).project(camera);
      const xPosition = (projection.x * 0.5 + 0.5) * window.innerWidth;
      const yPosition = (-projection.y * 0.5 + 0.5) * window.innerHeight;
      item.element.style.left = `${xPosition}px`;
      item.element.style.top = `${yPosition}px`;
      item.element.style.opacity = String(Math.max(0, item.timer * 1.7));
      item.element.style.transform = `translate(-50%, -50%) translateY(${(1 - item.timer) * -20}px)`;
    }
  }
}

function spawnObjects(delta) {
  spawnTimer -= delta;
  if (spawnTimer > 0) {
    return;
  }

  const lanes = [0, 1, 2];
  const blockedLanes = new Set();
  const firstLane = Math.floor(Math.random() * lanes.length);
  blockedLanes.add(firstLane);

  if (Math.random() > 0.35) {
    const remaining = lanes.filter((lane) => !blockedLanes.has(lane));
    if (remaining.length > 0) {
      blockedLanes.add(remaining[Math.floor(Math.random() * remaining.length)]);
    }
  }

  blockedLanes.forEach((lane) => {
    const types = ['cone', 'barrier', 'crate'];
    const obstacleType = types[Math.floor(Math.random() * types.length)];
    createObstacle(obstacleType, lane, -45);
  });

  const openLanes = lanes.filter((lane) => !blockedLanes.has(lane));
  if (openLanes.length > 0) {
    const coinLane = openLanes[Math.floor(Math.random() * openLanes.length)];
    const coinRoll = Math.random();
    const coinType = coinRoll < 0.25 ? 'silver' : coinRoll < 0.85 ? 'gold' : 'rainbow';
    createCoinRow(coinLane, -42, 5, coinType);
  }

  spawnTimer = Math.max(0.8, 1.7 - speedMultiplier * 0.22);
}

function handleInput(action) {
  if (!gameRunning || gameOver) {
    return;
  }

  if (action === 'left') {
    targetLane = Math.max(0, targetLane - 1);
    lastDirection = -1;
  }

  if (action === 'right') {
    targetLane = Math.min(2, targetLane + 1);
    lastDirection = 1;
  }

  if (action === 'jump' && !isJumping) {
    jumpVelocity = 8.6;
    isJumping = true;
    playJumpSound();
  }

  if (action === 'parry' && parryCooldown <= 0) {
    parryTimer = 0.42;
    parryCooldown = 0.72;
    playTone(260, 0.1, 'square', 0.035);
    flingNearbyObjects();
  }
}

function updatePlayer(delta) {
  parryTimer = Math.max(0, parryTimer - delta);
  parryCooldown = Math.max(0, parryCooldown - delta);
  currentLane = THREE.MathUtils.lerp(currentLane, targetLane, 0.18);
  const targetX = lanePositions[targetLane];
  player.position.x = THREE.MathUtils.lerp(player.position.x, targetX, 0.17);
  player.rotation.z = THREE.MathUtils.lerp(player.rotation.z, (targetLane - currentLane) * 0.26, 0.14);
  player.rotation.x = THREE.MathUtils.lerp(player.rotation.x, 0, 0.12);

  if (isJumping) {
    player.position.y += jumpVelocity * delta;
    jumpVelocity -= 22 * delta;

    if (player.position.y <= 0) {
      player.position.y = 0;
      jumpVelocity = 0;
      isJumping = false;
    }
  }

  const runCycle = elapsedTime * (7 + speedMultiplier * 2.2);
  const stride = Math.sin(runCycle);
  const { arms, legs, torso, headPivot, flameGroup, flames } = player.userData;
  arms[0].shoulder.rotation.x = stride * 0.42;
  arms[0].elbow.rotation.x = -0.12 - Math.max(0, stride) * 0.4;
  arms[1].shoulder.rotation.x = THREE.MathUtils.lerp(-stride * 0.42, 1.22, parryTimer / 0.42);
  arms[1].elbow.rotation.x = THREE.MathUtils.lerp(-0.12 - Math.max(0, -stride) * 0.4, -0.12, parryTimer / 0.42);
  legs[0].hip.rotation.x = -stride * 0.48;
  legs[1].hip.rotation.x = stride * 0.48;
  legs[0].knee.rotation.x = Math.max(0, stride) * 0.55;
  legs[1].knee.rotation.x = Math.max(0, -stride) * 0.55;
  legs[0].shoe.rotation.x = -legs[0].knee.rotation.x * 0.6;
  legs[1].shoe.rotation.x = -legs[1].knee.rotation.x * 0.6;
  torso.position.y = 1.55 + Math.abs(stride) * 0.035;
  torso.rotation.x = THREE.MathUtils.lerp(torso.rotation.x, parryTimer > 0 ? -0.12 : 0.025, 0.12);
  headPivot.rotation.z = Math.sin(runCycle * 0.5) * 0.035;

  const isBurning = speedMultiplier >= 5;
  flameGroup.visible = isBurning;
  flames.forEach((flame, index) => {
    const flicker = 0.82 + Math.sin(elapsedTime * 25 + index * 2.4) * 0.18;
    flame.scale.set(flicker, flicker * (0.92 + Math.sin(elapsedTime * 19 + index) * 0.14), flicker);
    flame.rotation.z = (index - 2) * -0.16 + Math.sin(elapsedTime * 13 + index) * 0.12;
  });
  speedLines.classList.toggle('active', speedMultiplier >= 2);
  speedLines.classList.toggle('intense', speedMultiplier >= 5);

  camera.position.x = THREE.MathUtils.lerp(camera.position.x, player.position.x * 0.4, 0.12);
  camera.position.y = THREE.MathUtils.lerp(camera.position.y, 5.6 + player.position.y * 0.4, 0.1);
}

function flingNearbyObjects() {
  const fling = (object, direction) => {
    object.userData.flung = true;
    object.userData.velocity = new THREE.Vector3(direction * 2.5, 5.2, -10 - Math.random() * 3);
    object.userData.angularVelocity = new THREE.Vector3(
      (Math.random() - 0.5) * 10,
      (Math.random() - 0.5) * 10,
      (Math.random() - 0.5) * 10
    );
    object.userData.bounces = 0;
  };
  let hitCount = 0;

  for (const obstacle of activeObstacles) {
    if (obstacle.userData.flung) {
      continue;
    }
    const distanceX = obstacle.position.x - player.position.x;
    const distanceZ = obstacle.position.z - player.position.z;
    if (Math.abs(distanceX) < 2.1 && distanceZ > -9 && distanceZ < 2.2) {
      fling(obstacle, Math.sign(distanceX) || (Math.random() < 0.5 ? -1 : 1));
      hitCount += 1;
    }
  }

  for (const coin of activeCoins) {
    if (coin.userData.flung) {
      continue;
    }
    const distanceX = coin.position.x - player.position.x;
    const distanceZ = coin.position.z - player.position.z;
    if (Math.abs(distanceX) < 1.6 && distanceZ > -7 && distanceZ < 1.5) {
      fling(coin, Math.sign(distanceX) || (Math.random() < 0.5 ? -1 : 1));
      hitCount += 1;
    }
  }

  if (hitCount > 0) {
    playTone(620, 0.12, 'sawtooth', 0.045);
  }
}

function updateWorld(delta) {
  speedMultiplier = Math.min(1 + elapsedTime / 20, 6);
  const travelSpeed = baseSpeed * speedMultiplier;

  roadSegments.forEach((segment) => {
    segment.position.z += travelSpeed * delta;
    if (segment.position.z > segmentLength * 1.2) {
      segment.position.z -= segmentLength * roadSegments.length;
    }
  });

  environmentSegments.forEach((segment) => {
    segment.position.z += travelSpeed * delta;
    if (segment.position.z > segmentLength * 1.2) {
      segment.position.z -= segmentLength * environmentSegments.length;
    }
  });
}

function updateObstacles(delta) {
  const travelSpeed = baseSpeed * speedMultiplier;

  activeObstacles.forEach((obstacle) => {
    if (obstacle.userData.flung) {
      updateFlungObject(obstacle, delta);
    } else {
      obstacle.position.z += travelSpeed * delta;
    }
  });

  activeCoins.forEach((coin) => {
    if (coin.userData.flung) {
      updateFlungObject(coin, delta);
    } else {
      coin.position.z += travelSpeed * delta;
      coin.rotation.y += delta * 10;
    }
    if (coin.userData.type === 'rainbow') {
      coin.material.color.setHSL((elapsedTime * 0.35) % 1, 0.9, 0.58);
      coin.material.emissive.setHSL((elapsedTime * 0.35) % 1, 1, 0.28);
    }
  });

  for (let i = activeObstacles.length - 1; i >= 0; i -= 1) {
    const obstacle = activeObstacles[i];
    if (obstacle.position.z > 12 || obstacle.position.z < -75) {
      removeObstacle(obstacle);
    }
  }

  for (let i = activeCoins.length - 1; i >= 0; i -= 1) {
    const coin = activeCoins[i];
    if (coin.position.z > 12 || coin.position.z < -75) {
      removeCoin(coin);
    }
  }
}

function updateFlungObject(object, delta) {
  const velocity = object.userData.velocity;
  const angularVelocity = object.userData.angularVelocity;
  velocity.y -= flingGravity * delta;
  object.position.addScaledVector(velocity, delta);
  object.rotation.x += angularVelocity.x * delta;
  object.rotation.y += angularVelocity.y * delta;
  object.rotation.z += angularVelocity.z * delta;

  if (object.position.y < 0.16) {
    object.position.y = 0.16;
    velocity.y = Math.abs(velocity.y) * 0.46;
    velocity.x *= 0.78;
    velocity.z *= 0.78;
    object.userData.bounces += 1;
    if (velocity.y < 1.2 || object.userData.bounces >= 4) {
      velocity.y = 0;
    }
  }
}

function checkCollisions() {
  const playerX = player.position.x;
  const playerZ = player.position.z;
  const playerY = player.position.y;

  for (let i = activeObstacles.length - 1; i >= 0; i -= 1) {
    const obstacle = activeObstacles[i];
    if (obstacle.userData.flung) {
      continue;
    }
    const diffX = Math.abs(obstacle.position.x - playerX);
    const diffZ = Math.abs(obstacle.position.z - playerZ);

    if (diffX < 1.1 && diffZ < 1.3) {
      const type = obstacle.userData.type;
      if (type === 'crate') {
        endGame();
        return;
      }

      const safeHeight = obstacle.userData.jumpHeight;
      if (playerY < safeHeight) {
        endGame();
        return;
      }
    }
  }

  for (let i = activeCoins.length - 1; i >= 0; i -= 1) {
    const coin = activeCoins[i];
    const diffX = Math.abs(coin.position.x - playerX);
    const diffZ = Math.abs(coin.position.z - playerZ);
    const diffY = Math.abs(coin.position.y - (playerY + 1.5));

    if (diffX < 0.9 && diffZ < 1.2 && diffY < 1.6) {
      score += coin.userData.value;
      coinCount += 1;
      addFloatingText(`+${coin.userData.value}`, player.position.x, player.position.y + 2.8, player.position.z);
      playCoinSound();
      removeCoin(coin);
      updateHUD();
    }
  }
}

function updateScore(delta) {
  score += delta * 12 * speedMultiplier;
  updateHUD();
}

function updateGame(delta) {
  elapsedTime += delta;
  updatePlayer(delta);
  updateWorld(delta);
  updateObstacles(delta);
  spawnObjects(delta);
  checkCollisions();
  updateScore(delta);
  updateFloatingTexts();
}

function endGame() {
  if (gameOver) {
    return;
  }

  gameRunning = false;
  gameOver = true;
  stopMusic();
  speedLines.classList.remove('active', 'intense');
  playGameOverSound();

  highScore = Math.max(highScore, Math.floor(score));
  try {
    window.localStorage.setItem(storageKey, String(highScore));
  } catch (error) {
    // Ignore storage access errors in restricted browser contexts.
  }

  finalScoreValue.textContent = formatNumber(score, 4);
  finalCoinsValue.textContent = String(coinCount).padStart(2, '0');
  finalHighScoreValue.textContent = formatNumber(highScore, 4);

  setOverlayVisibility(gameOverOverlay, true);
  setOverlayVisibility(menuOverlay, false);
  setOverlayVisibility(howToPlayOverlay, false);
  setOverlayVisibility(hud, false);
}

function resetGame() {
  while (activeObstacles.length > 0) {
    removeObstacle(activeObstacles[0]);
  }
  while (activeCoins.length > 0) {
    removeCoin(activeCoins[0]);
  }
  floatingTexts.forEach((item) => item.element.remove());
  floatingTexts.length = 0;

  currentLane = 1;
  targetLane = 1;
  jumpVelocity = 0;
  isJumping = false;
  parryTimer = 0;
  parryCooldown = 0;
  score = 0;
  coinCount = 0;
  elapsedTime = 0;
  gameOver = false;
  spawnTimer = 1.2;
  speedMultiplier = 1;
  lastDirection = 0;

  player.position.set(0, 0, 0);
  player.rotation.set(0, 0, 0);
  player.userData.torso.position.y = 1.55;
  player.userData.torso.rotation.set(0, 0, 0);
  player.userData.headPivot.rotation.set(0, 0, 0);
  player.userData.arms.forEach(({ shoulder, elbow }) => {
    shoulder.rotation.set(0, 0, 0);
    elbow.rotation.set(0, 0, 0);
  });
  player.userData.legs.forEach(({ hip, knee, shoe }) => {
    hip.rotation.set(0, 0, 0);
    knee.rotation.set(0, 0, 0);
    shoe.rotation.set(0, 0, 0);
  });
  player.userData.flameGroup.visible = false;
  speedLines.classList.remove('active', 'intense');

  camera.position.set(0, 5.6, 12);
  camera.lookAt(0, 0, -30);
  updateHighScoreDisplays();
  updateHUD();
}

function startGame() {
  initAudio();
  resetGame();
  gameRunning = true;
  startMusic();
  setOverlayVisibility(menuOverlay, false);
  setOverlayVisibility(gameOverOverlay, false);
  setOverlayVisibility(howToPlayOverlay, false);
  setOverlayVisibility(hud, true);
}

function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9ad0ff);
  scene.fog = new THREE.Fog(0x9ad0ff, 25, 130);

  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 220);
  camera.position.set(0, 5.8, 12);
  camera.lookAt(0, 0, -30);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const hemiLight = new THREE.HemisphereLight(0xdfeeff, 0x6a6a6a, 1.3);
  scene.add(hemiLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(10, 25, 10);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 2048;
  dirLight.shadow.mapSize.height = 2048;
  dirLight.shadow.camera.left = -30;
  dirLight.shadow.camera.right = 30;
  dirLight.shadow.camera.top = 30;
  dirLight.shadow.camera.bottom = -30;
  scene.add(dirLight);

  createWorld();
  createPlayer();
  updateHighScoreDisplays();
  updateHUD();
}

function animate() {
  requestAnimationFrame(animate);

  const delta = Math.min(clock.getDelta(), 0.05);

  if (gameRunning && !gameOver) {
    updateGame(delta);
  } else {
    const idleDrift = Math.sin((performance.now() * 0.001) * 0.8) * 0.12;
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, idleDrift, 0.03);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, 5.8, 0.02);
    camera.lookAt(0, 0, -30);
  }

  renderer.render(scene, camera);
}

function handleKeyDown(event) {
  const key = event.key.toLowerCase();
  if (key === 'a' || key === 'arrowleft') {
    handleInput('left');
  }
  if (key === 'd' || key === 'arrowright') {
    handleInput('right');
  }
  if (key === 'w' || key === 'arrowup' || key === ' ') {
    handleInput('jump');
  }
}

function bindEvents() {
  window.addEventListener('keydown', handleKeyDown, { passive: false });
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  playButton.addEventListener('click', () => {
    startGame();
  });
  canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button === 0) {
      handleInput('parry');
    }
  });

  howToPlayButton.addEventListener('click', () => {
    setOverlayVisibility(menuOverlay, false);
    setOverlayVisibility(howToPlayOverlay, true);
  });

  closeInstructionsButton.addEventListener('click', () => {
    setOverlayVisibility(howToPlayOverlay, false);
    setOverlayVisibility(menuOverlay, true);
  });

  playAgainButton.addEventListener('click', () => {
    startGame();
  });

  mainMenuButton.addEventListener('click', () => {
    gameRunning = false;
    gameOver = false;
    stopMusic();
    setOverlayVisibility(gameOverOverlay, false);
    setOverlayVisibility(hud, false);
    setOverlayVisibility(menuOverlay, true);
    resetGame();
  });

  touchButtons.forEach((button) => {
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const action = button.dataset.action;
      handleInput(action);
    });
  });
}

function init() {
  initScene();
  bindEvents();
  clock = new THREE.Clock();
  updateHighScoreDisplays();
  updateHUD();
  setOverlayVisibility(menuOverlay, true);
  setOverlayVisibility(hud, false);
  setOverlayVisibility(gameOverOverlay, false);
  setOverlayVisibility(howToPlayOverlay, false);
  animate();
}

init();
