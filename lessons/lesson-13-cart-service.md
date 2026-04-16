# Lesson 13 — Redis StatefulSet: Cart Service

**Status:** [x] Complete
**K8s Concepts:** StatefulSet (Redis), Headless Service, stable pod DNS
**Spring Boot Concepts:** Spring Data Redis, Hash operations, cache-aside pattern

---

## Concept: Why StatefulSet for Redis?

A regular Deployment gives every pod a random name (`redis-7f8d6b-xkpqz`). When the pod
is rescheduled, the name changes — and so does its DNS entry. For stateless apps that is
fine. For Redis it is not.

Redis persistence writes data to disk. When the pod comes back after a restart, it must
reconnect to **the same PersistentVolumeClaim** so it can replay the AOF/RDB file. K8s
can only guarantee this if the pod has a **stable identity**.

A **StatefulSet** provides three guarantees a Deployment does not:

| Guarantee | What it means |
|---|---|
| Stable pod names | `redis-0`, `redis-1`, … — same name after restart |
| Stable DNS | `redis-0.redis.shopnow.svc.cluster.local` always resolves to `redis-0` |
| Ordered startup/shutdown | Pod N is not started until Pod N-1 is Running/Ready |

---

## Concept: Headless Service and Pod DNS

A normal ClusterIP Service gives you one virtual IP that load-balances across pods.
A **Headless Service** (`clusterIP: None`) does not create a virtual IP. Instead, DNS
resolves the service name directly to the set of pod IPs.

More importantly for StatefulSets, each pod gets its own DNS A record:

```
<pod-name>.<service-name>.<namespace>.svc.cluster.local
redis-0.redis.shopnow.svc.cluster.local  →  10.244.0.x
```

This is what allows cart-service to always reach the same Redis pod even after
rescheduling — it uses the stable DNS name, not a pod IP.

```
kubectl get svc redis -n shopnow
# NAME    TYPE        CLUSTER-IP   EXTERNAL-IP   PORT(S)    AGE
# redis   ClusterIP   None         <none>        6379/TCP   ...
#         ^^^^^^^^^^^
#         clusterIP: None = headless
```

---

## Concept: Cache-Aside vs Redis as Primary Store

**Cache-aside** (typical use of Redis alongside a SQL DB):
```
Read:   check Redis → hit: return value │ miss: query Postgres, write to Redis, return
Write:  write Postgres → invalidate or update Redis key
```

