export interface OrderLineItem {
  id?: number;
  skuCode: string;
  price: number;
  quantity: number;
}

export interface Order {
  id: number;
  orderNumber: string;
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED';
  createdAt: string;
  orderLineItems: OrderLineItem[];
}

export interface CreateOrderRequest {
  orderLineItems: Array<{ productId: number; quantity: number }>;
}
