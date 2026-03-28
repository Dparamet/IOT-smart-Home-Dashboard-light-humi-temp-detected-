import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getDatabase, ref, onValue, update, query, limitToLast } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

// --- DOM Elements ---
const $ = (id) => document.getElementById(id);
const setupDiv = $('setup-container');
const loginDiv = $('login-container');
const appDiv = $('app-container');
const errDiv = $('login-error');
const elStatusBadge = $('board-status');
const elStatusText = $('status-text');
const elStatusMeta = $('status-meta');
const elCurrentTime = $('current-time');
const logPanel = $('log-panel');
const btnClearLog = $('btn-clear-log');
const healthLastSync = $('health-last-sync');
const healthSyncAge = $('health-sync-age');
const healthRelayQueue = $('health-relay-queue');
const metricDetailEls = {
    temp: {
        current: $('metric-temp-current'),
        trend: $('metric-temp-trend'),
        min: $('metric-temp-min'),
        avg: $('metric-temp-avg'),
        max: $('metric-temp-max')
    },
    hum: {
        current: $('metric-hum-current'),
        trend: $('metric-hum-trend'),
        min: $('metric-hum-min'),
        avg: $('metric-hum-avg'),
        max: $('metric-hum-max')
    },
    light: {
        current: $('metric-light-current'),
        trend: $('metric-light-trend'),
        min: $('metric-light-min'),
        avg: $('metric-light-avg'),
        max: $('metric-light-max')
    }
};
const metricEls = {
    temp: $('val-temp').parentElement,
    hum: $('val-hum').parentElement,
    light: $('val-light').parentElement
};

// --- State Management ---
let app, auth, db;
let lastSyncTime = 0;
let lastDataArrivalAt = 0;
let isFirebaseConnected = false;
let chartInstance = null;
let heartbeatTimer = null;
let clockTimer = null;
let stopIoTListeners = [];
let iotStarted = false;
let uiHandlersBound = false;
let lastBoardState = 'syncing';
const RELAY_PRESS_DELAY_MS = 1000;
const DATA_STALE_MS = 10000;
const miniCharts = { temp: null, hum: null, light: null };
const LOG_LIMIT = 140;
const logQueue = [];
let logFlushScheduled = false;

function isFiniteNumber(val) {
    return Number.isFinite(Number(val));
}

function toNumberOrNull(val) {
    const n = Number(val);
    return Number.isFinite(n) ? n : null;
}

function normalizeTimestamp(rawTs) {
    const n = Number(rawTs);
    if (!Number.isFinite(n)) return null;
    // รองรับทั้งวินาทีและมิลลิวินาที
    return n < 1e12 ? n * 1000 : n;
}

function formatTimeLabel(timestampMs) {
    if (!Number.isFinite(timestampMs)) return '';
    const d = new Date(timestampMs);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function formatSensorValue(val, digits = 1) {
    return isFiniteNumber(val) ? Number(val).toFixed(digits) : '--';
}

function setMetricTrend(el, diff) {
    if (!el) return;
    el.classList.remove('up', 'down', 'flat');
    if (!Number.isFinite(diff) || Math.abs(diff) < 0.05) {
        el.classList.add('flat');
        el.textContent = 'ทรงตัว';
        return;
    }
    if (diff > 0) {
        el.classList.add('up');
        el.textContent = '↗ เพิ่มขึ้น';
    } else {
        el.classList.add('down');
        el.textContent = '↘ ลดลง';
    }
}

function updateMetricDetailCard(key, values, unit = '', digits = 1) {
    const ui = metricDetailEls[key];
    if (!ui) return;

    const series = values.filter((v) => Number.isFinite(v));
    if (series.length === 0) {
        ui.current.textContent = `-- ${unit}`.trim();
        ui.min.textContent = '--';
        ui.avg.textContent = '--';
        ui.max.textContent = '--';
        setMetricTrend(ui.trend, 0);
        return;
    }

    const min = Math.min(...series);
    const max = Math.max(...series);
    const avg = series.reduce((sum, n) => sum + n, 0) / series.length;
    const last = series[series.length - 1];
    const prev = series.length > 1 ? series[series.length - 2] : last;

    ui.current.textContent = `${last.toFixed(digits)} ${unit}`.trim();
    ui.min.textContent = min.toFixed(digits);
    ui.avg.textContent = avg.toFixed(digits);
    ui.max.textContent = max.toFixed(digits);
    setMetricTrend(ui.trend, last - prev);
}

function destroyMiniCharts() {
    Object.keys(miniCharts).forEach((k) => {
        if (miniCharts[k]) {
            miniCharts[k].destroy();
            miniCharts[k] = null;
        }
    });
}

function createMiniChart(canvasId, color) {
    const canvas = $(canvasId);
    if (!canvas || typeof Chart === 'undefined') return null;
    return new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                data: [],
                borderColor: color,
                backgroundColor: 'transparent',
                borderWidth: 2,
                tension: 0.35,
                pointRadius: 0,
                pointHoverRadius: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
            scales: {
                x: { display: false },
                y: { display: false }
            },
            animation: { duration: 200, easing: 'easeOutQuad' }
        }
    });
}

