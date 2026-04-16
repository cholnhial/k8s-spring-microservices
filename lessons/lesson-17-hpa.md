# Lesson 17 — HorizontalPodAutoscaler: Scaling Services

**Status:** [ ] Complete
**K8s Concepts:** HorizontalPodAutoscaler (HPA), metrics-server, CPU/memory scaling targets, scaling behaviour
**Spring Boot Concepts:** Spring Boot Actuator metrics, JVM tuning for horizontal scaling

---

## Concept: Why Autoscale?

So far every Deployment in ShopNow runs `replicas: 1`. That means:

- **One failure = zero capacity.** If the single pod crashes, the service is down until K8s
  restarts it (10–60 s depending on probe timings).
- **One spike = degraded performance.** If a flash sale doubles traffic to order-service,
  the single pod's CPU gets throttled at its limit (500m) and response times spike.

Manual scaling (`kubectl scale --replicas=3`) works, but someone has to notice the problem
first. A **HorizontalPodAutoscaler** watches resource metrics and adjusts replica count
automatically — scaling out when load rises and scaling back in when it drops.

```
                ┌─────────────────────────────────────────┐
                │          HPA control loop (15s)         │
                │                                         │
                │  1. Query metrics-server for current    │
                │     CPU/memory across all pods          │
                │  2. Compute desired replicas:           │
                │     desired = ⌈ current × (actual /     │
                │                 target) ⌉               │
                │  3. Scale Deployment.spec.replicas      │
                └─────────────┬───────────────────────────┘
                              │
              ┌───────────────▼───────────────┐
              │       metrics-server          │
              │  (scrapes kubelet cAdvisor)   │
              └───────────────────────────────┘
```

---

## Concept: metrics-server

The HPA doesn't collect metrics itself — it queries the **Kubernetes Metrics API**
(`metrics.k8s.io`), which is served by **metrics-server**.

metrics-server runs as a Deployment in the cluster. It scrapes resource usage (CPU and
memory) from every node's kubelet every 15 seconds and exposes it via the API.

Without metrics-server, the HPA has no data and does nothing. Minikube ships with
metrics-server as a built-in addon, but it's **disabled by default**.

```bash
# Check if metrics-server is already running
minikube addons list | grep metrics-server

# Enable it
minikube addons enable metrics-server

# Wait for it to become ready (~30s)
kubectl get deployment metrics-server -n kube-system
kubectl rollout status deployment/metrics-server -n kube-system --timeout=90s
```

After enabling, verify it's collecting data:

```bash
# This should return CPU/memory for every node
kubectl top nodes

# And for every pod in shopnow
kubectl top pods -n shopnow
```

> `kubectl top` returning "error: Metrics API not available" means metrics-server isn't
> ready yet. Wait 30s and retry.

---

## Concept: How the HPA Calculates Desired Replicas

The HPA runs a control loop every 15 seconds (configurable via
`--horizontal-pod-autoscaler-sync-period` on the controller manager). Each cycle:

```
desiredReplicas = ⌈ currentReplicas × (currentMetricValue / targetMetricValue) ⌉
```

### Example: CPU-based scaling

Suppose order-service has:
- 2 running replicas
- HPA target: 50% CPU utilisation
- Current average CPU across both pods: 80%

```
desired = ⌈ 2 × (80 / 50) ⌉ = ⌈ 2 × 1.6 ⌉ = ⌈ 3.2 ⌉ = 4
```

The HPA scales order-service to 4 replicas.

Next cycle, if average CPU drops to 40%:

```
desired = ⌈ 4 × (40 / 50) ⌉ = ⌈ 4 × 0.8 ⌉ = ⌈ 3.2 ⌉ = 4   (no change — ceiling rounds up)
```

If it drops to 30%:

```
desired = ⌈ 4 × (30 / 50) ⌉ = ⌈ 4 × 0.6 ⌉ = ⌈ 2.4 ⌉ = 3   (scale in)
```

### What "CPU utilisation" means here

The HPA compares actual CPU usage against the **resource request**, not the limit.

If a container requests `250m` and is currently using `200m`, utilisation is:

```
200m / 250m = 80%
```

This is why **every container must have `resources.requests.cpu` set** — without it, the
HPA cannot compute a percentage and refuses to scale. You already set these in Lesson 10.

---

## Concept: HPA Manifest (autoscaling/v2)

