# Lesson 18 — Rolling Updates, Rollbacks & Blue/Green Deploys

**Status:** [ ] Complete
**K8s Concepts:** Deployment rollout strategy, `maxSurge`/`maxUnavailable`, revision history, `kubectl rollout`, pause/resume, blue/green via Services
**Spring Boot Concepts:** Graceful shutdown, `preStop` hook, readiness-gated traffic shedding

---

## Current Project Alignment

The platform now has two useful rollout surfaces:

- Spring Boot Deployments such as `order-service`, where graceful shutdown matters.
- The Angular/nginx `frontend`, where ConfigMap changes often need `kubectl rollout restart`
  even when the image does not change.

Kafka and ZooKeeper are StatefulSets. Do not use the Deployment rollout examples on them;
StatefulSets roll one ordinal at a time and have different operational rules.

---

## Concept: What Actually Happens on `kubectl apply`

Every time you change a Deployment's pod template and re-apply it, K8s creates a **new
ReplicaSet** with the updated template and progressively shifts pods from the old
ReplicaSet to the new one. The Deployment controller is a thin coordinator on top of
ReplicaSets — it owns the *strategy* for how those two RS's hand over traffic.

```
           before apply                           during rollout
  ┌─────────────────────────┐          ┌─────────────────────────────┐
  │  Deployment: order      │          │  Deployment: order          │
  │   └─ ReplicaSet rs-A    │          │   ├─ ReplicaSet rs-A (old)  │
  │        ├─ pod-1  v1.0   │   apply  │   │    ├─ pod-1   v1.0      │
  │        ├─ pod-2  v1.0   │  ──────► │   │    └─ pod-2   Terminating│
  │        └─ pod-3  v1.0   │          │   └─ ReplicaSet rs-B (new)  │
  └─────────────────────────┘          │        ├─ pod-4   v1.1      │
                                       │        └─ pod-5   v1.1      │
                                       └─────────────────────────────┘
```

**Key invariant:** The Service selector matches on the common labels
(`app: order-service`), so both old and new pods receive traffic during the rollout.
K8s gates each transition on the new pod's **readiness probe** — that's why probes are
the single most load-bearing piece of a safe update.

---

## Concept: RollingUpdate vs Recreate

A Deployment's `spec.strategy` selects one of two strategies:

### `Recreate` — stop all, then start all

```yaml
spec:
  strategy:
    type: Recreate
```

All old pods are terminated first. Then new pods are started. **There is downtime**
equal to the time it takes the new pods to become Ready.

Use `Recreate` only when:
- Two versions of the app cannot run simultaneously (e.g. incompatible DB schema, exclusive
  file lock, single-writer Kafka consumer group)
- You're managing a stateful singleton where two replicas would corrupt data

### `RollingUpdate` — overlap old and new (the default)

```yaml
spec:
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 25%          # how many pods ABOVE the desired count are allowed temporarily
      maxUnavailable: 25%    # how many pods BELOW the desired count are allowed temporarily
```

The controller orchestrates a gradual handover, respecting both knobs every step.

### `maxSurge` and `maxUnavailable` — worked example

Suppose `replicas: 4`, `maxSurge: 1`, `maxUnavailable: 0`.

| Step | Old Ready | New Ready | Total pods | Notes |
|---|---|---|---|---|
| 0 | 4 | 0 | 4 | Starting state |
| 1 | 4 | 1 (Pending) | 5 | Surge by 1 — total = 4 + 1 |
| 2 | 4 | 1 (Ready) | 5 | New pod passed readiness |
| 3 | 3 (Terminating) | 1 | 4 | Old pod removed — now below total again |
| 4 | 3 | 2 (Pending) | 5 | Surge again |
| 5 | 3 | 2 (Ready) | 5 | … |
| … | 0 | 4 (Ready) | 4 | Done |

At **no point** were fewer than 4 Ready pods serving traffic (`maxUnavailable: 0`), and
at most 5 pods existed at once (`maxSurge: 1`).

### Choosing the knobs

| Combination | Behaviour | When to use |
|---|---|---|
| `maxSurge: 25%`, `maxUnavailable: 25%` | Default. Fast, relaxed. | Stateless services with ample capacity |
| `maxSurge: 1`, `maxUnavailable: 0` | Zero-downtime, one-at-a-time | Small replica counts (2–4) where you can't lose any capacity |
| `maxSurge: 0`, `maxUnavailable: 1` | No surge, shrink first | Quota-constrained namespaces where the quota won't accommodate extras |
| `maxSurge: 100%`, `maxUnavailable: 0` | Spin up full new fleet, then drop old | Fast rollout when you have spare cluster capacity |

