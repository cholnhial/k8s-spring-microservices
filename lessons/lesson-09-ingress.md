# Lesson 09 — Ingress: API Gateway as the Single Entry Point

**Status:** [x] Complete
**K8s Concepts:** Ingress, IngressController, path-based routing
**Spring Boot Concepts:** Spring Cloud Gateway, route configuration

---

## Concept: Why Ingress?

Without Ingress, exposing services externally requires a `NodePort` or `LoadBalancer` per
service. In a cluster with 10 services that means 10 external ports / load balancers.

**Ingress** solves this with a single entry point:

```
Internet
    │
    ▼
┌─────────────────────────────────┐
│  Ingress (nginx)  :80           │  ← one external entry point
│                                 │
│  /api/products/** ──────────────┼──► product-service:8081
│  /api/orders/**   ──────────────┼──► order-service:8082
│  /**              ──────────────┼──► api-gateway:8080
└─────────────────────────────────┘
```

### Ingress vs IngressController

| Resource | What it is |
|---|---|
| `Ingress` | A K8s config object — declares routing rules |
| `IngressController` | The actual reverse proxy (nginx, traefik, etc.) that reads Ingress rules |

You enabled the nginx IngressController in Lesson 01 (`minikube addons enable ingress`).

### Why api-gateway in front of Ingress?

The K8s Ingress handles **cluster-edge** routing (external → cluster).
Spring Cloud Gateway handles **application-level** routing with features Ingress cannot:
- JWT validation
- Rate limiting
- Request transformation
- Circuit breaking

```
Browser → Ingress (nginx) → api-gateway (Spring Cloud Gateway) → backend services
```

---

## Your Task

### 1. Implement the API Gateway Spring Boot app

In `services/api-gateway/`, create a Spring Boot app. Required `pom.xml` dependencies:

```xml
<!-- Spring Cloud Gateway (reactive — do NOT add spring-boot-starter-web) -->
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-gateway</artifactId>
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

> **Important:** Spring Cloud Gateway is **reactive** (Netty, not Tomcat). Do not add
> `spring-boot-starter-web` — it will conflict.

Local `src/main/resources/application.yml`:

```yaml
spring:
  application:
    name: api-gateway
  config:
    import: "configserver:http://config-server:8888"
```

Add to your `shopnow-config` git repo as `api-gateway.yaml`:

```yaml
server:
  port: 8080

spring:
  cloud:
    gateway:
      server:
        webmvc:
          # Spring Cloud 2025.x uses spring-cloud-starter-gateway-server-webmvc (MVC/Tomcat).
          # Its config prefix is spring.cloud.gateway.server.webmvc — NOT spring.cloud.gateway.
          routes:
            - id: product-service
              uri: http://product-service:8081
              predicates:
                - Path=/api/products/**

            - id: order-service
              uri: http://order-service:8082
              predicates:
                - Path=/api/orders/**

            - id: inventory-service
              uri: http://inventory-service:8083
              predicates:
                - Path=/api/inventory/**

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

You implement: no business logic needed — the gateway is pure routing config.

### 2. Create the Deployment

Create `k8s/api-gateway/deployment.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-gateway
  namespace: shopnow
  labels:
    app: api-gateway
    part-of: shopnow
    version: "1.0"
spec:
  replicas: 1
  selector:
    matchLabels:
      app: api-gateway
  template:
    metadata:
      labels:
        app: api-gateway
        part-of: shopnow
        version: "1.0"
    spec:
      containers:
        - name: api-gateway
          image: shopnow/api-gateway:latest
          imagePullPolicy: Never
          ports:
            - containerPort: 8080
          startupProbe:
            httpGet:
              path: /actuator/health
              port: 8080
            failureThreshold: 30
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: 8080
            periodSeconds: 10
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: 8080
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

### 3. Create the Service

Create `k8s/api-gateway/service.yaml`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: api-gateway
  namespace: shopnow
  labels:
    app: api-gateway
    part-of: shopnow
    version: "1.0"
spec:
  selector:
    app: api-gateway
  ports:
    - port: 8080
      targetPort: 8080
```

### 4. Create the Ingress

Create `k8s/api-gateway/ingress.yaml`:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: shopnow-ingress
  namespace: shopnow
  labels:
    part-of: shopnow
  # No rewrite-target annotation here. The api-gateway owns the full path
  # (/api/products/**, etc.) and must receive it unchanged to route correctly.
  # rewrite-target: / would strip the path, causing 404s in the gateway.
spec:
  ingressClassName: nginx
  rules:
    - host: shopnow.local
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: api-gateway
                port:
                  number: 8080
```

### 5. Add a local DNS entry

So your browser can resolve `shopnow.local` to Minikube:

```bash
echo "$(minikube ip) shopnow.local" | sudo tee -a /etc/hosts
```

### 6. Build and deploy

```bash
eval $(minikube docker-env)
cd services/api-gateway
./mvnw spring-boot:build-image -Dspring-boot.build-image.imageName=shopnow/api-gateway:latest
cd ../..

kubectl apply -f k8s/api-gateway/deployment.yaml
kubectl apply -f k8s/api-gateway/service.yaml
kubectl apply -f k8s/api-gateway/ingress.yaml
kubectl rollout status deployment/api-gateway -n shopnow --timeout=120s
```

### 7. Verify routing

```bash
# Check the Ingress has an address assigned
kubectl get ingress -n shopnow

# Test via curl (routes through Ingress → api-gateway → product-service)
curl http://shopnow.local/api/products

# Or port-forward directly to the gateway to test routes in isolation
kubectl port-forward svc/api-gateway 8080:8080 -n shopnow
curl http://localhost:8080/api/products
```

---

## Notes & Learnings

> _Record anything surprising, problems you hit, or insights you had._

---

## Up Next

[Lesson 10 — Namespaces & Resource Limits: Order Service](lesson-10-order-service.md)
