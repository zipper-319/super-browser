#!/usr/bin/env python3
"""
闲鱼湖北地区智能电表相关商品采集与违规分析脚本
使用 CDP Proxy API（http://localhost:3456）
"""

import json
import time
import os
import logging
import urllib.parse
from datetime import datetime
from pathlib import Path
from typing import Optional, Any, Dict, List

import requests
import pandas as pd


# ============ 日志配置 ============
OUTPUT_DIR = Path("D:/code/pz_projects/goofish/output")
IMAGE_DIR = OUTPUT_DIR / "images"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
IMAGE_DIR.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler(OUTPUT_DIR / 'crawler.log', encoding='utf-8'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)


# ============ 配置 ============
CDP_PROXY = "http://localhost:3456"

# 搜索关键词
KEYWORDS = [
    "智能电表",
    "采集终端",
    "集中器",
    "载波模块",
    "电能表"
]

# 湖北城市列表
HUBEI_CITIES = ['武汉', '黄石', '十堰', '宜昌', '襄阳', '鄂州', '荆门', '孝感', '荆州', '黄冈', '咸宁', '随州', '恩施', '仙桃', '潜江', '天门', '神农架']

# 采集配置
MAX_PAGES = 2


# ============ 违规识别规则 ============
VIOLATION_RULES = {
    "高风险-涉嫌盗电": {
        "keywords": ["免费用电", "省电费", "电表倒转", "电表暂停", "电表慢走", "偷电", "窃电"],
        "risk": "高",
        "type": "盗电工具",
        "suggestion": "移交公安机关"
    },
    "高风险-设备改装": {
        "keywords": ["改数", "改表", "改装", "解码器", "编程器", "读写器", "遥控", "调表"],
        "risk": "高",
        "type": "设备改装",
        "suggestion": "移交公安机关"
    },
    "中风险-通信干扰": {
        "keywords": ["干扰器", "屏蔽器", "载波干扰", "信号屏蔽", "阻断器"],
        "risk": "中",
        "type": "通信干扰",
        "suggestion": "联合平台下架"
    },
    "中风险-疑似盗抢": {
        "keywords": ["二手", "拆机", "无包装", "库存处理"],
        "risk": "中",
        "type": "疑似盗抢设备",
        "suggestion": "列入观察名单"
    },
    "低风险-逃避监管": {
        "keywords": ["加微信", "加QQ", "私聊", "看图联系", "V信", "薇信"],
        "risk": "低",
        "type": "逃避监管",
        "suggestion": "列入观察名单"
    }
}


