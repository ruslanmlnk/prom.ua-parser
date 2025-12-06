import { SearchFilters, ParseResult, Product, ProductAttribute } from "../types";

const parsePrice = (priceStr: string | null | undefined): number => {
  if (!priceStr) return 0;
  return parseFloat(priceStr.replace(/[^0-9.,]/g, '').replace(',', '.')) || 0;
};

const fetchHtmlWithRetry = async (url: string): Promise<string> => {
    const proxies = [
        (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}&disableCache=${Date.now()}`,
        (u: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
    ];

    let lastError;

    for (const proxyGen of proxies) {
        try {
            const proxyUrl = proxyGen(url);
            const response = await fetch(proxyUrl);
            if (!response.ok) throw new Error(`Status ${response.status}`);
            const text = await response.text();
            if (text.length < 100) throw new Error("Empty response");
            return text;
        } catch (e) {
            console.warn("Proxy attempt failed", e);
            lastError = e;
        }
    }
    throw lastError || new Error("All proxies failed");
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
                             if(categoryPath.length > 0) categoryName = categoryPath[categoryPath.length - 1];
                        }

                        const oldPrice = pData.priceOriginal > pData.discountedPrice ? parseFloat(pData.priceOriginal) : undefined;
                        
                        return {
                            id: pData.id ? String(pData.id) : undefined,
                            title: pData.name,
                            price: parseFloat(pData.price) || pData.discountedPrice,
                            oldPrice,
                            currency: "UAH",
                            availability: pData.status === 'available' ? 'В наявності' : (pData.status === 'on_order' ? 'Під замовлення' : 'Немає'),
                            link: url,
                            seller: "Prom Seller", 
                            sku: pData.sku,
                            image: allImages[0],
                            allImages,
                            description: pData.descriptionFull || pData.description,
                            categoryName,
                            categoryPath,
                            detailsLoaded: true
                        };
                    }
                }
            }
        }
    } catch (e) {
        console.warn("Apollo extraction failed", e);
    }
    return null;
}

export const fetchProductDetails = async (url: string): Promise<{ 
    description: string; 
    attributes: ProductAttribute[]; 
    allImages: string[]; 
    categoryName: string;
    categoryPath: string[];
    oldPrice?: number;
    sku?: string;
}> => {
  try {
    const targetUrl = url.startsWith('http') ? url : `https://prom.ua${url}`;
    const html = await fetchHtmlWithRetry(targetUrl);
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    const apolloData = extractFromApollo(doc, targetUrl);
    
    let description = apolloData?.description || "";
    let attributes: ProductAttribute[] = [];
    let allImages: string[] = apolloData?.allImages || [];
    let categoryName = apolloData?.categoryName || "";
    let categoryPath: string[] = apolloData?.categoryPath || [];
    let oldPrice: number | undefined = apolloData?.oldPrice;
    let sku = apolloData?.sku || "";

    if (!description) {
        const descSelectors = [
            '[data-qaid="descriptions"]',
            '[data-qaid="product_description"]', 
            '[data-qaid="main_product_description"]',
            '.b-user-content',
            '[data-qaid="attribute_block"] + div' 
        ];
        for (const sel of descSelectors) {
            const el = doc.querySelector(sel);
            if (el) {
                el.querySelectorAll('script, style').forEach(s => s.remove());
                el.querySelectorAll('img').forEach(img => {
                    const dataSrc = img.getAttribute('data-src');
                    if (dataSrc) img.setAttribute('src', dataSrc);
                });
                description = el.innerHTML.trim();
                if (description) break;
            }
        }
    }

    if (allImages.length === 0) {
        const ldScripts = doc.querySelectorAll('script[type="application/ld+json"]');
        ldScripts.forEach(s => {
            try {
                const json = JSON.parse(s.textContent || "{}");
                if ((json['@type'] === 'Product' || json['@type'] === 'Offer') && json.image) {
                    if (Array.isArray(json.image)) allImages = json.image;
                    else if (typeof json.image === 'string') allImages.push(json.image);
                }
            } catch (e) {}
        });

        if (allImages.length === 0) {
            const galleryImgs = doc.querySelectorAll('[data-qaid="image_preview"]');
            galleryImgs.forEach(img => {
                let src = img.getAttribute('data-src') || img.getAttribute('src');
                if (src) {
                    src = src.replace(/_w\d+_h\d+/, '_w640_h640'); 
                    if (!allImages.includes(src)) allImages.push(src);
                }
            });
        }
    }

    if (attributes.length === 0) {
        const rows = doc.querySelectorAll('[data-qaid="attribute_block"] tr, [data-qaid="product_attributes"] tr');
        rows.forEach(row => {
            const name = row.querySelector('td:first-child')?.textContent?.trim();
            const value = row.querySelector('td:last-child')?.textContent?.trim();
            if (name && value) attributes.push({ name, value });
        });
    }

    if (!sku) {
        const skuEl = doc.querySelector('[data-qaid="product-sku"]');
        if (skuEl) {
            sku = skuEl.textContent?.replace('Код:', '').trim() || "";
        }
    }

    if (categoryPath.length === 0) {
        const breadcrumbs = doc.querySelectorAll('[data-qaid="breadcrumbs_seo"] li a');
        if (breadcrumbs.length > 0) {
            breadcrumbs.forEach(b => {
                const txt = b.getAttribute('title') || b.textContent?.trim();
                if (txt && txt !== 'Головна' && txt !== 'Каталог товарів') categoryPath.push(txt);
            });
            categoryName = categoryPath[categoryPath.length - 1] || "";
        }
    }

    if (!oldPrice) {
        const oldPriceEl = doc.querySelector('[data-qaid="old_price"]');
        if (oldPriceEl) {
            oldPrice = parsePrice(oldPriceEl.getAttribute('data-qaprice'));
        }
    }

    return { description, attributes, allImages, categoryName, categoryPath, oldPrice, sku };

  } catch (error) {
    console.warn("Failed to fetch details for", url, error);
    return { description: "", attributes: [], allImages: [], categoryName: "", categoryPath: [] };
  }
};

