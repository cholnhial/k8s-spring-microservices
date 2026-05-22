import { CurrencyPipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { Product } from '../../core/models/product';
import { CartService } from '../cart/cart.service';
import { ProductService } from './product.service';

type ProductWithStock = Product & { inStock: boolean };

@Component({
  selector: 'app-product-list',
  standalone: true,
  imports: [CurrencyPipe, RouterLink],
  template: `
    <section class="page-heading">
      <div>
        <h1>Products</h1>
        <p>Browse the ShopNow catalog backed by product-service and inventory-service.</p>
      </div>
      <a class="secondary-action" routerLink="/cart">View cart</a>
    </section>

    @if (error()) {
      <p class="error">{{ error() }}</p>
    }

    <section class="product-grid">
      @for (product of products(); track product.id) {
        <article class="product-card">
          <div>
            <a [routerLink]="['/products', product.id]">
              <h2>{{ product.name }}</h2>
            </a>
            <p>{{ product.description }}</p>
          </div>
          <div class="card-footer">
            <span class="price">{{ product.price | currency }}</span>
            <span class="stock" [class.out]="!product.inStock">
              {{ product.inStock ? 'In stock' : 'Out of stock' }}
            </span>
          </div>
          <button type="button" [disabled]="!product.inStock" (click)="addToCart(product)">
            Add to cart
          </button>
        </article>
      } @empty {
        <p class="muted">No products returned by product-service yet.</p>
      }
    </section>
  `,
})
export class ProductListComponent implements OnInit {
  private readonly productService = inject(ProductService);
  private readonly cartService = inject(CartService);
  readonly auth = inject(AuthService);

  readonly products = signal<ProductWithStock[]>([]);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.productService.listWithStock().subscribe({
      next: products => this.products.set(products),
      error: error => this.error.set(error?.error?.message ?? 'Could not load products'),
    });
  }

  addToCart(product: Product): void {
    this.cartService.add({ productId: String(product.id), quantity: 1 }).subscribe({
      error: error => this.error.set(error?.error?.message ?? 'Could not add item to cart'),
    });
  }
}
