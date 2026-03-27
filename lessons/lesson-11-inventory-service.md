# Lesson 11 — Circuit Breaker & Resilience: Inventory Service

**Status:** [ ] Complete
**K8s Concepts:** Liveness/Readiness Probes (deep-dive), PodDisruptionBudget
**Spring Boot Concepts:** Resilience4j circuit breaker, circuit breaker → readiness probe integration

---

## Concept: Health Probes — What Actually Happens

You used all three probes in Lesson 08. Now let's understand what K8s *does* when each one fails.

### Three Probe Types

```
StartupProbe   — "Is the app done starting?"
LivenessProbe  — "Is the app still alive?"
ReadinessProbe — "Is the app ready to receive traffic?"
```

| Probe | On failure | Consequence |
|---|---|---|
| `startupProbe` | Restarts the container | App was too slow to start; `livenessProbe` is suppressed until this passes |
| `livenessProbe` | Restarts the container | App is alive but stuck (deadlock, memory leak); hard reset |
| `readinessProbe` | Removes pod from Service endpoints | App is running but temporarily unable to serve; **no restart** |

The critical distinction: **readiness failure removes the pod from the load-balancer pool without killing it**. The app is still running and can recover. Once the probe passes again, traffic resumes automatically.

### How the Three Probes Sequence

```
Pod starts
    │
    ├── startupProbe fires every 10s (up to 30 × 10s = 5 min)
    │       ↓ passes once
    ├── livenessProbe fires every 10s (3 consecutive fails → restart)
    └── readinessProbe fires every 5s  (3 consecutive fails → removed from load balancer)
                                        (1 success → added back)
```

### Probe Timing Fields

```yaml
startupProbe:
  httpGet:
    path: /actuator/health
    port: 8083
  periodSeconds: 10
  failureThreshold: 30      # 30 × 10s = 5 min max startup window
  successThreshold: 1       # must be 1 for startup and liveness probes

livenessProbe:
  httpGet:
    path: /actuator/health/liveness
    port: 8083
  periodSeconds: 10
  failureThreshold: 3       # 30s of consecutive failures → kill and restart

readinessProbe:
  httpGet:
    path: /actuator/health/readiness
    port: 8083
  periodSeconds: 5
  failureThreshold: 3       # 15s of consecutive failures → remove from load balancer
  successThreshold: 1       # 1 success → add back to load balancer
```

---

## Concept: Circuit Breaker

When order-service calls inventory-service, what happens if inventory-service is slow or down?

**Without a circuit breaker:**
- Every request to order-service blocks, waiting on a Feign call to inventory-service
- Threads pile up — order-service thread pool fills
- order-service becomes slow, then unresponsive
- The failure cascades upward to the api-gateway and the client

**With a circuit breaker:**
- After N consecutive failures to inventory-service, the circuit **opens**
- Calls to inventory-service are **short-circuited** immediately — no network call is made
- A **fallback** method runs instead (return a graceful error, cached result, or degraded response)
- After a wait period, the circuit enters **half-open** state — a probe call goes through
- If the probe succeeds, the circuit **closes** and normal operation resumes

```
             ┌──── failures ≥ threshold ────┐
             │                              ▼
          CLOSED ◄── probe succeeds ── HALF_OPEN
             │                              ▲
             │        wait-duration         │
             └───────────────── OPEN ───────┘
                             (short-circuit, fallback runs)
```

### Resilience4j — annotation-based circuit breaker

Add the `@CircuitBreaker` annotation to any Spring bean method. The `name` must match
an instance defined in your config:

```java
@CircuitBreaker(name = "inventory-service", fallbackMethod = "inventoryFallback")
public List<InventoryResponse> checkInventory(List<String> skuCodes) {
    return inventoryClient.checkStock(skuCodes);   // Feign call
}

// Fallback — same signature + the exception type
public List<InventoryResponse> inventoryFallback(List<String> skuCodes, Exception e) {
    throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
        "Inventory service is unavailable, please try again later");
}
```

> **AOP gotcha:** `@CircuitBreaker` works via Spring AOP proxy. This means the annotated
> method must be on a **different bean** from the caller. If `OrderController` calls a
> `@CircuitBreaker` method on itself, the annotation is silently ignored. Create a
> dedicated `InventoryCheckService` bean — that's what the skeleton provides.

### Resilience4j Configuration

```yaml
resilience4j:
  circuitbreaker:
    instances:
      inventory-service:
        sliding-window-size: 10                        # evaluate last 10 calls
        minimum-number-of-calls: 5                     # need at least 5 calls before tripping
        failure-rate-threshold: 50                     # trip if ≥50% of last 10 calls failed
        wait-duration-in-open-state: 30s               # stay OPEN for 30s before half-open
        permitted-number-of-calls-in-half-open-state: 3
        register-health-indicator: true                # ← expose CB state to actuator health
```

The `register-health-indicator: true` line is what connects Resilience4j to K8s.

---

## Concept: Circuit Breaker → Readiness Probe → K8s Traffic

