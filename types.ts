export interface ProductAttribute {
  name: string;
  value: string;
}

export interface Product {
  id: string;
  externalId?: string;
  title: string;
  price: number;
  oldPrice?: number;
  currency: string;
  availability: 'В наявності' | 'Під замовлення' | 'Немає' | 'Unknown';
  link: string;
  seller: string;
  sku?: string;
  image?: string;
  allImages?: string[];
  description?: string;
  attributes?: ProductAttribute[];
  categoryId?: string;
  categoryName?: string;
  categoryPath?: string[];
  detailsLoaded?: boolean;
}

export interface SearchFilters {
  mode: 'category' | 'products';
  shopUrl: string;       // For category parsing
  productUrls: string[]; // For specific product parsing
}

export interface ParseResult {
  products: Product[];
}