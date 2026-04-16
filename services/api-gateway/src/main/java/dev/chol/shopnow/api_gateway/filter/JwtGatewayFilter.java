package dev.chol.shopnow.api_gateway.filter;

import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import jakarta.servlet.*;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;

@Component
@Order(1)
public class JwtGatewayFilter implements Filter {

    @Value("${JWT_SECRET}")
    private String jwtSecret;

    // Requests to these path prefixes pass through without a token
    private static final List<String> PUBLIC_PATHS = List.of(
            "/api/users/auth/",
            "/actuator/"
    );

    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
            throws IOException, ServletException {

        HttpServletRequest  req = (HttpServletRequest)  request;
        HttpServletResponse res = (HttpServletResponse) response;

        String path = req.getRequestURI();

        if (PUBLIC_PATHS.stream().anyMatch(path::startsWith)) {
            chain.doFilter(request, response);
            return;
        }

        String authHeader = req.getHeader("Authorization");
        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            sendUnauthorized(res, "Missing or invalid Authorization header");
            return;
        }

        String token = authHeader.substring(7);
        if (!isTokenValid(token)) {
            sendUnauthorized(res, "Token is invalid or expired");
            return;
        }

        chain.doFilter(request, response);
    }

    private boolean isTokenValid(String token) {
        try {
            SecretKey key = Keys.hmacShaKeyFor(jwtSecret.getBytes(StandardCharsets.UTF_8));
            Jwts.parser().verifyWith(key).build().parseSignedClaims(token);
            return true;
        } catch (JwtException | IllegalArgumentException e) {
            return false;
        }
    }

    private void sendUnauthorized(HttpServletResponse response, String message) throws IOException {
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType("application/json");
        response.getWriter().write("{\"error\":\"" + message + "\"}");
    }
}
