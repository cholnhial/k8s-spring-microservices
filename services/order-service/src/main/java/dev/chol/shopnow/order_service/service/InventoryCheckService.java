package dev.chol.shopnow.order_service.service;

import dev.chol.shopnow.order_service.client.InventoryClient;
import dev.chol.shopnow.order_service.dto.InventoryResponse;
import io.github.resilience4j.circuitbreaker.annotation.CircuitBreaker;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

@Service
public class InventoryCheckService {

    private final InventoryClient inventoryClient;

    public InventoryCheckService(InventoryClient inventoryClient) {
        this.inventoryClient = inventoryClient;
    }

    // @CircuitBreaker wraps this bean method — works because OrderController calls THIS bean,
    // not itself. AOP proxies only intercept cross-bean calls.
    @CircuitBreaker(name = "inventory-service", fallbackMethod = "inventoryFallback")
    public List<InventoryResponse> checkInventory(List<String> skuCodes) {
        return inventoryClient.checkStock(skuCodes);
    }

    // Fallback — same signature + the caught exception as the final parameter
    public List<InventoryResponse> inventoryFallback(List<String> skuCodes, Exception e) {
        // TODO: throw ResponseStatusException with 503 SERVICE_UNAVAILABLE
        //   "Inventory service is unavailable, please try again later"
        throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                "Inventory service is unavailable, please try again later");
    }
}