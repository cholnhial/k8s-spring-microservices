import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  { path: 'login', loadComponent: () => import('./features/auth/login.component').then(m => m.LoginComponent) },
  { path: 'register', loadComponent: () => import('./features/auth/register.component').then(m => m.RegisterComponent) },
  { path: 'products', canActivate: [authGuard], loadComponent: () => import('./features/products/product-list.component').then(m => m.ProductListComponent) },
  { path: 'products/:id', canActivate: [authGuard], loadComponent: () => import('./features/products/product-detail.component').then(m => m.ProductDetailComponent) },
  { path: 'cart', canActivate: [authGuard], loadComponent: () => import('./features/cart/cart.component').then(m => m.CartComponent) },
  { path: 'checkout', canActivate: [authGuard], loadComponent: () => import('./features/checkout/checkout.component').then(m => m.CheckoutComponent) },
  { path: 'orders', canActivate: [authGuard], loadComponent: () => import('./features/orders/orders.component').then(m => m.OrdersComponent) },
  { path: '**', redirectTo: 'products' },
];
