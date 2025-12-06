import React, { useState } from 'react';
import { SearchFilters, Product } from './types';
import Filters from './components/Filters';
import ProductTable from './components/ProductTable';
import { searchPromUa } from './services/promService';
import { ShoppingBag, Database } from 'lucide-react';

const App: React.FC = () => {
  const [filters, setFilters] = useState<SearchFilters>({
    mode: 'category',
    shopUrl: '',
    productUrls: ['']
  });
  
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async () => {
    setIsLoading(true);
    setError(null);
    setHasSearched(true);
    setProducts([]);

    try {
      const result = await searchPromUa(filters);
      setProducts(result.products);
      
      if (result.products.length === 0) {
        setError("Нічого не знайдено. Перевірте посилання.");
      }
    } catch (err: any) {
      setError(err.message || 'Виникла помилка при отриманні даних.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateProduct = (updatedProduct: Product) => {
    setProducts(prev => prev.map(p => p.id === updatedProduct.id ? updatedProduct : p));
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-12">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-orange-600 p-2 rounded-lg">
              <ShoppingBag className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold text-slate-800">
              Prom.ua <span className="font-normal text-slate-500">Live Parser</span>
            </h1>
          </div>
          <div className="flex items-center gap-2 text-xs font-medium px-3 py-1 bg-slate-100 text-slate-600 rounded-full border border-slate-200 hidden sm:flex">
            <Database className="w-3 h-3" />
            Direct HTML Scraping
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          
          <div className="lg:col-span-1">
            <Filters 
              filters={filters} 
              setFilters={setFilters} 
              onSearch={handleSearch}
              isLoading={isLoading}
            />
          </div>

          <div className="lg:col-span-3">
            {error ? (
              <div className="bg-red-50 border border-red-200 text-red-700 px-6 py-4 rounded-xl flex items-start gap-3">
                <div className="mt-0.5 font-bold">Помилка:</div>
                <div>{error}</div>
              </div>
            ) : (
              <ProductTable 
                products={products}
                hasSearched={hasSearched}
                isLoading={isLoading}
                onProductUpdate={handleUpdateProduct}
              />
            )}
          </div>
          
        </div>
      </main>
    </div>
  );
};

export default App;
