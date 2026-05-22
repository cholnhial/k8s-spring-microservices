import { HttpClient } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { AddToCartRequest, Cart, CartEntry } from '../../core/models/cart';

@Injectable({ providedIn: 'root' })
export class CartService {
  readonly cart = signal<Cart>({});

  constructor(private readonly http: HttpClient, private readonly auth: AuthService) {}

  load(): Observable<Cart> {
    return this.http.get<Cart>(`/api/cart/${this.userId()}`).pipe(
      tap(cart => this.cart.set(cart ?? {})),
    );
  }

  add(request: AddToCartRequest): Observable<unknown> {
    return this.http.post(`/api/cart/${this.userId()}/items`, request).pipe(
      tap(() => this.load().subscribe()),
    );
  }

  remove(productId: number): Observable<unknown> {
    return this.http.delete(`/api/cart/${this.userId()}/items/${productId}`).pipe(
      tap(() => this.load().subscribe()),
    );
  }

  clear(): Observable<unknown> {
    return this.http.delete(`/api/cart/${this.userId()}`).pipe(
      tap(() => this.cart.set({})),
    );
  }

  entries(): CartEntry[] {
    return Object.entries(this.cart()).map(([productId, quantity]) => ({
      productId: Number(productId),
      quantity,
    }));
  }

  private userId(): string {
    const username = this.auth.username();
    if (!username) {
      throw new Error('Not logged in');
    }
    return username;
  }
}
