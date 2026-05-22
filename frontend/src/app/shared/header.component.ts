import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../core/auth/auth.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <header class="app-header">
      <a class="brand" routerLink="/products">ShopNow</a>
      <nav>
        @if (auth.isLoggedIn()) {
          <a routerLink="/products" routerLinkActive="active">Products</a>
          <a routerLink="/cart" routerLinkActive="active">Cart</a>
          <a routerLink="/orders" routerLinkActive="active">Orders</a>
          <span class="user">Hi, {{ auth.username() }}</span>
          <button type="button" (click)="auth.logout()">Log out</button>
        } @else {
          <a routerLink="/login" routerLinkActive="active">Log in</a>
          <a routerLink="/register" routerLinkActive="active">Register</a>
        }
      </nav>
    </header>
  `,
})
export class HeaderComponent {
  readonly auth = inject(AuthService);
}
