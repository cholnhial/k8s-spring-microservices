package dev.chol.shopnow.order_service.dto;

public record OrderLineItemRequest(
        Long productId,
        Integer quantity
) {}
