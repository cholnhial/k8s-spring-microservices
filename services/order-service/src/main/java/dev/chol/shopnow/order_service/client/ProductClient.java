package dev.chol.shopnow.order_service.client;

import dev.chol.shopnow.order_service.dto.ProductResponse;
import org.springframework.security.oauth2.client.annotation.ClientRegistrationId;
import org.springframework.web.service.annotation.GetExchange;
import org.springframework.web.service.annotation.HttpExchange;
import org.springframework.web.bind.annotation.PathVariable;

@HttpExchange("/api/products")
@ClientRegistrationId("order-service")
public interface ProductClient {

    @GetExchange("/{id}")
    ProductResponse findById(@PathVariable Long id);
}
