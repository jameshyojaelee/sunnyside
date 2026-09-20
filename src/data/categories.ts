export const CATEGORY_IDS = ['coffee', 'bakery', 'dessert', 'restaurant', 'bar', 'grocery', 'shop', 'service', 'other'] as const;
export type Category = (typeof CATEGORY_IDS)[number];

export interface CategoryStyle {
  label: string;
  /** Awning and sign color. */
  color: string;
}

export const CATEGORIES: Record<Category, CategoryStyle> = {
  coffee: { label: 'Coffee', color: '#7b4a2b' },
  bakery: { label: 'Bakery', color: '#d8872f' },
  dessert: { label: 'Dessert', color: '#d6588f' },
  restaurant: { label: 'Restaurant', color: '#c23b2e' },
  bar: { label: 'Bar', color: '#6b3fa3' },
  grocery: { label: 'Grocery & Deli', color: '#2f8a4f' },
  shop: { label: 'Shop', color: '#2f6db5' },
  service: { label: 'Service', color: '#2d8c96' },
  other: { label: 'Other', color: '#7d7d7d' },
};
