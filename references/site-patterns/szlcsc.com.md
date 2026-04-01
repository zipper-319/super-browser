---
domain: szlcsc.com
aliases: [立创商城, 立创, LCSC]
updated: 2026-03-27
---

## 平台特征

1. **登录状态**：用户日常 Chrome 通常已登录，显示客户编号
2. **搜索页面**：有多个搜索入口，行为不同
3. **数据加载**：服务端渲染，可通过 DOM 直接提取

## 有效模式

### 搜索 URL 格式

**推荐**：使用 `so.szlcsc.com` 子域名
```
https://so.szlcsc.com/global.html?k={关键词}
```

**无效**：直接访问 `/search` 接口
```
https://www.szlcsc.com/search?q={关键词}  # 返回 500 系统异常
```

### 搜索结果提取

搜索结果在页面 DOM 中，可通过文本提取：
- 型号、品牌、封装、类目
- 价格梯度（1+/10+/30+/100+）
- 库存数量
- 产品描述

### 搜索框选择器

```javascript
// 全局搜索框
document.getElementById("global-seach-input")
```

## 已知陷阱

### 1. /search 接口返回 500 错误（2026-03-27）

**问题**：直接访问 `https://www.szlcsc.com/search?q=xxx` 返回 JSON 错误：
```json
{"code":500,"msg":"系统异常","result":null,"ok":false}
```

**解决方案**：使用 `so.szlcsc.com/global.html?k=xxx` 格式

### 2. list 子域名返回 403（2026-03-27）

**问题**：访问 `https://list.szlcsc.com/catalog/xxx.htm` 返回：
```json
{"code":403,"msg":"非法ACL-URL请求，禁止访问！","ok":false}
```

**解决方案**：避免使用 list 子域名，使用 so.szlcsc.com 搜索

### 3. 搜索框点击行为（2026-03-27）

**问题**：在首页直接点击搜索按钮（不输入内容），会跳转到热门关键词的搜索结果页

**解决方案**：需要先在搜索框输入目标关键词，再搜索；或直接导航到搜索 URL
