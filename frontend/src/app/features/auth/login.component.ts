import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <section class="auth-panel">
      <h1>Log in</h1>
      <form (ngSubmit)="submit()" #form="ngForm">
        <label>
          Username
          <input name="username" [(ngModel)]="username" required autocomplete="username" />
        </label>
        <label>
          Password
          <input name="password" [(ngModel)]="password" type="password" required autocomplete="current-password" />
        </label>
        <button type="submit" [disabled]="form.invalid || loading">
          {{ loading ? 'Logging in...' : 'Log in' }}
        </button>
        @if (error) {
          <p class="error">{{ error }}</p>
        }
      </form>
      <p class="muted">No account? <a routerLink="/register">Register</a></p>
    </section>
  `,
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  username = '';
  password = '';
  loading = false;
  error: string | null = null;

  submit(): void {
    this.loading = true;
    this.error = null;

    this.auth.login({ username: this.username, password: this.password }).subscribe({
      next: () => this.router.navigate(['/products']),
      error: error => {
        this.error = error?.error?.message ?? error?.error?.error ?? 'Login failed';
        this.loading = false;
      },
    });
  }
}
