package dev.chol.shopnow.order_service.client;

import dev.chol.shopnow.order_service.dto.InventoryResponse;
import org.springframework.security.oauth2.client.annotation.ClientRegistrationId;
import org.springframework.web.service.annotation.GetExchange;
import org.springframework.web.service.annotation.HttpExchange;
import org.springframework.web.bind.annotation.RequestParam;

import java.util.List;

@HttpExchange("/api/inventory")
@ClientRegistrationId("order-service")
public interface InventoryClient {

    @GetExchange
    List<InventoryResponse> checkStock(@RequestParam List<String> skuCodes);
}