```
inventory-service pod goes down
         │
         ▼
order-service makes 5 consecutive failed Feign calls
         │
         ▼
Circuit breaker OPENS in order-service
         │
         ▼  (because register-health-indicator: true)
/actuator/health/readiness returns {"status":"DOWN"}
         │
         ▼
K8s readiness probe fails on order-service pod (3× in a row)
         │
         ▼
order-service pod removed from Service endpoints → no new traffic routed to it

─────────────────────────── inventory-service recovers ───────────────────────────

Circuit moves to HALF_OPEN → probe call succeeds → circuit CLOSES
         │
         ▼
/actuator/health/readiness returns {"status":"UP"}
         │
         ▼
K8s readiness probe passes → pod re-added to Service endpoints → traffic resumes
```

This is automatic, zero-downtime recovery. Once the wiring is in place you get it for free.

---

## Concept: PodDisruptionBudget

When a node is drained (`kubectl drain`, rolling OS upgrade, cloud preemption), K8s must evict pods.
Without constraints, it could evict **all replicas of a Deployment at once**, causing downtime.

A **PodDisruptionBudget (PDB)** sets a floor on the number of pods that must stay available:

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: inventory-service-pdb
  namespace: shopnow
spec:
  minAvailable: 1        # at least 1 replica must be Running/Ready at all times
  selector:
    matchLabels:
      app: inventory-service
```

> With `minAvailable: 1` and only 1 replica deployed, eviction is **refused** until a
> second replica becomes available. This is intentional — the PDB enforces that you scale
> to ≥2 replicas before a node drain can proceed. You can also express this as
> `maxUnavailable: 0`.

PDBs protect against **voluntary disruptions** (node drains, rolling updates).
They do **not** protect against involuntary disruptions (hardware failure, OOMKill).

---

## Your Task

### 1. Generate the Spring Boot project

Go to [start.spring.io](https://start.spring.io) and generate:

| Field | Value |
|---|---|
| Project | Maven |
| Language | Java |
| Spring Boot | 4.0.3 |
| Group | `dev.chol.shopnow` |
| Artifact | `inventory-service` |
| Java | 21 |
| Dependencies | Spring Web, Spring Data JPA, Spring Boot Actuator, Config Client, Eureka Discovery Client, PostgreSQL Driver |

Unzip into `services/inventory-service/`. The scaffolded source stubs are already in
`services/inventory-service/src/` — **replace the generated stubs** with those files, then
fill in every `// TODO`.

### 2. Implement the Inventory Service

#### `Inventory` entity

| Field | Type | Constraint |
|---|---|---|
| `id` | `Long` | `@Id @GeneratedValue(strategy = IDENTITY)` |
| `skuCode` | `String` | `@Column(unique = true, nullable = false)` |
| `quantity` | `Integer` | `@Column(nullable = false)` |

#### `InventoryRepository`

Extend `JpaRepository<Inventory, Long>`. Add one derived query:

```java
List<Inventory> findBySkuCodeIn(List<String> skuCodes);
```

#### `InventoryService`

Implement `isInStock(List<String> skuCodes)`:

- Call `inventoryRepository.findBySkuCodeIn(skuCodes)`
- For each result: `inStock = quantity > 0`
- For each skuCode with **no record** in the DB, include it as `inStock = false`

#### `InventoryController`

| Method | Path | Input | Response |
|---|---|---|---|
| `GET` | `/api/inventory` | `?skuCodes=SKU-1,SKU-2` (query param) | `List<InventoryResponse>` |
| `PUT` | `/api/inventory/{skuCode}` | `?quantity=N` (query param) | 200 OK |

The `PUT` endpoint is for seeding test data — it creates or updates the stock level for a skuCode.

### 3. Add inventory-service config to your config repo

In your `shopnow-config` git repo, create `inventory-service.yaml`:

```yaml
server:
  port: 8083

spring:
  datasource:
    url: jdbc:postgresql://postgres-inventory:5432/${POSTGRES_DB}
    username: ${POSTGRES_USER}
    password: ${POSTGRES_PASSWORD}
  jpa:
    hibernate:
      ddl-auto: update

eureka:
  client:
    service-url:
      defaultZone: http://discovery-server:8761/eureka

management:
  endpoint:
    health:
      probes:
        enabled: true
  endpoints:
    web:
      exposure:
        include: health
```

### 4. Create the inventory-db Secret

The postgres-inventory StatefulSet already exists in `k8s/infrastructure/`. Apply it and create its Secret:

```bash
kubectl create secret generic inventory-db-credentials \
  --from-literal=POSTGRES_DB=inventorydb \
  --from-literal=POSTGRES_USER=shopnow \
  --from-literal=POSTGRES_PASSWORD=changeme \
  -n shopnow

kubectl apply -f k8s/infrastructure/postgres-inventory.yaml
kubectl apply -f k8s/infrastructure/postgres-inventory-svc.yaml
```

### 5. Build and deploy inventory-service

