# Lesson 15 — nginx + Angular: Frontend Deployment

**Status:** [ ] Complete
**K8s Concepts:** ConfigMap as volume, Deployment (stateless), Service (ClusterIP + NodePort)
**Spring Boot Concepts:** None — this lesson is Angular + nginx. You will wire auth into the
front end using the JWT that user-service issues in Lesson 12.

---

## Concept: ConfigMap as a Volume

You have used ConfigMaps as environment variable sources. They can also be **mounted as
files** inside a container. This is how nginx.conf gets into the pod.

```yaml
volumes:
  - name: nginx-config
    configMap:
      name: nginx-frontend-config   # K8s ConfigMap

containers:
  - name: frontend
    volumeMounts:
      - name: nginx-config
        mountPath: /etc/nginx/nginx.conf
        subPath: nginx.conf          # ← mount only this key, not the whole directory
```

Without `subPath`, K8s mounts the entire ConfigMap as a directory, replacing
`/etc/nginx/` with a directory containing one file per ConfigMap key. `subPath` mounts
just the one key as a file at the specified path.

**The practical benefit:** change the nginx config by updating the ConfigMap and rolling
the Deployment — no image rebuild required.

```bash
kubectl edit configmap nginx-frontend-config -n shopnow
# or
kubectl create configmap nginx-frontend-config --from-file=nginx.conf \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl rollout restart deployment/frontend -n shopnow
```

---

## Concept: nginx as a Reverse Proxy

nginx has two jobs in this setup:

1. **Serve static files** — the compiled Angular app (`dist/`)
2. **Proxy API calls to the api-gateway** — so the browser never has to know the gateway URL

```
Browser
  │
  │  GET /                   → nginx serves index.html
  │  GET /assets/main.js     → nginx serves static file
  │  GET /api/products       → nginx proxy_pass to api-gateway:8080
  │
  ▼
nginx pod
  │
  ├── /                → /usr/share/nginx/html/  (Angular build output)
  └── /api/            → http://api-gateway:8080/api/
```

This eliminates CORS issues — from the browser's perspective, all requests go to the
same origin (the nginx host).

```nginx
server {
    listen 80;

    # Serve Angular app
    root /usr/share/nginx/html;
    index index.html;

    # Angular client-side routing — unknown paths serve index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy all /api/* calls to the api-gateway
    location /api/ {
        proxy_pass http://api-gateway:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

> **`try_files $uri $uri/ /index.html`** is required for Angular routing. If a user
> navigates directly to `http://app/cart`, nginx cannot find a `/cart` file — it falls
> back to `index.html` and Angular's router takes over.

---

## Concept: Multi-Stage Docker Build

The Angular app is compiled at build time. The runtime container only needs nginx —
not Node, npm, or the Angular CLI. A multi-stage build keeps the final image small.

```dockerfile
# Stage 1: build the Angular app
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build -- --configuration production

# Stage 2: runtime image — just nginx + the built assets
FROM nginx:1.27-alpine
COPY --from=builder /app/dist/frontend/browser /usr/share/nginx/html
# nginx.conf comes from a ConfigMap volume mount at runtime — NOT baked in
EXPOSE 80
```

The nginx.conf is **not** in the image. It is mounted from a ConfigMap at runtime.
This means you can update the proxy rules without rebuilding the image.

---

## Concept: SPA + Stateless JWT Auth

ShopNow's backend issues a JWT from user-service (Lesson 12) and the api-gateway
validates it on every call (`JwtGatewayFilter`). That makes the frontend's job simple:

1. **Login** — POST credentials to `/api/users/auth/login`, receive `{token}`.
2. **Store** — put the token in `localStorage` so page reloads keep the session.
3. **Attach** — add `Authorization: Bearer <token>` to every subsequent request.
4. **Observe expiry** — when the gateway rejects a call with 401, clear the token and
   send the user back to `/login`.

```
  ┌──────────┐                  ┌─────────────┐                     ┌──────────────┐
  │ Browser  │                  │ nginx (pod) │                     │ api-gateway  │
  └────┬─────┘                  └──────┬──────┘                     └──────┬───────┘
       │  POST /api/users/auth/login   │                                    │
       │──────────────────────────────►│  proxy_pass                        │
       │                                │──────────────────────────────────►│
       │                                │                                    │
       │                                │         { token: "eyJ…" }          │
       │                                │◄──────────────────────────────────│
       │◄──────────────────────────────│                                    │
       │ (store in localStorage)                                            │
       │                                                                     │
       │  GET /api/orders                                                    │
       │  Authorization: Bearer eyJ…                                         │
       │──────────────────────────────►│──────────────────────────────────►│
       │                                │                         (gateway filter validates)
```

