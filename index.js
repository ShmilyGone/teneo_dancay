const axios = require('axios');
const chalk = require('chalk');
const WebSocket = require('ws');
const { HttpsProxyAgent } = require('https-proxy-agent');
const readline = require('readline');
const fs = require('fs');
const useProxy = true;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

let sockets = [];
let pingIntervals = [];
let countdownIntervals = [];
let potentialPoints = [];
let countdowns = [];
let pointsTotals = [];
let pointsToday = [];
let lastUpdateds = [];
let messages = [];
let userIds = [];
let browserIds = [];
let proxies = [];

function loadProxies() {
  try {
    const data = fs.readFileSync('proxy.txt', 'utf8');
    proxies = data.split('\n').map(line => line.trim().replace(/,$/, '').replace(/['"]+/g, '')).filter(line => line);
  } catch (err) {
    console.error('Không tải được proxy:', err);
  }
}

function loadAccounts() {
  try {
    const data = fs.readFileSync('data.txt', 'utf8');
    const accounts = data.split('\n')
      .map(line => {
        const [email, password] = line.trim().split('|');
        return email && password ? { email, password } : null;
      })
      .filter(account => account !== null);
    
    if (accounts.length === 0) {
      console.error(chalk.red('Không tìm thấy tài khoản nào trong file data.txt'));
      process.exit(1);
    }

    return accounts;
  } catch (err) {
    console.error(chalk.red('Lỗi đọc file data.txt:'), err);
    process.exit(1);
  }
}

const accounts = loadAccounts();

function normalizeProxyUrl(proxy) {
  if (!proxy.startsWith('http://') && !proxy.startsWith('https://')) {
    proxy = 'http://' + proxy;
  }
  return proxy;
}

const enableLogging = false;

const authorization = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlra25uZ3JneHV4Z2pocGxicGV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjU0MzgxNTAsImV4cCI6MjA0MTAxNDE1MH0.DRAvf8nH1ojnJBc3rD_Nw6t1AV8X_g6gmY_HByG2Mag";
const apikey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlra25uZ3JneHV4Z2pocGxicGV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjU0MzgxNTAsImV4cCI6MjA0MTAxNDE1MH0.DRAvf8nH1ojnJBc3rD_Nw6t1AV8X_g6gmY_HByG2Mag";

function generateBrowserId(index) {
  return `browserId-${index}-${Math.random().toString(36).substring(2, 15)}`;
}

function logToFile(message) {
  if (enableLogging) {
    fs.appendFile('error.log', `${new Date().toISOString()} - ${message}\n`, (err) => {
      if (err) {
        console.error('Không thể ghi nhật ký tin nhắn:', err);
      }
    });
  }
}

function displayAccountData(index) {
  console.log(chalk.cyan(`================= Tài khoản ${index + 1} =================`));
  console.log(chalk.whiteBright(`Email: ${accounts[index].email}`));
  console.log(`User ID: ${userIds[index]}`);
  console.log(`Browser ID: ${browserIds[index]}`);
  console.log(chalk.green(`Tổng điểm: ${pointsTotals[index]}`));
  console.log(chalk.green(`Điểm hôm nay: ${pointsToday[index]}`));
  console.log(chalk.whiteBright(`Message: ${messages[index]}`));
  const proxy = proxies[index % proxies.length];
  if (useProxy && proxy) {
    console.log(chalk.hex('#FFA500')(`Proxy: ${proxy}`));
  } else {
    console.log(chalk.hex('#FFA500')(`Proxy: Không sử dụng proxy`));
  }
  console.log(chalk.cyan(`_____________________________________________`));
}
function logAllAccounts() {
  console.clear();
  for (let i = 0; i < accounts.length; i++) {
    displayAccountData(i);
  }
  console.log("\nTrạng thái:");
  for (let i = 0; i < accounts.length; i++) {
    console.log(`Tài khoản ${i + 1}: Potential next Teneo Points: ${potentialPoints[i]}, Đếm ngược: ${countdowns[i]}`);
  }
}

async function connectWebSocket(index) {
  if (sockets[index]) return;
  const version = "v0.2";
  const url = "wss://secure.ws.teneo.pro";
  const wsUrl = `${url}/websocket?userId=${encodeURIComponent(userIds[index])}&version=${encodeURIComponent(version)}&browserId=${encodeURIComponent(browserIds[index])}`;

  const proxy = proxies[index % proxies.length];
  const agent = useProxy && proxy ? new HttpsProxyAgent(normalizeProxyUrl(proxy)) : null;

  sockets[index] = new WebSocket(wsUrl, { agent });

  sockets[index].onopen = async () => {
    lastUpdateds[index] = new Date().toISOString();
    console.log(`Tài khoản ${index + 1} đã kết nối`, lastUpdateds[index]);
    logToFile(`Tài khoản ${index + 1} đã kết nối tại ${lastUpdateds[index]}`);
    startPinging(index);
    startCountdownAndPoints(index);
  };

  sockets[index].onmessage = async (event) => {
    const data = JSON.parse(event.data);
    if (data.pointsTotal !== undefined && data.pointsToday !== undefined) {
      lastUpdateds[index] = new Date().toISOString();
      pointsTotals[index] = data.pointsTotal;
      pointsToday[index] = data.pointsToday;
      messages[index] = data.message;

      logAllAccounts();
      logToFile(`Account ${index + 1} received data: ${JSON.stringify(data)}`);
    }

    if (data.message === "Pulse from server") {
      console.log(`Đã nhận được point từ máy chủ cho Tài khoản ${index + 1}. Bắt đầu ping...`);
      logToFile(`Đã nhận được point từ máy chủ cho Tài khoản ${index + 1}`);
      setTimeout(() => {
        startPinging(index);
      }, 10000);
    }
  };

  sockets[index].onclose = () => {
    console.log(`Tài khoản ${index + 1} đã ngắt kết nối`);
    logToFile(`Tài khoản ${index + 1} đã ngắt kết nối`);
    reconnectWebSocket(index);
  };

  sockets[index].onerror = (error) => {
    console.error(`Lỗi kết nối WebSocket cho Tài khoản ${index + 1}:`, error);
    logToFile(`Lỗi kết nối WebSocket cho Tài khoản ${index + 1}: ${error}`);
  };
}

async function reconnectWebSocket(index) {
  const version = "v0.2";
  const url = "wss://secure.ws.teneo.pro";
  const wsUrl = `${url}/websocket?userId=${encodeURIComponent(userIds[index])}&version=${encodeURIComponent(version)}&browserId=${encodeURIComponent(browserIds[index])}`;

  const proxy = proxies[index % proxies.length];
  const agent = useProxy && proxy ? new HttpsProxyAgent(normalizeProxyUrl(proxy)) : null;

  if (sockets[index]) {
    sockets[index].removeAllListeners();
  }

  sockets[index] = new WebSocket(wsUrl, { agent });

  sockets[index].onopen = async () => {
    lastUpdateds[index] = new Date().toISOString();
    console.log(`Tài khoản ${index + 1} đã kết nối lại`, lastUpdateds[index]);
    logToFile(`Tài khoản ${index + 1} đã kết nối lại vào lúc ${lastUpdateds[index]}`);
    startPinging(index);
    startCountdownAndPoints(index);
  };

  sockets[index].onmessage = async (event) => {
    const data = JSON.parse(event.data);
    if (data.pointsTotal !== undefined && data.pointsToday !== undefined) {
      lastUpdateds[index] = new Date().toISOString();
      pointsTotals[index] = data.pointsTotal;
      pointsToday[index] = data.pointsToday;
      messages[index] = data.message;

      logAllAccounts();
      logToFile(`Account ${index + 1} received data: ${JSON.stringify(data)}`);
    }

    if (data.message === "Pulse from server") {
      console.log(`Đã nhận được point từ máy chủ cho Tài khoản ${index + 1}. Bắt đầu ping...`);
      logToFile(`Đã nhận được point từ máy chủ cho Tài khoản ${index + 1}`);
      setTimeout(() => {
        startPinging(index);
      }, 10000);
    }
  };

  sockets[index].onclose = () => {
    console.log(`Tài khoản ${index + 1} lại bị ngắt kết nối`);
    logToFile(`Tài khoản ${index + 1} lại bị ngắt kết nối`);
    setTimeout(() => {
      reconnectWebSocket(index);
    }, 5000);
  };

  sockets[index].onerror = (error) => {
    console.error(`Lỗi kết nối WebSocket cho Tài khoản ${index + 1}:`, error);
    logToFile(`Lỗi kết nối WebSocket cho Tài khoản ${index + 1}: ${error}`);
  };
}
function startCountdownAndPoints(index) {
  clearInterval(countdownIntervals[index]);
  updateCountdownAndPoints(index);
  countdownIntervals[index] = setInterval(() => updateCountdownAndPoints(index), 1000);
}

async function updateCountdownAndPoints(index) {
  const restartThreshold = 60000;
  const now = new Date();

  if (!lastUpdateds[index]) {
    lastUpdateds[index] = {};
  }

  if (countdowns[index] === "Tính toán...") {
    const lastCalculatingTime = lastUpdateds[index].calculatingTime || now;
    const calculatingDuration = now.getTime() - lastCalculatingTime.getTime();

    if (calculatingDuration > restartThreshold) {
      reconnectWebSocket(index);
      logToFile(`Tài khoản ${index + 1} kết nối lại do tính toán mất nhiều thời gian`);
      return;
    }
  }

  if (lastUpdateds[index]) {
    const nextHeartbeat = new Date(lastUpdateds[index]);
    nextHeartbeat.setMinutes(nextHeartbeat.getMinutes() + 15);
    const diff = nextHeartbeat.getTime() - now.getTime();

    if (diff > 0) {
      const minutes = Math.floor(diff / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      countdowns[index] = `${minutes}m ${seconds}s`;

      const maxPoints = 25;
      const timeElapsed = now.getTime() - new Date(lastUpdateds[index]).getTime();
      const timeElapsedMinutes = timeElapsed / (60 * 1000);
      let newPoints = Math.min(maxPoints, (timeElapsedMinutes / 15) * maxPoints);
      newPoints = parseFloat(newPoints.toFixed(2));

      if (Math.random() < 0.1) {
        const bonus = Math.random() * 2;
        newPoints = Math.min(maxPoints, newPoints + bonus);
        newPoints = parseFloat(newPoints.toFixed(2));
      }

      potentialPoints[index] = newPoints;
    } else {
      countdowns[index] = "Đang tính toán, có thể mất một phút trước khi bắt đầu...";
      potentialPoints[index] = 25;

      lastUpdateds[index].calculatingTime = now;
    }
  } else {
    countdowns[index] = "Đang tính toán, có thể mất một phút trước khi bắt đầu...";
    potentialPoints[index] = 0;

    lastUpdateds[index].calculatingTime = now;
  }

  logAllAccounts();
  logToFile(`Cập nhật đếm ngược và điểm cho Tài khoản ${index + 1}`);
}

function startPinging(index) {
  pingIntervals[index] = setInterval(async () => {
    if (sockets[index] && sockets[index].readyState === WebSocket.OPEN) {
      const proxy = proxies[index % proxies.length];
      const agent = useProxy && proxy ? new HttpsProxyAgent(normalizeProxyUrl(proxy)) : null;
      
      sockets[index].send(JSON.stringify({ type: "PING" }), { agent });
      logAllAccounts();
      logToFile(`Ping đã được gửi cho Tài khoản ${index + 1}`);
    }
  }, 10000);
}

function stopPinging(index) {
  if (pingIntervals[index]) {
    clearInterval(pingIntervals[index]);
    pingIntervals[index] = null;
    logToFile(`Đã dừng ping cho Tài khoản ${index + 1}`);
  }
}

function restartAccountProcess(index) {
  disconnectWebSocket(index);
  connectWebSocket(index);
  console.log(`WebSocket restarted for index: ${index}`);
  logToFile(`WebSocket restarted for index: ${index}`);
}

async function getUserId(index) {
  const loginUrl = "https://ikknngrgxuxgjhplbpey.supabase.co/auth/v1/token?grant_type=password";

  const proxy = proxies[index % proxies.length];
  const agent = useProxy && proxy ? new HttpsProxyAgent(normalizeProxyUrl(proxy)) : null;

  try {
    const response = await axios.post(loginUrl, {
      email: accounts[index].email,
      password: accounts[index].password
    }, {
      headers: {
        'Authorization': authorization,
        'apikey': apikey
      },
      httpsAgent: agent
    });

    userIds[index] = response.data.user.id;
    browserIds[index] = generateBrowserId(index);
    logAllAccounts();

    const profileUrl = `https://ikknngrgxuxgjhplbpey.supabase.co/rest/v1/profiles?select=personal_code&id=eq.${userIds[index]}`;
    const profileResponse = await axios.get(profileUrl, {
      headers: {
        'Authorization': authorization,
        'apikey': apikey
      },
      httpsAgent: agent
    });

    console.log(`Profile Data for Account ${index + 1}:`, profileResponse.data);
    logToFile(`Profile Data for Account ${index + 1}: ${JSON.stringify(profileResponse.data)}`);
    startCountdownAndPoints(index);
    await connectWebSocket(index);
  } catch (error) {
    console.error(`Error for Account ${index + 1}:`, error.response ? error.response.data : error.message);
    logToFile(`Error for Account ${index + 1}: ${error.response ? error.response.data : error.message}`);
  }
}

loadProxies();

for (let i = 0; i < accounts.length; i++) {
  potentialPoints[i] = 0;
  countdowns[i] = "Tính toán...";
  pointsTotals[i] = 0;
  pointsToday[i] = 0;
  lastUpdateds[i] = null;
  messages[i] = '';
  userIds[i] = null;
  browserIds[i] = null;
  getUserId(i);
}
