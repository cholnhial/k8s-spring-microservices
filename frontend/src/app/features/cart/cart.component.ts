import { CurrencyPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { forkJoin, of, switchMap } from 'rxjs';
import { Product } from '../../core/models/product';
import { ProductService } from '../products/product.service';
import { CartService } from './cart.service';

interface CartLine {
  product: Product;
  quantity: number;
}

@Component({
  selector: 'app-cart',
  standalone: true,
  imports: [CurrencyPipe, RouterLink],
  template: `
    <section class="page-heading">
      <div>
        <h1>Your cart</h1>
        <p>Cart data is stored in Redis through cart-service.</p>
      </div>
      <a class="secondary-action" routerLink="/products">Continue shopping</a>
    </section>

    @if (error()) {
      <p class="error">{{ error() }}</p>
    }

    @if (lines().length === 0) {
      <p class="muted">Cart is empty.</p>
    } @else {
      <section class="list-panel">
        @for (line of lines(); track line.product.id) {
          <article class="cart-line">
            <div>
              <h2>{{ line.product.name }}</h2>
              <p>{{ line.product.price | currency }} x {{ line.quantity }}</p>
            </div>
            <strong>{{ line.product.price * line.quantity | currency }}</strong>
            <button type="button" (click)="remove(line.product.id)">Remove</button>
          </article>
        }
        <div class="summary-row">
          <span>Total</span>
          <strong>{{ total() | currency }}</strong>
        </div>
        <a routerLink="/checkout"><button type="button">Checkout</button></a>
      </section>
    }
  `,
})
export class CartComponent implements OnInit {
  private readonly cartService = inject(CartService);
  private readonly productService = inject(ProductService);

  readonly lines = signal<CartLine[]>([]);
  readonly error = signal<string | null>(null);
  readonly total = computed(() => this.lines().reduce((sum, line) => sum + line.product.price * line.quantity, 0));

  ngOnInit(): void {
    this.load();
  }

  remove(productId: number): void {
    this.cartService.remove(productId).subscribe({
      next: () => this.load(),
      error: error => this.error.set(error?.error?.message ?? 'Could not remove item'),
    });
  }

  private load(): void {
    this.cartService.load().pipe(
      switchMap(() => {
        const entries = this.cartService.entries();
        if (entries.length === 0) {
          return of([]);
        }
        return forkJoin(entries.map(entry => this.productService.get(entry.productId).pipe(
          switchMap(product => of({ product, quantity: entry.quantity })),
        )));
      }),
    ).subscribe({
      next: lines => this.lines.set(lines),
      error: error => this.error.set(error?.error?.message ?? 'Could not load cart'),
    });
  }
}