There is **no session cookie**, no server-side session state, no refresh token. The
JWT expires after 1 hour and the user logs in again.

### Why `localStorage` and not `sessionStorage` or cookies?

| Storage | Survives page reload | Survives tab close | XSS risk | CSRF risk |
|---|---|---|---|---|
| `localStorage` | Yes | Yes | Readable by any JS on the page | None (manual header attach) |
| `sessionStorage` | Yes | No | Same | None |
| `HttpOnly` cookie | Yes | Yes | Safe from JS | Vulnerable unless SameSite+CSRF token |

For this course, `localStorage` is the right trade-off — simple, works with the
header-based auth the gateway expects, and the XSS risk is mitigated by Angular's
built-in template sanitisation. In a production setting you'd reach for `HttpOnly`
cookies with SameSite=Strict and a CSRF token.

---

## Concept: HTTP Interceptors in Angular

Angular's `HttpClient` supports an **interceptor chain** — functions that run on every
outgoing request and every incoming response. You'll use two:

1. **Auth interceptor** — read the JWT from `localStorage`, attach it as
   `Authorization: Bearer <token>` to every request except the public auth endpoints.
2. **Error interceptor** — catch 401 responses, clear the stored token, and navigate
   to `/login`.

Angular 17 (standalone) registers interceptors when the HTTP client is provided:

```ts
provideHttpClient(
  withInterceptors([authInterceptor, errorInterceptor])
)
```

Each interceptor is a plain function:

```ts
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = localStorage.getItem('jwt');
  if (token && !req.url.includes('/auth/')) {
    req = req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  }
  return next(req);
};
```

### Route guards

A **guard** is a function that runs before navigation and decides whether to allow it.
The `authGuard` checks for a token in `localStorage` and redirects to `/login` if
none exists. Applied per-route:

```ts
{ path: 'checkout', canActivate: [authGuard], component: CheckoutComponent }
```

---

## Concept: The ShopNow UI — Feature Spec

You'll build a small but complete SPA with these routes:

| Route | Access | Purpose |
|---|---|---|
| `/` | Public | Redirects to `/products` |
| `/login` | Public | Username + password form |
| `/register` | Public | New user signup |
| `/products` | Public | Grid of products with "Add to Cart" |
| `/products/:id` | Public | Single product detail + "Add to Cart" |
| `/cart` | Auth | Current user's cart, quantity edit, remove, "Checkout" |
| `/checkout` | Auth | Confirm cart → POST to `/api/orders`, redirect to `/orders` |
| `/orders` | Auth | List of the user's past orders |

### API calls by screen

| Screen | Endpoint | Auth |
|---|---|---|
| Product list | `GET /api/products` | No |
| Product detail | `GET /api/products/:id` | No |
| In-stock badge | `GET /api/inventory?skuCodes=…` | No |
| Login | `POST /api/users/auth/login` | No |
| Register | `POST /api/users/auth/register` | No |
| Add to cart | `POST /api/cart/:userId/items` | Yes |
| View cart | `GET /api/cart/:userId` | Yes |
| Remove cart item | `DELETE /api/cart/:userId/items/:productId` | Yes |
| Checkout | `POST /api/orders` | Yes |
| Orders list | `GET /api/orders` | Yes |

### JWT claim extraction

The backend stores the username (or user id) in the `sub` claim. The front end
decodes the payload (no signature check — the gateway already verified it) to
display the username in the header and to build URLs like `/api/cart/:userId`.

```ts
function decodeJwt(token: string): { sub: string; role: string; exp: number } {
  const [, payload] = token.split('.');
  return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
}
```

> Never trust a decoded JWT client-side — it's for display only. All authorisation
> decisions happen server-side at the gateway.

---

## Your Task

### Part A — Build the Angular App

### 1. Generate the Angular app

If you don't have the Angular CLI installed locally, install it once:

```bash
npm install -g @angular/cli@17
```

Generate the app at the repo root:

