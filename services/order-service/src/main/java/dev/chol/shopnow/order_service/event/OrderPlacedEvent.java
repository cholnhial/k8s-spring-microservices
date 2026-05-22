package dev.chol.shopnow.order_service.event;

import java.util.List;

public record OrderPlacedEvent(
        String orderNumber,
        String customerEmail,
        List<String> skuCodes
) {}
