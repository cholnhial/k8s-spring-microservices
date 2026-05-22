import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <section class="auth-panel">
      <h1>Register</h1>
      <form (ngSubmit)="submit()" #form="ngForm">
        <label>
          Username
          <input name="username" [(ngModel)]="username" required autocomplete="username" />
        </label>
        <label>
          Email
          <input name="email" [(ngModel)]="email" type="email" required autocomplete="email" />
        </label>
        <label>
          Password
          <input name="password" [(ngModel)]="password" type="password" required autocomplete="new-password" />
        </label>
        <button type="submit" [disabled]="form.invalid || loading">
          {{ loading ? 'Creating account...' : 'Create account' }}
        </button>
        @if (error) {
          <p class="error">{{ error }}</p>
        }
      </form>
      <p class="muted">Already registered? <a routerLink="/login">Log in</a></p>
    </section>
  `,
})
export class RegisterComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  username = '';
  email = '';
  password = '';
  loading = false;
  error: string | null = null;

  submit(): void {
    this.loading = true;
    this.error = null;

    this.auth.register({ username: this.username, email: this.email, password: this.password }).subscribe({
      next: () => this.router.navigate(['/products']),
      error: error => {
        this.error = error?.error?.message ?? error?.error?.error ?? 'Registration failed';
        this.loading = false;
      },
    });
  }
}