```bash
ng new frontend --routing --style=css --standalone --ssr=false
mv frontend/frontend/* frontend/frontend/.[!.]* frontend/ 2>/dev/null || true
rmdir frontend/frontend 2>/dev/null || true
cd frontend
```

> Angular 17's `ng new` creates a `standalone` project (no `NgModule`s). The rest of
> this lesson assumes the standalone API.

Run it locally to confirm the scaffold works:

```bash
npm start
# Open http://localhost:4200
```

### 2. Project layout

Create this structure under `frontend/src/app/`:

```
src/app/
├── app.config.ts                 ← root config (providers, interceptors)
├── app.routes.ts                 ← route table
├── app.component.ts              ← shell (header + <router-outlet>)
├── core/
│   ├── auth/
│   │   ├── auth.service.ts       ← login/register/logout + token storage
│   │   ├── auth.guard.ts         ← route guard
│   │   ├── auth.interceptor.ts   ← attach Bearer token
│   │   └── error.interceptor.ts  ← handle 401
│   └── models/
│       ├── product.ts
│       ├── cart.ts
│       ├── order.ts
│       └── auth.ts
├── features/
│   ├── auth/
│   │   ├── login.component.ts
│   │   └── register.component.ts
│   ├── products/
│   │   ├── product-list.component.ts
│   │   ├── product-detail.component.ts
│   │   └── product.service.ts
│   ├── cart/
│   │   ├── cart.component.ts
│   │   └── cart.service.ts
│   ├── checkout/
│   │   └── checkout.component.ts
│   └── orders/
│       ├── orders.component.ts
│       └── order.service.ts
└── shared/
    └── header.component.ts
```

### 3. Configure a dev proxy so `/api/*` works locally

When you run `ng serve` on port 4200, calls to `/api/*` need to reach the api-gateway.
Port-forward the gateway on your host and proxy through it:

Create `frontend/proxy.conf.json`:

```json
{
  "/api": {
    "target": "http://localhost:8080",
    "secure": false,
    "changeOrigin": true
  }
}
```

Update `angular.json` → `projects.frontend.architect.serve.options`:

```json
"proxyConfig": "proxy.conf.json"
```

Start the gateway port-forward in a separate terminal:

```bash
kubectl port-forward svc/api-gateway 8080:8080 -n shopnow
```

Now `npm start` with `ng serve -o` will hot-reload the Angular app while proxying
API calls to the running cluster.

### 4. Define models — `src/app/core/models/`

`auth.ts`

```ts
export interface LoginRequest { username: string; password: string; }
export interface RegisterRequest { username: string; email: string; password: string; }
export interface AuthResponse { token: string; }
export interface JwtPayload { sub: string; role: 'USER' | 'ADMIN'; iat: number; exp: number; }
```

`product.ts`

```ts
export interface Product {
  id: number;
  name: string;
  description: string;
  price: number;
  stockQuantity: number;
  skuCode: string;
}

export interface InventoryResponse { skuCode: string; inStock: boolean; }
```

`cart.ts`

```ts
// cart-service returns a Redis hash: { "<productId>": "<quantity>", ... }
export type Cart = Record<string, number>;
export interface AddToCartRequest { productId: number; quantity: number; }
```

`order.ts`

```ts
export interface OrderLineItem { id?: number; skuCode: string; price: number; quantity: number; }
export interface Order {
  id: number;
  orderNumber: string;
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED';
  createdAt: string;
  orderLineItems: OrderLineItem[];
}
export interface CreateOrderRequest {
  orderLineItems: { productId: number; quantity: number }[];
}
```

### 5. Auth service — `core/auth/auth.service.ts`

This is the full implementation. It wraps the two public endpoints, stores the token
in `localStorage`, and exposes a `user()` signal for the header to display.

