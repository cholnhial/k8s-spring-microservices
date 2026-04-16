package dev.chol.shopnow.user_service.service;

import dev.chol.shopnow.user_service.dto.AuthRequest;
import dev.chol.shopnow.user_service.dto.AuthResponse;
import dev.chol.shopnow.user_service.dto.RegisterRequest;
import dev.chol.shopnow.user_service.model.Role;
import dev.chol.shopnow.user_service.model.User;
import dev.chol.shopnow.user_service.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
@RequiredArgsConstructor
public class AuthService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;

    public AuthResponse register(RegisterRequest request) {
        if (userRepository.existsByUsername(request.username())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Username already taken");
        }
        if (userRepository.existsByEmail(request.email())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Email already registered");
        }
        User user = new User();
        user.setUsername(request.username());
        user.setEmail(request.email());
        user.setPassword(passwordEncoder.encode(request.password()));
        user.setRole(Role.USER);
        userRepository.save(user);
        return new AuthResponse(jwtService.generateToken(user));
    }

    public AuthResponse login(AuthRequest request) {
        User user = userRepository.findByUsername(request.username())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid credentials"));
        if (!passwordEncoder.matches(request.password(), user.getPassword())) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid credentials");
        }
        return new AuthResponse(jwtService.generateToken(user));
    }
}
