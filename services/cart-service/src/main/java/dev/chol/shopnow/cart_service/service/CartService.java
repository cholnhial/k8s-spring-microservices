package dev.chol.shopnow.cart_service.service;

import org.springframework.data.redis.core.HashOperations;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.Map;

@Service
public class CartService {

    private final HashOperations<String, String, Integer> hashOperations;
    private final RedisTemplate<String, Integer> redisTemplate;

    public CartService(RedisTemplate<String, Integer> redisTemplate) {
        this.redisTemplate = redisTemplate;
        this.hashOperations = redisTemplate.opsForHash();
    }

    public void addItem(String userId, String productId, int quantity) {
        hashOperations.increment(cartKey(userId), productId, quantity);
    }

    public void removeItem(String userId, String productId) {
        hashOperations.delete(cartKey(userId), productId);
    }

    public Map<String, Integer> getCart(String userId) {
        return new LinkedHashMap<>(hashOperations.entries(cartKey(userId)));
    }

    public void clearCart(String userId) {
        redisTemplate.delete(cartKey(userId));
    }

    private String cartKey(String userId) {
        return "cart:" + userId;
    }
}