The modern HPA spec is `autoscaling/v2` (stable since K8s 1.23). The older `v1` only
supports CPU. Use `v2` — it supports CPU, memory, and custom metrics.

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: order-service-hpa
  namespace: shopnow
  labels:
    app: order-service
    part-of: shopnow
    version: "1.0"
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: order-service              # the Deployment to scale
  minReplicas: 2                     # never go below 2 (availability)
  maxReplicas: 5                     # never go above 5 (cost/resource ceiling)
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 60     # scale out when average CPU > 60% of request
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80     # scale out when average memory > 80% of request
```

### Key fields

| Field | Purpose |
|---|---|
| `scaleTargetRef` | Points to the Deployment (or StatefulSet) to scale |
| `minReplicas` | Floor — HPA will never scale below this |
| `maxReplicas` | Ceiling — HPA will never scale above this |
| `metrics[].resource.target.averageUtilization` | The target % of resource request across all pods |

When multiple metrics are specified (CPU and memory here), the HPA computes desired
replicas for **each** metric independently and takes the **maximum**. This ensures
scaling responds to whichever resource is under the most pressure.

### minReplicas: why 2, not 1?

With `minReplicas: 1`, there's always a cold-start penalty when traffic arrives — the
HPA takes 15–45 seconds to react, then the new pod takes 30–90 seconds to start. During
that window, the single pod is overwhelmed.

With `minReplicas: 2`, you always have redundancy and the HPA starts from a warmer base.
The trade-off is using 2× resources at idle. For a learning cluster that's fine.

---

## Concept: Scaling Behaviour (Flap Prevention)

Without guardrails, the HPA can **flap** — rapidly scaling up and down as load oscillates.
K8s 1.23+ provides `behavior` to control scale-up and scale-down rates:

```yaml
spec:
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 0      # scale up immediately when needed
      policies:
        - type: Pods
          value: 2                       # add at most 2 pods per 60s
          periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300    # wait 5 min of low usage before scaling down
      policies:
        - type: Pods
          value: 1                       # remove at most 1 pod per 60s
          periodSeconds: 60
```

The asymmetry is intentional:
- **Scale up fast** — when traffic spikes, you want capacity now
- **Scale down slow** — if traffic drops briefly then comes back, you don't want to remove
  pods you'll need again in a minute

The `stabilizationWindowSeconds` for scale-down means the HPA looks at the desired
replica count over the last 300 seconds and picks the **highest** value. This prevents
a momentary dip from triggering a premature scale-in.

---

## Concept: JVM Considerations for Horizontal Scaling

Spring Boot apps on the JVM have specific characteristics that affect autoscaling:

### 1. Startup time matters

A JVM + Spring Boot app takes 15–60 seconds to start (class loading, annotation scanning,
connection pool init). During this window the new pod is consuming resources but not serving
traffic (the readiness probe gates this correctly).

The HPA accounts for this — it doesn't count a pod's metrics until the pod is Ready. But
it means your effective reaction time is: **HPA sync interval (15s) + pod startup time**.

### 2. CPU during startup is not representative

A freshly started JVM uses high CPU for JIT compilation. The HPA might see this spike and
think it needs even more replicas. The `startupProbe` you already configured in Lesson 08
suppresses liveness/readiness until the app is fully booted — and since the HPA only
considers Ready pods, the startup spike doesn't feed into the scaling calculation.

### 3. Memory is mostly fixed

A JVM's memory is dominated by the heap, which is allocated upfront. Memory-based
autoscaling is less useful for JVM apps because usage doesn't fluctuate with load the way
CPU does. Including it in the HPA is still good practice as a safety net (e.g. a memory
leak will eventually trigger a scale-out before OOMKill), but CPU will be the primary
scaling signal.

---

## Your Task

### 1. Enable metrics-server in Minikube

```bash
minikube addons enable metrics-server
kubectl rollout status deployment/metrics-server -n kube-system --timeout=90s

# Verify — should show CPU/memory for each pod (wait ~60s after enabling)
kubectl top pods -n shopnow
```

### 2. Create HPA manifests

Create the following files. The manifests are provided — but **read each one carefully and
make sure you understand every field before applying it.**

Create `k8s/order-service/hpa.yaml`:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: order-service-hpa
  namespace: shopnow
  labels:
    app: order-service
    part-of: shopnow
    version: "1.0"
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: order-service
  minReplicas: 2
  maxReplicas: 5
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 60
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 0
      policies:
        - type: Pods
          value: 2
          periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Pods
          value: 1
          periodSeconds: 60
```

