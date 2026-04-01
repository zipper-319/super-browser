---
domain: goofish.com
aliases: [闲鱼, 闲鱼平台, Xianyu]
updated: 2026-03-26 (优化文档结构：统一路径、补充Unicode编码表、完善导入语句、精简重复警告)
---

## 平台特征

1. **登录要求**：闲鱼网页版搜索结果需要登录才能查看商品列表
   - 未登录时显示"加载中..."，商品不显示
   - 登录方式：短信验证码、密码、手机淘宝/支付宝扫码

2. **动态加载**：商品列表通过 JavaScript 动态加载
   - 页面初始状态显示"加载中..."
   - 等待 3-4 秒后内容才会完全渲染

3. **反爬机制**：
   - 搜索结果页有反爬检测
   - 短时间内大量请求可能触发风控
   - 建议每次请求间隔 2-3 秒

4. **页面结构**：
   - 商品列表容器：`[class*=feeds-list-container]`
   - 商品卡片：`[class*=feeds-item-wrap]`
   - 筛选栏：`[class*=search-filter-up-container]`
   - 分页：`[class*=search-page-tiny-container]`
   - 商品链接格式：`/item?id={商品ID}&categoryId={分类ID}`

## 有效模式

### 搜索 URL 格式
```text
https://www.goofish.com/search?q={URL编码的关键词}
```

### CDP 连接方式（2026-03-26 验证）

**Chrome 远程调试端口配置**：
- 启动 Chrome 时需添加 `--remote-allow-origins=*` 参数允许 WebSocket 连接
- 常用端口：9066、9222

**⚠️ CDP Proxy 端口发现机制（2026-03-26 更新）**：

CDP Proxy 的端口发现策略：
1. 尝试读取 `DevToolsActivePort` 文件
2. 尝试默认端口 `9222`
3. 如果都失败，提示用户通过环境变量指定端口

**如果 Chrome 使用非标准端口（如 9066）**：
```bash
# 通过环境变量指定端口
CHROME_DEBUG_PORT=9066 node cdp-proxy.mjs

# 验证连接成功
curl http://localhost:3456/health
# 期望输出: {"status":"ok","connected":true,"chromePort":9066}
```

**查看 Chrome 调试端口**：在 Chrome 地址栏打开 `chrome://inspect/#remote-debugging`

**推荐：CDP Proxy HTTP API**（2026-03-26 验证稳定）：

使用 CDP Proxy 提供的 HTTP API，避免 WebSocket 连接管理的复杂性：

```python
import requests

class CDPProxyClient:
    """CDP Proxy API 客户端"""
    def __init__(self, proxy_url="http://localhost:3456"):
        self.proxy_url = proxy_url
        self.session = requests.Session()

    def health_check(self):
        resp = self.session.get(f"{self.proxy_url}/health", timeout=5)
        return resp.json().get("connected", False)

    def new_tab(self, url):
        resp = self.session.get(f"{self.proxy_url}/new", params={"url": url}, timeout=15)
        return resp.json().get('targetId')

    def close_tab(self, target_id):
        resp = self.session.get(f"{self.proxy_url}/close", params={"target": target_id})
        return resp.status_code == 200

    def navigate(self, target_id, url):
        resp = self.session.get(f"{self.proxy_url}/navigate",
            params={"target": target_id, "url": url}, timeout=30)
        return resp.status_code == 200

    def eval_js(self, target_id, js_code):
        resp = self.session.post(
            f"{self.proxy_url}/eval",
            params={"target": target_id},
            data=js_code,
            headers={"Content-Type": "text/plain"},
            timeout=20
        )
        return resp.json().get('value')

    def click(self, target_id, selector):
        resp = self.session.post(
            f"{self.proxy_url}/click",
            params={"target": target_id},
            data=selector,
            headers={"Content-Type": "text/plain"}
        )
        return resp.json().get('clicked', False)
```

**优势**：
- HTTP API 简单直观，无需管理 WebSocket 生命周期
- CDP Proxy 维护持久连接，避免频繁创建/销毁连接
- 支持自动等待页面加载（`/new` 和 `/navigate` 端点）
- 完整的 Python 采集脚本示例：`scripts/goofish_crawler_proxy.py`

---



**关键 API**（端口可为 4654、9066 等）：
```bash
# 列出页面
curl http://localhost:9066/json

# 创建新标签页（必须用 PUT）
curl -X PUT "http://localhost:9066/json/new?https://www.goofish.com"

# 关闭标签页
curl http://localhost:9066/json/close/{targetId}
```

### 数据提取

