package dev.chol.shopnow.notification_service.event;

import java.util.List;

public record OrderPlacedEvent(
        String orderNumber,
        String customerEmail,
        List<String> skuCodes
) {}
