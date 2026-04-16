package dev.chol.shopnow.user_service.controller;

import dev.chol.shopnow.user_service.dto.AuthRequest;
import dev.chol.shopnow.user_service.dto.AuthResponse;
import dev.chol.shopnow.user_service.dto.RegisterRequest;
import dev.chol.shopnow.user_service.service.AuthService;
import dev.chol.shopnow.user_service.service.JwtService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/users/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;
    private final JwtService jwtService;

    @PostMapping("/register")
    @ResponseStatus(HttpStatus.CREATED)
    public AuthResponse register(@RequestBody RegisterRequest request) {
        return authService.register(request);
    }

    @PostMapping("/login")
    public AuthResponse login(@RequestBody AuthRequest request) {
        return authService.login(request);
    }

    @GetMapping("/validate")
    public Map<String, Boolean> validate(@RequestParam String token) {
        return Map.of("valid", jwtService.isTokenValid(token));
    }
}