```javascript
// 提取商品列表（完整版）
(function() {
    var products = [];
    var links = document.querySelectorAll("a[href*='/item']");
    var seenIds = new Set();

    links.forEach(function(link) {
        var href = link.href;
        var match = href.match(/id=([a-f0-9]+)/i);
        if (!match || seenIds.has(match[1])) return;
        seenIds.add(match[1]);

        var card = link.closest("[class*=feeds-item-wrap]");
        if (!card) return;

        var product = { id: match[1], url: href };

        // 标题
        var titleEl = card.querySelector("[class*=title--]");
        product.title = titleEl ? titleEl.innerText.trim() : "";

        // 价格
        var priceEl = card.querySelector("[class*=price--]");
        product.price = priceEl ? priceEl.innerText.trim() : "";

        // 卖家地区（⚠️ 注意：返回的是城市名如"武汉"，不是省份名）
        var locationEl = card.querySelector("[class*=seller-text]");
        product.sellerLocation = locationEl ? locationEl.innerText.trim() : "";

        // 商品描述
        var descEl = card.querySelector("[class*=desc--]");
        product.description = descEl ? descEl.innerText.trim() : "";

        // 图片
        var imgEl = card.querySelector("img");
        product.imageUrl = imgEl ? imgEl.src : "";

        if (product.title) products.push(product);
    });
    return products;
})();
```

### 翻页操作

**推荐：JS `el.click()`**
```javascript
// 翻页操作
var arrows = document.querySelectorAll("button[class*=search-page-tiny-arrow-container]");
for (var i = 0; i < arrows.length; i++) {
    var btn = arrows[i];
    if (btn.disabled) continue;
    if (btn.querySelector("[class*=arrow-right]")) {
        btn.click();
        break;
    }
}
```

### 区域筛选

**完整操作流程**（2026-03-26 批量验证成功）：

```javascript
// 1. 滚动到区域按钮位置
document.querySelector("div[class*=areaText]").scrollIntoView({block: "center"});

// 2. 点击打开区域面板
document.querySelector("div[class*=areaText]").click();

// 3. 选择省份（使用 unicode 转义避免编码问题）
var provItems = document.querySelectorAll("[class*=provItem]");
for (var i = 0; i < provItems.length; i++) {
    if (provItems[i].innerText.indexOf("\u6e56\u5317") !== -1) {  // 湖北
        provItems[i].click();
        break;
    }
}

// 4. 选择城市（索引0为全省）
var cols = document.querySelectorAll("[class*=areaWrap] [class*=col--]");
var cities = cols[1].querySelectorAll("[class*=provItem]");
cities[0].click();

// 5. 确认筛选
document.querySelector("[class*=searchBtn--]").click();
```

**筛选成功标志**：
- 页码总数减少（如从 50 页变为 25 页）
- 区域按钮显示选中的省份名

## 已知陷阱

### 1. 卖家地区字段内容（2026-03-26 新增）

**问题**：`sellerLocation` 字段返回的是城市名（如"武汉"、"宜昌"），不是省份名。

**⚠️ 常见错误**：
```python
# ❌ 错误：筛选湖北后，location 仍是城市名，不会包含"湖北"
is_hubei = '湖北' in p.get('sellerLocation', '')  # 永远返回 False

# ✅ 正确：用城市列表匹配
HUBEI_CITIES = ['武汉', '黄石', '十堰', '宜昌', '襄阳', '鄂州', '荆门', '孝感', '荆州', '黄冈', '咸宁', '随州', '恩施', '仙桃', '潜江', '天门', '神农架']

def is_hubei(location):
    for city in HUBEI_CITIES:
        if city in str(location):
            return True
    return False
```

**注意**：即使应用了区域筛选（湖北），商品卡片上的 `sellerLocation` 仍显示城市名而非省份名。

### 2. Windows 控制台编码问题（2026-03-26 新增）

**问题**：Windows 控制台使用 GBK 编码，打印含 `\xa0` 等特殊字符的中文会触发 `UnicodeEncodeError`。

**解决方案**：
```python
# 方案1：替换特殊字符
title = title.replace('\xa0', ' ')

# 方案2：try-except 包装
try:
    print(f"商品: {title[:30]}")
except:
    print(f"商品: [ID:{id}]")
```

### 3. CDP 中文编码问题（2026-03-25）

**问题**：通过 curl 发送包含中文的 JS 代码会变成乱码。

**解决方案**：
```javascript
// ❌ 错误
if (text.indexOf("湖北") !== -1)

// ✅ 使用 unicode 转义
if (text.indexOf("\u6e56\u5317") !== -1)
```

常用 unicode 编码：

| 中文 | Unicode |
|------|---------|
| 湖北 | `\u6e56\u5317` |

**在线转换**：Python `'\u6e56\u5317'.encode('unicode-escape')` 或 JS `'湖北'.charCodeAt(0).toString(16)`

