package dev.chol.shopnow.order_service;

import dev.chol.shopnow.order_service.client.InventoryClient;
import dev.chol.shopnow.order_service.client.ProductClient;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.web.service.registry.ImportHttpServices;

@SpringBootApplication
@ImportHttpServices(group = "product-service", types = ProductClient.class)
@ImportHttpServices(group = "inventory-service", types = InventoryClient.class)
public class OrderServiceApplication {

	public static void main(String[] args) {
		SpringApplication.run(OrderServiceApplication.class, args);
	}

}