const scrapeSingleProduct = async (url: string): Promise<Product | null> => {
    try {
        const targetUrl = url.startsWith('http') ? url : `https://prom.ua${url}`;
        const html = await fetchHtmlWithRetry(targetUrl);
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");

        const apolloData = extractFromApollo(doc, targetUrl);

        const details = await fetchProductDetails(targetUrl); 
        
        const titleEl = doc.querySelector('h1[data-qaid="product_name"], h1');
        const title = apolloData?.title || titleEl?.textContent?.trim() || "No Title";

        const priceEl = doc.querySelector('[data-qaid="product_price"]');
        const price = apolloData?.price || parsePrice(priceEl?.getAttribute('data-qaprice') || priceEl?.textContent);

        const id = apolloData?.id || url.replace(/[^0-9]/g, '').slice(-10) || Date.now().toString();

        const statusEl = doc.querySelector('[data-qaid="product_presence"]');
        const rawStatus = statusEl?.textContent?.trim() || "";
        let availability: any = "Unknown";
        if (apolloData?.availability) {
            availability = apolloData.availability;
        } else if (rawStatus.toLowerCase().includes("наявності") || rawStatus.toLowerCase().includes("готово")) {
            availability = "В наявності";
        } else if (rawStatus.toLowerCase().includes("замовлення")) {
            availability = "Під замовлення";
        } else if (rawStatus.toLowerCase().includes("немає")) {
            availability = "Немає";
        }

        const sellerEl = doc.querySelector('[data-qaid="company_name"]');
        const seller = sellerEl?.textContent?.trim() || "Seller";

        return {
            id,
            externalId: id,
            title,
            price,
            oldPrice: details.oldPrice,
            currency: "UAH",
            availability,
            link: targetUrl,
            seller,
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
        console.error("Single product scrape error", url, e);
        return null;
    }
};

export const searchPromUa = async (filters: SearchFilters): Promise<ParseResult> => {
  if (filters.mode === 'products') {
    if (!filters.productUrls || filters.productUrls.filter(u => u.trim()).length === 0) {
        throw new Error("Не вказано жодного посилання на товар.");
    }
    
    const validUrls = filters.productUrls.filter(u => u.trim());
    const products: Product[] = [];
    
    // Process sequentially or in small batches to avoid blocking
    for (const url of validUrls) {
        const product = await scrapeSingleProduct(url.trim());
        if (product) products.push(product);
    }
    
    return { products };
  }

  // Existing Category Mode Logic
  if (!filters.shopUrl) {
      throw new Error("Не вказано посилання на категорію");
  }

  const targetUrl = filters.shopUrl.trim();
  
  try {
    const html = await fetchHtmlWithRetry(targetUrl);
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    const productNodes = doc.querySelectorAll('[data-qaid="product_block"]');
    const products: Product[] = [];

    productNodes.forEach((node) => {
      try {
        const titleEl = node.querySelector('[data-qaid="product_name"]');
        const linkEl = node.querySelector('[data-qaid="product_link"]');
        const priceEl = node.querySelector('[data-qaid="product_price"]');
        const oldPriceEl = node.querySelector('[data-qaid="price_old"]'); 
        
        const statusEl = node.querySelector('[data-qaid="product_presence"]');
        const imgEl = node.querySelector('img');
        const shopEl = node.querySelector('[data-qaid="company_name"]') || node.querySelector('[data-qaid="product_shop_url"]');
        const dataProductId = node.getAttribute('data-product-id');

        if (titleEl && linkEl) {
          const title = titleEl.getAttribute('title') || titleEl.textContent?.trim() || "No Title";
          
          let link = linkEl.getAttribute('href') || "";
          if (link.startsWith('/')) {
             try {
                const shopUrlObj = new URL(targetUrl);
                link = `${shopUrlObj.origin}${link}`;
             } catch {
                link = `https://prom.ua${link}`;
             }
          } else if (!link.startsWith('http')) {
             link = `https://prom.ua${link}`;
          }

          const price = parsePrice(priceEl?.getAttribute('data-qaprice') || priceEl?.textContent);
          let oldPrice = oldPriceEl ? parsePrice(oldPriceEl.getAttribute('data-qaprice-old') || oldPriceEl.textContent) : undefined;
          
          if (oldPrice && oldPrice <= price) oldPrice = undefined;

          const rawStatus = statusEl?.textContent?.trim() || "";
          let availability: any = "Unknown";
          if (rawStatus.toLowerCase().includes("наявності") || rawStatus.toLowerCase().includes("готово")) {
            availability = "В наявності";
          } else if (rawStatus.toLowerCase().includes("замовлення")) {
            availability = "Під замовлення";
          } else if (rawStatus.toLowerCase().includes("немає") || rawStatus.toLowerCase().includes("закінчи")) {
            availability = "Немає";
          }

          const seller = shopEl?.getAttribute('title') || shopEl?.textContent?.trim() || "Prom Seller";

          let image = "";
          if (imgEl) {
             const src = imgEl.getAttribute('src');
             const dataSrc = imgEl.getAttribute('data-src');
             if (src && !src.startsWith('data:') && src.startsWith('http')) {
               image = src;
             } else if (dataSrc && dataSrc.startsWith('http')) {
               image = dataSrc;
             }
          }
          if (!image) image = "https://placehold.co/100x100?text=No+Image";

          const id = dataProductId || link;

          products.push({
            id: id,
            externalId: dataProductId || undefined,
            title,
            price,
            oldPrice,
            currency: "UAH",
            availability,
            link,
            seller,
            image,
            allImages: [image], 
            description: "", 
            attributes: [],
            detailsLoaded: false
          });
        }
      } catch (err) {
        console.warn("Skipped a malformed product node", err);
      }
    });

    return { products };

  } catch (error) {
    console.error("Scraping failed:", error);
    throw new Error("Не вдалося завантажити дані. Перевірте посилання. Деякі магазини можуть блокувати доступ через проксі.");
  }
};