function initMiniCharts() {
    if (typeof Chart === 'undefined') {
        setTimeout(initMiniCharts, 120);
        return;
    }
    destroyMiniCharts();
    miniCharts.temp = createMiniChart('mini-temp-chart', '#ff8f8f');
    miniCharts.hum = createMiniChart('mini-hum-chart', '#6be8ff');
    miniCharts.light = createMiniChart('mini-light-chart', '#ffd166');
}

function updateMiniChart(chart, labels, values) {
    if (!chart) return;
    chart.data.labels = labels;
    chart.data.datasets[0].data = values;
    chart.update('active');
}

function updateSeparatedDashboard(labels, temp, hum, light) {
    updateMetricDetailCard('temp', temp, '°C', 1);
    updateMetricDetailCard('hum', hum, '%', 1);
    updateMetricDetailCard('light', light, '%', 1);

    updateMiniChart(miniCharts.temp, labels, temp);
    updateMiniChart(miniCharts.hum, labels, hum);
    updateMiniChart(miniCharts.light, labels, light);
}

function pulseValue(el) {
    if (!el) return;
    el.classList.remove('updated');
    // Force reflow to restart animation class reliably
    void el.offsetWidth;
    el.classList.add('updated');
    setTimeout(() => el.classList.remove('updated'), 190);
}

function enqueueLog(level, message) {
    const now = new Date();
    const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    logQueue.push({ level, message, time });
    if (!logFlushScheduled) {
        logFlushScheduled = true;
        requestAnimationFrame(flushLogs);
    }
}

function flushLogs() {
    logFlushScheduled = false;
    if (!logPanel || logQueue.length === 0) return;

    const empty = logPanel.querySelector('.log-empty');
    if (empty) empty.remove();

    const fragment = document.createDocumentFragment();
    while (logQueue.length > 0) {
        const item = logQueue.shift();
        const row = document.createElement('div');
        row.className = 'log-entry';

        const timeEl = document.createElement('span');
        timeEl.className = 'log-time';
        timeEl.textContent = item.time;

        const levelEl = document.createElement('span');
        levelEl.className = `log-level ${item.level}`;
        levelEl.textContent = item.level.toUpperCase();

        const msgEl = document.createElement('span');
        msgEl.className = 'log-msg';
        msgEl.textContent = item.message;

        row.append(timeEl, levelEl, msgEl);
        fragment.appendChild(row);
    }
    logPanel.appendChild(fragment);

    while (logPanel.children.length > LOG_LIMIT) {
        logPanel.removeChild(logPanel.firstElementChild);
    }
    logPanel.scrollTop = logPanel.scrollHeight;
}

function clearLogs() {
    logPanel.innerHTML = '<div class="log-empty">ยังไม่มี log</div>';
    enqueueLog('info', 'ล้าง Log เรียบร้อย');
}