> `maxSurge: 0` and `maxUnavailable: 0` is **invalid** — there'd be no way to make progress.
> K8s rejects this at apply time.

---

## Concept: Revision History & `kubectl rollout`

Every rollout produces a new ReplicaSet, and the old one is kept around (scaled to 0
replicas) for rollback. The number retained is controlled by:

```yaml
spec:
  revisionHistoryLimit: 10        # default
```

The `kubectl rollout` family of commands operates on these revisions:

```bash
# Watch an in-progress rollout until it finishes (exit 0 success, non-zero failure)
kubectl rollout status deployment/order-service -n shopnow

# Pause the rollout mid-flight (new changes buffer but don't roll)
kubectl rollout pause deployment/order-service -n shopnow

# Resume a paused rollout
kubectl rollout resume deployment/order-service -n shopnow

# List the revision history
kubectl rollout history deployment/order-service -n shopnow

# Inspect the pod template of a specific revision
kubectl rollout history deployment/order-service -n shopnow --revision=3

# Roll back to the previous revision
kubectl rollout undo deployment/order-service -n shopnow

# Roll back to a specific revision
kubectl rollout undo deployment/order-service -n shopnow --to-revision=2

# Force a rollout even if nothing changed (handy when config repo was updated)
kubectl rollout restart deployment/order-service -n shopnow
```

### `kubectl rollout restart` vs `kubectl apply`

- `apply` creates a new revision only if the **pod template** changed (image tag,
  env, resources, labels on the template).
- `rollout restart` injects a dummy annotation (`kubectl.kubernetes.io/restartedAt`)
  into the pod template — this *is* a template change, so a new revision is created
  and all pods are cycled. Useful when Config Server content changed but no K8s
  manifest did.

### The history comment trick

By default, `kubectl rollout history` shows `<none>` in the CHANGE-CAUSE column. You
can populate it by annotating the Deployment:

```bash
kubectl annotate deployment/order-service -n shopnow \
  kubernetes.io/change-cause="bump to v1.2 — adds idempotency key" --overwrite
```

Next rollout will carry that annotation forward as the revision's change cause.

---

## Concept: Image Tag Hygiene

