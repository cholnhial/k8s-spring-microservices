# Lesson 16 — Sidecar Pattern: Distributed Tracing with Zipkin

**Status:** [x] Complete
**K8s Concepts:** Sidecar container, multi-container Pod, shared volumes between containers
**Spring Boot Concepts:** Micrometer Tracing, Brave, Zipkin reporter, trace/span propagation

---

## Current Project Alignment

Lesson 16 starts from the platform as it exists after Lesson 15:

- Browser traffic enters through `shopnow.local` Ingress, then reaches `frontend`.
- The frontend nginx ConfigMap proxies `/api/*` to `api-gateway:8080`.
- `api-gateway` validates JWTs for all non-public API paths.
- `order-service` now publishes `order-created` Kafka events.
- `notification-service` consumes those events from Kafka.
- Kafka and ZooKeeper use `bitnamilegacy/kafka:3.7` and `bitnamilegacy/zookeeper:3.9`.

Tracing should cover synchronous HTTP calls first. Kafka producer/consumer tracing is
a useful extension after the basic Zipkin HTTP waterfall is visible.

---

## Concept: The Sidecar Pattern

A **sidecar** is a second container that runs in the same pod as your main application
container. Because they share the same pod, sidecars share:

- **Network namespace** — same `localhost`, same port space
- **Volumes** — can read/write the same files
- **Lifecycle** — start and stop together

```
┌───────────────── Pod ─────────────────────────────┐
│                                                   │
│  ┌─────────────────┐    ┌────────────────────┐   │
│  │  app container  │    │  sidecar container │   │
│  │                 │◄──►│                    │   │
│  │  port 8081      │    │  port 9411 (local) │   │
│  └─────────────────┘    └────────────────────┘   │
│                                                   │
│  shared volume: /var/log/app/                     │
└───────────────────────────────────────────────────┘
```

Common sidecar use cases:

| Sidecar | What it does |
|---|---|
| Log shipper (Fluent Bit) | Reads app log files, forwards to Elasticsearch/Loki |
| Service mesh proxy (Envoy, Linkerd) | Intercepts all network traffic for mTLS, retries, metrics |
| Secrets injector (Vault Agent) | Fetches secrets from Vault, writes them to a shared volume |
| OTEL Collector | Receives traces/metrics from the app, forwards to backend |

### Sidecar YAML pattern

```yaml
spec:
  containers:
    - name: app
      image: shopnow/product-service:latest
      volumeMounts:
        - name: shared-logs
          mountPath: /var/log/app

    - name: log-shipper        # ← the sidecar
      image: fluent/fluent-bit:latest
      volumeMounts:
        - name: shared-logs    # same volume = sees the app's logs
          mountPath: /var/log/app
          readOnly: true

  volumes:
    - name: shared-logs
      emptyDir: {}             # ephemeral, lives as long as the pod
```

---

## Concept: Distributed Tracing

When a client request enters the api-gateway and fans out across product-service,
inventory-service, and order-service, a single latency measurement at the gateway
tells you very little. Distributed tracing gives you the full picture:

```
Trace ID: abc123
│
├── Span: api-gateway          0ms → 145ms  (total request time)
│     │
│     ├── Span: product-service   5ms → 30ms
│     │
│     └── Span: order-service    31ms → 140ms
│               │
│               └── Span: inventory-service  35ms → 95ms
```

Each **span** records:
- Service name
- Operation name
- Start time and duration
- Parent span ID (links spans into a tree)
- Tags (HTTP method, status code, DB query)

All spans sharing the same **trace ID** are displayed together in the Zipkin UI as a
waterfall diagram, making it obvious where latency comes from.

### How trace context propagates

Spring Cloud Sleuth / Micrometer Tracing injects and reads HTTP headers automatically:

```
Client → api-gateway
         Headers added by Micrometer:
           X-B3-TraceId:  abc123
           X-B3-SpanId:   span-gateway
           X-B3-Sampled:  1

api-gateway → product-service
         Headers forwarded:
           X-B3-TraceId:  abc123       ← same trace
           X-B3-SpanId:   span-product ← new span for this hop
           X-B3-ParentSpanId: span-gateway
```

The receiving service reads these headers, creates a child span, and reports it to
Zipkin along with the shared trace ID. Zipkin stitches the spans into the tree.

---

## Concept: Micrometer Tracing + Zipkin

