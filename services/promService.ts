import { SearchFilters, ParseResult, Product, ProductAttribute } from "../types";

const parsePrice = (priceStr: string | null | undefined): number => {
    if (!priceStr) return 0;
    const cleanStr = priceStr.replace(/\s+/g, '').replace(/&nbsp;/g, '').replace(/[^0-9.,]/g, '').replace(',', '.');
    return parseFloat(cleanStr) || 0;
};

const fetchHtmlWithRetry = async (url: string): Promise<string> => {
    const urlObj = new URL(url);
    urlObj.searchParams.set('_v', Date.now().toString());
    const finalTargetUrl = urlObj.toString();

    const proxies = [
        (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
        (u: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
        (u: string) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    ];

    const shuffledProxies = [...proxies].sort(() => Math.random() - 0.5);
    let lastError;

    for (const proxyGen of shuffledProxies) {
        try {
            const proxyUrl = proxyGen(finalTargetUrl);
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 20000);

            const response = await fetch(proxyUrl, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (!response.ok) throw new Error(`Status ${response.status}`);
            const text = await response.text();

            if (text.length < 500) throw new Error("Response too short - blocked");
            if (text.includes('captcha') || text.includes('verify you are human')) throw new Error("CAPTCHA detected");

            return text;
        } catch (e) {
            console.warn("Proxy attempt failed for", finalTargetUrl, e);
            lastError = e;
        }
    }
    throw lastError || new Error("Всі проксі-сервери не змогли отримати доступ до сторінки.");
}

const extractFromApollo = (doc: Document, url: string): Partial<Product> | null => {
    try {
        const scripts = doc.querySelectorAll('script');
        for (const script of scripts) {
            const content = script.textContent || "";
            if (content.includes('window.ApolloCacheState')) {
                const match = content.match(/window\.ApolloCacheState\s*=\s*({.+});/);
                if (match && match[1]) {
                    const cache = JSON.parse(match[1]);
                    const productKey = Object.keys(cache).find(k => k.startsWith('ProductCardPageQuery'));

                    if (productKey && cache[productKey]?.result?.product) {
                        const pData = cache[productKey].result.product;
                        let allImages: string[] = [];
                        if (pData.images && Array.isArray(pData.images)) {
                            allImages = pData.images.map((img: any) => img.url || img);
                        } else if (pData.image) {
                            allImages = [pData.image];
                        }

                        let categoryPath: string[] = [];
                        let categoryName = "";
                        if (cache[productKey].result.breadCrumbs?.items) {
                            categoryPath = cache[productKey].result.breadCrumbs.items.map((b: any) => b.caption);
                            if (categoryPath.length > 0) categoryName = categoryPath[categoryPath.length - 1];
                        }

                        const price = parseFloat(pData.price) || pData.discountedPrice;
                        let oldPrice = pData.priceOriginal ? parseFloat(pData.priceOriginal) : undefined;
                        if (oldPrice && oldPrice <= price) oldPrice = undefined;

                        let attributes: ProductAttribute[] = [];
                        if (pData.attributes && Array.isArray(pData.attributes)) {
                            attributes = pData.attributes.map((attr: any) => ({
                                name: attr.name,
                                value: Array.isArray(attr.values) ? attr.values.map((v: any) => v.value).join(', ') : attr.value
                            }));
                        }

                        return {
                            id: pData.id ? String(pData.id) : undefined,
                            title: pData.name,
                            price,
                            oldPrice,
                            currency: "UAH",
                            availability: pData.status === 'available' ? 'В наявності' : (pData.status === 'on_order' ? 'Під замовлення' : 'Немає'),
                            link: url,
                            seller: "Prom Seller",
                            sku: pData.sku,
                            image: allImages[0],
                            allImages,
                            description: pData.descriptionFull || pData.description,
                            attributes,
                            categoryName,
                            categoryPath,
                            detailsLoaded: true
                        };
                    }
                }
            }
        }
    } catch (e) { }
    return null;
}

const extractDetailsFromDoc = (doc: Document, apolloData: any): any => {
    let description = apolloData?.description || "";
    let attributes: ProductAttribute[] = apolloData?.attributes || [];
    let allImages: string[] = apolloData?.allImages || [];
    let categoryName = apolloData?.categoryName || "";
    let categoryPath: string[] = apolloData?.categoryPath || [];
    let oldPrice: number | undefined = apolloData?.oldPrice;
    let sku = apolloData?.sku || "";
    let availability: any = apolloData?.availability;

    if (!description) {
        const descSelectors = ['[data-qaid="descriptions"]', '[data-qaid="product_description"]', '.b-user-content', '.cs-user-content'];
        for (const sel of descSelectors) {
            const el = doc.querySelector(sel);
            if (el) {
                el.querySelectorAll('script, style, [data-qaid="attribute_block"]').forEach(s => s.remove());
                description = el.innerHTML.trim();
                if (description) break;
            }
        }
    }

    const uniqueImages = new Set<string>(allImages);
    doc.querySelectorAll('[data-qaid="image_preview"], .cs-image-holder img, .b-extra-photos img, .b-pictures img, .cs-images img').forEach(img => {
        let src = img.getAttribute('data-src') || img.getAttribute('src');
        if (src && !src.startsWith('data:')) {
            src = src.replace(/_w\d+_h\d+/, '_w640_h640');
            uniqueImages.add(src);
        }
    });
    allImages = Array.from(uniqueImages).filter(img => img);

    if (attributes.length === 0) {
        doc.querySelectorAll('.b-product-info tr, [data-qaid="attribute_block"] tr, .cs-product-info tr, .cs-product-info__row').forEach(row => {
            const cells = row.querySelectorAll('td, .cs-product-info__cell');
            if (cells.length >= 2) {
                const name = cells[0].textContent?.trim();
                const value = cells[1].textContent?.trim();
                if (name && value) attributes.push({ name, value });
            }
        });
    }

    if (!sku) {
        const skuEl = doc.querySelector('[data-qaid="product-sku"], [data-qaid="product_code"], .b-product-data__item_type_sku, .cs-product-data__item_type_sku');
        sku = skuEl?.textContent?.replace(/Код:|Артикул:/g, '').trim() || "";
    }

    if (categoryPath.length === 0) {
        doc.querySelectorAll('[data-qaid="breadcrumbs_seo"] li a, .b-breadcrumb__item a, .cs-breadcrumb__item a').forEach(b => {
            const txt = b.getAttribute('title') || b.textContent?.trim();
            if (txt && !['Головна', 'Каталог товарів', 'Каталог'].includes(txt)) categoryPath.push(txt);
        });
        categoryName = categoryPath[categoryPath.length - 1] || "";
    }

    if (!oldPrice) {
        const oldPriceSelectors = [
            '[data-qaid="old_price"]',
            '[data-qaid="old_product_price"]',
            '.b-goods-price__value_type_old',
            '.b-product-gallery__old-price',
            '.b-product-cost__old-price',
            '.b-product-cost__prev',
            '.cs-goods-price__value_type_old',
            '.cs-goods-price__old',
            'strike',
            'del'
        ];
        for (const sel of oldPriceSelectors) {
            const el = doc.querySelector(sel);
            const val = parsePrice(el?.getAttribute('data-qaprice') || el?.textContent);
            if (val > 0) { oldPrice = val; break; }
        }
    }

    if (!availability) {
        const statusEl = doc.querySelector('[data-qaid="presence_data"], [data-qaid="product_presence"], .b-product-data__item_type_available, .b-goods-data__state, .b-product-status__state, .cs-goods-availability, .cs-goods-data__state, .b-product-gallery__state');
        if (statusEl) {
            const lower = statusEl.textContent?.toLowerCase() || "";
            if (lower.includes("немає")) availability = "Немає";
            else if (lower.includes("замовлення")) availability = "Під замовлення";
            else if (lower.includes("наявності") || lower.includes("готово")) availability = "В наявності";
        }
    }

    return { description, attributes, allImages, categoryName, categoryPath, oldPrice, sku, availability };
};

export const scrapeSingleProduct = async (url: string): Promise<Product | null> => {
    try {
        const targetUrl = url.startsWith('http') ? url : `https://prom.ua${url}`;
        const html = await fetchHtmlWithRetry(targetUrl);
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        const apolloData = extractFromApollo(doc, targetUrl);
        const details = extractDetailsFromDoc(doc, apolloData);

        const title = apolloData?.title || doc.querySelector('h1')?.textContent?.trim() || "No Title";
        const priceEl = doc.querySelector('[data-qaid="product_price"]') ||
            doc.querySelector('.cs-goods-price__value_type_current') ||
            doc.querySelector('.b-goods-price__value_type_current') ||
            doc.querySelector('.b-product-gallery__current-price') ||
            doc.querySelector('.b-product-cost__price');
        const price = apolloData?.price || parsePrice(priceEl?.getAttribute('data-qaprice') || priceEl?.textContent);
        const idMatch = targetUrl.match(/\/p(\d+)/) || targetUrl.match(/-(\d+)\.html/);
        const id = apolloData?.id || (idMatch ? idMatch[1] : Date.now().toString());

        return {
            id,
            externalId: id,
            title,
            price,
            oldPrice: details.oldPrice,
            currency: "UAH",
            availability: details.availability || "Unknown",
            link: targetUrl,
            seller: doc.querySelector('[data-qaid="company_name"]')?.textContent?.trim() || "Seller",
            sku: details.sku,
            image: details.allImages[0] || "",
            allImages: details.allImages,
            description: details.description,
            attributes: details.attributes,
            categoryName: details.categoryName,
            categoryPath: details.categoryPath,
            detailsLoaded: true
        };
    } catch (e) {
        return null;
    }
};

const extractProductsFromCategoryPage = (doc: Document, targetUrl: string): { products: Product[], nextUrlFromDom: string | null } => {
    const cardSelectors = [
        '[data-qaid="product_block"]',
        '[data-qaid="product-block"]',
        '.cs-product-gallery__item',
        '.b-product-gallery__item',
        '.b-goods-gallery__item',
        '.cs-product-list__item',
        '.cs-product-gallery',
        '.b-product-gallery',
        '.b-product-gallery li'
    ];

    const uniqueNodes = new Set<Element>();
    cardSelectors.forEach(sel => doc.querySelectorAll(sel).forEach(el => uniqueNodes.add(el)));

    const products: Product[] = [];
    uniqueNodes.forEach((node) => {
        try {
            const titleEl = node.querySelector('[data-qaid="product_name"], .cs-product-gallery__title, .b-product-gallery__title, .b-goods-title, .cs-goods-title-wrap, a.cs-product-gallery__title');
            const linkEl = node.querySelector('a[href]');
            if (titleEl && linkEl) {
                const title = titleEl.textContent?.trim() || "No Title";
                const href = linkEl.getAttribute('href') || "";
                const link = new URL(href, targetUrl).href;

                // Пріоритет для поточної ціни: спочатку шукаємо .cs-goods-price__value_type_current
                const priceEl = node.querySelector('.cs-goods-price__value_type_current') ||
                    node.querySelector('.b-goods-price__value_type_current') ||
                    node.querySelector('.b-product-gallery__current-price') ||
                    node.querySelector('[data-qaid="product_price"]') ||
                    node.querySelector('.b-product-cost__price') ||
                    node.querySelector('.cs-goods-price__value') ||
                    node.querySelector('.b-goods-price__value') ||
                    node.querySelector('.cs-goods-price__major');
                const price = parsePrice(priceEl?.getAttribute('data-qaprice') || priceEl?.textContent);

                // Пріоритет для старої ціни: спочатку шукаємо .cs-goods-price__value_type_old
                const oldPriceEl = node.querySelector('.cs-goods-price__value_type_old') ||
                    node.querySelector('.b-goods-price__value_type_old') ||
                    node.querySelector('.b-product-gallery__old-price') ||
                    node.querySelector('[data-qaid="price_old"]') ||
                    node.querySelector('[data-qaid="old_price"]') ||
                    node.querySelector('.cs-goods-price__old') ||
                    node.querySelector('strike') ||
                    node.querySelector('del') ||
                    node.querySelector('[data-qaid="discount_label"]'); // Іноді стара ціна поруч зі знижкою
                const oldPrice = oldPriceEl ? parsePrice(oldPriceEl.getAttribute('data-qaprice') || oldPriceEl.textContent) : undefined;

                // Пріоритет для наявності: спочатку шукаємо [data-qaid="presence_data"]
                const statusEl = node.querySelector('[data-qaid="presence_data"]') ||
                    node.querySelector('.cs-goods-data__state') ||
                    node.querySelector('.b-product-gallery__state') ||
                    node.querySelector('.cs-goods-availability') ||
                    node.querySelector('[data-qaid="product_presence"]') ||
                    node.querySelector('.b-goods-data__state');
                let availability: any = "Unknown";
                const lower = statusEl?.textContent?.toLowerCase() || "";
                if (lower.includes("немає")) availability = "Немає";
                else if (lower.includes("замовлення")) availability = "Під замовлення";
                else if (lower.includes("наявності") || lower.includes("готово")) availability = "В наявності";

                const imgEl = node.querySelector('img');
                const image = imgEl?.getAttribute('data-src') || imgEl?.getAttribute('src') || "";

                products.push({
                    id: link,
                    title,
                    price,
                    oldPrice: (oldPrice && oldPrice > price) ? oldPrice : undefined,
                    currency: "UAH",
                    availability,
                    link,
                    seller: node.querySelector('[data-qaid="company_name"]')?.textContent?.trim() || "Seller",
                    image,
                    detailsLoaded: false
                });
            }
        } catch (err) { }
    });

    let nextUrlFromDom: string | null = null;
    const allLinks = Array.from(doc.querySelectorAll('a[href]'));
    for (const a of allLinks) {
        const href = a.getAttribute('href');
        if (!href || ['#', 'javascript:void(0)'].includes(href)) continue;
        const text = a.textContent?.trim() || "";
        const lowerText = text.toLowerCase();
        const classes = a.className || "";

        if (
            text === '›' || text === '»' || text === '→' ||
            lowerText.includes('наступна') || lowerText.includes('далі') || lowerText === 'next' ||
            a.getAttribute('data-qaid') === 'next_page' ||
            a.getAttribute('rel') === 'next' ||
            classes.includes('b-pager__link_pos_last') ||
            classes.includes('cs-pager__link_pos_last')
        ) {
            try {
                const resolved = new URL(href, targetUrl).href;
                if (resolved !== targetUrl) {
                    nextUrlFromDom = resolved;
                    break;
                }
            } catch { }
        }
    }

    return { products, nextUrlFromDom };
}

// Покращена логіка інкрементації URL сторінки
const getNextPageUrl = (currentUrl: string): string => {
    const url = new URL(currentUrl);
    const path = url.pathname;

    // Шукаємо паттерн /page_N
    const pageMatch = path.match(/\/page_(\d+)/);

    if (pageMatch) {
        const currentPage = parseInt(pageMatch[1]);
        const nextPath = path.replace(`/page_${currentPage}`, `/page_${currentPage + 1}`);
        url.pathname = nextPath;
    } else {
        // Якщо page_N немає, додаємо його в кінець шляху (перед query параметрами)
        // Але перевіряємо, чи шлях не закінчується на слеш
        const base = path.endsWith('/') ? path.slice(0, -1) : path;
        url.pathname = `${base}/page_2`;
    }

    return url.toString();
}

export const searchPromUa = async (filters: SearchFilters, onProgress?: (msg: string) => void): Promise<ParseResult> => {
    if (filters.mode === 'products') {
        const validUrls = filters.productUrls.filter(u => u.trim());
        const products: Product[] = [];
        for (let i = 0; i < validUrls.length; i++) {
            if (onProgress) onProgress(`Парсинг товару ${i + 1} з ${validUrls.length}...`);
            const p = await scrapeSingleProduct(validUrls[i].trim());
            if (p) products.push(p);
        }
        return { products };
    }

    let currentUrl: string = filters.shopUrl.trim();
    const maxPages = filters.maxPages || 1;
    const allProducts: Product[] = [];
    const visitedUrls = new Set<string>();

    try {
        for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
            // Запобігаємо нескінченним циклам
            const normUrl = currentUrl.split('?')[0].replace(/\/$/, '');
            if (visitedUrls.has(normUrl)) break;
            visitedUrls.add(normUrl);

            if (onProgress) onProgress(`Обробка сторінки ${pageNum} з ${maxPages}...`);
            console.log(`[Parser] Fetching: ${currentUrl}`);

            const html = await fetchHtmlWithRetry(currentUrl);
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");

            const { products, nextUrlFromDom } = extractProductsFromCategoryPage(doc, currentUrl);

            let added = 0;
            products.forEach(p => {
                if (!allProducts.some(existing => existing.id === p.id)) {
                    allProducts.push(p);
                    added++;
                }
            });

            console.log(`[Parser] Found ${products.length} products. Added ${added} new.`);

            // Якщо на сторінці немає товарів - ймовірно ми вийшли за межі пагінації
            if (products.length === 0) break;

            // Визначаємо URL для наступної ітерації
            if (pageNum < maxPages) {
                // Пріоритет: 1. Посилання з DOM, 2. Автоматична генерація
                if (nextUrlFromDom) {
                    currentUrl = nextUrlFromDom;
                } else {
                    currentUrl = getNextPageUrl(currentUrl);
                }
                await new Promise(r => setTimeout(r, 1500));
            }
        }
        return { products: allProducts };
    } catch (error) {
        console.error("[Parser] Scraping failed:", error);
        if (allProducts.length > 0) return { products: allProducts };
        throw error;
    }
};