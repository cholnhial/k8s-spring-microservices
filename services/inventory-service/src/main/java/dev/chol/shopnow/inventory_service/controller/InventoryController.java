package dev.chol.shopnow.inventory_service.controller;

import dev.chol.shopnow.inventory_service.dto.InventoryResponse;
import dev.chol.shopnow.inventory_service.service.InventoryService;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/inventory")
public class InventoryController {

    private final InventoryService inventoryService;

    public InventoryController(InventoryService inventoryService) {
        this.inventoryService = inventoryService;
    }

    @GetMapping
    public List<InventoryResponse> isInStock(@RequestParam List<String> skuCodes) {
        return inventoryService.isInStock(skuCodes);
    }

    @PutMapping("/{skuCode}")
    public void updateStock(@PathVariable String skuCode, @RequestParam int quantity) {
        inventoryService.updateStock(skuCode, quantity);
    }
}