```ts
import { HttpClient } from '@angular/common/http';
import { Injectable, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';
import { AuthResponse, JwtPayload, LoginRequest, RegisterRequest } from '../models/auth';

const TOKEN_KEY = 'jwt';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private token = signal<string | null>(localStorage.getItem(TOKEN_KEY));

  readonly payload = computed<JwtPayload | null>(() => {
    const t = this.token();
    if (!t) return null;
    try {
      const [, p] = t.split('.');
      return JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/')));
    } catch { return null; }
  });
  readonly username = computed(() => this.payload()?.sub ?? null);
  readonly isLoggedIn = computed(() => {
    const p = this.payload();
    return !!p && p.exp * 1000 > Date.now();
  });

  constructor(private http: HttpClient, private router: Router) {}

  login(req: LoginRequest): Observable<AuthResponse> {
    return this.http.post<AuthResponse>('/api/users/auth/login', req).pipe(
      tap(res => this.setToken(res.token))
    );
  }

  register(req: RegisterRequest): Observable<AuthResponse> {
    return this.http.post<AuthResponse>('/api/users/auth/register', req).pipe(
      tap(res => this.setToken(res.token))
    );
  }

  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    this.token.set(null);
    this.router.navigate(['/login']);
  }

  getToken(): string | null { return this.token(); }

  private setToken(t: string): void {
    localStorage.setItem(TOKEN_KEY, t);
    this.token.set(t);
  }
}
```

### 6. Auth interceptor — `core/auth/auth.interceptor.ts`

```ts
import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from './auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.getToken();
  const isPublic = req.url.includes('/api/users/auth/');
  if (token && !isPublic) {
    req = req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  }
  return next(req);
};
```

### 7. Error interceptor — `core/auth/error.interceptor.ts`

```ts
import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  return next(req).pipe(
    catchError(err => {
      if (err.status === 401) {
        auth.logout();    // clears token + navigates to /login
      }
      return throwError(() => err);
    })
  );
};
```

### 8. Auth guard — `core/auth/auth.guard.ts`

```ts
import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.isLoggedIn()) return true;
  router.navigate(['/login']);
  return false;
};
```

### 9. Product service — `features/products/product.service.ts`

```ts
import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { forkJoin, map, Observable } from 'rxjs';
import { InventoryResponse, Product } from '../../core/models/product';

@Injectable({ providedIn: 'root' })
export class ProductService {
  constructor(private http: HttpClient) {}

  list(): Observable<Product[]> {
    return this.http.get<Product[]>('/api/products');
  }

  get(id: number): Observable<Product> {
    return this.http.get<Product>(`/api/products/${id}`);
  }

  // Combines product list with inventory so the UI can show in-stock badges
  listWithStock(): Observable<Array<Product & { inStock: boolean }>> {
    return this.list().pipe(
      // ... TODO: hit /api/inventory?skuCodes=… and merge inStock by skuCode
    );
  }
}
```

> The `listWithStock` stub is where **you** wire the inventory call. Hint: collect
> skuCodes from the product list, call `/api/inventory?skuCodes=SKU1,SKU2`, then map
> each product to `{...p, inStock}`.

### 10. Cart service — `features/cart/cart.service.ts`

```ts
import { HttpClient } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { tap } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { AddToCartRequest, Cart } from '../../core/models/cart';

@Injectable({ providedIn: 'root' })
export class CartService {
  readonly cart = signal<Cart>({});

  constructor(private http: HttpClient, private auth: AuthService) {}

  private userId(): string {
    const u = this.auth.username();
    if (!u) throw new Error('Not logged in');
    return u;
  }

  load() {
    return this.http.get<Cart>(`/api/cart/${this.userId()}`)
      .pipe(tap(c => this.cart.set(c)));
  }

  add(req: AddToCartRequest) {
    return this.http.post(`/api/cart/${this.userId()}/items`, req)
      .pipe(tap(() => this.load().subscribe()));
  }

  remove(productId: number) {
    return this.http.delete(`/api/cart/${this.userId()}/items/${productId}`)
      .pipe(tap(() => this.load().subscribe()));
  }

  clear() {
    return this.http.delete(`/api/cart/${this.userId()}`)
      .pipe(tap(() => this.cart.set({})));
  }
}
```

### 11. Order service — `features/orders/order.service.ts`

```ts
import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { CreateOrderRequest, Order } from '../../core/models/order';

@Injectable({ providedIn: 'root' })
export class OrderService {
  constructor(private http: HttpClient) {}

  list(): Observable<Order[]> { return this.http.get<Order[]>('/api/orders'); }
  get(id: number): Observable<Order> { return this.http.get<Order>(`/api/orders/${id}`); }
  create(req: CreateOrderRequest): Observable<Order> {
    return this.http.post<Order>('/api/orders', req);
  }
}
```

### 12. Components

For each component, you get a **skeleton with the method signatures and the template
shape**. Fill in the styles and any polishing. Use Angular's template syntax and
the `inject()` function — all components are standalone.

#### 12a. `shared/header.component.ts`