function formatClockTime(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '--:--:--';
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return '--:--:--';
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

function updateCurrentTime() {
    if (!elCurrentTime) return;
    elCurrentTime.textContent = formatClockTime(Date.now());
}

function startClock() {
    if (clockTimer) clearInterval(clockTimer);
    updateCurrentTime();
    clockTimer = setInterval(updateCurrentTime, 1000);
}

function updateHealthPanel(nowMs = Date.now()) {
    if (!healthLastSync || !healthSyncAge || !healthRelayQueue) return;
    const ageMs = lastDataArrivalAt > 0 ? Math.max(0, nowMs - lastDataArrivalAt) : null;
    const queueCount = Number(relayPending.relay_1) + Number(relayPending.relay_2);
    const isBusy = queueCount > 0;
    const syncTime = lastSyncTime || lastDataArrivalAt;

    healthLastSync.textContent = formatClockTime(syncTime);
    healthSyncAge.textContent = ageMs === null ? '--' : `${(ageMs / 1000).toFixed(1)}s`;
    healthRelayQueue.textContent = isBusy ? `กำลังส่ง ${queueCount} คำสั่ง` : 'พร้อม';
    healthRelayQueue.classList.toggle('busy', isBusy);
}

function cleanupIoTLogic() {
    stopIoTListeners.forEach(unsub => {
        if (typeof unsub === 'function') unsub();
    });
    stopIoTListeners = [];
    destroyMiniCharts();
    Object.values(relayTimeout).forEach((timer) => {
        if (timer) clearTimeout(timer);
    });
    relayTimeout.relay_1 = null;
    relayTimeout.relay_2 = null;
    relayPending.relay_1 = false;
    relayPending.relay_2 = false;
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
    if (clockTimer) {
        clearInterval(clockTimer);
        clockTimer = null;
    }
    iotStarted = false;
    lastBoardState = 'syncing';
    isFirebaseConnected = false;
    lastDataArrivalAt = 0;
    elStatusBadge.className = 'status-badge status-offline';
    elStatusText.textContent = 'กำลังซิงค์ฮาร์ดแวร์...';
    if (elStatusMeta) elStatusMeta.textContent = 'ยังไม่ได้เชื่อมต่อฐานข้อมูล';
    updateHealthPanel();
    enqueueLog('warn', 'หยุดการเชื่อมต่อ IoT ชั่วคราว');
}

// Relay state tracking for stability
const relayPending = { relay_1: false, relay_2: false };
const relayTimeout = { relay_1: null, relay_2: null };
const relayServerState = { relay_1: null, relay_2: null };

async function syncRelayWithRetry(relayId, state, retries = 3, delayMs = 1000) {
    const controlKey = relayId === 1 ? 'relay_1' : 'relay_2';

    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            await Promise.race([
                update(ref(db, 'iot_system/controls'), { [controlKey]: state }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
            ]);

            enqueueLog('info', `Relay ${relayId} => ${state ? 'ON' : 'OFF'} (sync ok)`);
            return true;
        } catch (err) {
            if (attempt < retries - 1) {
                enqueueLog('warn', `Relay ${relayId} retry ${attempt + 1}/${retries - 1}...`);
                await new Promise(r => setTimeout(r, delayMs));
                delayMs *= 1.5; // Exponential backoff
            } else {
                throw err;
            }
        }
    }
}

function setRelayInputBusy(inputEl, controlKey, busy) {
    inputEl.disabled = busy;
    inputEl.style.opacity = busy ? '0.5' : '1';
    relayPending[controlKey] = busy;
    updateHealthPanel();
}

function scheduleRelayUpdate(inputEl, relayId, state) {
    const controlKey = relayId === 1 ? 'relay_1' : 'relay_2';

    if (!db || relayPending[controlKey]) {
        inputEl.checked = !state;
        return;
    }

    if (relayTimeout[controlKey]) {
        clearTimeout(relayTimeout[controlKey]);
        relayTimeout[controlKey] = null;
    }

    setRelayInputBusy(inputEl, controlKey, true);
    enqueueLog('info', `Relay ${relayId} รอส่งคำสั่ง ${RELAY_PRESS_DELAY_MS / 1000} วินาที...`);

    relayTimeout[controlKey] = setTimeout(() => {
        relayTimeout[controlKey] = null;

        syncRelayWithRetry(relayId, state).then(() => {
            enqueueLog('info', `Relay ${relayId} confirmed`);
        }).catch(err => {
            inputEl.checked = !state; // Revert if all retries failed
            console.error(`Failed to sync ${controlKey} after retries:`, err);
            enqueueLog('error', `Relay ${relayId} failed: ${err.message}`);
        }).finally(() => {
            setRelayInputBusy(inputEl, controlKey, false);
        });
    }, RELAY_PRESS_DELAY_MS);
}