Using `:latest` (which we've done throughout this course for simplicity) is fine for
Minikube but **breaks rollouts in production**:

- `kubectl apply` only creates a new revision if the template *changes*. If the image
  tag is `shopnow/order-service:latest` both before and after, no new revision is
  created — even though the underlying image is different.
- The workaround (`kubectl rollout restart`) works, but you lose the ability to
  correlate a revision with a specific build.

**Production rule:** tag each image with an immutable identifier — a semver
(`v1.2.3`), a git SHA (`sha-9a8c7b2`), or both. The tag itself becomes the audit
trail.

```yaml
image: shopnow/order-service:v1.2.3
imagePullPolicy: IfNotPresent
```

Use the same rule for the frontend:

```yaml
image: shopnow/frontend:v1.2.3
```

---

## Concept: Graceful Shutdown for Spring Boot

A rolling update's zero-downtime guarantee depends on **each old pod finishing its
in-flight requests before it dies.** If K8s kills a pod mid-request, clients see
connection resets — a user-visible error.

### The shutdown sequence

When K8s decides to terminate a pod:

```
1. Pod moves to "Terminating" state
   ├── Pod IP is removed from Service endpoints        (stops NEW traffic arriving)
   ├── preStop hook runs (if defined)                  (optional: grace period, drain)
   └── SIGTERM sent to PID 1 in the container          (app starts graceful shutdown)
       ↓
2. Wait up to terminationGracePeriodSeconds (default 30s)
       ↓
3. If still running: SIGKILL                           (hard stop, in-flight requests cut off)
```

Two independent processes happen in parallel after step 1: endpoint removal propagates
through kube-proxy, and the container receives SIGTERM. Neither waits for the other.

### The endpoint propagation race

Endpoint removal is *eventually* consistent. By the time every node's kube-proxy has
updated its iptables rules, a few hundred milliseconds have elapsed. During that
window, traffic can still be routed to a pod that already received SIGTERM and is
shutting down.

The fix: a `preStop` hook that sleeps briefly before SIGTERM fires.

```yaml
containers:
  - name: order-service
    lifecycle:
      preStop:
        exec:
          command: ["sh", "-c", "sleep 5"]
```

Five seconds is usually enough for endpoint removal to propagate cluster-wide.

### Spring Boot graceful shutdown

Once SIGTERM arrives, Spring Boot needs to stop accepting new requests and wait for
in-flight ones to complete. This is configured in application properties (add to the
shared config or each service):

```yaml
server:
  shutdown: graceful             # stop accepting new requests, drain in-flight
spring:
  lifecycle:
    timeout-per-shutdown-phase: 25s   # max wait for in-flight requests
```

The timeout must be **less than** `terminationGracePeriodSeconds` on the pod — otherwise
K8s SIGKILLs the process while Spring Boot is still draining.

```
  preStop sleep (5s)  ──► SIGTERM ──► Spring drains (≤25s) ──► exit
  │◄────────────── terminationGracePeriodSeconds: 40s ───────────────►│
```

Rule of thumb: `preStop sleep` + Spring shutdown timeout + small margin ≤ grace period.

### Putting it together

```yaml
spec:
  template:
    spec:
      terminationGracePeriodSeconds: 40
      containers:
        - name: order-service
          lifecycle:
            preStop:
              exec:
                command: ["sh", "-c", "sleep 5"]
          # readiness/liveness/startup probes as before
```

---

## Concept: Blue/Green Deployment via Services

Rolling updates overlap versions at the **pod** level. **Blue/green** overlaps them at
the **Deployment** level: two full fleets run side by side, and a single Service
selector flip swings 100% of traffic from one to the other.

```
                    ┌────────────────────────────┐
                    │   Service: order-service    │
                    │   selector: slot=blue       │   ← flip this label to switch
                    └───────────────┬─────────────┘
                                    │
                ┌───────────────────┴────────────────────┐
                ▼                                        ▼
   ┌─────────────────────────┐             ┌─────────────────────────┐
   │ Deployment: order-blue  │             │ Deployment: order-green │
   │   pods label: slot=blue │             │   pods label: slot=green│
   │   image: v1.2.3  (live) │             │   image: v1.2.4  (idle) │
   └─────────────────────────┘             └─────────────────────────┘
```

### The flow

1. Blue is live. Service selector is `slot: blue`.
2. Deploy green alongside blue (`order-service-green` Deployment with the new image).
3. Run smoke tests directly against the green pods (via a separate test Service that
   selects `slot: green`).
4. When green is verified, **flip the main Service selector** from `slot: blue` to
   `slot: green`. All traffic instantly routes to green.
5. Keep blue running for a cooldown period. If anything goes wrong, flip back.
6. After confidence, scale blue to 0 (or delete it).

### Trade-offs vs rolling update

| Dimension | Rolling update | Blue/green |
|---|---|---|
| Cluster resources during rollout | `replicas × (1 + maxSurge)` | `replicas × 2` |
| Versions live simultaneously | Yes (briefly) | Yes (for as long as green+blue both exist) |
| Rollback speed | Minutes (re-roll old template) | Seconds (flip selector) |
| Works for DB-incompatible changes | No | Yes, if you version the schema first |
| Complexity | Low (built into Deployment) | Higher (two Deployments + selector flips) |

### When not to blue/green

If the two versions **cannot** run simultaneously (exclusive DB lock, Kafka consumer
group conflict, singleton leader election), blue/green gives you two live copies
fighting for the resource. Use `Recreate` or a canary with traffic splitting instead.

---

## Concept: Rollout Failures & How K8s Detects Them

A rollout is `Progressing` until either:

- **Success:** all new-RS pods are Ready and all old-RS pods are removed, **or**
- **Failure:** `progressDeadlineSeconds` elapses without progress (default: 600s)

"Progress" means: a new pod became Ready, or a replica count moved in the right
direction. If the new image crash-loops forever, no pods ever become Ready, no
progress is made, and after 10 minutes the Deployment is marked
`ProgressDeadlineExceeded`.

```bash
# Human-readable status
kubectl rollout status deployment/order-service -n shopnow --timeout=5m
# Exits with non-zero on failure — use this in CI pipelines

# The underlying condition
kubectl get deployment order-service -n shopnow \
  -o jsonpath='{.status.conditions[?(@.type=="Progressing")].reason}'
```

K8s does **not** auto-rollback. If a rollout fails, the cluster is left in a split
state (some old pods, some failing new pods) until you `kubectl rollout undo`. CI/CD
tools (Argo Rollouts, Flagger) wrap this with automated rollback.

---

## Your Task

### 1. Add graceful shutdown to the shared config

In your `shopnow-config` git repo, edit `application.yaml` (the shared config applied
to every service) and add:

```yaml
server:
  shutdown: graceful
spring:
  lifecycle:
    timeout-per-shutdown-phase: 25s
```

Commit and push.

Also apply this shared config to `cart-service` and `notification-service`; they were
added after the first core-service lessons.

### 2. Update order-service Deployment with preStop and grace period

Edit `k8s/order-service/deployment.yaml`. Add to the pod spec:

```yaml
spec:
  template:
    spec:
      terminationGracePeriodSeconds: 40
      containers:
        - name: order-service
          lifecycle:
            preStop:
              exec:
                command: ["sh", "-c", "sleep 5"]
          # ... existing container spec
```

And add an explicit rolling update strategy to the Deployment spec:

```yaml
spec:
  replicas: 3                       # bump up so there's something to roll
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  revisionHistoryLimit: 5
  progressDeadlineSeconds: 300
```

> **Why `maxUnavailable: 0`?** With only 3 replicas, losing even one during a rollout
> is a 33% capacity drop. Zero unavailability plus `maxSurge: 1` gives you a
> one-at-a-time rollout with no capacity loss. It's slightly slower but far safer
> at low replica counts.

Apply the change:

```bash
kubectl apply -f k8s/order-service/deployment.yaml
kubectl rollout status deployment/order-service -n shopnow
```

Verify Spring Boot picked up the config:

```bash
kubectl logs deployment/order-service -n shopnow | grep -i 'graceful\|shutdown'
# Expect: "Commencing graceful shutdown" on pod termination
```

### 3. Trigger a rolling update and watch it happen

The fastest way to force a rollout (without a new image) is `rollout restart`:

```bash
# Terminal 1 — watch pods come and go
watch -n 1 'kubectl get pods -n shopnow -l app=order-service -o wide'

# Terminal 2 — trigger a rollout
kubectl rollout restart deployment/order-service -n shopnow

# Terminal 3 — follow the rollout
kubectl rollout status deployment/order-service -n shopnow
```

What to observe:

1. A **new pod** appears (Pending → ContainerCreating → Running). Total pods = 4.
2. When that new pod becomes **Ready**, one old pod enters **Terminating**.
3. Terminating pod stays around for the full 40s grace period (preStop 5s + Spring
   graceful 25s + slack), then disappears.
4. Next new pod starts. Loop until all 3 are replaced.

At no point should the Ready-pod count drop below 3.

### 4. Inspect the revision history

```bash
kubectl rollout history deployment/order-service -n shopnow
```

You should see two revisions. Annotate the newest one with a change cause, then
trigger a third rollout to see the annotation appear:

```bash
kubectl annotate deployment/order-service -n shopnow \
  kubernetes.io/change-cause="demo: added preStop hook" --overwrite

kubectl rollout restart deployment/order-service -n shopnow
kubectl rollout status deployment/order-service -n shopnow

kubectl rollout history deployment/order-service -n shopnow
# Newest revision should now show the change cause
```

### 5. Simulate a bad deploy and roll back

Edit `k8s/order-service/deployment.yaml` and set an image that doesn't exist:

```yaml
image: shopnow/order-service:v999-broken
imagePullPolicy: Never
```

Apply and watch it fail:

```bash
kubectl apply -f k8s/order-service/deployment.yaml
kubectl rollout status deployment/order-service -n shopnow --timeout=60s
# Expect: error — image pull backoff

# Check pod state
kubectl get pods -n shopnow -l app=order-service
# Expect: 3 old pods still Running, 1 new pod stuck in ImagePullBackOff

# The new ReplicaSet exists but can't make progress
kubectl get rs -n shopnow -l app=order-service
```

Now roll back:

```bash
kubectl rollout undo deployment/order-service -n shopnow
kubectl rollout status deployment/order-service -n shopnow
```

> Notice that **the old pods never went down**. K8s couldn't create Ready new pods,
> so it never terminated old ones. This is the rolling-update safety property in
> action — a bad image deploy does not cause an outage, it causes a *stuck* rollout
> that waits for a human to fix or roll back.

Restore the correct image in the manifest:

```yaml
image: shopnow/order-service:latest
```

Apply and confirm a clean state:

```bash
kubectl apply -f k8s/order-service/deployment.yaml
kubectl rollout status deployment/order-service -n shopnow
```

### 5b. Roll out a frontend ConfigMap-only change

Frontend nginx config is mounted from `k8s/frontend/nginx-configmap.yaml`. Changing that
ConfigMap does not automatically restart the frontend pod:

```bash
kubectl apply -f k8s/frontend/nginx-configmap.yaml
kubectl rollout restart deployment/frontend -n shopnow
kubectl rollout status deployment/frontend -n shopnow
```

This is the same reason we use `rollout restart` after external Config Server changes:
the pod template did not change, but the mounted/configured runtime behavior did.

### 6. Blue/green for product-service

Now the more involved pattern. The demo manifests live in
`k8s/product-service/blue-green/` so the normal `product-service` Deployment remains
intact for the rest of the course. You'll run two slots (`blue`, `green`) and flip
traffic by editing the main Service selector.

> Important: delete the normal `product-service` Deployment and HPA before applying
> the blue/green demo. The normal Deployment selector is `app: product-service`, which
> overlaps both slot Deployments. Restore it after the exercise.

#### 6a. Prepare the blue slot

The blue slot is already scaffolded at
`k8s/product-service/blue-green/product-service-blue.yaml`. It carries the normal
`app: product-service` label plus `slot: blue`.

Delete the normal controller and make blue live:

```bash
kubectl delete hpa product-service-hpa -n shopnow --ignore-not-found=true
kubectl delete deployment product-service -n shopnow --ignore-not-found=true
kubectl apply -f k8s/product-service/blue-green/product-service-blue.yaml
kubectl rollout status deployment/product-service-blue -n shopnow
kubectl patch svc/product-service -n shopnow -p '{"spec":{"selector":{"app":"product-service","slot":"blue"}}}'
```

The main Service selector should now look like:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: product-service
  namespace: shopnow
  labels:
    app: product-service
    part-of: shopnow
spec:
  selector:
    app: product-service
    slot: blue                    # ← add this
  ports:
    - port: 8081
      targetPort: 8081
```

#### 6b. Create and test green

The green Deployment and private test Service are scaffolded at:

- `k8s/product-service/blue-green/product-service-green.yaml`
- `k8s/product-service/blue-green/product-service-green-test-service.yaml`

Apply both:

```bash
kubectl apply -f k8s/product-service/blue-green/product-service-green.yaml
kubectl apply -f k8s/product-service/blue-green/product-service-green-test-service.yaml
kubectl rollout status deployment/product-service-green -n shopnow
```

At this point both blue and green are running; only blue receives real traffic (via
the main Service), while green can be smoke-tested via the test Service.

#### 6c. Smoke test green, then flip

```bash
# Smoke test green directly
kubectl port-forward svc/product-service-green-test 8091:8081 -n shopnow &
curl -s http://localhost:8091/api/products | head -c 200

# All good? Flip the main Service selector to green:
kubectl patch svc/product-service -n shopnow -p '{"spec":{"selector":{"app":"product-service","slot":"green"}}}'

# Verify traffic now lands on green pods
kubectl port-forward svc/product-service 8081:8081 -n shopnow &
curl -s http://localhost:8081/api/products | head -c 200
# Examine the pod name in logs to confirm it's a green pod
kubectl logs -l slot=green -n shopnow --tail=5
```

#### 6d. Roll back the flip (seconds, not minutes)

Suppose you discover a bug. Flip back:

```bash
kubectl patch svc/product-service -n shopnow -p '{"spec":{"selector":{"app":"product-service","slot":"blue"}}}'
```

Traffic returns to blue immediately — no image pulls, no pod churn, no readiness wait.
**This is the power of blue/green: instant rollback.**

#### 6e. Cleanup after a successful flip

Once you're confident green is stable:

```bash
# Scale blue down (keep manifest around in case you need to reinstate quickly)
kubectl scale deployment/product-service-blue --replicas=0 -n shopnow

# After a cooldown period (hours/days in prod), delete blue entirely
kubectl delete deployment/product-service-blue -n shopnow

# The green Deployment now takes on the role of the "current" slot — next release
# will create a new blue alongside it and flip again.
```

### 7. Restore product-service to a single Deployment

For the rest of the course, we don't need the blue/green split. Revert:

```bash
# Delete both slots
kubectl delete -f k8s/product-service/blue-green/

# Restore the standard Deployment, Service selector, and HPA
kubectl apply -f k8s/product-service/deployment.yaml
kubectl apply -f k8s/product-service/service.yaml
kubectl apply -f k8s/product-service/hpa.yaml
```

### 8. Observe the graceful shutdown in logs

One more experiment. With the restored product-service running, tail logs of a pod
and delete it:

```bash
# Terminal 1
POD=$(kubectl get pod -n shopnow -l app=order-service -o jsonpath='{.items[0].metadata.name}')
kubectl logs -f $POD -n shopnow

# Terminal 2
kubectl delete pod $POD -n shopnow
```

In Terminal 1 you should see Spring Boot log `Commencing graceful shutdown. Waiting
for active requests to complete` before the pod disappears. If you sent a request at
the moment of deletion, it would complete successfully — no client-visible error.

---

## Notes & Learnings

> _Record anything surprising, problems you hit, or insights you had._

---

## Up Next

[Lesson 19 — Helm Charts: Packaging the Platform](lesson-19-helm.md)
