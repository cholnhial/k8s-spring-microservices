package dev.chol.shopnow.order_service.controller;

import dev.chol.shopnow.order_service.client.ProductClient;
import dev.chol.shopnow.order_service.dto.InventoryResponse;
import dev.chol.shopnow.order_service.dto.OrderRequest;
import dev.chol.shopnow.order_service.dto.ProductResponse;
import dev.chol.shopnow.order_service.model.Order;
import dev.chol.shopnow.order_service.model.OrderLineItem;
import dev.chol.shopnow.order_service.repository.OrderRepository;
import dev.chol.shopnow.order_service.service.InventoryCheckService;
import dev.chol.shopnow.order_service.service.OrderEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

@RestController
@RequestMapping("/api/orders")
public class OrderController {

    private final OrderRepository orderRepository;
    private final ProductClient productClient;
    private final InventoryCheckService inventoryCheckService;
    private final OrderEventPublisher orderEventPublisher;

    public OrderController(OrderRepository orderRepository, ProductClient productClient,
                           InventoryCheckService inventoryCheckService,
                           OrderEventPublisher orderEventPublisher) {
        this.orderRepository = orderRepository;
        this.productClient = productClient;
        this.inventoryCheckService = inventoryCheckService;
        this.orderEventPublisher = orderEventPublisher;
    }

    @GetMapping
    public List<Order> getAll() {
        return orderRepository.findAll();
    }

    @GetMapping("/{id}")
    public Order getById(@PathVariable Long id) {
        return orderRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Order not found: " + id));
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Order create(@RequestBody OrderRequest request) {
        List<OrderLineItem> lineItems = request.orderLineItems().stream()
                .map(item -> {
                    ProductResponse product;
                    try {
                        product = productClient.findById(item.productId());
                    } catch (HttpClientErrorException.NotFound e) {
                        throw new ResponseStatusException(HttpStatus.NOT_FOUND,
                                "Product not found: " + item.productId());
                    }
                    OrderLineItem lineItem = new OrderLineItem();
                    lineItem.setSkuCode(product.skuCode());
                    lineItem.setPrice(product.price());
                    lineItem.setQuantity(item.quantity());
                    return lineItem;
                })
                .toList();

        List<String> skuCodes = lineItems.stream().map(OrderLineItem::getSkuCode).toList();
        List<InventoryResponse> stock = inventoryCheckService.checkInventory(skuCodes);

        stock.stream()
                .filter(s -> !s.inStock())
                .findFirst()
                .ifPresent(s -> {
                    throw new ResponseStatusException(HttpStatus.CONFLICT,
                            "Item out of stock: " + s.skuCode());
                });

        Order order = new Order();
        order.setOrderLineItems(lineItems);
        Order savedOrder = orderRepository.save(order);
        orderEventPublisher.publishOrderPlaced(savedOrder);
        return savedOrder;
    }
}
