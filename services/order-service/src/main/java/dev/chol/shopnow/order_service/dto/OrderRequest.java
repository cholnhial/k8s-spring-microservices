package dev.chol.shopnow.order_service.dto;

import java.util.List;

public record OrderRequest(
        List<OrderLineItemRequest> orderLineItems
) {}