class CDPProxyClient:
    """CDP Proxy API 客户端"""

    def __init__(self, proxy_url: str = CDP_PROXY):
        self.proxy_url = proxy_url
        self.session = requests.Session()
        logger.info(f"CDPProxyClient 初始化，Proxy: {proxy_url}")

    def health_check(self) -> bool:
        """检查 Proxy 连接状态"""
        try:
            resp = self.session.get(f"{self.proxy_url}/health", timeout=5)
            data = resp.json()
            if data.get("connected"):
                logger.info(f"Proxy 已连接 Chrome（端口 {data.get('chromePort')}）")
                return True
            else:
                logger.warning("Proxy 未连接到 Chrome")
                return False
        except Exception as e:
            logger.error(f"Proxy 连接检查失败: {e}")
            return False

    def list_targets(self) -> List[Dict]:
        """列出所有标签页"""
        try:
            resp = self.session.get(f"{self.proxy_url}/targets", timeout=5)
            if resp.status_code == 200:
                return resp.json()
        except Exception as e:
            logger.error(f"列出标签页失败: {e}")
        return []

    def new_tab(self, url: str) -> Optional[str]:
        """创建新标签页，返回 target_id"""
        try:
            resp = self.session.get(
                f"{self.proxy_url}/new",
                params={"url": url},
                timeout=15
            )
            if resp.status_code == 200:
                data = resp.json()
                target_id = data.get('targetId')
                logger.info(f"创建标签页成功: {target_id}")
                return target_id
            else:
                logger.error(f"创建标签页失败: HTTP {resp.status_code}")
        except Exception as e:
            logger.error(f"创建标签页异常: {e}")
        return None

    def close_tab(self, target_id: str) -> bool:
        """关闭标签页"""
        try:
            resp = self.session.get(
                f"{self.proxy_url}/close",
                params={"target": target_id},
                timeout=5
            )
            return resp.status_code == 200
        except Exception as e:
            logger.error(f"关闭标签页失败: {e}")
        return False

    def navigate(self, target_id: str, url: str) -> bool:
        """导航到 URL（自动等待加载）"""
        try:
            resp = self.session.get(
                f"{self.proxy_url}/navigate",
                params={"target": target_id, "url": url},
                timeout=30
            )
            return resp.status_code == 200
        except Exception as e:
            logger.error(f"导航失败: {e}")
        return False

    def eval_js(self, target_id: str, js_code: str) -> Optional[Any]:
        """执行 JavaScript 代码"""
        try:
            resp = self.session.post(
                f"{self.proxy_url}/eval",
                params={"target": target_id},
                data=js_code,
                headers={"Content-Type": "text/plain"},
                timeout=20
            )
            if resp.status_code == 200:
                data = resp.json()
                return data.get('value')
            else:
                logger.debug(f"JS 执行失败: {resp.text[:200]}")
        except Exception as e:
            logger.error(f"JS 执行异常: {e}")
        return None

    def click(self, target_id: str, selector: str) -> bool:
        """点击元素"""
        try:
            resp = self.session.post(
                f"{self.proxy_url}/click",
                params={"target": target_id},
                data=selector,
                headers={"Content-Type": "text/plain"},
                timeout=10
            )
            if resp.status_code == 200:
                data = resp.json()
                return data.get('clicked', False)
        except Exception as e:
            logger.error(f"点击失败: {e}")
        return False

    def scroll(self, target_id: str, y: int = 3000, direction: str = "down") -> bool:
        """滚动页面"""
        try:
            resp = self.session.get(
                f"{self.proxy_url}/scroll",
                params={"target": target_id, "y": y, "direction": direction},
                timeout=10
            )
            return resp.status_code == 200
        except Exception as e:
            logger.error(f"滚动失败: {e}")
        return False

    def screenshot(self, target_id: str, file_path: str) -> bool:
        """截图保存"""
        try:
            resp = self.session.get(
                f"{self.proxy_url}/screenshot",
                params={"target": target_id, "file": file_path},
                timeout=15
            )
            return resp.status_code == 200
        except Exception as e:
            logger.error(f"截图失败: {e}")
        return False

    def wait_for_condition(self, target_id: str, condition_js: str, timeout: float = 15) -> bool:
        """等待条件满足"""
        start = time.time()
        while time.time() - start < timeout:
            result = self.eval_js(target_id, condition_js)
            if result is True:
                return True
            time.sleep(0.5)
        return False

    def wait_for_products(self, target_id: str, timeout: float = 15) -> bool:
        """等待商品列表加载"""
        js = 'document.querySelectorAll("a[href*=\'/item\']").length > 0'
        return self.wait_for_condition(target_id, js, timeout)


# ============ JS 代码片段 ============
def extract_products_js() -> str:
    return '''
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
        var product = {id: match[1], url: href};
        var titleEl = card.querySelector("[class*=title--]");
        product.title = titleEl ? titleEl.innerText.trim() : "";
        var priceEl = card.querySelector("[class*=price--]");
        product.price = priceEl ? priceEl.innerText.trim() : "";
        var locationEl = card.querySelector("[class*=seller-text]");
        product.sellerLocation = locationEl ? locationEl.innerText.trim() : "";
        var descEl = card.querySelector("[class*=desc--]");
        product.description = descEl ? descEl.innerText.trim() : "";
        var imgEl = card.querySelector("img");
        product.imageUrl = imgEl ? imgEl.src : "";
        // 尝试提取卖家昵称
        var sellerNameEl = card.querySelector("[class*=seller-name], [class*=nick], [class*=userName]");
        product.sellerName = sellerNameEl ? sellerNameEl.innerText.trim() : "";
        // 尝试提取发布时间
        var timeEl = card.querySelector("[class*=time], [class*=publish-time], [class*=created]");
        product.publishTime = timeEl ? timeEl.innerText.trim() : "";
        // 尝试从描述中提取联系方式
        var descText = product.description || "";
        var contactMatch = descText.match(/(?:微信|VX|QQ|\\u5fae\\u4fe1|v[\\u4fe1])[：:]*\\s*([a-zA-Z0-9_-]{4,20})/i);
        product.contact = contactMatch ? contactMatch[1] : "";
        if (product.title) products.push(product);
    });
    return {count: products.length, products: products};
})();
'''

