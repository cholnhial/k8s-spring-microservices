package dev.chol.shopnow.inventory_service.service;

import dev.chol.shopnow.inventory_service.dto.InventoryResponse;
import dev.chol.shopnow.inventory_service.model.Inventory;
import dev.chol.shopnow.inventory_service.repository.InventoryRepository;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
public class InventoryService {

    private final InventoryRepository inventoryRepository;

    public InventoryService(InventoryRepository inventoryRepository) {
        this.inventoryRepository = inventoryRepository;
    }

    public List<InventoryResponse> isInStock(List<String> skuCodes) {
        Map<String, Integer> stockMap = inventoryRepository.findBySkuCodeIn(skuCodes)
                .stream()
                .collect(Collectors.toMap(Inventory::getSkuCode, Inventory::getQuantity));

        return skuCodes.stream()
                .map(sku -> new InventoryResponse(sku, stockMap.getOrDefault(sku, 0) > 0))
                .toList();
    }

    public void updateStock(String skuCode, int quantity) {
        Inventory inventory = inventoryRepository.findBySkuCode(skuCode)
                .orElseGet(() -> {
                    Inventory i = new Inventory();
                    i.setSkuCode(skuCode);
                    return i;
                });
        inventory.setQuantity(quantity);
        inventoryRepository.save(inventory);
    }
}