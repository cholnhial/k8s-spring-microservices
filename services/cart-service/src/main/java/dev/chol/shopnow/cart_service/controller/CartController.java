package dev.chol.shopnow.cart_service.controller;

import dev.chol.shopnow.cart_service.dto.AddCartItemRequest;
import dev.chol.shopnow.cart_service.service.CartService;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/cart")
public class CartController {

    private final CartService cartService;

    public CartController(CartService cartService) {
        this.cartService = cartService;
    }

    @GetMapping("/{userId}")
    public Map<String, Integer> getCart(@PathVariable String userId) {
        return cartService.getCart(userId);
    }

    @PostMapping("/{userId}/items")
    @ResponseStatus(HttpStatus.OK)
    public void addItem(@PathVariable String userId, @RequestBody AddCartItemRequest request) {
        cartService.addItem(userId, request.productId(), request.quantity());
    }

    @DeleteMapping("/{userId}/items/{productId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void removeItem(@PathVariable String userId, @PathVariable String productId) {
        cartService.removeItem(userId, productId);
    }

    @DeleteMapping("/{userId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void clearCart(@PathVariable String userId) {
        cartService.clearCart(userId);
    }
}