function bindIoTUIHandlers() {
    if (uiHandlersBound) return;
    uiHandlersBound = true;

    $('toggle-relay1').addEventListener('change', (e) => {
        const nextState = e.target.checked;
        if (relayServerState.relay_1 === nextState) {
            enqueueLog('info', 'Relay 1 อยู่สถานะเดิมแล้ว');
            return;
        }
        scheduleRelayUpdate(e.target, 1, nextState);
    });

    $('toggle-relay2').addEventListener('change', (e) => {
        const nextState = e.target.checked;
        if (relayServerState.relay_2 === nextState) {
            enqueueLog('info', 'Relay 2 อยู่สถานะเดิมแล้ว');
            return;
        }
        scheduleRelayUpdate(e.target, 2, nextState);
    });

    btnClearLog?.addEventListener('click', clearLogs);
}

// --- 1. Init Flow ---
function checkSetup() {
    const configStr = localStorage.getItem('iot_firebase_config');
    if (!configStr) {
        setupDiv.style.display = 'block';
        loginDiv.style.display = 'none';
        appDiv.style.display = 'none';
        enqueueLog('warn', 'ยังไม่ได้ตั้งค่า Firebase');
        return;
    }

    try {
        const config = JSON.parse(configStr);
        initFirebase(config);
    } catch (error) {
        console.error('Invalid local config:', error);
        localStorage.removeItem('iot_firebase_config');
        setupDiv.style.display = 'block';
        loginDiv.style.display = 'none';
        appDiv.style.display = 'none';
        enqueueLog('error', 'Firebase config ไม่ถูกต้อง (ถูกรีเซ็ตแล้ว)');
    }
}

$('btn-save-setup').addEventListener('click', () => {
    const apiKey = $('apiKey').value.trim();
    const databaseURL = $('databaseURL').value.trim();
    if(!apiKey || !databaseURL) return alert('กรุณากรอกข้อมูลให้ครบถ้วน');

    const config = { apiKey, databaseURL };
    localStorage.setItem('iot_firebase_config', JSON.stringify(config));
    enqueueLog('info', 'บันทึก Firebase config สำเร็จ');
    location.reload(); // Reload to start fresh
});

$('btn-reset-setup').addEventListener('click', () => {
    localStorage.removeItem('iot_firebase_config');
    enqueueLog('warn', 'รีเซ็ต Firebase config');
    location.reload();
});

function initFirebase(config) {
    try {
        app = initializeApp(config);
        auth = getAuth(app);
        db = getDatabase(app);

        setupDiv.style.display = 'none';

        // Auth Listener
        onAuthStateChanged(auth, (user) => {
            if (user) {
                loginDiv.style.display = 'none';
                appDiv.style.display = 'block';
                enqueueLog('info', `เข้าสู่ระบบสำเร็จ: ${user.email ?? 'unknown user'}`);
                startIoTLogic();
            } else {
                cleanupIoTLogic();
                loginDiv.style.display = 'block';
                appDiv.style.display = 'none';
                enqueueLog('warn', 'ออกจากระบบแล้ว');
            }
        });
    } catch (error) {
        console.error("Firebase Init Error:", error);
        alert('ตั้งค่า Firebase ผิดพลาด กรุณารีเซ็ตแล้วลองใหม่');
        localStorage.removeItem('iot_firebase_config');
        enqueueLog('error', `Firebase init fail: ${error.message}`);
        location.reload();
    }
}

// --- 2. Auth Flow ---
$('btn-login').addEventListener('click', () => {
    const email = $('email').value.trim();
    const pass = $('password').value;
    errDiv.style.display = 'none';

    signInWithEmailAndPassword(auth, email, pass)
        .catch((error) => {
            errDiv.textContent = "เข้าสู่ระบบล้มเหลว: " + error.message;
            errDiv.style.display = 'block';
            enqueueLog('error', `Login fail: ${error.message}`);
        });
});

$('btn-logout').addEventListener('click', () => {
    enqueueLog('warn', 'กำลังออกจากระบบ...');
    signOut(auth);
});

