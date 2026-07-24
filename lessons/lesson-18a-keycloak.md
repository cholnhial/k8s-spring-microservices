# Lesson 18a - Keycloak: Service-to-Service OAuth2

**Status:** [ ] Experimental
**Branch:** `keycloak`
**K8s Concepts:** Identity provider Deployment, Secret-backed realm import, service DNS, health probes
**Spring Boot Concepts:** OAuth2 client credentials, Resource Server JWT validation, `RestClient` OAuth2 interceptor, declarative HTTP interfaces

---

## Why This Lesson Exists

This is a branch-only experiment. If it works well, we can merge it back into the main
curriculum later. The goal is to prove that Spring can manage service-to-service bearer
tokens for us:

- a service uses its own `client-id` and `client-secret`
- Spring obtains a Keycloak access token with the `client_credentials` grant
- Spring attaches the bearer token to outbound REST calls
- Spring renews expired tokens
- Spring removes an invalid cached token after a resource server returns `401`

We are not writing our own token cache, refresh scheduler, retry interceptor, or JWT
parsing logic. The point of the lesson is to let Spring own that lifecycle.

---

## Concept: Service Identity vs User Identity

So far, ShopNow has focused on user-facing JWT authentication in `user-service`.
Service-to-service authentication is different.

When `order-service` calls `inventory-service`, there is no browser user directly
logging into Keycloak for that call. The caller is the workload itself. That means:

- `order-service` gets a Keycloak client named `order-service`
- it authenticates with `client_credentials`
- Keycloak returns an access token representing the service account
- `inventory-service` validates the token as a Resource Server

```
order-service
  |
  | 1. client_id + client_secret
  v
Keycloak token endpoint
  |
  | 2. access token, ttl = 30s
  v
order-service RestClient
  |
  | 3. Authorization: Bearer <token>
  v
inventory-service / product-service
```

Short token TTLs are intentional in this lesson. A 30 second access token makes it easy
to watch Spring reuse a valid token, then mint a new one after expiry.

---

## Concept: Keycloak in Minikube

The lesson adds a single Keycloak Deployment under `k8s/keycloak/`.

| File | Purpose |
|---|---|
| `admin-secret.yaml` | Initial admin username/password for the dev server |
| `client-secrets.yaml` | Client secrets that Spring services will read later |
| `realm-secret.yaml` | Secret-mounted `shopnow` realm import with clients and a short token TTL |
| `deployment.yaml` | Keycloak `start-dev --import-realm` Deployment |
| `service.yaml` | ClusterIP Service exposing Keycloak on `keycloak:8080` |

This is a learning setup, not a production Keycloak design. We use `start-dev`, one
replica, and an imported realm. Production would use TLS, a real database, externalized
secret management, backups, and a planned realm-management process.

Apply it:

```bash
kubectl apply -f k8s/keycloak/
kubectl rollout status deployment/keycloak -n shopnow --timeout=180s
```

Open the admin console:

```bash
kubectl port-forward svc/keycloak 8088:8080 -n shopnow
```

Then browse to:

```text
http://localhost:8088
```

Dev admin credentials:

```text
username: admin
password: admin-dev-password
```

Inside the cluster, Spring services should use this issuer:

```text
http://keycloak:8080/realms/shopnow
```

---

## Concept: What Keycloak Imports

The imported `shopnow` realm creates these confidential clients:

- `api-gateway`
- `order-service`
- `product-service`
- `inventory-service`
- `user-service`
- `cart-service`
- `notification-service`

Each client has:

- `client-secret` authentication
- service accounts enabled
- browser login disabled
- direct password grant disabled
- access token lifespan set to 30 seconds at realm level

For this lesson, the important caller is `order-service`, because it already talks to
`product-service` and `inventory-service` through OpenFeign. That gives us a concrete
before/after migration target.

---

## Config Server Changes

Put the following patterns in the external config repo served by `config-server`.
Do not put client secrets in ConfigMaps. The values below assume each Deployment reads
the relevant secret key from `shopnow-oauth2-client-secrets`.

### Shared Resource Server Config

Every service that accepts protected REST calls should validate Keycloak JWTs:

```yaml
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          issuer-uri: http://keycloak:8080/realms/shopnow
```

This belongs in shared config if every REST service becomes a Resource Server. If only
some services are protected at first, add it per service.

### `order-service.yaml`

`order-service` is an OAuth2 Client because it makes outbound REST calls. We are leaving
its inbound endpoints open for now so the existing frontend/API Gateway path keeps
working while this branch tests service-to-service OAuth2.

```yaml
spring:
  security:
    oauth2:
      client:
        provider:
          keycloak:
            issuer-uri: http://keycloak:8080/realms/shopnow
        registration:
          order-service:
            provider: keycloak
            client-id: order-service
            client-secret: ${ORDER_SERVICE_CLIENT_SECRET}
            authorization-grant-type: client_credentials
  http:
    serviceclient:
      product-service:
        base-url: http://product-service:8081
        connect-timeout: 1s
        read-timeout: 2s
      inventory-service:
        base-url: http://inventory-service:8083
        connect-timeout: 1s
        read-timeout: 2s
```

### `product-service.yaml`

At minimum, `product-service` validates incoming bearer tokens:

```yaml
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          issuer-uri: http://keycloak:8080/realms/shopnow
```

If `product-service` later calls another REST service, add its own client registration:

```yaml
spring:
  security:
    oauth2:
      client:
        provider:
          keycloak:
            issuer-uri: http://keycloak:8080/realms/shopnow
        registration:
          product-service:
            provider: keycloak
            client-id: product-service
            client-secret: ${PRODUCT_SERVICE_CLIENT_SECRET}
            authorization-grant-type: client_credentials
```