Create `k8s/product-service/hpa.yaml`:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: product-service-hpa
  namespace: shopnow
  labels:
    app: product-service
    part-of: shopnow
    version: "1.0"
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: product-service
  minReplicas: 2
  maxReplicas: 4
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 60
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 0
      policies:
        - type: Pods
          value: 2
          periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Pods
          value: 1
          periodSeconds: 60
```

> **Why two services?** order-service gets both CPU and memory metrics (it's the most
> complex service, doing Feign calls + JPA writes). product-service gets CPU only (it's
> read-heavy and a good contrast). This lets you compare how HPA behaves with different
> metric configurations.

### 3. Apply and observe

```bash
kubectl apply -f k8s/order-service/hpa.yaml
kubectl apply -f k8s/product-service/hpa.yaml

# Check HPA status
kubectl get hpa -n shopnow
```

The output should look like:

```
NAME                  REFERENCE                  TARGETS          MINPODS   MAXPODS   REPLICAS   AGE
order-service-hpa     Deployment/order-service   12%/60%, 65%/80%   2         5         2          30s
product-service-hpa   Deployment/product-service 8%/60%             2         4         2          30s
```

> **"<unknown>/60%" in the TARGETS column** means metrics-server hasn't scraped the pod
> yet, or the pod doesn't have `resources.requests` set. Wait 60 seconds and check again.
> If it persists, verify `kubectl top pods -n shopnow` returns data.

Notice that both Deployments will immediately scale from 1 to 2 replicas — the HPA enforces
`minReplicas: 2` as soon as it's applied.

### 4. Watch the HPA describe output

```bash
kubectl describe hpa order-service-hpa -n shopnow
```

Key things to look for in the output:
- **Conditions**: `AbleToScale`, `ScalingActive`, `ScalingLimited`
- **Events**: `SuccessfulRescale` — shows when and why it scaled

### 5. Generate load and watch autoscaling in action

Open a terminal to watch HPA status live:

```bash
watch -n 5 'kubectl get hpa -n shopnow'
```

In another terminal, generate sustained load against order-service:

```bash
# Port-forward the api-gateway
kubectl port-forward svc/api-gateway 8080:8080 -n shopnow &

# Sustained load — hit the orders endpoint 10 requests/second for 2 minutes
# (adjust the product ID to one that exists in your DB)
for i in $(seq 1 1200); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST http://localhost:8080/api/orders \
    -H "Content-Type: application/json" \
    -d '{"orderLineItems":[{"productId":1,"quantity":1}]}' &
  sleep 0.1
done
```

> This is a rough load generator. For real load testing you'd use tools like `hey`, `wrk`,
> or `k6` — but `curl` in a loop is enough to push CPU above 60% on a single pod.

What to observe:
1. After ~30 seconds of sustained load, `kubectl get hpa` should show CPU % rising
2. When average CPU exceeds 60%, the HPA creates new pods (check the REPLICAS column)
3. After the load stops, wait 5+ minutes — the HPA gradually scales back to `minReplicas`
4. Check events: `kubectl describe hpa order-service-hpa -n shopnow | grep -A 5 Events`

### 6. Verify the ResourceQuota interaction

With `minReplicas: 2` on both order-service and product-service, you now have at least 4
Spring Boot pods. Each requests 512Mi memory and 250m CPU.

```bash
kubectl describe resourcequota shopnow-quota -n shopnow
```

Check that total requests don't exceed the quota ceiling (4 CPU, 8Gi memory). If they do,
the HPA won't be able to scale — pods will be stuck in `Pending` with an event like
`exceeded quota`. You may need to increase the quota to accommodate autoscaling headroom.

> **Rule of thumb:** set quota limits to accommodate `maxReplicas` across all HPAs,
> plus your infrastructure pods (postgres, redis, etc). This is a real production
> consideration — autoscaling is meaningless if the quota blocks new pods.

### 7. Experiment: what happens when maxReplicas is reached?

With the load generator still running, check:

```bash
kubectl describe hpa order-service-hpa -n shopnow
```

Look for the condition `ScalingLimited` with reason `TooManyReplicas`. This means the HPA
wants more pods but is capped at `maxReplicas`. The existing pods continue serving at
their current (possibly degraded) performance.

In production this is an alert trigger — if HPA regularly hits max, you need either:
- Higher `maxReplicas`
- More cluster capacity (bigger nodes or more nodes)
- Application-level optimisation (reduce per-request CPU)

---

## Notes & Learnings

> _Record anything surprising, problems you hit, or insights you had._

---

## Up Next

[Lesson 18 — Rolling Updates, Rollbacks & Blue/Green Deploys](lesson-18-updates.md)