// --- 3. IoT Core Logic ---
function startIoTLogic() {
    if (iotStarted) return;
    iotStarted = true;
    bindIoTUIHandlers();
    initChart();
    initMiniCharts();

    // References
    const sensorsRef = ref(db, 'iot_system/sensors');
    const controlsRef = ref(db, 'iot_system/controls');
    const historyRef = query(ref(db, 'iot_system/history'), limitToLast(60));
    const connectedRef = ref(db, '.info/connected');

    // Firebase connectivity listener
    const offConnected = onValue(connectedRef, (snapshot) => {
        isFirebaseConnected = Boolean(snapshot.val());
    });

    // A. Sensors Listener
    const offSensors = onValue(sensorsRef, (snapshot) => {
        const data = snapshot.val();
        if(data) {
            $('val-temp').textContent = formatSensorValue(data.temperature, 1);
            $('val-hum').textContent = formatSensorValue(data.humidity, 1);
            $('val-light').textContent = isFiniteNumber(data.light_percent) ? Number(data.light_percent) : '--';
            pulseValue(metricEls.temp);
            pulseValue(metricEls.hum);
            pulseValue(metricEls.light);

            lastDataArrivalAt = Date.now();
            const ts = normalizeTimestamp(data.timestamp);
            lastSyncTime = ts ?? lastDataArrivalAt; // fallback กัน timestamp อุปกรณ์ค้าง
            updateHealthPanel();
        }
    });

    // B. Controls Listener (Sync back from DB)
    const offControls = onValue(controlsRef, (snapshot) => {
        const data = snapshot.val();
        if(data) {
            relayServerState.relay_1 = Boolean(data.relay_1);
            relayServerState.relay_2 = Boolean(data.relay_2);
            $('toggle-relay1').checked = Boolean(data.relay_1);
            $('toggle-relay2').checked = Boolean(data.relay_2);
        }
    });

    // C. Chart History Listener
    const offHistory = onValue(historyRef, (snapshot) => {
        const data = snapshot.val();
        if(data) {
            const labels = [];
            const tempValues = [];
            const humValues = [];
            const lightValues = [];

            // รองรับหลายรูปแบบ: timestamp ใน entry หรือ timestamp ใน key
            // และเรียงตามเวลาเพื่ออ่านกราฟง่ายขึ้น
            const sortedEntries = Object.entries(data)
                .map(([key, entry], idx) => {
                    const ts = normalizeTimestamp(entry?.timestamp) ?? normalizeTimestamp(key) ?? (idx + 1);
                    return { ts, entry };
                })
                .sort((a, b) => a.ts - b.ts);

            sortedEntries.forEach(({ ts, entry }) => {
                labels.push(formatTimeLabel(ts));
                tempValues.push(toNumberOrNull(entry?.temperature));
                humValues.push(toNumberOrNull(entry?.humidity));
                lightValues.push(toNumberOrNull(entry?.light_percent ?? entry?.light));
            });

            updateChart(labels, tempValues, humValues, lightValues);
            updateSeparatedDashboard(labels, tempValues, humValues, lightValues);
        }
    });

    stopIoTListeners.push(offConnected, offSensors, offControls, offHistory);

    // --- Heartbeat Monitor (Check if offline) ---
    heartbeatTimer = setInterval(() => {
        const now = Date.now();
        updateHealthPanel(now);

        const ageMs = lastDataArrivalAt > 0 ? (now - lastDataArrivalAt) : null;

        const nextState = !isFirebaseConnected
            ? 'offline'
            : (lastDataArrivalAt === 0
                ? 'connecting'
                : ((ageMs !== null && ageMs > DATA_STALE_MS) ? 'stale' : 'online'));

        if (elStatusMeta) {
            if (!isFirebaseConnected) {
                elStatusMeta.textContent = 'ฐานข้อมูลไม่เชื่อมต่อ (Firebase disconnected)';
            } else if (lastDataArrivalAt === 0) {
                elStatusMeta.textContent = 'เชื่อมต่อแล้ว แต่ยังไม่ได้รับข้อมูลจากอุปกรณ์';
            } else {
                elStatusMeta.textContent = `ข้อมูลล่าสุด ${(ageMs / 1000).toFixed(1)} วินาทีที่แล้ว`;
            }
        }

        if (nextState !== lastBoardState) {
            lastBoardState = nextState;
            if (nextState === 'online') {
                elStatusBadge.className = 'status-badge status-online';
                elStatusText.textContent = 'ออนไลน์ (Live)';
                enqueueLog('info', 'อุปกรณ์กลับมาออนไลน์');
            } else if (nextState === 'offline') {
                elStatusBadge.className = 'status-badge status-offline';
                elStatusText.textContent = 'ขาดการเชื่อมต่อฐานข้อมูล';
                enqueueLog('error', 'Firebase disconnected');
            } else if (nextState === 'stale') {
                elStatusBadge.className = 'status-badge status-stale';
                elStatusText.textContent = 'ข้อมูลค้าง (Stale Data)';
                enqueueLog('warn', `ข้อมูลไม่อัปเดตเกิน ${(DATA_STALE_MS / 1000).toFixed(0)} วินาที`);
            } else {
                elStatusBadge.className = 'status-badge status-connecting';
                elStatusText.textContent = 'รอข้อมูลจากอุปกรณ์...';
                enqueueLog('info', 'เชื่อมต่อฐานข้อมูลแล้ว กำลังรอข้อมูลอุปกรณ์...');
            }
        }
    }, 400);

    updateHealthPanel();
    enqueueLog('info', 'เริ่มต้น IoT runtime สำเร็จ');
}