```ts
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth/auth.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [RouterLink],
  template: `
    <header>
      <a routerLink="/products"><strong>ShopNow</strong></a>
      <nav>
        <a routerLink="/products">Products</a>
        @if (auth.isLoggedIn()) {
          <a routerLink="/cart">Cart</a>
          <a routerLink="/orders">Orders</a>
          <span>Hi, {{ auth.username() }}</span>
          <button (click)="auth.logout()">Log out</button>
        } @else {
          <a routerLink="/login">Log in</a>
          <a routerLink="/register">Register</a>
        }
      </nav>
    </header>
  `,
})
export class HeaderComponent {
  auth = inject(AuthService);
}
```

#### 12b. `features/auth/login.component.ts`

```ts
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <h2>Log in</h2>
    <form (ngSubmit)="submit()" #f="ngForm">
      <input name="username" [(ngModel)]="username" placeholder="username" required />
      <input name="password" [(ngModel)]="password" placeholder="password" type="password" required />
      <button [disabled]="f.invalid || loading">Log in</button>
      @if (error) { <p class="error">{{ error }}</p> }
    </form>
    <p>No account? <a routerLink="/register">Register</a></p>
  `,
})
export class LoginComponent {
  auth = inject(AuthService);
  router = inject(Router);
  username = '';
  password = '';
  loading = false;
  error: string | null = null;

  submit() {
    this.loading = true;
    this.error = null;
    this.auth.login({ username: this.username, password: this.password })
      .subscribe({
        next: () => this.router.navigate(['/products']),
        error: (e) => { this.error = e?.error?.message ?? 'Login failed'; this.loading = false; },
      });
  }
}
```

#### 12c. `features/auth/register.component.ts`

Parallel to login — adds an `email` field, calls `auth.register()`, redirects to
`/products` on success. You write this one yourself using the login component as a
pattern.

#### 12d. `features/products/product-list.component.ts`

```ts
import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ProductService } from './product.service';
import { CartService } from '../cart/cart.service';
import { AuthService } from '../../core/auth/auth.service';
import { Product } from '../../core/models/product';

@Component({
  selector: 'app-product-list',
  standalone: true,
  imports: [RouterLink],
  template: `
    <h2>Products</h2>
    <div class="grid">
      @for (p of products(); track p.id) {
        <article>
          <a [routerLink]="['/products', p.id]"><h3>{{ p.name }}</h3></a>
          <p>{{ p.description }}</p>
          <p><strong>{{ p.price | currency }}</strong></p>
          @if (auth.isLoggedIn()) {
            <button (click)="addToCart(p)">Add to cart</button>
          }
        </article>
      }
    </div>
  `,
})
export class ProductListComponent implements OnInit {
  private productSvc = inject(ProductService);
  private cartSvc = inject(CartService);
  auth = inject(AuthService);
  products = signal<Product[]>([]);

  ngOnInit() { this.productSvc.list().subscribe(ps => this.products.set(ps)); }

  addToCart(p: Product) {
    this.cartSvc.add({ productId: p.id, quantity: 1 }).subscribe();
  }
}
```

#### 12e. `features/products/product-detail.component.ts`

- Grab the `:id` route param via `ActivatedRoute`.
- Call `ProductService.get(id)`.
- Render name, description, price, stock.
- "Add to cart" button that respects a quantity input.

You write this one using the product-list component as a pattern.

#### 12f. `features/cart/cart.component.ts`

```ts
import { Component, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CartService } from './cart.service';

@Component({
  selector: 'app-cart',
  standalone: true,
  imports: [RouterLink],
  template: `
    <h2>Your cart</h2>
    @if (entries().length === 0) {
      <p>Cart is empty. <a routerLink="/products">Browse products</a></p>
    } @else {
      <ul>
        @for (e of entries(); track e.productId) {
          <li>
            Product #{{ e.productId }} × {{ e.quantity }}
            <button (click)="remove(e.productId)">remove</button>
          </li>
        }
      </ul>
      <a routerLink="/checkout"><button>Checkout</button></a>
    }
  `,
})
export class CartComponent implements OnInit {
  private cartSvc = inject(CartService);
  cart = this.cartSvc.cart;     // signal

  ngOnInit() { this.cartSvc.load().subscribe(); }

  entries() {
    return Object.entries(this.cart()).map(([k, v]) => ({ productId: Number(k), quantity: v }));
  }