def apply_region_filter_js() -> str:
    return '''
(function() {
    var areaBtn = document.querySelector("div[class*=areaText]");
    if (!areaBtn) return {success: false, error: "no_area_button"};
    areaBtn.scrollIntoView({block: "center"});
    areaBtn.click();
    return {success: true, step: "opened_panel"};
})();
'''

def select_hubei_js() -> str:
    return '''
(function() {
    var provItems = document.querySelectorAll("[class*=provItem]");
    for (var i = 0; i < provItems.length; i++) {
        var text = provItems[i].innerText || "";
        if (text.indexOf("\\u6e56\\u5317") !== -1) {
            provItems[i].click();
            return {success: true};
        }
    }
    return {success: false, error: "hubei_not_found"};
})();
'''

def select_all_cities_js() -> str:
    return '''
(function() {
    var cols = document.querySelectorAll("[class*=areaWrap] [class*=col--]");
    if (cols.length < 2) return {success: false, error: "no_city_col"};
    var cities = cols[1].querySelectorAll("[class*=provItem]");
    if (cities.length === 0) return {success: false, error: "no_cities"};
    cities[0].click();
    return {success: true};
})();
'''

def confirm_filter_js() -> str:
    return '''
(function() {
    var btn = document.querySelector("[class*=searchBtn--]");
    if (!btn) return {success: false, error: "no_confirm_btn"};
    btn.click();
    return {success: true};
})();
'''

def click_next_page_js() -> str:
    return '''
(function() {
    var arrows = document.querySelectorAll("button[class*=search-page-tiny-arrow-container]");
    for (var i = 0; i < arrows.length; i++) {
        var btn = arrows[i];
        if (btn.disabled) continue;
        if (btn.querySelector("[class*=arrow-right]")) {
            btn.click();
            return {success: true};
        }
    }
    return {success: false, error: "no_next"};
})();
'''

def check_filter_status_js() -> str:
    return '''
(function() {
    var areaBtn = document.querySelector("div[class*=areaText]");
    var text = areaBtn ? areaBtn.innerText.trim() : "";
    return {areaText: text, hasHubei: text.indexOf("\\u6e56\\u5317") !== -1};
})();
'''


# ============ 辅助函数 ============
def analyze_violations(product: Dict) -> List[Dict]:
    text = f"{product.get('title', '')} {product.get('description', '')}".lower()
    violations = []
    for rule_name, rule in VIOLATION_RULES.items():
        matched = [kw for kw in rule["keywords"] if kw.lower() in text]
        if matched:
            violations.append({
                "rule": rule_name,
                "type": rule["type"],
                "risk": rule["risk"],
                "keywords": matched,
                "suggestion": rule["suggestion"]
            })
    return violations


