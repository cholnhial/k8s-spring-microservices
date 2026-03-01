# Lesson 10 — Namespaces & Resource Limits: Order Service

**Status:** [x] Complete
**K8s Concepts:** ResourceQuota, LimitRange, resource requests/limits (deep dive)
**Spring Boot Concepts:** Spring Data JPA, REST, OpenFeign (inter-service calls)

---

## Concept: Requests vs Limits

Every container in this project sets `resources.requests` and `resources.limits`.
This is not optional — it is how K8s schedules and protects workloads.

| Field | What it means | Effect when exceeded |
|---|---|---|
| `requests.memory` | Guaranteed minimum | Used for scheduling (K8s won't place pod on a node without this much free) |
| `limits.memory` | Hard cap | Container is **OOMKilled** (restarted) |
| `requests.cpu` | Guaranteed share | Used for scheduling |
| `limits.cpu` | Hard cap | Container is **throttled** (not killed) |

> You saw this in action in Lesson 07 — the discovery-server was OOMKilled because its
> memory limit (512Mi) was lower than the JVM's fixed region requirements (~623MB).

### The scheduling rule

K8s schedules a pod on a node based on **requests**, not limits. A pod with
`requests.memory: 256Mi` and `limits.memory: 768Mi` will be scheduled on any node
with 256Mi free — but can use up to 768Mi at runtime.

---

## Concept: LimitRange

A **LimitRange** sets default requests/limits for any container in a namespace that
does not specify its own. It also enforces maximum values.

Without a LimitRange, a developer can accidentally deploy a container with no resource
spec — which the scheduler treats as requesting 0 CPU and 0 memory, meaning it could
be placed on any node and consume unbounded resources.

```yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: shopnow-limits
  namespace: shopnow
spec:
  limits:
    - type: Container
      default:            # applied if a container sets no limits
        memory: "512Mi"
        cpu: "500m"
      defaultRequest:     # applied if a container sets no requests
        memory: "256Mi"
        cpu: "250m"
      max:                # no container may exceed these
        memory: "1Gi"
        cpu: "2"
```

---

## Concept: ResourceQuota

A **ResourceQuota** caps the **total** resource consumption across all pods in a namespace.
It prevents a single namespace from starving the rest of the cluster.

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: shopnow-quota
  namespace: shopnow
spec:
  hard:
    requests.cpu: "4"
    requests.memory: "8Gi"
    limits.cpu: "8"
    limits.memory: "16Gi"
    pods: "20"
```

---

## Concept: How Services Communicate (Synchronous HTTP via OpenFeign + Eureka)

When order-service needs to validate that a product exists before creating an order, it
makes a **synchronous HTTP call** to product-service. The call chain looks like this:

```
Client
  │
  │  POST /api/orders
  ▼
order-service
  │
  │  1. "Where is product-service?" → asks Eureka
  │  2. Eureka returns: 10.244.x.x:8081
  │  3. GET http://10.244.x.x:8081/api/products/{id}
  ▼
product-service
  │
  │  4. Returns ProductResponse (or 404)
  ▼
order-service
  │  5a. Product found  → save order → return 201
  │  5b. Product 404   → return 404 "Product not found"
```

### OpenFeign — declarative HTTP client

Instead of writing `RestClient` boilerplate, you declare an interface and Spring generates
the HTTP implementation at runtime:

```java
@FeignClient(name = "product-service")   // name must match spring.application.name
public interface ProductClient {
    @GetMapping("/api/products/{id}")
    ProductResponse findById(@PathVariable Long id);
}
```

The `name = "product-service"` is the Eureka service name. OpenFeign asks Eureka
for the address, so **no hardcoded URLs** — it works regardless of which pod IP
product-service is running on, and automatically load-balances if there are multiple
replicas.

Add `@EnableFeignClients` to your main class to activate this:

```java
@SpringBootApplication
@EnableFeignClients
public class OrderServiceApplication { ... }
```

### Synchronous vs Asynchronous

This pattern is **synchronous** — if product-service is down, the order request fails
immediately. That is a deliberate coupling trade-off. The async alternative (publishing
an event to Kafka and letting product-service respond asynchronously) is covered in
Lesson 14 with notification-service.

---

## Your Task

### 1. Apply the LimitRange and ResourceQuota

Create `k8s/namespaces/limitrange.yaml`:

```yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: shopnow-limits
  namespace: shopnow
spec:
  limits:
    - type: Container
      default:
        memory: "512Mi"
        cpu: "500m"
      defaultRequest:
        memory: "256Mi"
        cpu: "250m"
      max:
        memory: "1Gi"
        cpu: "2"
```

Create `k8s/namespaces/resourcequota.yaml`:

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: shopnow-quota
  namespace: shopnow
spec:
  hard:
    requests.cpu: "4"
    requests.memory: "8Gi"
    limits.cpu: "8"
    limits.memory: "16Gi"
    pods: "20"
```

Apply both:

```bash
kubectl apply -f k8s/namespaces/limitrange.yaml
kubectl apply -f k8s/namespaces/resourcequota.yaml

# Inspect what is now enforced
kubectl describe limitrange shopnow-limits -n shopnow
kubectl describe resourcequota shopnow-quota -n shopnow
```

### 2. Implement the Order Service Spring Boot app

In `services/order-service/`, create a Spring Boot app. Required `pom.xml` dependencies:

```xml
<!-- REST -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
</dependency>

<!-- JPA + PostgreSQL -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-data-jpa</artifactId>
</dependency>
<dependency>
    <groupId>org.postgresql</groupId>
    <artifactId>postgresql</artifactId>
    <scope>runtime</scope>
</dependency>

<!-- Health probes -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-actuator</artifactId>
</dependency>

<!-- Synchronous calls to product-service / inventory-service -->
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-openfeign</artifactId>
</dependency>

<!-- Service discovery -->
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-netflix-eureka-client</artifactId>
</dependency>

<!-- Fetch config from config-server -->
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-config</artifactId>
</dependency>
```

Local `src/main/resources/application.yml`:

```yaml
spring:
  application:
    name: order-service
  config:
    import: "optional:configserver:http://config-server:8888"
```

Add to your `shopnow-config` git repo as `order-service.yaml`:

```yaml
server:
  port: 8082

spring:
  datasource:
    url: jdbc:postgresql://postgres-order:5432/orderdb
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

**Yes, the business logic needs to be implemented before you can build and deploy.**
You can write it yourself or ask Claude to generate it. Either way, here is the spec:

---

#### Order Service — High-Level Spec

**`OrderStatus` enum**

```
PENDING, CONFIRMED, CANCELLED
```

**`OrderLineItem` entity** (child of Order)

| Field | Type | Notes |
|---|---|---|
| `id` | `Long` | Auto-generated primary key |
| `skuCode` | `String` | Matches the product's skuCode |
| `price` | `BigDecimal` | Captured at time of order (not live) |
| `quantity` | `Integer` | Number of units ordered |

**`Order` entity**

| Field | Type | Notes |
|---|---|---|
| `id` | `Long` | Auto-generated primary key |
| `orderNumber` | `String` | UUID-generated, unique |
| `status` | `OrderStatus` | Defaults to `PENDING` on creation |
| `createdAt` | `LocalDateTime` | Set on creation |
| `orderLineItems` | `List<OrderLineItem>` | One-to-many, cascade all |

**`ProductClient`** (Feign interface — calls product-service)

| Method | Calls |
|---|---|
| `findById(Long id)` | `GET /api/products/{id}` on product-service |

**`OrderController`** — REST endpoints under `/api/orders`

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/orders` | Return all orders |
| `GET` | `/api/orders/{id}` | Return one order |
| `POST` | `/api/orders` | Create an order — for each line item, call product-service to verify the product exists and capture its current price; return `404` if any product is not found |

Return `404` when an order is not found. No authentication required at this stage.

---

### 3. Create a Secret for the order database

Following the same pattern as Lesson 06 step 5:

```bash
kubectl create secret generic order-db-credentials \
  --from-literal=POSTGRES_DB=orderdb \
  --from-literal=POSTGRES_USER=shopnow \
  --from-literal=POSTGRES_PASSWORD=changeme \
  -n shopnow
```

### 4. Create the Deployment

Create `k8s/order-service/deployment.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
  namespace: shopnow
  labels:
    app: order-service
    part-of: shopnow
    version: "1.0"
spec:
  replicas: 1
  selector:
    matchLabels:
      app: order-service
  template:
    metadata:
      labels:
        app: order-service
        part-of: shopnow
        version: "1.0"
    spec:
      containers:
        - name: order-service
          image: shopnow/order-service:latest
          imagePullPolicy: Never
          ports:
            - containerPort: 8082
          env:
            - name: POSTGRES_USER
              valueFrom:
                secretKeyRef:
                  name: order-db-credentials
                  key: POSTGRES_USER
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: order-db-credentials
                  key: POSTGRES_PASSWORD
          startupProbe:
            httpGet:
              path: /actuator/health
              port: 8082
            failureThreshold: 30
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: 8082
            periodSeconds: 10
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: 8082
            periodSeconds: 5
            failureThreshold: 3
          resources:
            requests:
              memory: "512Mi"
              cpu: "250m"
            limits:
              memory: "768Mi"
              cpu: "500m"
```

### 5. Create the Service

Create `k8s/order-service/service.yaml`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: order-service
  namespace: shopnow
  labels:
    app: order-service
    part-of: shopnow
    version: "1.0"
spec:
  selector:
    app: order-service
  ports:
    - port: 8082
      targetPort: 8082
```

### 6. Build and deploy

```bash
eval $(minikube docker-env)
cd services/order-service
./mvnw spring-boot:build-image -Dspring-boot.build-image.imageName=shopnow/order-service:latest
cd ../..

kubectl apply -f k8s/order-service/deployment.yaml
kubectl apply -f k8s/order-service/service.yaml
kubectl rollout status deployment/order-service -n shopnow --timeout=120s
```

### 7. Observe resource enforcement

```bash
# See how much of the quota is currently consumed
kubectl describe resourcequota shopnow-quota -n shopnow

# Try to deploy a pod that exceeds the LimitRange max (1Gi) — should be rejected
kubectl run oversize --image=nginx:alpine \
  --requests='memory=2Gi' \
  --limits='memory=2Gi' \
  -n shopnow
# Expected: Error — exceeds max memory 1Gi from LimitRange
```

---

## Notes & Learnings

> _Record anything surprising, problems you hit, or insights you had._

---

## Up Next

[Lesson 11 — Circuit Breaker & Resilience: Inventory Service](lesson-11-inventory-service.md)