### `inventory-service.yaml`

```yaml
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          issuer-uri: http://keycloak:8080/realms/shopnow
```

Add `inventory-service` as an OAuth2 client only when it needs outbound REST calls.

---

## Deployment Secret Wiring

When you implement the Spring changes, add the relevant secret env var to each caller
Deployment. For `order-service`:

```yaml
env:
  - name: ORDER_SERVICE_CLIENT_SECRET
    valueFrom:
      secretKeyRef:
        name: shopnow-oauth2-client-secrets
        key: ORDER_SERVICE_CLIENT_SECRET
```

Repeat the same pattern for any service that has an OAuth2 client registration:

| Service | Secret key |
|---|---|
| `api-gateway` | `API_GATEWAY_CLIENT_SECRET` |
| `order-service` | `ORDER_SERVICE_CLIENT_SECRET` |
| `product-service` | `PRODUCT_SERVICE_CLIENT_SECRET` |
| `inventory-service` | `INVENTORY_SERVICE_CLIENT_SECRET` |
| `user-service` | `USER_SERVICE_CLIENT_SECRET` |
| `cart-service` | `CART_SERVICE_CLIENT_SECRET` |
| `notification-service` | `NOTIFICATION_SERVICE_CLIENT_SECRET` |

---

## Replacing OpenFeign with HTTP Interfaces

`order-service` currently has OpenFeign clients:

- `InventoryClient`
- `ProductClient`

In this branch, the target design is Spring Framework HTTP interfaces backed by
`RestClient`. The interface shape is similar to Feign, but it uses Spring's native
`@HttpExchange`, `@GetExchange`, `@PostExchange`, etc.

Example target shape for the inventory call:

```java
@HttpExchange("/api/inventory")
@ClientRegistrationId("order-service")
public interface InventoryHttpClient {

    @GetExchange
    List<InventoryResponse> checkStock(@RequestParam List<String> skuCodes);
}
```

Spring Boot registers the proxies with `@ImportHttpServices`:

```java
@ImportHttpServices(group = "product-service", types = ProductClient.class)
@ImportHttpServices(group = "inventory-service", types = InventoryClient.class)
class OrderServiceApplication {
}
```

The group names match `spring.http.serviceclient.<group>.base-url` in config-server.
`order-service` also adds a product-service-only `RestClient` interceptor that writes a
fresh random `X-Correlation-Id` header on every outbound product call. That part is code,
not config, because config values are static.

For this branch, `order-service` is aligned to Spring Boot `4.0.5` and Spring Cloud
`2025.1.1`, matching the existing `user-service`, because Spring Cloud's HTTP-service
load-balancer configurer needs the newer Boot 4 HTTP client API.

The key design rule is that the OAuth2 interceptor belongs on the `RestClient` backing
the HTTP interface, not inside each business method.

---

## Spring OAuth2 Token Handling

The `OAuth2ClientHttpRequestInterceptor` is the load-bearing piece:

- it asks `OAuth2AuthorizedClientManager` for an authorized client
- if none exists, Spring obtains an access token
- if the existing token is expired, Spring renews it
- it adds `Authorization: Bearer <access-token>` to the outbound request

For the 401 test, also wire Spring's authorization failure handler:

```java
OAuth2ClientHttpRequestInterceptor interceptor =
        new OAuth2ClientHttpRequestInterceptor(authorizedClientManager);

OAuth2AuthorizationFailureHandler failureHandler =
        OAuth2ClientHttpRequestInterceptor.authorizationFailureHandler(authorizedClientService);

interceptor.setAuthorizationFailureHandler(failureHandler);
```

Important nuance: the failure handler removes the cached authorized client after an
invalid-token failure. The failed request may still fail. The next call should ask
Keycloak for a new token instead of reusing the rejected one.

With HTTP interfaces, the registration is selected by
`@ClientRegistrationId("order-service")` on the client interface. Application code should
not repeat token plumbing at each call site.

---

## Test Plan: Expiry and 401

### Test 1: Token expiry

1. Deploy Keycloak.
2. Wire `order-service` as an OAuth2 client.
3. Call an endpoint that makes `order-service -> inventory-service`.
4. Watch Keycloak logs for token endpoint calls:

```bash
kubectl logs -f deployment/keycloak -n shopnow
```

Expected behavior:

- first outbound request mints a token
- repeated request inside 30 seconds reuses the token
- request after 30 seconds mints a new token

### Test 2: Invalid token / 401

Use a temporary resource-server check or Keycloak-side change to make the current token
invalid. Options:

- temporarily disable the `order-service` client in Keycloak after a token is minted
- rotate the `order-service` client secret and restart only after observing the old token
- reduce realm token TTL even further and call just after expiry

Expected behavior:

- protected service returns `401`
- Spring failure handler removes the cached authorized client
- next outbound call obtains a fresh token

Do not implement custom token invalidation code unless this test proves Spring is not
doing what we expect.

---

## Cleanup

```bash
kubectl delete -f k8s/keycloak/
```

Because this lesson uses Keycloak dev mode and realm import, cleanup removes the whole
identity provider state.

---

## References

- Keycloak container guide: https://www.keycloak.org/server/containers
- Keycloak health checks: https://www.keycloak.org/observability/health
- Spring Security OAuth2 authorized clients: https://docs.spring.io/spring-security/reference/servlet/oauth2/client/authorized-clients.html
- Spring Framework REST clients and HTTP interfaces: https://docs.spring.io/spring-framework/reference/integration/rest-clients.html