def save_to_excel(all_products: List[Dict], violation_products: List[Dict]):
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')

    if all_products:
        df_export = pd.DataFrame({
            '序号': range(1, len(all_products) + 1),
            '搜索关键词': [p.get('keyword', '') for p in all_products],
            '商品标题': [p.get('title', '').replace('\xa0', ' ')[:200] for p in all_products],
            '商品描述': [p.get('description', '').replace('\xa0', ' ')[:300] for p in all_products],
            '商品链接': [p.get('url', '') for p in all_products],
            '图片下载状态': [p.get('imageStatus', '') for p in all_products],
            '图片链接或本地路径': [p.get('imageUrl', '') for p in all_products],
            '卖家昵称': [p.get('sellerName', '') for p in all_products],
            '卖家所在地': [p.get('sellerLocation', '') for p in all_products],
            '联系方式': [p.get('contact', '') for p in all_products],
            '价格': [p.get('price', '') for p in all_products],
            '发布时间': [p.get('publishTime', '') for p in all_products],
            '违规特征标注': [p.get('violationTypes', '') for p in all_products]
        })
        file_path = OUTPUT_DIR / f"全量查询数据表_{timestamp}.xlsx"
        df_export.to_excel(file_path, index=False)
        logger.info(f"已保存全量数据: {file_path}")

    if violation_products:
        df_violation = pd.DataFrame({
            '序号': range(1, len(violation_products) + 1),
            '搜索关键词': [p.get('keyword', '') for p in violation_products],
            '商品标题': [p.get('title', '').replace('\xa0', ' ')[:200] for p in violation_products],
            '商品描述': [p.get('description', '').replace('\xa0', ' ')[:300] for p in violation_products],
            '商品链接': [p.get('url', '') for p in violation_products],
            '图片链接': [p.get('imageUrl', '') for p in violation_products],
            '卖家所在地': [p.get('sellerLocation', '') for p in violation_products],
            '价格': [p.get('price', '') for p in violation_products],
            '违规类型': [p.get('violationTypes', '') for p in violation_products],
            '风险等级': [p.get('riskLevel', '') for p in violation_products],
            '违规关键词': [p.get('violationKeywords', '') for p in violation_products],
            '处置建议': [p.get('suggestion', '') for p in violation_products]
        })
        file_path = OUTPUT_DIR / f"疑似非法售卖清单_{timestamp}.xlsx"
        df_violation.to_excel(file_path, index=False)
        logger.info(f"已保存违规数据: {file_path}")


def apply_region_filter(client: CDPProxyClient, target_id: str) -> bool:
    """应用区域筛选（湖北）"""
    # 步骤1: 打开区域面板
    result = client.eval_js(target_id, apply_region_filter_js())
    logger.debug(f"打开区域面板: {result}")
    if not result or not result.get('success'):
        logger.warning(f"打开区域面板失败")
        return False

    time.sleep(1.5)

    # 步骤2: 选择湖北
    result = client.eval_js(target_id, select_hubei_js())
    logger.debug(f"选择湖北: {result}")
    if not result or not result.get('success'):
        logger.warning("选择湖北失败")
        return False

    time.sleep(0.8)

    # 步骤3: 选择全省
    result = client.eval_js(target_id, select_all_cities_js())
    logger.debug(f"选择全省: {result}")
    if not result or not result.get('success'):
        logger.warning("选择全省失败")
        return False

    time.sleep(0.5)

    # 步骤4: 确认筛选
    result = client.eval_js(target_id, confirm_filter_js())
    logger.debug(f"确认筛选: {result}")
    if not result or not result.get('success'):
        logger.warning("确认筛选失败")
        return False

    # 等待页面重新加载
    time.sleep(4)
    return client.wait_for_products(target_id, timeout=12)


