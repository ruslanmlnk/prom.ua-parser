import React, { useState, useEffect } from 'react';
import { ExternalLink, ShoppingCart, AlertCircle, CheckCircle2, Clock, XCircle, ImageOff, FileJson, FileSpreadsheet, CheckSquare, Square, Loader2, Lock, AlertTriangle } from 'lucide-react';
import { Product } from '../types';
import { fetchProductDetails } from '../services/promService';

interface ProductTableProps {
  products: Product[];
  hasSearched: boolean;
  isLoading: boolean;
  onProductUpdate: (product: Product) => void;
}

const toBool = (val: unknown) => {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') {
    const normalized = val.trim().toLowerCase();
    return ['true', '1', 'yes', 'on'].includes(normalized);
  }
  return false;
};

// Use direct property access so Vite replaces at build time.
const rawDemoFlag =
  import.meta.env.VITE_DEMO_MODE ??
  import.meta.env.DEMO_MODE ??
  (typeof process !== 'undefined' ? process.env?.VITE_DEMO_MODE ?? process.env?.DEMO_MODE : undefined);

const IS_DEMO = toBool(rawDemoFlag);
const DEMO_LIMIT = 2;
const DEMO_STORAGE_KEY = 'prom_parser_demo_used';

const ProductTable: React.FC<ProductTableProps> = ({ products, hasSearched, isLoading, onProductUpdate }) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exportingState, setExportingState] = useState<{ type: 'csv' | 'xml', progress: string } | null>(null);
  const [demoLimitReached, setDemoLimitReached] = useState(false);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [products]);

  useEffect(() => {
    if (IS_DEMO) {
      const hasUsed = localStorage.getItem(DEMO_STORAGE_KEY);
      if (hasUsed === 'true') {
        setDemoLimitReached(true);
      }
    }
  }, []);

  const toggleSelectAll = () => {
    if (selectedIds.size === products.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(products.map(p => p.id)));
    }
  };

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const getSelectedProducts = () => {
    return products.filter(p => selectedIds.has(p.id));
  };

  const ensureDetails = async (items: Product[], type: 'csv' | 'xml') => {
    const total = items.length;
    let count = 0;
    const itemsToFetch = items.filter(p => !p.detailsLoaded);
    const finalItems = [...items];

    if (itemsToFetch.length > 0) {
      const batchSize = 3;
      for (let i = 0; i < itemsToFetch.length; i += batchSize) {
        const batch = itemsToFetch.slice(i, i + batchSize);
        await Promise.all(batch.map(async (product) => {
          setExportingState({ 
             type, 
             progress: `Завантаження даних ${count + 1}/${itemsToFetch.length}` 
          });
          
          const details = await fetchProductDetails(product.link);
          
          const combinedImages = Array.from(new Set([product.image || '', ...(details.allImages || [])])).filter(Boolean);

          const updatedProduct: Product = { 
            ...product, 
            description: details.description,
            attributes: details.attributes,
            allImages: combinedImages,
            categoryName: details.categoryName,
            categoryPath: details.categoryPath,
            oldPrice: details.oldPrice || product.oldPrice,
            sku: details.sku || product.sku,
            detailsLoaded: true 
          };
          
          onProductUpdate(updatedProduct);
          
          const idx = finalItems.findIndex(p => p.id === product.id);
          if (idx !== -1) finalItems[idx] = updatedProduct;

          count++;
        }));
      }
    }
    return finalItems;
  };

  const handleDemoRestriction = (items: Product[]) => {
    if (!IS_DEMO) return items;

    const hasUsed = localStorage.getItem(DEMO_STORAGE_KEY) === 'true';
    if (hasUsed || demoLimitReached) {
      alert("У тестовому режимі експорт доступний лише один раз.");
      setDemoLimitReached(true);
      return null;
    }

    if (items.length > DEMO_LIMIT) {
      alert(`Тестовий режим: Буде експортовано лише перші ${DEMO_LIMIT} товари.`);
      return items.slice(0, DEMO_LIMIT);
    }

    return items;
  };

  const markDemoAsUsed = () => {
    if (IS_DEMO) {
      localStorage.setItem(DEMO_STORAGE_KEY, 'true');
      setDemoLimitReached(true);
    }
  };
  
  const downloadCSV = async () => {
    const selected = getSelectedProducts();
    if (!selected.length) return;

    const itemsToProcess = handleDemoRestriction(selected);
    if (!itemsToProcess) return;

    setExportingState({ type: 'csv', progress: 'Підготовка...' });
    
    const itemsToExport = await ensureDetails(itemsToProcess, 'csv');

    const headers = [
      "Код_товару", 
      "Назва_позиції", 
      "Пошукові_запити",
      "Опис", 
      "Тип_товару",
      "Ціна", 
      "Валюта", 
      "Одиниця_виміру", 
      "Посилання_на_зображення", 
      "Наявність", 
      "Назва_групи", 
      "Виробник",
      "Знижка",
      "Стара_ціна",
      "Артикул",
      "Характеристики" 
    ];

    const csvContent = [
      headers.join(","),
      ...itemsToExport.map(p => {
        const safeTitle = `"${p.title.replace(/"/g, '""')}"`;
        const category = (p.categoryPath && p.categoryPath.length > 0) 
            ? p.categoryPath[p.categoryPath.length - 1] 
            : (p.categoryName?.trim() || "Загальна група");
        const safeCategory = `"${category.replace(/"/g, '""')}"`;
        
        const safeDesc = `"${(p.description || '').replace(/"/g, '""')}"`;
        
        const attrsStr = p.attributes?.map(a => `${a.name}|${a.value}`).join('||') || '';
        const safeAttrs = `"${attrsStr.replace(/"/g, '""')}"`;
        
        const imagesStr = (p.allImages && p.allImages.length > 0 ? p.allImages : [p.image]).join(', ');
        const safeImages = `"${imagesStr.replace(/"/g, '""')}"`;
        
        const id = p.externalId || p.id.replace(/[^0-9]/g, '').slice(0, 10) || Date.now().toString();
        const sku = `"${(p.sku || '').replace(/"/g, '""')}"`;
        const oldPriceVal = p.oldPrice ? p.oldPrice : '';
        const discountVal = p.oldPrice && p.oldPrice > p.price ? (p.oldPrice - p.price) : '';

        return [
            `"${id}"`, 
            safeTitle, 
            "", 
            safeDesc, 
            "r", 
            p.price, 
            "UAH", 
            "шт.",
            safeImages, 
            p.availability === 'В наявності' ? '+' : '-', 
            safeCategory,
            "", 
            discountVal,
            oldPriceVal,
            sku,
            safeAttrs
        ].join(",");
      })
    ].join("\n");

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `prom_export_full_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    markDemoAsUsed();
    setExportingState(null);
  };

  const downloadXML = async () => {
    const selected = getSelectedProducts();
    if (!selected.length) return;

    const itemsToProcess = handleDemoRestriction(selected);
    if (!itemsToProcess) return;

    setExportingState({ type: 'xml', progress: 'Підготовка...' });

    const itemsToExport = await ensureDetails(itemsToProcess, 'xml');

    const categoriesMap = new Map<string, number>();
    let catCounter = 1;
    categoriesMap.set("Загальна група", catCounter++);

    itemsToExport.forEach(p => {
        const catName = (p.categoryPath && p.categoryPath.length > 0) 
            ? p.categoryPath[p.categoryPath.length - 1] 
            : (p.categoryName?.trim() || "Загальна група");
            
        if (!categoriesMap.has(catName)) {
            categoriesMap.set(catName, catCounter++);
        }
    });

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<yml_catalog date="${new Date().toISOString().slice(0, 19).replace('T', ' ')}">
  <shop>
    <name>Exported Data</name>
    <company>Prom Parser</company>
    <url>http://prom.ua</url>
    <currencies>
      <currency id="UAH" rate="1"/>
    </currencies>
    <categories>
`;
    categoriesMap.forEach((id, name) => {
        xml += `      <category id="${id}">${name.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</category>\n`;
    });

    xml += `    </categories>
    <offers>
`;

    itemsToExport.forEach(p => {
      const available = p.availability === 'В наявності'; 
      const descContent = p.description || "";
      
      const catName = (p.categoryPath && p.categoryPath.length > 0) 
            ? p.categoryPath[p.categoryPath.length - 1] 
            : (p.categoryName?.trim() || "Загальна група");
      const catId = categoriesMap.get(catName);
      
      const id = p.externalId || p.id.replace(/[^a-zA-Z0-9]/g, '');

      xml += `    <offer id="${id}" available="${available}">
      <name>${p.title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</name>
      <price>${p.price}</price>
`;
      if (p.oldPrice && p.oldPrice > p.price) {
          xml += `      <oldprice>${p.oldPrice}</oldprice>\n`;
      }
      
      xml += `      <currencyId>UAH</currencyId>
      <categoryId>${catId}</categoryId>
`;
      
      if (p.allImages && p.allImages.length > 0) {
          p.allImages.forEach(img => {
               xml += `      <picture>${img}</picture>\n`;
          });
      } else if (p.image) {
          xml += `      <picture>${p.image}</picture>\n`;
      }

      xml += `      <url>${p.link}</url>
      <vendor>${p.seller.replace(/&/g, '&amp;')}</vendor>
`;
      if (p.sku) {
          xml += `      <vendorCode>${p.sku.replace(/&/g, '&amp;')}</vendorCode>\n`;
      }

      xml += `      <description><![CDATA[${descContent}]]></description>
`;
      if (p.attributes) {
        p.attributes.forEach(attr => {
           xml += `      <param name="${attr.name.replace(/"/g, '&quot;')}">${attr.value.replace(/&/g, '&amp;')}</param>\n`;
        });
      }
      if (p.sku) {
           xml += `      <param name="Артикул">${p.sku.replace(/&/g, '&amp;')}</param>\n`;
      }

      xml += `      <param name="Condition">New</param>
    </offer>
`;
    });

    xml += `  </offers>
  </shop>
</yml_catalog>`;

    const blob = new Blob([xml], { type: 'application/xml;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `prom_export_full_${new Date().toISOString().slice(0,10)}.xml`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    markDemoAsUsed();
    setExportingState(null);
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 flex flex-col items-center justify-center min-h-[400px]">
        <Loader2 className="w-12 h-12 text-orange-600 animate-spin mb-4" />
        <h3 className="text-lg font-medium text-slate-800">Завантаження...</h3>
        <p className="text-slate-500 mt-2">Отримуємо список товарів</p>
      </div>
    );
  }

  if (!hasSearched) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 flex flex-col items-center justify-center min-h-[400px] text-center">
        <div className="w-16 h-16 bg-orange-50 rounded-full flex items-center justify-center mb-4">
          <ShoppingCart className="w-8 h-8 text-orange-600" />
        </div>
        <h2 className="text-xl font-bold text-slate-800 mb-2">Парсер Prom.ua</h2>
        <p className="text-slate-500 max-w-md">
          Вставте посилання зліва та натисніть "Почати парсинг".
        </p>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 flex flex-col items-center justify-center min-h-[400px] text-center">
        <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mb-4">
          <AlertCircle className="w-8 h-8 text-red-500" />
        </div>
        <h2 className="text-xl font-bold text-slate-800 mb-2">Нічого не знайдено</h2>
        <p className="text-slate-500 max-w-md">
          Сайт не повернув товарів за цим посиланням.
        </p>
      </div>
    );
  }

  const getAvailabilityBadge = (status: string) => {
    const s = status.toLowerCase();
    if (s.includes('наявності')) {
      return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800"><CheckCircle2 className="w-3 h-3"/> Є в наявності</span>;
    } else if (s.includes('замовлення')) {
      return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800"><Clock className="w-3 h-3"/> Під замовлення</span>;
    } else {
      return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800"><XCircle className="w-3 h-3"/> {status || 'Немає'}</span>;
    }
  };

  const isAllSelected = products.length > 0 && selectedIds.size === products.length;

  return (
    <div className="space-y-6">
      {IS_DEMO && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-3 text-amber-800 text-sm">
           <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600" />
           <div>
              <p className="font-bold">Увага: Тестовий режим</p>
              <p className="opacity-90 mt-0.5">
                Експорт обмежено до <strong>{DEMO_LIMIT} товарів</strong>. Ви можете виконати експорт лише <strong>один раз</strong>.
                {demoLimitReached && <span className="block mt-1 text-red-600 font-bold">Ліміт вичерпано.</span>}
              </p>
           </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex flex-col sm:flex-row justify-between items-center gap-4 sticky top-24 z-10">
        <div className="flex items-center gap-3">
           <h3 className="font-semibold text-slate-800">Результати: {products.length}</h3>
           {selectedIds.size > 0 && (
             <span className="bg-orange-100 text-orange-800 text-xs font-bold px-2 py-1 rounded-md border border-orange-200">
               Вибрано: {selectedIds.size}
             </span>
           )}
        </div>
        
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button 
            onClick={downloadCSV}
            disabled={selectedIds.size === 0 || exportingState !== null || (IS_DEMO && demoLimitReached)}
            className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 text-white text-sm font-medium rounded-lg transition-colors min-w-[160px] 
              ${(IS_DEMO && demoLimitReached) ? 'bg-slate-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700 disabled:bg-slate-300 disabled:cursor-not-allowed'}`}
          >
            {exportingState?.type === 'csv' ? (
               <><Loader2 className="w-4 h-4 animate-spin"/> {exportingState.progress}</>
            ) : (
               <>{(IS_DEMO && demoLimitReached) ? <Lock className="w-4 h-4" /> : <FileSpreadsheet className="w-4 h-4" />} Експорт CSV (Max)</>
            )}
          </button>
          <button 
            onClick={downloadXML}
            disabled={selectedIds.size === 0 || exportingState !== null || (IS_DEMO && demoLimitReached)}
            className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 text-white text-sm font-medium rounded-lg transition-colors min-w-[160px]
              ${(IS_DEMO && demoLimitReached) ? 'bg-slate-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed'}`}
          >
             {exportingState?.type === 'xml' ? (
               <><Loader2 className="w-4 h-4 animate-spin"/> {exportingState.progress}</>
            ) : (
               <>{(IS_DEMO && demoLimitReached) ? <Lock className="w-4 h-4" /> : <FileJson className="w-4 h-4" />} Експорт XML (Max)</>
            )}
          </button>
        </div>
      </div>
      
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white border-b border-slate-200">
                <th className="px-4 py-3 w-[50px] text-center">
                  <button onClick={toggleSelectAll} className="text-slate-500 hover:text-slate-700 transition-colors">
                    {isAllSelected ? <CheckSquare className="w-5 h-5 text-orange-600" /> : <Square className="w-5 h-5" />}
                  </button>
                </th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider w-[100px]">Фото</th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider w-1/3">Назва товару</th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Ціна</th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Статус</th>
                <th className="px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Посилання</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {products.map((product, idx) => {
                const isSelected = selectedIds.has(product.id);
                return (
                  <tr 
                    key={product.id} 
                    className={`transition-colors cursor-pointer ${isSelected ? 'bg-orange-50' : 'hover:bg-slate-50'}`}
                    onClick={() => toggleSelect(product.id)}
                  >
                    <td className="px-4 py-4 text-center" onClick={(e) => e.stopPropagation()}>
                       <button onClick={() => toggleSelect(product.id)} className="text-slate-400 hover:text-slate-600">
                         {isSelected ? <CheckSquare className="w-5 h-5 text-orange-600" /> : <Square className="w-5 h-5" />}
                       </button>
                    </td>
                    <td className="px-6 py-4">
                       <div className="w-16 h-16 rounded-lg border border-slate-200 bg-white overflow-hidden flex items-center justify-center shrink-0">
                          {product.image && product.image !== 'https://placehold.co/100x100?text=No+Image' ? (
                             <img 
                                src={product.image} 
                                alt={product.title} 
                                className="w-full h-full object-contain"
                                onError={(e) => {
                                   (e.target as HTMLImageElement).style.display = 'none';
                                   (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                                }}
                             />
                          ) : (
                            <div className="flex flex-col items-center justify-center text-slate-300">
                               <ImageOff className="w-6 h-6" />
                            </div>
                          )}
                          <div className="hidden flex flex-col items-center justify-center text-slate-300">
                             <ImageOff className="w-6 h-6" />
                          </div>
                       </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-slate-900 line-clamp-2" title={product.title}>
                          {product.title}
                        </span>
                        <div className="flex flex-wrap gap-2 mt-1">
                             <span className="text-xs text-slate-400">{product.seller}</span>
                             {product.sku && (
                                <span className="text-xs text-slate-500 font-mono bg-slate-100 px-1 rounded">Арт: {product.sku}</span>
                             )}
                        </div>
                        {product.detailsLoaded && (
                            <span className="text-[10px] text-green-600 font-medium mt-1">✓ Макс. дані (Опис, Фото, Категорії)</span>
                        )}
                        {product.externalId && (
                           <span className="text-[10px] text-slate-300 mt-0.5">ID: {product.externalId}</span>
                        )}
                        <span className="text-[10px] text-slate-400 mt-0.5">
                            {product.categoryPath && product.categoryPath.length > 0 
                                ? product.categoryPath.join(' > ') 
                                : (product.categoryName || 'Категорія не визначена')}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className={`text-sm font-bold ${product.oldPrice ? 'text-red-600' : 'text-orange-600'}`}>
                            {product.price.toLocaleString('uk-UA')} ₴
                        </span>
                        {product.oldPrice && product.oldPrice > product.price && (
                            <span className="text-xs text-slate-400 line-through">
                                {product.oldPrice.toLocaleString('uk-UA')} ₴
                            </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getAvailabilityBadge(product.availability)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <a
                        href={product.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Перейти <ExternalLink className="w-3 h-3" />
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ProductTable;