  remove(productId: number) { this.cartSvc.remove(productId).subscribe(); }
}
```

> Your next enhancement: fetch the full `Product` for each cart entry so you can
> show the name and price, not just the id. Hint: `forkJoin` over the entries.

#### 12g. `features/checkout/checkout.component.ts`

- Read the current cart from `CartService.cart()`.
- Build a `CreateOrderRequest` from its entries.
- Call `OrderService.create()`.
- On success: `cartSvc.clear()` then navigate to `/orders`.
- On error: show a message (often 409 "Item out of stock" from the circuit breaker
  fallback in Lesson 11).

#### 12h. `features/orders/orders.component.ts`

- Call `OrderService.list()` on init.
- Render a table: order number, created date, status, line item count, total price
  (derived from line items).

### 13. Wire routes — `app.routes.ts`

```ts
import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'products' },
  { path: 'login',    loadComponent: () => import('./features/auth/login.component').then(m => m.LoginComponent) },
  { path: 'register', loadComponent: () => import('./features/auth/register.component').then(m => m.RegisterComponent) },
  { path: 'products', loadComponent: () => import('./features/products/product-list.component').then(m => m.ProductListComponent) },
  { path: 'products/:id', loadComponent: () => import('./features/products/product-detail.component').then(m => m.ProductDetailComponent) },
  { path: 'cart',     canActivate: [authGuard], loadComponent: () => import('./features/cart/cart.component').then(m => m.CartComponent) },
  { path: 'checkout', canActivate: [authGuard], loadComponent: () => import('./features/checkout/checkout.component').then(m => m.CheckoutComponent) },
  { path: 'orders',   canActivate: [authGuard], loadComponent: () => import('./features/orders/orders.component').then(m => m.OrdersComponent) },
  { path: '**', redirectTo: 'products' },
];
```

Lazy loading (`loadComponent`) means each route compiles into a separate JS bundle
and is only fetched when first visited. For a small app it barely matters, but it's
the Angular 17 idiom and worth internalising.

### 14. App shell — `app.component.ts`

```ts
import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HeaderComponent } from './shared/header.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, HeaderComponent],
  template: `
    <app-header />
    <main>
      <router-outlet />
    </main>
  `,
})
export class AppComponent {}
```

### 15. Register providers — `app.config.ts`

```ts
import { ApplicationConfig } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { routes } from './app.routes';
import { authInterceptor } from './core/auth/auth.interceptor';
import { errorInterceptor } from './core/auth/error.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([authInterceptor, errorInterceptor])),
  ],
};
```

### 16. Verify the app locally

With the api-gateway port-forward running in one terminal:

```bash
cd frontend
npm start
# Browse to http://localhost:4200
```

End-to-end smoke test:

1. Click **Register**, create a user. You should be logged in and redirected to the product list.
2. Open DevTools → Application → Local Storage: verify the `jwt` key exists.
3. Add a product to the cart.
4. Open the cart — confirm the item is listed.
5. DevTools → Network → pick any `/api/*` call and confirm the `Authorization: Bearer …`
   header is attached.
6. Click **Checkout** — you should land on the orders page with a new order.
7. Click **Log out** — the header collapses back to Login/Register.
8. Edit localStorage: change the JWT to garbage, then refresh. The next `/api` call
   should return 401, the error interceptor should clear the token and redirect you
   to `/login`.

### Part B — Deploy to Kubernetes

### 17. Create the nginx ConfigMap

Create `k8s/frontend/nginx-configmap.yaml`:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: nginx-frontend-config
  namespace: shopnow
  labels:
    app: frontend
    part-of: shopnow
    version: "1.0"
data:
  nginx.conf: |
    events {
      worker_connections 1024;
    }

    http {
      include       /etc/nginx/mime.types;
      default_type  application/octet-stream;
      sendfile      on;

      # Gzip static assets
      gzip on;
      gzip_types text/css application/javascript application/json image/svg+xml;
      gzip_min_length 256;

      server {
        listen 80;

        root  /usr/share/nginx/html;
        index index.html;

        # Long-cache hashed bundles, no-cache index.html
        location ~* \.(js|css|woff2?|svg|png|jpg)$ {
          expires 1y;
          add_header Cache-Control "public, immutable";
        }
        location = /index.html {
          add_header Cache-Control "no-store";
        }

        # Angular SPA — unknown paths serve index.html
        location / {
          try_files $uri $uri/ /index.html;
        }

        # Proxy API calls to the gateway
        location /api/ {
          proxy_pass http://api-gateway:8080;
          proxy_set_header Host              $host;
          proxy_set_header X-Real-IP         $remote_addr;
          proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
          proxy_set_header X-Forwarded-Proto $scheme;
          proxy_read_timeout 60s;
        }
      }
    }
```

### 18. Create the Dockerfile

Create `frontend/Dockerfile`:

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build -- --configuration production

FROM nginx:1.27-alpine
COPY --from=builder /app/dist/frontend/browser /usr/share/nginx/html
EXPOSE 80
```

> If `ng build` outputs to `dist/frontend/` (no `browser/` subdirectory), adjust the
> `COPY --from=builder` path accordingly. Check `angular.json` for the `outputPath`.

### 19. Build the image into Minikube

```bash
eval $(minikube docker-env)
docker build -t shopnow/frontend:latest frontend/
```

### 20. Create the Deployment

Create `k8s/frontend/deployment.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
  namespace: shopnow
  labels:
    app: frontend
    part-of: shopnow
    version: "1.0"
spec:
  replicas: 1
  selector:
    matchLabels:
      app: frontend
  template:
    metadata:
      labels:
        app: frontend
        part-of: shopnow
        version: "1.0"
    spec:
      containers:
        - name: frontend
          image: shopnow/frontend:latest
          imagePullPolicy: Never
          ports:
            - containerPort: 80
          volumeMounts:
            - name: nginx-config
              mountPath: /etc/nginx/nginx.conf
              subPath: nginx.conf
          livenessProbe:
            httpGet:
              path: /
              port: 80
            periodSeconds: 15
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /
              port: 80
            periodSeconds: 5
            failureThreshold: 3
          resources:
            requests:
              memory: "64Mi"
              cpu: "50m"
            limits:
              memory: "128Mi"
              cpu: "100m"
      volumes:
        - name: nginx-config
          configMap:
            name: nginx-frontend-config
```

### 21. Create the Service

Create `k8s/frontend/service.yaml`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: frontend
  namespace: shopnow
  labels:
    app: frontend
    part-of: shopnow
    version: "1.0"
spec:
  type: NodePort
  selector:
    app: frontend
  ports:
    - port: 80
      targetPort: 80
      nodePort: 30080
```

> **NodePort** exposes the service on every Minikube node's port 30080. This lets you
> open the app directly in the browser without `kubectl port-forward`. The Ingress
> (from Lesson 09) is the production-grade way — NodePort is a shortcut for local dev.

### 22. Deploy

```bash
kubectl apply -f k8s/frontend/nginx-configmap.yaml
kubectl apply -f k8s/frontend/deployment.yaml
kubectl apply -f k8s/frontend/service.yaml

kubectl rollout status deployment/frontend -n shopnow --timeout=60s
```

### 23. Open the deployed app

```bash
minikube service frontend -n shopnow
# Opens the NodePort URL in your default browser
```

Or manually:

```bash
minikube ip                       # e.g. 192.168.49.2
# Open http://192.168.49.2:30080
```

Go through the same end-to-end flow you tested with `ng serve`: register → log in →
browse → add to cart → checkout → view orders → log out. Everything should work
identically, but now served by nginx out of the cluster with zero dev tooling in the
browser environment.

### 24. Test the nginx proxy directly

```bash
NODE_IP=$(minikube ip)
curl -s http://$NODE_IP:30080/api/products | head -c 200
# JSON via nginx → api-gateway → product-service
```

### 25. Demonstrate ConfigMap live reload

Change the nginx config without rebuilding the image:

```bash
kubectl edit configmap nginx-frontend-config -n shopnow
# Add inside `server { ... }`: add_header X-Served-By "shopnow-frontend";

kubectl rollout restart deployment/frontend -n shopnow

curl -sI http://$(minikube ip):30080/ | grep X-Served-By
# Expected: X-Served-By: shopnow-frontend
```

This is the payoff for mounting nginx.conf from a ConfigMap — operations tweaks
don't need a new image build.

---

## Notes & Learnings

> _Record anything surprising, problems you hit, or insights you had._

---

## Up Next

[Lesson 16 — Sidecar Pattern: Distributed Tracing with Zipkin](lesson-16-tracing.md)