def run_crawler():
    """主采集流程"""
    logger.info("=" * 60)
    logger.info("闲鱼湖北地区智能电表采集任务")
    logger.info(f"开始时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    logger.info(f"CDP Proxy: {CDP_PROXY}")
    logger.info("=" * 60)

    all_products = []
    violation_products = []

    client = CDPProxyClient(CDP_PROXY)

    # 检查 Proxy 连接
    if not client.health_check():
        logger.error("CDP Proxy 连接失败，请检查 Chrome 和 Proxy 状态")
        return

    # 创建新标签页
    target_id = client.new_tab("https://www.goofish.com")
    if not target_id:
        logger.error("创建标签页失败")
        return

    logger.info(f"标签页 ID: {target_id}")

    try:
        # 等待首页加载
        logger.info("等待首页加载...")
        time.sleep(5)

        # 遍历关键词
        for keyword_idx, keyword in enumerate(KEYWORDS, 1):
            logger.info("=" * 50)
            logger.info(f"[关键词 {keyword_idx}/{len(KEYWORDS)}] {keyword}")

            # 搜索
            search_url = f"https://www.goofish.com/search?q={urllib.parse.quote(keyword)}"
            logger.info(f"导航到搜索页...")

            if not client.navigate(target_id, search_url):
                logger.warning("导航失败，跳过...")
                continue

            # 等待搜索结果加载
            if not client.wait_for_products(target_id, timeout=12):
                logger.warning("搜索结果加载超时，跳过...")
                continue

            logger.info("搜索结果已加载")

            # 应用区域筛选
            logger.info("应用区域筛选（湖北）...")
            if not apply_region_filter(client, target_id):
                logger.warning("区域筛选失败，继续使用当前结果...")

            # 检查筛选状态
            filter_status = client.eval_js(target_id, check_filter_status_js())
            logger.info(f"筛选状态: {filter_status}")

            # 采集页面数据
            for page in range(1, MAX_PAGES + 1):
                logger.info(f"[第 {page}/{MAX_PAGES} 页] 采集数据...")

                time.sleep(2)

                result = client.eval_js(target_id, extract_products_js())

                if result and 'products' in result:
                    products = result['products']
                    logger.info(f"提取到 {len(products)} 条商品")

                    for p in products:
                        p['keyword'] = keyword
                        p['page'] = page
                        p['crawlTime'] = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

                        # 标记是否为湖北（通过城市名判断）
                        location = p.get('sellerLocation', '')
                        p['isHubei'] = any(city in location for city in HUBEI_CITIES)

                        # 图片仅记录 URL（防盗链导致下载成功率低）
                        p['imageStatus'] = '仅链接'
                        p['imageUrl'] = p.get('imageUrl', '')

                        # 分析违规
                        violations = analyze_violations(p)
                        if violations:
                            p['violations'] = violations
                            p['isViolation'] = True
                            p['violationTypes'] = ', '.join([v['type'] for v in violations])
                            risks = [v['risk'] for v in violations]
                            p['riskLevel'] = '高' if '高' in risks else ('中' if '中' in risks else '低')
                            p['violationKeywords'] = ', '.join([kw for v in violations for kw in v['keywords']])
                            p['suggestion'] = violations[0]['suggestion']

                            violation_products.append(p)
                            try:
                                logger.warning(f"发现违规: {p['title'][:30]}... [{p['riskLevel']}风险]")
                            except:
                                logger.warning(f"发现违规商品 [ID:{p['id']}] [{p['riskLevel']}风险]")
                        else:
                            p['isViolation'] = False
                            p['violationTypes'] = ''
                            p['riskLevel'] = ''
                            p['violationKeywords'] = ''
                            p['suggestion'] = ''

                        all_products.append(p)

                    # 每页保存
                    save_to_excel(all_products, violation_products)

                else:
                    logger.warning("未能提取到商品数据")

                # 翻页
                if page < MAX_PAGES:
                    logger.info("翻页...")
                    next_result = client.eval_js(target_id, click_next_page_js())
                    if next_result and next_result.get('success'):
                        time.sleep(3)
                        if not client.wait_for_products(target_id, timeout=10):
                            logger.warning("翻页后加载超时")
                    else:
                        logger.info("没有更多页面")
                        break

            # 关键词间隔
            if keyword_idx < len(KEYWORDS):
                logger.info("等待 2 秒...")
                time.sleep(2)

    finally:
        logger.info("关闭标签页...")
        client.close_tab(target_id)

    # 最终保存
    save_to_excel(all_products, violation_products)

    logger.info("=" * 60)
    logger.info("采集完成!")
    logger.info(f"结束时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    logger.info(f"总商品数: {len(all_products)}")
    logger.info(f"违规商品数: {len(violation_products)}")
    logger.info(f"输出目录: {OUTPUT_DIR}")
    logger.info("=" * 60)


if __name__ == "__main__":
    run_crawler()
