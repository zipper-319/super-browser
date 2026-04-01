#!/usr/bin/env bash
# 环境检查 + 确保 CDP Proxy 就绪

# Node.js
if command -v node &>/dev/null; then
  NODE_VER=$(node --version 2>/dev/null)
  NODE_MAJOR=$(echo "$NODE_VER" | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_MAJOR" -ge 22 ] 2>/dev/null; then
    echo "node: ok ($NODE_VER)"
  else
    echo "node: warn ($NODE_VER, 建议升级到 22+)"
  fi
else
  echo "node: missing — 请安装 Node.js 22+"
  exit 1
fi

# Chrome 调试端口检测 — 支持环境变量 CHROME_DEBUG_PORT 或自动发现
CHROME_PORT="${CHROME_DEBUG_PORT:-9222}"
if [ -n "$CHROME_DEBUG_PORT" ]; then
  # 用户指定了端口，检查该端口
  if node -e "
const net = require('net');
const s = net.createConnection($CHROME_DEBUG_PORT, '127.0.0.1');
s.on('connect', () => { process.exit(0); });
s.on('error', () => process.exit(1));
setTimeout(() => process.exit(1), 2000);
" 2>/dev/null; then
    echo "chrome: ok (port $CHROME_DEBUG_PORT via CHROME_DEBUG_PORT)"
  else
    echo "chrome: not connected on port $CHROME_DEBUG_PORT — 请确认 Chrome 调试端口"
    exit 1
  fi
else
  # 未指定端口，让 cdp-proxy.mjs 自动发现（不在此处强制检查）
  echo "chrome: will auto-discover via cdp-proxy.mjs"
fi

# CDP Proxy — 已运行则跳过，未运行则启动并等待连接
HEALTH=$(curl -s --connect-timeout 2 "http://127.0.0.1:3456/health" 2>/dev/null)
if echo "$HEALTH" | grep -q '"connected":true'; then
  echo "proxy: ready"
else
  if ! echo "$HEALTH" | grep -q '"ok"'; then
    echo "proxy: starting..."
    SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
    CHROME_DEBUG_PORT=$CHROME_DEBUG_PORT node "$SCRIPT_DIR/cdp-proxy.mjs" > /tmp/cdp-proxy.log 2>&1 &
  fi
  for i in $(seq 1 15); do
    sleep 1
    curl -s http://localhost:3456/health | grep -q '"connected":true' && echo "proxy: ready" && exit 0
    [ $i -eq 3 ] && echo "⚠️  Chrome 可能有授权弹窗，请点击「允许」后等待连接..."
  done
  echo "❌ 连接超时，请检查 Chrome 调试设置"
  echo ""
  echo "请确认 Chrome 的远程调试端口号（在 Chrome 地址栏打开 chrome://inspect/#remote-debugging 查看）"
  echo "然后通过环境变量指定端口：CHROME_DEBUG_PORT=<端口> bash check-deps.sh"
  echo "默认端口：9222"
  exit 1
fi