Spring Boot 3+ uses **Micrometer Tracing** (replacing Spring Cloud Sleuth). The
tracing bridge is **Brave** (Zipkin's client library). The reporter sends spans to Zipkin.

Add to each service's `pom.xml`:

```xml
<!-- Spring Boot 4 tracing auto-configuration -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-micrometer-tracing</artifactId>
</dependency>

<!-- Brave tracer and propagation auto-configuration -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-micrometer-tracing-brave</artifactId>
</dependency>

<!-- Spring Boot 4 Zipkin exporter auto-configuration -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-zipkin</artifactId>
</dependency>

<!-- Micrometer tracing with Brave bridge -->
<dependency>
    <groupId>io.micrometer</groupId>
    <artifactId>micrometer-tracing-bridge-brave</artifactId>
</dependency>

<!-- Zipkin reporter — sends spans over HTTP to Zipkin -->
<dependency>
    <groupId>io.zipkin.reporter2</groupId>
    <artifactId>zipkin-reporter-brave</artifactId>
</dependency>
```

Add to each service's config in your config repo:

```yaml
management:
  tracing:
    sampling:
      probability: 1.0           # sample 100% of requests (dev only; use 0.1 in prod)
    export:
      zipkin:
        endpoint: http://zipkin:9411/api/v2/spans
```

Spring Boot 4 auto-configures HTTP tracing once those dependencies and config are present.
No controller code changes are needed.

> **Project note:** ShopNow uses `config-server` as the source of truth for Spring
> application config. Do not duplicate these tracing properties into Kubernetes
> environment variables unless you are deliberately overriding config-server values.

---

## Your Task

### 1. Deploy Zipkin

Zipkin is a standalone service — it collects and stores spans sent by your Spring Boot
services. In this lesson it runs as a regular Deployment (not a sidecar), because it
is shared infrastructure, not a per-pod helper.

`k8s/infrastructure/zipkin.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: zipkin
  namespace: shopnow
  labels:
    app: zipkin
    part-of: shopnow
    version: "1.0"
spec:
  replicas: 1
  selector:
    matchLabels:
      app: zipkin
  template:
    metadata:
      labels:
        app: zipkin
        part-of: shopnow
        version: "1.0"
    spec:
      containers:
        - name: zipkin
          image: openzipkin/zipkin:3
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 9411
          env:
            - name: STORAGE_TYPE
              value: mem          # in-memory storage; data lost on restart — fine for dev
          resources:
            requests:
              memory: "256Mi"
              cpu: "100m"
            limits:
              memory: "512Mi"
              cpu: "250m"
```

`k8s/infrastructure/zipkin-svc.yaml`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: zipkin
  namespace: shopnow
  labels:
    app: zipkin
    part-of: shopnow
    version: "1.0"
spec:
  selector:
    app: zipkin
  ports:
    - port: 9411
      targetPort: 9411
```

Apply when you are ready:

```bash
kubectl apply -f k8s/infrastructure/zipkin.yaml
kubectl apply -f k8s/infrastructure/zipkin-svc.yaml
kubectl rollout status deployment/zipkin -n shopnow --timeout=60s
```

### 2. Add tracing dependencies to each service

For each of these services, add the two dependencies to `pom.xml`:

- `api-gateway`
- `product-service`
- `order-service`
- `inventory-service`
- `user-service`
- `cart-service`
- `notification-service`
- `config-server`
- `discovery-server`

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-micrometer-tracing</artifactId>
</dependency>
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-micrometer-tracing-brave</artifactId>
</dependency>
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-zipkin</artifactId>
</dependency>
<dependency>
    <groupId>io.micrometer</groupId>
    <artifactId>micrometer-tracing-bridge-brave</artifactId>
</dependency>
<dependency>
    <groupId>io.zipkin.reporter2</groupId>
    <artifactId>zipkin-reporter-brave</artifactId>
</dependency>
```

For `order-service`, add Feign's Micrometer integration too. This lets OpenFeign create
observed client spans and propagate trace headers to `product-service` and
`inventory-service`:

```xml
<dependency>
    <groupId>io.github.openfeign</groupId>
    <artifactId>feign-micrometer</artifactId>
</dependency>
```

### 3. Confirm tracing config in the config repo

Each traced service should receive these values from `shopnow-config/` through
`config-server`:

```yaml
management:
  tracing:
    sampling:
      probability: 1.0
    export:
      zipkin:
        endpoint: http://zipkin:9411/api/v2/spans
```

Commit and push the config repo if needed, then rebuild and redeploy each service:

```bash
eval $(minikube docker-env)

for svc in api-gateway product-service order-service inventory-service user-service cart-service notification-service config-server discovery-server; do
  echo "Building $svc..."
  cd services/$svc
  ./mvnw spring-boot:build-image -Dspring-boot.build-image.imageName=shopnow/${svc}:latest -q
  cd ../..
  kubectl rollout restart deployment/$svc -n shopnow
done

kubectl rollout status deployment/product-service -n shopnow --timeout=120s
```

> **Why `${svc}` and not `$svc`?** In zsh, `$svc:latest` can be interpreted as a
> parameter expansion with a modifier, producing bad image names such as
> `shopnow/api-gatewayatest:latest`. Braces make the variable boundary explicit:
> `shopnow/${svc}:latest`.

### 4. Open the Zipkin UI

```bash
kubectl port-forward svc/zipkin 9411:9411 -n shopnow
```

Open [http://localhost:9411](http://localhost:9411).

At this point you will see nothing — Zipkin only shows traces after requests arrive.

### 5. Generate some traces

```bash
# Use the same path the browser uses: Ingress -> frontend nginx -> api-gateway.
# Login first because api-gateway currently protects product/order/cart APIs.
TOKEN=$(curl -s -X POST http://shopnow.local/api/users/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"password"}' | jq -r .token)

# A simple product list — api-gateway -> product-service
curl -s http://shopnow.local/api/products \
  -H "Authorization: Bearer $TOKEN"

# An order — api-gateway → order-service → inventory-service (via circuit breaker) + Kafka publish
curl -s -X POST http://shopnow.local/api/orders \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"orderLineItems":[{"productId":1,"quantity":1}]}'
```

### 6. Explore traces in the Zipkin UI

In the Zipkin UI:
1. Click **Run Query** to list recent traces
2. Click a trace to see the waterfall view
3. Click individual spans to see tags (HTTP method, status, URL)
4. Compare latency across services

Look specifically for the order creation trace — it should show:
```
api-gateway  →  order-service  →  inventory-service
```

The order request also publishes to Kafka. In the basic Micrometer HTTP setup, that
Kafka boundary may not appear as a single connected waterfall unless Kafka tracing
instrumentation is also enabled.

### 7. Demonstrate the sidecar pattern with a log-shipping sidecar

Add a sidecar to the **product-service** Deployment that streams application logs to
stdout (simulating a log shipper):

`k8s/product-service/deployment.yaml` now includes a second container and a shared volume:

```yaml
spec:
  template:
    spec:
      containers:
        - name: product-service
          # ... existing spec ...
          volumeMounts:
            - name: app-logs
              mountPath: /var/log/app

        - name: log-shipper          # ← sidecar
          image: busybox:1.36
          command: ["sh", "-c", "while [ ! -f /var/log/app/app.log ]; do sleep 2; done; tail -n +1 -f /var/log/app/app.log"]
          volumeMounts:
            - name: app-logs
              mountPath: /var/log/app
              readOnly: true
          resources:
            requests:
              memory: "16Mi"
              cpu: "10m"
            limits:
              memory: "32Mi"
              cpu: "25m"

      volumes:
        - name: app-logs
          emptyDir: {}
```

Apply, then inspect both containers in the pod:

```bash
kubectl apply -f k8s/product-service/deployment.yaml

# The pod now has two containers — note READY shows 2/2
kubectl get pods -n shopnow -l app=product-service
# NAME                               READY   STATUS    ...
# product-service-xxxx-yyyy          2/2     Running   ...

# View main app container logs
kubectl logs deployment/product-service -n shopnow -c product-service

# View the sidecar's output
kubectl logs deployment/product-service -n shopnow -c log-shipper
```

> **Key observation:** `-c <container-name>` is required when a pod has multiple containers.
> Without it, kubectl defaults to the first container.

Do **not** add this sidecar to the frontend nginx pod. The frontend is already a small
nginx-only static serving pod, and nginx logs to stdout by default.

To remove the sidecar after the exercise, revert the Deployment YAML to single-container
and re-apply.

---

## Notes & Learnings

- Spring Boot 4 splits observability auto-configuration into smaller modules. For
  Zipkin tracing with Brave, the services need `spring-boot-micrometer-tracing`,
  `spring-boot-micrometer-tracing-brave`, `spring-boot-zipkin`,
  `micrometer-tracing-bridge-brave`, and `zipkin-reporter-brave`.
- Boot 4 uses `management.tracing.export.zipkin.endpoint`, not the older
  `management.zipkin.tracing.endpoint` key.
- OpenFeign does not automatically create observed client spans unless
  `feign-micrometer` is on the classpath. `order-service` needs it so the
  `api-gateway -> order-service -> product-service/inventory-service` trace stays
  connected.
- In zsh, use `shopnow/${svc}:latest` in image build loops. `shopnow/$svc:latest`
  can be parsed as a zsh parameter modifier and produce image names like
  `shopnow/api-gatewayatest:latest`.
- Zipkin's waterfall view showed the completed order trace as:
  `api-gateway -> order-service -> product-service -> inventory-service`, with
  order-service producing the outgoing Feign client spans.

---

## Up Next

[Lesson 17 — HorizontalPodAutoscaler: Scaling Services](lesson-17-hpa.md)
