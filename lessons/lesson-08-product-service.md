# Lesson 08 — Health Probes: Product Service Deployment

**Status:** [x] Complete
**K8s Concepts:** Startup probe, liveness probe, readiness probe
**Spring Boot Concepts:** Spring Data JPA, Spring Web, Actuator health indicators, Eureka client

---

## Concept: The Three Probes

Kubernetes has three independent health checks for a container. Understanding when each
fires — and what K8s does when it fails — is critical:

| Probe | Question | On failure | Use for |
|---|---|---|---|
| **Startup** | Is the app done starting? | Kill & restart | Slow JVM / slow DB migration |
| **Liveness** | Is the app alive (not deadlocked)? | Kill & restart | Hung threads, memory leaks |
| **Readiness** | Is the app ready to serve traffic? | Remove from Service endpoints | DB unavailable, warming up |

```
Pod lifecycle with all three probes:

  [0s]  Container starts
  [0s]  Startup probe begins polling /actuator/health
        (liveness + readiness are PAUSED while startup is running)
  [~30s] Startup probe passes → liveness + readiness probes begin
  [~35s] Readiness probe passes → Pod added to Service endpoints → traffic flows

  Later:
  - DB goes down → readiness fails → Pod silently removed from endpoints
  - Deadlock detected → liveness fails → Pod killed & restarted
```

### Why separate liveness and readiness?

A pod with a broken database connection should **stop receiving traffic** (readiness failure)
but should **not be restarted** — restarting won't fix the database. That's the distinction.

### Spring Boot Actuator health groups

Spring Boot 3.x/4.x exposes dedicated endpoints for K8s probes when it detects it is
running inside a K8s environment (or when `management.endpoint.health.probes.enabled=true`):

- `/actuator/health/liveness` — `LivenessStateHealthIndicator`
- `/actuator/health/readiness` — `ReadinessStateHealthIndicator` (includes DB, config-server)

---

## Your Task

### 1. Implement the Product Service Spring Boot app

In `services/product-service/`, create a Spring Boot app. Required `pom.xml` dependencies:

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

Local `src/main/resources/application.yml` — minimal, rest comes from config-server:

```yaml
spring:
  application:
    name: product-service
  config:
    import: "configserver:http://config-server:8888"
```

Add to your `shopnow-config` git repo as `product-service.yaml`:

```yaml
server:
  port: 8081

spring:
  datasource:
    url: jdbc:postgresql://postgres-product:5432/productdb
    username: ${POSTGRES_USER}        # injected from product-db-credentials (created in Lesson 06)
    password: ${POSTGRES_PASSWORD}    # injected from product-db-credentials (created in Lesson 06)
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
        enabled: true                 # expose /liveness and /readiness endpoints
  endpoints:
    web:
      exposure:
        include: health
```

**Yes, the business logic needs to be implemented before you can build and deploy.**
You can write it yourself or ask Claude to generate it. Either way, here is the spec:

---

#### Product Service — High-Level Spec

**`Product` entity**

| Field | Type | Notes |
|---|---|---|
| `id` | `Long` | Auto-generated primary key |
| `name` | `String` | Required, not blank |
| `description` | `String` | Optional |
| `price` | `BigDecimal` | Required, positive |
| `stockQuantity` | `Integer` | Required, non-negative |
| `skuCode` | `String` | Unique identifier per product |

**`ProductRepository`**

- Extends `JpaRepository<Product, Long>`
- One extra method: find by `skuCode`

**`ProductController`** — REST endpoints under `/api/products`

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/products` | Return all products |
| `GET` | `/api/products/{id}` | Return one product |
| `POST` | `/api/products` | Create a product |
| `PUT` | `/api/products/{id}` | Update a product |
| `DELETE` | `/api/products/{id}` | Delete a product |

Return `404` when a product is not found. No authentication required at this stage.

---

> **No new Secret needed** — `product-db-credentials` was already created in Lesson 06 step 1.

### 2. Create the Deployment

Create `k8s/product-service/deployment.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: product-service
  namespace: shopnow
  labels:
    app: product-service
    part-of: shopnow
    version: "1.0"
spec:
  replicas: 1
  selector:
    matchLabels:
      app: product-service
  template:
    metadata:
      labels:
        app: product-service
        part-of: shopnow
        version: "1.0"
    spec:
      containers:
        - name: product-service
          image: shopnow/product-service:latest
          imagePullPolicy: Never
          ports:
            - containerPort: 8081
          env:
            - name: POSTGRES_USER
              valueFrom:
                secretKeyRef:
                  name: product-db-credentials
                  key: POSTGRES_USER
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: product-db-credentials
                  key: POSTGRES_PASSWORD
          startupProbe:
            httpGet:
              path: /actuator/health
              port: 8081
            failureThreshold: 30    # 30 × 10s = 5 min max startup time
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: 8081
            periodSeconds: 10
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: 8081
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

> **Note:** `initialDelaySeconds` is not needed on liveness/readiness when a startup probe
> is present — K8s will not run them until the startup probe has passed.

### 4. Create the Service

Create `k8s/product-service/service.yaml`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: product-service
  namespace: shopnow
  labels:
    app: product-service
    part-of: shopnow
    version: "1.0"
spec:
  selector:
    app: product-service
  ports:
    - port: 8081
      targetPort: 8081
```

### 5. Build and deploy

```bash
eval $(minikube docker-env)
cd services/product-service
./mvnw spring-boot:build-image -Dspring-boot.build-image.imageName=shopnow/product-service:latest
cd ../..

kubectl apply -f k8s/product-service/deployment.yaml
kubectl apply -f k8s/product-service/service.yaml
kubectl rollout status deployment/product-service -n shopnow --timeout=120s
```

### 6. Test the probes

```bash
# Watch readiness in action — delete the pod and watch traffic stop then resume
kubectl delete pod -l app=product-service -n shopnow
kubectl get pods -n shopnow -w

# Inspect the probe results
kubectl describe pod -l app=product-service -n shopnow | grep -A5 "Liveness\|Readiness\|Startup"

# Hit the health endpoints directly
kubectl port-forward svc/product-service 8081:8081 -n shopnow
curl http://localhost:8081/actuator/health/liveness
curl http://localhost:8081/actuator/health/readiness
```

---

## Notes & Learnings

> _Record anything surprising, problems you hit, or insights you had._

---

## Up Next

[Lesson 09 — Ingress: API Gateway as the Single Entry Point](lesson-09-ingress.md)
