import { CurrencyPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { forkJoin, of, switchMap } from 'rxjs';
import { Product } from '../../core/models/product';
import { CartService } from '../cart/cart.service';
import { OrderService } from '../orders/order.service';
import { ProductService } from '../products/product.service';

interface CheckoutLine {
  product: Product;
  quantity: number;
}

@Component({
  selector: 'app-checkout',
  standalone: true,
  imports: [CurrencyPipe, RouterLink],
  template: `
    <section class="page-heading">
      <div>
        <h1>Checkout</h1>
        <p>Submitting creates an order and publishes an order-created Kafka event.</p>
      </div>
      <a class="secondary-action" routerLink="/cart">Back to cart</a>
    </section>

    @if (error()) {
      <p class="error">{{ error() }}</p>
    }

    @if (lines().length === 0) {
      <p class="muted">Your cart is empty.</p>
    } @else {
      <section class="list-panel">
        @for (line of lines(); track line.product.id) {
          <article class="cart-line">
            <div>
              <h2>{{ line.product.name }}</h2>
              <p>{{ line.quantity }} item(s)</p>
            </div>
            <strong>{{ line.product.price * line.quantity | currency }}</strong>
          </article>
        }
        <div class="summary-row">
          <span>Total</span>
          <strong>{{ total() | currency }}</strong>
        </div>
        <button type="button" [disabled]="submitting()" (click)="placeOrder()">
          {{ submitting() ? 'Placing order...' : 'Place order' }}
        </button>
      </section>
    }
  `,
})
export class CheckoutComponent implements OnInit {
  private readonly cartService = inject(CartService);
  private readonly productService = inject(ProductService);
  private readonly orderService = inject(OrderService);
  private readonly router = inject(Router);

  readonly lines = signal<CheckoutLine[]>([]);
  readonly error = signal<string | null>(null);
  readonly submitting = signal(false);
  readonly total = computed(() => this.lines().reduce((sum, line) => sum + line.product.price * line.quantity, 0));

  ngOnInit(): void {
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
      error: error => this.error.set(error?.error?.message ?? 'Could not prepare checkout'),
    });
  }

  placeOrder(): void {
    const orderLineItems = this.lines().map(line => ({
      productId: line.product.id,
      quantity: line.quantity,
    }));

    this.submitting.set(true);
    this.error.set(null);

    this.orderService.create({ orderLineItems }).subscribe({
      next: () => {
        this.cartService.clear().subscribe({
          next: () => this.router.navigate(['/orders']),
          error: () => this.router.navigate(['/orders']),
        });
      },
      error: error => {
        this.error.set(error?.error?.message ?? error?.error?.error ?? 'Could not place order');
        this.submitting.set(false);
      },
    });
  }
}
