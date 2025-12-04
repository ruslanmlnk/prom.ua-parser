import React from 'react';
import { Search, Link as LinkIcon, RefreshCw, AlertCircle } from 'lucide-react';
import { SearchFilters } from '../types';

interface FiltersProps {
  filters: SearchFilters;
  setFilters: React.Dispatch<React.SetStateAction<SearchFilters>>;
  onSearch: () => void;
  isLoading: boolean;
}

const Filters: React.FC<FiltersProps> = ({ filters, setFilters, onSearch, isLoading }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFilters(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch();
  };

  const isValid = filters.shopUrl?.trim().length > 0;

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 h-fit sticky top-6">
      <div className="flex items-center gap-2 mb-4 text-orange-600">
        <LinkIcon className="w-5 h-5" />
        <h2 className="font-bold text-lg">Парсинг магазину</h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        
        <div>
          <label className="block text-sm font-semibold text-slate-800 mb-2">
            Посилання на категорію або товари
          </label>
          <input
            type="url"
            name="shopUrl"
            value={filters.shopUrl}
            onChange={handleChange}
            placeholder="https://prom.ua/ua/c/..."
            className="w-full pl-3 pr-3 py-3 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-colors text-slate-900 placeholder:text-slate-400 text-sm"
          />
        </div>

        <button
          type="submit"
          disabled={isLoading || !isValid}
          className="w-full flex items-center justify-center gap-2 bg-orange-600 hover:bg-orange-700 text-white font-medium py-3 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-2 shadow-sm"
        >
          {isLoading ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              Обробка сторінки...
            </>
          ) : (
            <>
              <Search className="w-4 h-4" />
              Почати парсинг
            </>
          )}
        </button>
      </form>

      <div className="mt-6 p-4 bg-blue-50 rounded-lg text-sm text-blue-800 border border-blue-100 flex gap-3 items-start">
        <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold mb-1">Інструкція:</p>
          <ol className="list-decimal pl-4 space-y-1 text-xs opacity-90">
            <li>Зайдіть на Prom.ua або сайт магазину на платформі Prom.</li>
            <li>Відкрийте потрібну категорію товарів.</li>
            <li>Скопіюйте посилання з адресного рядка.</li>
            <li>Вставте сюди та натисніть кнопку.</li>
          </ol>
        </div>
      </div>
    </div>
  );
};

export default Filters;