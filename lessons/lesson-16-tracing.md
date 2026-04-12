# Lesson 16 — Sidecar Pattern: Distributed Tracing with Zipkin

**Status:** [ ] Complete
**K8s Concepts:** Sidecar container, multi-container Pod, shared volumes between containers
**Spring Boot Concepts:** Micrometer Tracing, Brave, Zipkin reporter, trace/span propagation

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
  zipkin:
    tracing:
      endpoint: http://zipkin:9411/api/v2/spans
```

Spring Boot auto-configures everything else. No code changes needed in the services.

---

## Your Task

### 1. Deploy Zipkin

Zipkin is a standalone service — it collects and stores spans sent by your Spring Boot
services. In this lesson it runs as a regular Deployment (not a sidecar), because it
is shared infrastructure, not a per-pod helper.

Create `k8s/infrastructure/zipkin.yaml`:

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

Create `k8s/infrastructure/zipkin-svc.yaml`:

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

Apply:

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

```xml
<dependency>
    <groupId>io.micrometer</groupId>
    <artifactId>micrometer-tracing-bridge-brave</artifactId>
</dependency>
<dependency>
    <groupId>io.zipkin.reporter2</groupId>
    <artifactId>zipkin-reporter-brave</artifactId>
</dependency>
```

### 3. Add tracing config to each service in your config repo

Append to each service YAML in `shopnow-config/`:

```yaml
management:
  tracing:
    sampling:
      probability: 1.0
  zipkin:
    tracing:
      endpoint: http://zipkin:9411/api/v2/spans
```

Commit and push the config repo, then rebuild and redeploy each service:

```bash
eval $(minikube docker-env)

for svc in api-gateway product-service order-service inventory-service user-service; do
  echo "Building $svc..."
  cd services/$svc
  ./mvnw spring-boot:build-image -Dspring-boot.build-image.imageName=shopnow/$svc:latest -q
  cd ../..
  kubectl rollout restart deployment/$svc -n shopnow
done

kubectl rollout status deployment/product-service -n shopnow --timeout=120s
```

### 4. Open the Zipkin UI

```bash
kubectl port-forward svc/zipkin 9411:9411 -n shopnow
```

Open [http://localhost:9411](http://localhost:9411).

At this point you will see nothing — Zipkin only shows traces after requests arrive.

### 5. Generate some traces

```bash
kubectl port-forward svc/api-gateway 8080:8080 -n shopnow

# A simple product list — one span per service involved
curl -s http://localhost:8080/api/products

# An order — api-gateway → order-service → inventory-service (via circuit breaker) + Kafka publish
curl -s -X POST http://localhost:8080/api/orders \
  -H "Content-Type: application/json" \
  -d '{"orderLineItems":[{"skuCode":"SKU-1","price":29.99,"quantity":1}]}'
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

### 7. Demonstrate the sidecar pattern with a log-shipping sidecar

Add a sidecar to the **product-service** Deployment that streams application logs to
stdout (simulating a log shipper):

Edit `k8s/product-service/deployment.yaml` to add a second container and a shared volume:

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
          command: ["sh", "-c", "tail -F /var/log/app/app.log 2>/dev/null || sleep infinity"]
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

To remove the sidecar after the exercise, revert the Deployment YAML to single-container
and re-apply.

---

## Notes & Learnings

> _Record anything surprising, problems you hit, or insights you had._

---

## Up Next

[Lesson 17 — HorizontalPodAutoscaler: Scaling Services](lesson-17-hpa.md)
