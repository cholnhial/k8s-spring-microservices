import { CurrencyPipe, DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { Order } from '../../core/models/order';
import { OrderService } from './order.service';

@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [CurrencyPipe, DatePipe],
  template: `
    <section class="page-heading">
      <div>
        <h1>Orders</h1>
        <p>Orders are persisted by order-service and emit notification events.</p>
      </div>
    </section>

    @if (error()) {
      <p class="error">{{ error() }}</p>
    }

    @if (orders().length === 0) {
      <p class="muted">No orders yet.</p>
    } @else {
      <section class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Order</th>
              <th>Created</th>
              <th>Status</th>
              <th>Items</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            @for (order of orders(); track order.id) {
              <tr>
                <td>{{ order.orderNumber }}</td>
                <td>{{ order.createdAt | date: 'medium' }}</td>
                <td><span class="status">{{ order.status }}</span></td>
                <td>{{ itemCount(order) }}</td>
                <td>{{ total(order) | currency }}</td>
              </tr>
            }
          </tbody>
        </table>
      </section>
    }
  `,
})
export class OrdersComponent implements OnInit {
  private readonly orderService = inject(OrderService);

  readonly orders = signal<Order[]>([]);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.orderService.list().subscribe({
      next: orders => this.orders.set(orders),
      error: error => this.error.set(error?.error?.message ?? 'Could not load orders'),
    });
  }

  itemCount(order: Order): number {
    return order.orderLineItems.reduce((sum, item) => sum + item.quantity, 0);
  }

  total(order: Order): number {
    return order.orderLineItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  }
}
