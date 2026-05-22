import { CurrencyPipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Product } from '../../core/models/product';
import { CartService } from '../cart/cart.service';
import { ProductService } from './product.service';

@Component({
  selector: 'app-product-detail',
  standalone: true,
  imports: [CurrencyPipe, FormsModule, RouterLink],
  template: `
    <a routerLink="/products" class="back-link">Back to products</a>

    @if (product(); as item) {
      <section class="detail-layout">
        <div class="product-preview">
          <span>{{ item.name.slice(0, 2).toUpperCase() }}</span>
        </div>
        <article>
          <h1>{{ item.name }}</h1>
          <p>{{ item.description }}</p>
          <dl class="facts">
            <div>
              <dt>Price</dt>
              <dd>{{ item.price | currency }}</dd>
            </div>
            <div>
              <dt>SKU</dt>
              <dd>{{ item.skuCode }}</dd>
            </div>
            <div>
              <dt>Stock</dt>
              <dd>{{ item.stockQuantity }}</dd>
            </div>
          </dl>
          <label class="quantity">
            Quantity
            <input type="number" min="1" [(ngModel)]="quantity" />
          </label>
          <button type="button" (click)="addToCart(item)">Add to cart</button>
          @if (message()) {
            <p class="success">{{ message() }}</p>
          }
          @if (error()) {
            <p class="error">{{ error() }}</p>
          }
        </article>
      </section>
    } @else if (error()) {
      <p class="error">{{ error() }}</p>
    } @else {
      <p class="muted">Loading product...</p>
    }
  `,
})
export class ProductDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly productService = inject(ProductService);
  private readonly cartService = inject(CartService);

  readonly product = signal<Product | null>(null);
  readonly error = signal<string | null>(null);
  readonly message = signal<string | null>(null);
  quantity = 1;

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    this.productService.get(id).subscribe({
      next: product => this.product.set(product),
      error: error => this.error.set(error?.error?.message ?? 'Could not load product'),
    });
  }

  addToCart(product: Product): void {
    this.message.set(null);
    this.error.set(null);
    this.cartService.add({ productId: String(product.id), quantity: this.quantity }).subscribe({
      next: () => this.message.set('Added to cart'),
      error: error => this.error.set(error?.error?.message ?? 'Could not add item to cart'),
    });
  }
}
