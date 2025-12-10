import { SearchFilters, ParseResult, Product, ProductAttribute } from "../types";

const parsePrice = (priceStr: string | null | undefined): number => {
  if (!priceStr) return 0;
  // Normalize spaces (replace &nbsp; and regular spaces), remove non-numeric except dots/commas
  // Example: "1 200,00 грн" -> "1200.00"
  const cleanStr = priceStr.replace(/\s+/g, '').replace(/&nbsp;/g, '').replace(/[^0-9.,]/g, '').replace(',', '.');
  return parseFloat(cleanStr) || 0;
};

const fetchHtmlWithRetry = async (url: string): Promise<string> => {
    // Randomize proxy order to distribute load
    const proxies = [
        (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}&disableCache=${Date.now()}`,
        (u: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
    ];
    
    // Shuffle proxies
    if (Math.random() > 0.5) proxies.reverse();

    let lastError;

    for (const proxyGen of proxies) {
        try {
            const proxyUrl = proxyGen(url);
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

            const response = await fetch(proxyUrl, { signal: controller.signal });
            clearTimeout(timeoutId);

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

                        const price = parseFloat(pData.price) || pData.discountedPrice;
                        let oldPrice = pData.priceOriginal ? parseFloat(pData.priceOriginal) : undefined;
                        
                        // Sanity check for old price
                        if (oldPrice && oldPrice <= price) {
                            oldPrice = undefined;
                        }
                        
                        // Extract attributes from Apollo if available
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
                            attributes, // Use extracted attributes
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

// Internal function to extract details from a Document object (avoids network calls)
const extractDetailsFromDoc = (doc: Document, apolloData: any): { 
    description: string; 
    attributes: ProductAttribute[]; 
    allImages: string[]; 
    categoryName: string;
    categoryPath: string[];
    oldPrice?: number;
    sku?: string;
    availability?: 'В наявності' | 'Під замовлення' | 'Немає' | 'Unknown';
} => {
    let description = apolloData?.description || "";
    let attributes: ProductAttribute[] = apolloData?.attributes || [];
    let allImages: string[] = apolloData?.allImages || [];
    let categoryName = apolloData?.categoryName || "";
    let categoryPath: string[] = apolloData?.categoryPath || [];
    let oldPrice: number | undefined = apolloData?.oldPrice;
    let sku = apolloData?.sku || "";
    let availability: 'В наявності' | 'Під замовлення' | 'Немає' | 'Unknown' | undefined = apolloData?.availability;

    // --- Description Parsing ---
    if (!description) {
        const descSelectors = [
            '[data-qaid="descriptions"]',
            '[data-qaid="product_description"]', 
            '[data-qaid="main_product_description"]',
            '.b-user-content',
        ];
        for (const sel of descSelectors) {
            const el = doc.querySelector(sel);
            if (el) {
                // Remove scripts, styles, and potentially the attribute block if it's nested
                el.querySelectorAll('script, style, [data-qaid="attribute_block"], .b-product-info').forEach(s => s.remove());
                
                el.querySelectorAll('img').forEach(img => {
                    const dataSrc = img.getAttribute('data-src');
                    if (dataSrc) img.setAttribute('src', dataSrc);
                });
                description = el.innerHTML.trim();
                if (description) break;
            }
        }
    }

    // --- Image Parsing ---
    // Use a Set to avoid duplicates and ensure we collect from ALL sources
    const uniqueImages = new Set<string>(allImages);

    // 1. JSON-LD
    const ldScripts = doc.querySelectorAll('script[type="application/ld+json"]');
    ldScripts.forEach(s => {
        try {
            const json = JSON.parse(s.textContent || "{}");
            if ((json['@type'] === 'Product' || json['@type'] === 'Offer') && json.image) {
                if (Array.isArray(json.image)) {
                    json.image.forEach((img: string) => uniqueImages.add(img));
                } else if (typeof json.image === 'string') {
                    uniqueImages.add(json.image);
                }
            }
        } catch (e) {}
    });

    // 2. Standard Prom Gallery
    const galleryImgs = doc.querySelectorAll('[data-qaid="image_preview"]');
    galleryImgs.forEach(img => {
        let src = img.getAttribute('data-src') || img.getAttribute('src');
        if (src) {
            src = src.replace(/_w\d+_h\d+/, '_w640_h640'); 
            uniqueImages.add(src);
        }
    });

    // 3. Custom/Legacy Gallery (.cs-images / .cs-image-holder / .b-extra-photos / .b-pictures / .b-images__item)
    const customSelectors = [
        '.cs-image-holder__image',      // Direct class on img
        '.cs-image-holder img',         // Img inside holder
        '.cs-images__item img',         // Img inside item
        '.cs-images img',               // Fallback
        
        // Support for b-extra-photos structure
        '.b-extra-photos img',
        '.b-extra-photos__item img',
        '.b-extra-photos__link img',

        // Support for b-pictures / b-images structure (requested)
        '.b-pictures img',
        '.b-pictures__link img',
        '.b-pictures__item img',
        '.b-images__item img',
        '.b-images__link img'
    ];
    
    const customGalleryImgs = doc.querySelectorAll(customSelectors.join(', '));
    customGalleryImgs.forEach(img => {
        let src = img.getAttribute('src') || img.getAttribute('data-src');
        if (src) {
             // Force high resolution for these specific gallery images
             // Replaces w140_h140 with w640_h640
             src = src.replace(/_w\d+_h\d+/, '_w640_h640');
             uniqueImages.add(src);
        }
    });

    allImages = Array.from(uniqueImages).filter(img => img && !img.includes('data:'));


    // --- Attributes Parsing ---
    if (attributes.length === 0) {
        // Priority 1: .b-product-info table (custom domains/prom)
        const infoTableRows = doc.querySelectorAll('.b-product-info tr');
        if (infoTableRows.length > 0) {
            infoTableRows.forEach(row => {
                // Skip header rows like "Основні"
                if (row.querySelector('th')) return;

                const cells = row.querySelectorAll('td');
                if (cells.length >= 2) {
                    const name = cells[0].textContent?.trim();
                    const value = cells[1].textContent?.trim();
                    if (name && value) {
                        attributes.push({ name, value });
                    }
                }
            });
        }

        // Priority 2: Standard Prom attribute blocks if table not found or empty
        if (attributes.length === 0) {
            const rows = doc.querySelectorAll('[data-qaid="attribute_block"] tr, [data-qaid="product_attributes"] tr');
            rows.forEach(row => {
                const cells = row.querySelectorAll('td');
                if (cells.length >= 2) {
                     const name = cells[0].textContent?.trim();
                     const value = cells[1].textContent?.trim();
                     if (name && value) attributes.push({ name, value });
                } else {
                    const name = row.querySelector('td:first-child')?.textContent?.trim();
                    const value = row.querySelector('td:last-child')?.textContent?.trim();
                    if (name && value && name !== value) attributes.push({ name, value });
                }
            });
        }
    }

    // --- SKU Parsing ---
    if (!sku) {
        // 1. data-qaid selector
        const skuEl = doc.querySelector('[data-qaid="product-sku"], [data-qaid="product_code"], .b-product-data__item_type_sku');
        if (skuEl) {
            sku = skuEl.textContent?.replace('Код:', '').replace('Артикул:', '').trim() || "";
        }
        
        // 2. Search by text content logic (fallback)
        if (!sku) {
             const allSpans = doc.querySelectorAll('span, div, p, li');
             for (const el of allSpans) {
                 const text = el.textContent?.trim() || "";
                 if (text.startsWith("Код:") || text.startsWith("Артикул:")) {
                     sku = text.split(':')[1]?.trim() || "";
                     if (sku) break;
                 }
             }
        }
    }

    // --- Breadcrumbs Parsing ---
    if (categoryPath.length === 0) {
        const breadcrumbs = doc.querySelectorAll('[data-qaid="breadcrumbs_seo"] li a, .b-breadcrumb__item a');
        if (breadcrumbs.length > 0) {
            breadcrumbs.forEach(b => {
                const txt = b.getAttribute('title') || b.textContent?.trim();
                if (txt && txt !== 'Головна' && txt !== 'Каталог товарів') categoryPath.push(txt);
            });
            categoryName = categoryPath[categoryPath.length - 1] || "";
        }
    }

    // --- Old Price Parsing (Updated) ---
    // Logic: Try Apollo -> Attribute -> Text Content with aggressive selectors
    if (!oldPrice) {
        const oldPriceSelectors = [
            '[data-qaid="old_price"]',
            '[data-qaid="price_old"]',
            '.b-product-cost__prev', // Classic Prom
            '.b-product-cost__old',
            '.old-price',
            '[class*="old-price"]',
            '[class*="old_price"]',
            '[class*="price_old"]',
            '[class*="prev_price"]',
            'strike', 
            'del'
        ];
        
        for (const sel of oldPriceSelectors) {
            const els = doc.querySelectorAll(sel);
            for (const el of els) {
                // Try to get explicit data attribute first
                const attrVal = el.getAttribute('data-qaprice') || el.getAttribute('data-qaprice-old');
                if (attrVal) {
                    const p = parsePrice(attrVal);
                    if (p > 0) {
                        oldPrice = p;
                        break;
                    }
                }
                // Try text content
                const textVal = parsePrice(el.textContent);
                if (textVal > 0) {
                    oldPrice = textVal;
                    break;
                }
            }
            if (oldPrice) break;
        }
    }

    // --- Availability Check ---
    if (!availability) {
        // Specific selector provided by user for availability
        const availableEl = doc.querySelector('.b-product-data__item_type_available');
        if (availableEl) {
             const text = availableEl.textContent?.trim() || "";
             if (text.toLowerCase().includes('наявності')) {
                 availability = 'В наявності';
             }
        }

        if (!availability) {
            const statusEl = doc.querySelector('[data-qaid="product_presence"], [data-qaid="presence_data"]');
            if (statusEl) {
                const rawStatus = statusEl.textContent?.trim() || "";
                if (rawStatus.toLowerCase().includes("наявності") || rawStatus.toLowerCase().includes("готово")) {
                    availability = "В наявності";
                } else if (rawStatus.toLowerCase().includes("замовлення")) {
                    availability = "Під замовлення";
                } else if (rawStatus.toLowerCase().includes("немає")) {
                    availability = "Немає";
                }
            }
        }
    }

    return { description, attributes, allImages, categoryName, categoryPath, oldPrice, sku, availability };
};

export const fetchProductDetails = async (url: string): Promise<{ 
    description: string; 
    attributes: ProductAttribute[]; 
    allImages: string[]; 
    categoryName: string;
    categoryPath: string[];
    oldPrice?: number;
    sku?: string;
    availability?: 'В наявності' | 'Під замовлення' | 'Немає' | 'Unknown';
}> => {
  try {
    const targetUrl = url.startsWith('http') ? url : `https://prom.ua${url}`;
    const html = await fetchHtmlWithRetry(targetUrl);
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const apolloData = extractFromApollo(doc, targetUrl);
    return extractDetailsFromDoc(doc, apolloData);
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
        
        // Pass the ALREADY fetched doc to extract details - saves 1 network request
        const details = extractDetailsFromDoc(doc, apolloData);
        
        const titleEl = doc.querySelector('h1[data-qaid="product_name"], h1');
        const title = apolloData?.title || titleEl?.textContent?.trim() || "No Title";

        const priceEl = doc.querySelector('[data-qaid="product_price"]');
        const price = apolloData?.price || parsePrice(priceEl?.getAttribute('data-qaprice') || priceEl?.textContent);

        const id = apolloData?.id || url.replace(/[^0-9]/g, '').slice(-10) || Date.now().toString();

        let availability: any = "Unknown";
        if (apolloData?.availability) {
            availability = apolloData.availability;
        } else if (details.availability) {
            availability = details.availability;
        } else {
             // Fallback to standard status element if not caught by details
             const statusEl = doc.querySelector('[data-qaid="product_presence"]');
             const rawStatus = statusEl?.textContent?.trim() || "";
             if (rawStatus.toLowerCase().includes("наявності") || rawStatus.toLowerCase().includes("готово")) {
                 availability = "В наявності";
             } else if (rawStatus.toLowerCase().includes("замовлення")) {
                 availability = "Під замовлення";
             } else if (rawStatus.toLowerCase().includes("немає")) {
                 availability = "Немає";
             }
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
    
    // BATCH PROCESSING: Process 5 URLs in parallel to speed up scraping
    const BATCH_SIZE = 5;
    for (let i = 0; i < validUrls.length; i += BATCH_SIZE) {
        const batch = validUrls.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(
            batch.map(url => scrapeSingleProduct(url.trim()))
        );
        
        batchResults.forEach(p => {
            if (p) products.push(p);
        });
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
        
        // Extended old price selectors for category view
        let oldPriceEl = node.querySelector('[data-qaid="price_old"]') 
                         || node.querySelector('.b-product-cost__prev')
                         || node.querySelector('[class*="old-price"]')
                         || node.querySelector('strike');
        
        const statusEl = node.querySelector('[data-qaid="product_presence"]');
        const imgEl = node.querySelector('img');
        const shopEl = node.querySelector('[data-qaid="company_name"]') || node.querySelector('[data-qaid="product_shop_url"]');
        const dataProductId = node.getAttribute('data-product-id');

        const skuEl = node.querySelector('[data-qaid="product_code"], .b-product-gallery__sku');
        const sku = skuEl?.textContent?.replace('Код:', '').trim();

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
          
          let oldPrice = undefined;
          if (oldPriceEl) {
               oldPrice = parsePrice(oldPriceEl.getAttribute('data-qaprice-old') || oldPriceEl.textContent);
          }
          
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
            sku,
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