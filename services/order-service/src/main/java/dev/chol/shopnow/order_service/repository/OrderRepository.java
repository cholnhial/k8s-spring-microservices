package dev.chol.shopnow.order_service.repository;

import dev.chol.shopnow.order_service.model.Order;
import org.springframework.data.jpa.repository.JpaRepository;

public interface OrderRepository extends JpaRepository<Order, Long> {}
