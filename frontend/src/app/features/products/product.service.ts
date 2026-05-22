import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, map, switchMap } from 'rxjs';
import { InventoryResponse, Product } from '../../core/models/product';

@Injectable({ providedIn: 'root' })
export class ProductService {
  constructor(private readonly http: HttpClient) {}

  list(): Observable<Product[]> {
    return this.http.get<Product[]>('/api/products');
  }

  get(id: number): Observable<Product> {
    return this.http.get<Product>(`/api/products/${id}`);
  }

  listWithStock(): Observable<Array<Product & { inStock: boolean }>> {
    return this.list().pipe(
      switchMap(products => {
        const skuCodes = products.map(product => product.skuCode);
        let params = new HttpParams();
        skuCodes.forEach(skuCode => {
          params = params.append('skuCodes', skuCode);
        });

        return this.http.get<InventoryResponse[]>('/api/inventory', { params }).pipe(
          map(stock => {
            const bySku = new Map(stock.map(item => [item.skuCode, item.inStock]));
            return products.map(product => ({
              ...product,
              inStock: bySku.get(product.skuCode) ?? product.stockQuantity > 0,
            }));
          }),
        );
      }),
    );
  }
}