**Redis as primary store** (this lesson's approach for the cart):
```
The cart lives entirely in Redis. There is no SQL database for cart data.
Redis Hash: cart:{userId}  →  field: productId,  value: quantity
```

The cart is ephemeral by nature — it is acceptable to lose it if Redis is restarted
(though with a PVC and AOF persistence the data survives). This avoids a fourth
PostgreSQL StatefulSet just for cart data.

### Redis Hash structure

```
HSET cart:user-42  product-101  2    # 2 units of product-101
HSET cart:user-42  product-205  1    # 1 unit of product-205
HGETALL cart:user-42
# → { "product-101": "2", "product-205": "1" }
```

Spring Data Redis exposes this via `HashOperations<String, String, Integer>`.

---

## Concept: Spring Data Redis

Add `spring-boot-starter-data-redis`. Spring Boot auto-configures a `LettuceConnectionFactory`
using `spring.data.redis.host` and `spring.data.redis.port`.

```java
@Configuration
public class RedisConfig {

    @Bean
    public RedisTemplate<String, Object> redisTemplate(RedisConnectionFactory factory) {
        RedisTemplate<String, Object> template = new RedisTemplate<>();
        template.setConnectionFactory(factory);
        // Use String serializer for keys and hash keys; Jackson for values
        template.setKeySerializer(new StringRedisSerializer());
        template.setHashKeySerializer(new StringRedisSerializer());
        template.setHashValueSerializer(new GenericJackson2JsonRedisSerializer());
        return template;
    }
}
```

Inject `HashOperations` from the template:

```java
private final HashOperations<String, String, Integer> hashOps;

public CartService(RedisTemplate<String, Object> redisTemplate) {
    this.hashOps = redisTemplate.opsForHash();
}
```

---

## Your Task

### 1. Create the Redis StatefulSet

Create `k8s/infrastructure/redis.yaml`:

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: redis
  namespace: shopnow
  labels:
    app: redis
    part-of: shopnow
spec:
  serviceName: redis
  replicas: 1
  selector:
    matchLabels:
      app: redis
  template:
    metadata:
      labels:
        app: redis
        part-of: shopnow
    spec:
      containers:
        - name: redis
          image: redis:7-alpine
          imagePullPolicy: IfNotPresent
          args: ["--appendonly", "yes"]   # enable AOF persistence
          ports:
            - containerPort: 6379
          volumeMounts:
            - name: redis-data
              mountPath: /data
          resources:
            requests:
              memory: "128Mi"
              cpu: "100m"
            limits:
              memory: "256Mi"
              cpu: "200m"
  volumeClaimTemplates:
    - metadata:
        name: redis-data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: standard
        resources:
          requests:
            storage: 1Gi
```

Create `k8s/infrastructure/redis-svc.yaml`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: redis
  namespace: shopnow
  labels:
    app: redis
    part-of: shopnow
spec:
  clusterIP: None
  selector:
    app: redis
  ports:
    - port: 6379
      targetPort: 6379
```

Apply both:

```bash
kubectl apply -f k8s/infrastructure/redis.yaml
kubectl apply -f k8s/infrastructure/redis-svc.yaml

kubectl rollout status statefulset/redis -n shopnow --timeout=60s

# Verify the stable DNS entry exists
kubectl run -it --rm dns-test --image=busybox:1.36 --restart=Never -n shopnow -- \
  nslookup redis-0.redis.shopnow.svc.cluster.local
# Should resolve to the pod IP
```

### 2. Implement the Cart Service

Generate a Spring Boot project at [start.spring.io](https://start.spring.io) with:

| Dependency | Starter |
|---|---|
| Spring Web | `spring-boot-starter-web` |
| Spring Data Redis | `spring-boot-starter-data-redis` |
| Spring Boot Actuator | `spring-boot-starter-actuator` |
| Config Client | `spring-cloud-starter-config` |
| Eureka Discovery Client | `spring-cloud-starter-netflix-eureka-client` |

Place the generated project in `services/cart-service/`.

#### `RedisConfig`

```java
@Configuration
public class RedisConfig {

    @Bean
    public RedisTemplate<String, Object> redisTemplate(RedisConnectionFactory factory) {
        RedisTemplate<String, Object> template = new RedisTemplate<>();
        template.setConnectionFactory(factory);
        template.setKeySerializer(new StringRedisSerializer());
        template.setHashKeySerializer(new StringRedisSerializer());
        template.setHashValueSerializer(new GenericJackson2JsonRedisSerializer());
        return template;
    }
}
```

#### `CartService`

Key prefix: `cart:{userId}` — each user's cart is one Redis Hash.

Methods to implement:

| Method | Redis operation | Description |
|---|---|---|
| `addItem(userId, productId, quantity)` | `HINCRBY` | Increment quantity (creates field if absent) |
| `removeItem(userId, productId)` | `HDEL` | Remove one product from cart |
| `getCart(userId)` | `HGETALL` | Return Map of productId → quantity |
| `clearCart(userId)` | `DEL` | Remove the entire cart key |

#### `CartController`

| Method | Path | Body / Params | Response |
|---|---|---|---|
| `GET` | `/api/cart/{userId}` | — | `Map<String, Integer>` |
| `POST` | `/api/cart/{userId}/items` | `{ productId, quantity }` | `200` |
| `DELETE` | `/api/cart/{userId}/items/{productId}` | — | `204` |
| `DELETE` | `/api/cart/{userId}` | — | `204` |

### 3. Add cart-service config to your config repo

Add `cart-service.yaml` to your `shopnow-config` git repo:

```yaml
server:
  port: 8085

spring:
  data:
    redis:
      host: redis-0.redis.shopnow.svc.cluster.local
      port: 6379

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

> **Why `redis-0.redis...` and not just `redis`?** Both work for single-replica setups.
> Using the pod DNS (`redis-0`) is an explicit statement of intent: cart-service is
> pinned to the primary Redis pod. If you later add replicas, you would route reads to
> `redis-1.redis...` and writes to `redis-0.redis...`.

### 4. Create the Deployment and Service

Create `k8s/cart-service/deployment.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cart-service
  namespace: shopnow
  labels:
    app: cart-service
    part-of: shopnow
    version: "1.0"
spec:
  replicas: 1
  selector:
    matchLabels:
      app: cart-service
  template:
    metadata:
      labels:
        app: cart-service
        part-of: shopnow
        version: "1.0"
    spec:
      containers:
        - name: cart-service
          image: shopnow/cart-service:latest
          imagePullPolicy: Never
          ports:
            - containerPort: 8085
          startupProbe:
            httpGet:
              path: /actuator/health
              port: 8085
            failureThreshold: 30
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: 8085
            periodSeconds: 10
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: 8085
            periodSeconds: 5
            failureThreshold: 3
          resources:
            requests:
              memory: "256Mi"
              cpu: "250m"
            limits:
              memory: "512Mi"
              cpu: "500m"
```

Create `k8s/cart-service/service.yaml`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: cart-service
  namespace: shopnow
  labels:
    app: cart-service
    part-of: shopnow
    version: "1.0"
spec:
  selector:
    app: cart-service
  ports:
    - port: 8085
      targetPort: 8085
```

Add the route to `api-gateway.yaml` in your config repo:

```yaml
- id: cart-service
  uri: http://cart-service:8085
  predicates:
    - Path=/api/cart/**
```

### 5. Build and deploy

```bash
eval $(minikube docker-env)
cd services/cart-service
./mvnw spring-boot:build-image -Dspring-boot.build-image.imageName=shopnow/cart-service:latest
cd ../..

kubectl apply -f k8s/cart-service/
kubectl rollout status deployment/cart-service -n shopnow --timeout=120s
```

### 6. Test the cart

```bash
kubectl port-forward svc/api-gateway 8080:8080 -n shopnow

# Add items to user-42's cart
curl -s -X POST http://localhost:8080/api/cart/user-42/items \
  -H "Content-Type: application/json" \
  -d '{"productId":"product-101","quantity":2}'

curl -s -X POST http://localhost:8080/api/cart/user-42/items \
  -H "Content-Type: application/json" \
  -d '{"productId":"product-205","quantity":1}'

# View the cart
curl -s http://localhost:8080/api/cart/user-42
# Expected: {"product-101":2,"product-205":1}

# Remove one item
curl -s -X DELETE http://localhost:8080/api/cart/user-42/items/product-101

# Clear the cart
curl -s -X DELETE http://localhost:8080/api/cart/user-42
```

### 7. Inspect Redis directly

```bash
kubectl exec -it redis-0 -n shopnow -- redis-cli

KEYS *               # list all keys
HGETALL cart:user-42 # inspect a cart hash
TTL cart:user-42     # -1 = no expiry set
```

> **Optional exercise:** add an expiry with `EXPIRE cart:{userId} 86400` (24 hours)
> so abandoned carts are auto-cleaned. Use `hashOps` template's `expire()` call
> after any write operation.

---

## Notes & Learnings

- Repo scaffolding added:
  - `k8s/infrastructure/redis.yaml`
  - `k8s/infrastructure/redis-svc.yaml`
  - `k8s/cart-service/deployment.yaml`
  - `k8s/cart-service/service.yaml`
  - `services/cart-service` Redis config, controller, DTO, and service classes
- The cart implementation stores one Redis Hash per user using the key pattern `cart:{userId}`.
- Operational follow-up remains outside this repo:
  - add `cart-service.yaml` and the `/api/cart/**` route in the external config repo
  - build the `shopnow/cart-service:latest` image
  - apply the manifests and verify rollout in the cluster

---

## Up Next

[Lesson 14 — Kafka StatefulSet & Headless Services: Notification Service](lesson-14-notification-service.md)
