export interface Product {
  id: number;
  name: string;
  description: string;
  price: number;
  stockQuantity: number;
  skuCode: string;
}

export interface InventoryResponse {
  skuCode: string;
  inStock: boolean;
}
