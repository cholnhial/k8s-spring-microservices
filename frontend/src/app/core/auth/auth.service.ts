import { HttpClient } from '@angular/common/http';
import { Injectable, computed, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';
import { AuthResponse, JwtPayload, LoginRequest, RegisterRequest } from '../models/auth';

const TOKEN_KEY = 'jwt';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly token = signal<string | null>(localStorage.getItem(TOKEN_KEY));

  readonly payload = computed<JwtPayload | null>(() => {
    const token = this.token();
    if (!token) {
      return null;
    }

    try {
      const [, payload] = token.split('.');
      return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    } catch {
      return null;
    }
  });

  readonly username = computed(() => this.payload()?.sub ?? null);

  readonly isLoggedIn = computed(() => {
    const payload = this.payload();
    return !!payload && payload.exp * 1000 > Date.now();
  });

  constructor(private readonly http: HttpClient, private readonly router: Router) {}

  login(request: LoginRequest): Observable<AuthResponse> {
    return this.http.post<AuthResponse>('/api/users/auth/login', request).pipe(
      tap(response => this.setToken(response.token)),
    );
  }

  register(request: RegisterRequest): Observable<AuthResponse> {
    return this.http.post<AuthResponse>('/api/users/auth/register', request).pipe(
      tap(response => this.setToken(response.token)),
    );
  }

  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    this.token.set(null);
    this.router.navigate(['/login']);
  }

  getToken(): string | null {
    return this.token();
  }

  private setToken(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
    this.token.set(token);
  }
}