### 4. WebSocket 连接被拒绝

**问题**：Python websocket-client 连接 Chrome CDP 返回 403 Forbidden。

**原因**：Chrome 需要启动时添加 `--remote-allow-origins=*`。

**解决方案**：使用 Node.js 原生 WebSocket（Node.js 22+ 内置支持）。

### 5. 创建标签页 405 错误

**问题**：GET 请求 `/json/new` 返回 405。

**解决方案**：必须使用 PUT 方法：
```bash
curl -X PUT "http://localhost:9066/json/new?https://example.com"
```

### 6. 登录态过期

- 长时间操作后可能需要重新登录
- 表现为商品列表显示"加载中..."但无内容

### 7. 图片防盗链问题（2026-03-26 新增）

**问题**：闲鱼图片有防盗链机制，直接用 `requests.get()` 下载会返回 67 字节的错误响应（而非真实图片）。

**现象**：
- 下载的图片文件大小统一为 67 字节
- 实际成功率极低（约 11%，仅少数图片可直链下载）

**原因**：闲鱼 CDN 检查 Referer，无正确 Referer 时返回 403 错误的小响应体。

**解决方案**：
```python
# 方案1：携带 Referer 和 Cookie
headers = {
    'Referer': 'https://www.goofish.com/',
    'User-Agent': 'Mozilla/5.0...',
    'Cookie': '...'  # 从浏览器获取
}
resp = requests.get(img_url, headers=headers)

# 方案2（推荐）：通过 CDP 在浏览器内截图
# 先导航到图片 URL，再截图保存

# 方案3：仅保存图片 URL，不下载
# 适合仅需记录线索的场景
```

**建议**：对于批量采集场景，如果不需要图片内容，仅记录 URL 即可。

### 8. Excel 文件锁定问题（2026-03-26 新增）

**问题**：保存 Excel 时，如果文件被 Excel 或 WPS 打开，会报 `PermissionError: [Errno 13] Permission denied`。

**标志**：输出目录存在 `~$xxx.xlsx` 临时文件。

**解决方案**：
```python
import os
from datetime import datetime

# 方案1：使用带时间戳的文件名（推荐）
timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
df.to_excel(f"output_{timestamp}.xlsx", index=False)

# 方案2：保存前检测并关闭已打开的文件
temp_files = [f for f in os.listdir(output_dir) if f.startswith('~$')]
if temp_files:
    print("[WARN] 检测到 Excel 文件被打开，将使用新文件名")
```

### 9. 直接 WebSocket 连接稳定性问题（2026-03-26 新增）

**问题**：Python 通过 subprocess 调用 Node.js 创建 WebSocket 连接执行 JS，在批量采集时稳定性差。

**对比测试结果**：

| 方式 | 5关键词×2页 | 结果 |
|------|-------------|------|
| Node.js subprocess | 全部超时 | 0 条数据 |
| CDP Proxy HTTP API | 全部成功 | 300 条数据 |

**解决方案**：使用 CDP Proxy HTTP API（见"有效模式 → CDP 连接方式"），详见"备选：Node.js CDP 客户端"部分的警告说明。

## 采集建议

### 工作流程

1. 打开首页确认登录状态
2. 使用 URL 导航到搜索页（URL编码中文关键词）
3. 等待 3-4 秒让内容加载
4. 应用区域筛选
5. 提取商品数据
6. 翻页继续采集
7. 每页数据立即保存

### 频率控制

| 操作类型 | 建议间隔 |
|----------|----------|
| 页面加载等待 | 3-4 秒 |
| 区域筛选操作 | 每步 0.5-1 秒 |
| 翻页间隔 | 2-3 秒 |
| 关键词切换 | 3-5 秒 |

### 批量采集经验（2026-03-26 验证）

**实测数据**：
- 5 个关键词，每个采集 2 页
- 总计 300 条商品数据（湖北地区筛选）
- 图片下载：285 张尝试，仅约 11% 成功（防盗链导致）
- 总耗时约 3 分钟

**性能指标**：
- 单页提取：30 条商品
- 区域筛选耗时：约 10 秒/关键词（含等待）
- 违规商品识别：123 条（41.0%）

**建议配置**：
```python
MAX_PAGES = 2  # 每关键词最多2页
WAIT_PAGE = 4  # 页面加载等待4秒（比3秒更稳定）
WAIT_FILTER = 1  # 筛选操作等待1秒
WAIT_PAGINATION = 3  # 翻页等待3秒
```

**Python 批量采集脚本**：
- **推荐**：`scripts/goofish_crawler_proxy.py`（使用 CDP Proxy HTTP API，稳定）   


**脚本使用规则**：
- 实际使用时先检查脚本是否符合用户需求，如有不一致修改后再进行使用