// --- Chart.js Setup ---
function initChart() {
    if (typeof Chart === 'undefined') {
        setTimeout(initChart, 120);
        return;
    }
    const ctx = $('historyChart').getContext('2d');
    Chart.defaults.color = '#a0a0b0'; // Dark mode text

    if (chartInstance !== null) {
        chartInstance.destroy();
    }

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'อุณหภูมิ (°C)',
                    borderColor: '#ff4b4b',
                    backgroundColor: 'rgba(255, 75, 75, 0.1)',
                    data: [],
                    tension: 0.35,
                    pointRadius: 1.6,
                    pointHoverRadius: 4,
                    borderWidth: 2.2,
                    fill: true,
                    yAxisID: 'yTemp'
                },
                {
                    label: 'ความชื้น (%)',
                    borderColor: '#00f2fe',
                    backgroundColor: 'rgba(0, 242, 254, 0.1)',
                    data: [],
                    tension: 0.35,
                    pointRadius: 1.6,
                    pointHoverRadius: 4,
                    borderWidth: 2,
                    fill: false,
                    yAxisID: 'yPercent'
                },
                {
                    label: 'ความสว่าง (%)',
                    borderColor: '#ffd166',
                    backgroundColor: 'rgba(255, 209, 102, 0.08)',
                    data: [],
                    tension: 0.35,
                    pointRadius: 1.6,
                    pointHoverRadius: 4,
                    borderWidth: 2,
                    fill: false,
                    yAxisID: 'yPercent'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        boxWidth: 12,
                        boxHeight: 12,
                        usePointStyle: true,
                        pointStyle: 'line',
                        padding: 16,
                        color: '#c4d1e3'
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(14, 20, 30, 0.92)',
                    borderColor: '#2a3647',
                    borderWidth: 1,
                    callbacks: {
                        label: (ctx) => {
                            const label = ctx.dataset.label || '';
                            const val = Number.isFinite(ctx.parsed.y) ? ctx.parsed.y.toFixed(1) : '--';
                            return `${label}: ${val}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    ticks: {
                        autoSkip: false,
                        maxRotation: 0,
                        minRotation: 0,
                        color: '#93a7c2',
                        callback: function(value, index) {
                            const labels = this.chart?.data?.labels || [];
                            const step = Math.max(1, Math.ceil(labels.length / 8));
                            return index % step === 0 ? labels[index] : '';
                        }
                    },
                    grid: {
                        color: 'rgba(42, 54, 71, 0.22)'
                    }
                },
                yTemp: {
                    type: 'linear',
                    position: 'left',
                    beginAtZero: false,
                    ticks: {
                        color: '#93a7c2',
                        callback: (v) => `${v}°`
                    },
                    grid: {
                        color: 'rgba(42, 54, 71, 0.28)'
                    },
                    title: { display: true, text: '°C', color: '#a9bbd3' }
                },
                yPercent: {
                    type: 'linear',
                    position: 'right',
                    min: 0,
                    max: 100,
                    ticks: {
                        color: '#93a7c2',
                        callback: (v) => `${v}%`
                    },
                    grid: {
                        drawOnChartArea: false,
                        color: 'rgba(42, 54, 71, 0.18)'
                    },
                    title: { display: true, text: '%', color: '#a9bbd3' }
                }
            },
            animation: {
                duration: 260,
                easing: 'easeOutQuad'
            }
        }
    });

    enqueueLog('info', 'พร้อมใช้งานกราฟข้อมูลย้อนหลัง');
}

function updateChart(labels, temp, hum, light) {
    if(!chartInstance) return;
    chartInstance.data.labels = labels;
    chartInstance.data.datasets[0].data = temp;
    chartInstance.data.datasets[1].data = hum;
    chartInstance.data.datasets[2].data = light;
    chartInstance.update('active');
}

// --- Boot App ---
startClock();
checkSetup();