```bash
eval $(minikube docker-env)
cd services/inventory-service
./mvnw spring-boot:build-image -Dspring-boot.build-image.imageName=shopnow/inventory-service:latest
cd ../..

kubectl apply -f k8s/inventory-service/deployment.yaml
kubectl apply -f k8s/inventory-service/service.yaml
kubectl rollout status deployment/inventory-service -n shopnow --timeout=120s
```

Verify it registered with Eureka:

```bash
kubectl port-forward svc/discovery-server 8761:8761 -n shopnow
# Open http://localhost:8761 — INVENTORY-SERVICE should appear in the registry
```

Seed some test data:

```bash
kubectl port-forward svc/inventory-service 8083:8083 -n shopnow
curl -X PUT "http://localhost:8083/api/inventory/SKU-1?quantity=100"
curl -X PUT "http://localhost:8083/api/inventory/SKU-2?quantity=0"
curl "http://localhost:8083/api/inventory?skuCodes=SKU-1,SKU-2"
# Expected: [{skuCode:"SKU-1",inStock:true},{skuCode:"SKU-2",inStock:false}]
```

### 6. Update order-service to check inventory with a circuit breaker

#### 6a. Add dependencies to `services/order-service/pom.xml`

```xml
<!-- Circuit breaker -->
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-circuitbreaker-resilience4j</artifactId>
</dependency>

<!-- AOP — required for @CircuitBreaker annotation to work -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-aop</artifactId>
</dependency>
```

#### 6b. Add CB config to `order-service.yaml` in your config repo

Append to the existing file:

```yaml
resilience4j:
  circuitbreaker:
    instances:
      inventory-service:
        sliding-window-size: 10
        minimum-number-of-calls: 5
        failure-rate-threshold: 50
        wait-duration-in-open-state: 30s
        permitted-number-of-calls-in-half-open-state: 3
        register-health-indicator: true

management:
  health:
    circuitbreakers:
      enabled: true
```

#### 6c. Implement the inventory check in order-service

Skeleton files are in `services/order-service/src/`:

- `client/InventoryClient.java` — Feign interface (fill in the method)
- `dto/InventoryResponse.java` — DTO record (fill in the fields)
- `service/InventoryCheckService.java` — CB wrapper bean (fill in the methods)

Implement `InventoryClient`:

```java
@FeignClient(name = "inventory-service")
public interface InventoryClient {
    @GetMapping("/api/inventory")
    List<InventoryResponse> checkStock(@RequestParam List<String> skuCodes);
}
```

Implement `InventoryCheckService.checkInventory()` with `@CircuitBreaker` and a fallback.

Update `OrderController.create()`:
1. Collect all `skuCode`s from the incoming `OrderRequest`
2. Call `inventoryCheckService.checkInventory(skuCodes)`
3. If any item has `inStock = false`, throw `ResponseStatusException(409 CONFLICT, "Item out of stock: SKU-X")`
4. Only proceed to save the order if all items are in stock

Rebuild and redeploy order-service after these changes.

### 7. Apply the PodDisruptionBudget

```bash
kubectl apply -f k8s/inventory-service/pdb.yaml

kubectl get pdb -n shopnow
kubectl describe pdb inventory-service-pdb -n shopnow
```

### 8. Test the circuit breaker

**Before scaling down, get a real product ID.** The order endpoint calls product-service first
to resolve the skuCode — if the product doesn't exist the request 404s before inventory is
ever touched and the circuit breaker never accumulates failures.

```bash
kubectl port-forward svc/api-gateway 8080:8080 -n shopnow &
# Fetch products and note an ID from the response
curl -s http://localhost:8080/api/products | jq '.[0].id'
# Note the ID — use it as PRODUCT_ID below (e.g. 1)
```

Now scale inventory-service to 0 to simulate it going down:

```bash
kubectl scale deployment inventory-service --replicas=0 -n shopnow
```

Send order requests until the circuit opens — replace `1` with your actual product ID:

```bash
for i in $(seq 1 7); do
  curl -s -X POST http://localhost:8080/api/orders \
    -H "Content-Type: application/json" \
    -d '{"orderLineItems":[{"productId":1,"quantity":2}]}'
  echo
done
```

The first 5 calls will hang briefly then return 503 (Feign timeout → circuit records a failure).
Calls 6 and 7 should return 503 immediately — that's the circuit short-circuiting, no network
call made.

After the circuit opens, check order-service health:

```bash
kubectl port-forward svc/order-service 8082:8082 -n shopnow
curl -s http://localhost:8082/actuator/health | jq .
# Look for: "circuitBreakers" > "inventoryService" > "status": "CIRCUIT_OPEN"
```

Restore inventory-service and watch the circuit self-heal:

```bash
kubectl scale deployment inventory-service --replicas=1 -n shopnow
# Wait ~30s for HALF_OPEN, then one successful call closes the circuit
watch -n 3 'curl -s http://localhost:8082/actuator/health | jq ".components.circuitBreakers"'
```

---

## Notes & Learnings

> _Record anything surprising, problems you hit, or insights you had._

---

## Up Next

[Lesson 12 — RBAC & ServiceAccounts: User Service](lesson-12-user-service.md)