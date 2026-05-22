export type Cart = Record<string, number>;

export interface AddToCartRequest {
  productId: string;
  quantity: number;
}

export interface CartEntry {
  productId: number;
  quantity: number;
}
