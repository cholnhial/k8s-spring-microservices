package dev.chol.shopnow.notification_service.service;

import dev.chol.shopnow.notification_service.event.OrderPlacedEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Service;

@Service
public class OrderNotificationListener {

    private static final Logger log = LoggerFactory.getLogger(OrderNotificationListener.class);

    @KafkaListener(topics = "order-created")
    public void handleOrderPlaced(OrderPlacedEvent event) {
        log.info("Order placed: {} - notifying {} about items {}",
                event.orderNumber(), event.customerEmail(), event.skuCodes());
    }
}
