package dev.chol.shopnow.order_service.service;

import dev.chol.shopnow.order_service.event.OrderPlacedEvent;
import dev.chol.shopnow.order_service.model.Order;
import dev.chol.shopnow.order_service.model.OrderLineItem;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;

@Service
public class OrderEventPublisher {

    private static final String ORDER_CREATED_TOPIC = "order-created";

    private final KafkaTemplate<String, OrderPlacedEvent> kafkaTemplate;

    public OrderEventPublisher(KafkaTemplate<String, OrderPlacedEvent> kafkaTemplate) {
        this.kafkaTemplate = kafkaTemplate;
    }

    public void publishOrderPlaced(Order order) {
        var skuCodes = order.getOrderLineItems().stream()
                .map(OrderLineItem::getSkuCode)
                .toList();

        var event = new OrderPlacedEvent(
                order.getOrderNumber(),
                "customer@example.com",
                skuCodes
        );

        kafkaTemplate.send(ORDER_CREATED_TOPIC, order.getOrderNumber(), event);
    }
}
