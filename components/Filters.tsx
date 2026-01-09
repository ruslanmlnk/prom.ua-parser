// Fix: Added missing React import to resolve namespace errors for React.FC, React.Dispatch, React.SetStateAction, React.ChangeEvent, and React.FormEvent.
import React from 'react';
import { Search, Link as LinkIcon, RefreshCw, AlertCircle, Plus, Trash2, List, Grid, Layers } from 'lucide-react';
import { SearchFilters } from '../types';

interface FiltersProps {
  filters: SearchFilters;
  setFilters: React.Dispatch<React.SetStateAction<SearchFilters>>;
  onSearch: () => void;
  isLoading: boolean;
}

const Filters: React.FC<FiltersProps> = ({ filters, setFilters, onSearch, isLoading }) => {
  const handleModeChange = (mode: 'category' | 'products') => {
    setFilters(prev => ({ ...prev, mode }));
  };

  const handleShopUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFilters(prev => ({ ...prev, shopUrl: e.target.value }));
  };

  const handleMaxPagesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    const normalized = Number.isFinite(val) ? Math.max(1, val) : 1;
    setFilters(prev => ({ ...prev, maxPages: normalized }));
  };

  const handleProductUrlChange = (index: number, value: string) => {
    const newUrls = [...filters.productUrls];
    newUrls[index] = value;
    setFilters(prev => ({ ...prev, productUrls: newUrls }));
  };

  const addProductUrl = () => {
    setFilters(prev => ({ ...prev, productUrls: [...prev.productUrls, ''] }));
  };

  const removeProductUrl = (index: number) => {
    const newUrls = filters.productUrls.filter((_, i) => i !== index);
    setFilters(prev => ({ ...prev, productUrls: newUrls }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch();
  };

  const isValid = filters.mode === 'category' 
    ? filters.shopUrl?.trim().length > 0
    : filters.productUrls.some(url => url.trim().length > 0);

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 h-fit sticky top-6">
      <div className="flex items-center gap-2 mb-4 text-orange-600">
        <LinkIcon className="w-5 h-5" />
        <h2 className="font-bold text-lg">Налаштування парсингу</h2>
      </div>

      <div className="flex bg-slate-100 p-1 rounded-lg mb-4">
        <button
          onClick={() => handleModeChange('category')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-md transition-all ${
            filters.mode === 'category' 
              ? 'bg-white text-slate-900 shadow-sm' 
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <Grid className="w-4 h-4" /> Категорія
        </button>
        <button
          onClick={() => handleModeChange('products')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-md transition-all ${
            filters.mode === 'products' 
              ? 'bg-white text-slate-900 shadow-sm' 
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <List className="w-4 h-4" /> Список товарів
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        
        {filters.mode === 'category' ? (
          <>
            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-2">
                Посилання на категорію (Prom.ua)
              </label>
              <input
                type="url"
                value={filters.shopUrl}
                onChange={handleShopUrlChange}
                placeholder="https://prom.ua/ua/c/..."
                className="w-full pl-3 pr-3 py-3 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-colors text-slate-900 placeholder:text-slate-400 text-sm"
              />
              <p className="text-xs text-slate-500 mt-2">
                Вставте посилання на сторінку категорії.
              </p>
            </div>
            
            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-2 flex items-center gap-2">
                <Layers className="w-4 h-4" /> Кількість сторінок
              </label>
              <input
                type="number"
                min="1"
                value={filters.maxPages || 1}
                onChange={handleMaxPagesChange}
                className="w-full pl-3 pr-3 py-2 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-colors text-slate-900 text-sm"
              />
              <p className="text-xs text-slate-500 mt-2">
                Вкажіть скільки сторінок потрібно обробити.
              </p>
            </div>
          </>
        ) : (
          <div>
             <label className="block text-sm font-semibold text-slate-800 mb-2">
              Посилання на окремі товари
            </label>
            <div className="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar pr-1">
              {filters.productUrls.map((url, index) => (
                <div key={index} className="flex gap-2">
                  <input
                    type="url"
                    value={url}
                    onChange={(e) => handleProductUrlChange(index, e.target.value)}
                    placeholder="https://..."
                    className="flex-1 pl-3 pr-3 py-2 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-colors text-slate-900 placeholder:text-slate-400 text-sm"
                  />
                  {filters.productUrls.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeProductUrl(index)}
                      className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addProductUrl}
              className="mt-3 w-full flex items-center justify-center gap-1.5 py-2 border border-dashed border-slate-300 rounded-lg text-slate-600 text-sm hover:border-orange-500 hover:text-orange-600 hover:bg-orange-50 transition-colors"
            >
              <Plus className="w-4 h-4" /> Додати ще посилання
            </button>
          </div>
        )}

        <button
          type="submit"
          disabled={isLoading || !isValid}
          className="w-full flex items-center justify-center gap-2 bg-orange-600 hover:bg-orange-700 text-white font-medium py-3 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-4 shadow-sm"
        >
          {isLoading ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              Обробка...
            </>
          ) : (
            <>
              <Search className="w-4 h-4" />
              {filters.mode === 'category' ? 'Парсити' : 'Парсити товари'}
            </>
          )}
        </button>
      </form>

      <div className="mt-6 p-4 bg-blue-50 rounded-lg text-sm text-blue-800 border border-blue-100 flex gap-3 items-start">
        <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold mb-1">Підказка:</p>
          <ul className="list-disc pl-4 space-y-1 text-xs opacity-90">
            {filters.mode === 'category' ? (
              <>
                <li>Парсер автоматично шукає кнопку "Наступна сторінка".</li>
                <li>Переконайтеся, що вказано <strong>Кількість сторінок</strong> більше 1.</li>
                <li>Деякі сайти можуть потребувати сортування для стабільної роботи.</li>
              </>
            ) : (
              <>
                <li>Додавайте прямі посилання на товари.</li>
                <li>Підтримуються Prom.ua та зовнішні сайти.</li>
              </>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
};

export default Filters;
