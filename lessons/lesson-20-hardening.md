# Lesson 20 — NetworkPolicy, ResourceQuotas & Hardening

**Status:** [ ] Complete
**K8s Concepts:** NetworkPolicy, PodSecurityContext, SecurityContext, PodSecurity admission, automountServiceAccountToken
**Spring Boot Concepts:** Spring Boot security hardening (actuator lockdown, info exposure)

---

## Concept: Defence in Depth

Up to now, every pod in the `shopnow` namespace can talk to every other pod. The api-gateway
can reach postgres directly. The notification-service can call the user-service. There's
no network boundary — it's a flat, fully trusted network.

This is fine for learning but wrong for production. **Defence in depth** means applying
multiple independent layers of security so that no single misconfiguration causes a breach:

```
Layer 1: NetworkPolicy         — which pods can talk to which pods (network)
Layer 2: RBAC                  — which pods can call the K8s API (already done in L12)
Layer 3: PodSecurityContext     — what the process inside the container can do (OS-level)
Layer 4: ResourceQuota          — how much of the cluster a namespace can consume (already done in L10)
Layer 5: Application security  — what the Spring Boot app exposes (actuator, headers)
```

This lesson adds layers 1, 3, and 5. Layers 2 and 4 are already in place from earlier
lessons.

---

## Concept: NetworkPolicy

A **NetworkPolicy** is a firewall rule for pods. It controls ingress (incoming traffic) and
egress (outgoing traffic) at the IP/port level, using label selectors to identify source
and destination pods.

### Default behaviour: allow all

By default, K8s has **no network policies** — all pods can communicate with all other pods
in all namespaces. A NetworkPolicy is additive: once you create one that selects a pod,
that pod switches from "allow all" to "deny all except what the policy permits".

### How NetworkPolicy works

```
┌─────────────────────────────────────────────────────────────────┐
│                        shopnow namespace                        │
│                                                                 │
│   api-gateway ──────────► order-service ──────► postgres-order  │
│        │                       │                                │
│        │                       ▼                                │
│        ├──────────────► product-service ──────► postgres-product│
│        │                                                        │
│        ├──────────────► inventory-service ──► postgres-inventory│
│        │                                                        │
│        └──────────────► user-service ────────► postgres-user    │
│                                                                 │
│   order-service ──────► inventory-service (Feign call)          │
│                                                                 │
│   ✗ product-service ──╳──► postgres-order  (should be blocked)  │
│   ✗ api-gateway ──────╳──► postgres-order  (should be blocked)  │
│   ✗ cart-service ─────╳──► user-service    (no legitimate call) │
└─────────────────────────────────────────────────────────────────┘
```

The principle: **each service should only reach the services it actually calls.**

### NetworkPolicy anatomy

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: postgres-order-allow-order-only
  namespace: shopnow
spec:
  podSelector:                         # which pods this policy applies TO
    matchLabels:
      app: postgres-order
  policyTypes:
    - Ingress                          # we're restricting incoming traffic
  ingress:
    - from:
        - podSelector:                 # allow traffic FROM pods with this label
            matchLabels:
              app: order-service
      ports:
        - port: 5432                   # only on the postgres port
          protocol: TCP
```

This says: "For any pod labelled `app: postgres-order`, only allow incoming TCP traffic
on port 5432 from pods labelled `app: order-service`. Block everything else."

### policyTypes: Ingress vs Egress

| Type | Controls | Common use |
|---|---|---|
| `Ingress` | Who can send traffic **to** the selected pods | Protecting databases, limiting which services can reach a backend |
| `Egress` | Where the selected pods can send traffic **to** | Preventing a compromised pod from calling external APIs or other namespaces |

You can specify both in a single policy. If you omit `Egress` from `policyTypes`, outbound
traffic from the selected pods is unrestricted (default allow).

### CNI requirement

NetworkPolicy is a K8s API object, but the **CNI plugin** is responsible for enforcing it.
Not all CNI plugins support NetworkPolicy:

| CNI | NetworkPolicy support |
|---|---|
| **Calico** | Full support (most common for production) |
| **Cilium** | Full support + extended policies |
| **Flannel** | No support — policies are silently ignored |
| **Kindnet** (kind default) | No support |
| **Minikube default** | Depends on the driver |

For Minikube, enable the Calico CNI:

```bash
# If you haven't started Minikube with Calico, you'll need to recreate:
minikube start --cpus=4 --memory=8192 --cni=calico

# Verify Calico is running
kubectl get pods -n kube-system | grep calico
```

> **If you've already built your cluster without `--cni=calico`**, the policies will
> apply (they're valid K8s objects) but won't be enforced. You can verify enforcement by
> testing blocked traffic after applying policies. If traffic that should be blocked
> still gets through, your CNI doesn't support NetworkPolicy.

---

## Concept: Default Deny Policy

The safest starting point is a **default deny** policy that blocks all ingress to every
pod in the namespace. Then you add specific allow rules for each legitimate communication
path.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: shopnow
spec:
  podSelector: {}             # empty selector = applies to ALL pods in the namespace
  policyTypes:
    - Ingress                 # deny all incoming traffic (no ingress rules = nothing allowed)
```

> An empty `podSelector: {}` matches all pods. With `policyTypes: [Ingress]` and no
> `ingress` rules, the result is: all ingress is denied for every pod in the namespace.
> You then "punch holes" with additional NetworkPolicy resources.

---

## Concept: PodSecurityContext & SecurityContext

Even if network access is locked down, the process inside the container might run as
root, mount the host filesystem, or escalate privileges. **SecurityContext** controls
what the container process is allowed to do at the OS level.

There are two levels:

### Pod-level: `spec.securityContext`

Applies to all containers in the pod:

```yaml
spec:
  securityContext:
    runAsNonRoot: true             # refuse to start if the image runs as UID 0
    runAsUser: 1000                # run as UID 1000
    runAsGroup: 1000               # primary GID 1000
    fsGroup: 1000                  # files created in mounted volumes get GID 1000
    seccompProfile:
      type: RuntimeDefault         # apply the container runtime's default seccomp profile
```

### Container-level: `spec.containers[].securityContext`

Applies to a specific container, and overrides pod-level settings:

```yaml
containers:
  - name: order-service
    securityContext:
      allowPrivilegeEscalation: false   # prevent setuid/setgid from gaining root
      readOnlyRootFilesystem: true      # container filesystem is read-only
      capabilities:
        drop:
          - ALL                         # drop all Linux capabilities
```

### What each field does

| Field | What it prevents |
|---|---|
| `runAsNonRoot: true` | Container image defaulting to root (UID 0) |
| `allowPrivilegeEscalation: false` | A process using `setuid`/`setgid` to gain higher privileges |
| `readOnlyRootFilesystem: true` | Malware writing to the container's filesystem (logs/temp still work via emptyDir mounts) |
| `capabilities.drop: [ALL]` | All Linux capabilities (network raw, sys_admin, etc) — the process gets the absolute minimum |
| `seccompProfile: RuntimeDefault` | Syscalls not in the runtime's allowlist (containerd default blocks ~44 dangerous syscalls) |

### The JVM + readOnlyRootFilesystem gotcha

Spring Boot apps write to `/tmp` (Tomcat's work directory, multipart uploads). With
`readOnlyRootFilesystem: true`, the container can't write anywhere — the app crashes.

The fix: mount an `emptyDir` at `/tmp`:

```yaml
spec:
  containers:
    - name: order-service
      securityContext:
        readOnlyRootFilesystem: true
      volumeMounts:
        - name: tmp
          mountPath: /tmp
  volumes:
    - name: tmp
      emptyDir: {}
```

`emptyDir` is a writable, pod-scoped temporary directory backed by the node's disk. It's
ephemeral — destroyed when the pod is deleted. This gives the JVM a place to write without
making the entire container filesystem writable.

---

## Concept: automountServiceAccountToken

By default, every pod gets the service account token mounted at
`/var/run/secrets/kubernetes.io/serviceaccount/token`. This token lets the pod authenticate
to the K8s API server.

Most application pods (order-service, product-service, etc.) never call the K8s API.
Mounting the token is an unnecessary attack surface — if the pod is compromised, the
attacker gets a valid K8s credential.

```yaml
spec:
  automountServiceAccountToken: false     # don't mount the SA token
```

> **Exception:** user-service has a custom ServiceAccount with a Role that reads Secrets.
> It needs the token. Leave `automountServiceAccountToken` at its default (`true`) for
> user-service only.

---

## Concept: Spring Boot Actuator Hardening

Spring Boot Actuator exposes operational endpoints. In a K8s environment, some of these
are needed (health probes) and some are dangerous if exposed to the network.

### Current state

In the config repo, most services have:

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health
```

This is already conservative — only `/actuator/health` (and its sub-groups `/liveness`,
`/readiness`) are exposed. But there are additional hardening steps:

### 1. Never expose sensitive endpoints in production

These endpoints should **never** be web-exposed outside of development:

| Endpoint | Risk |
|---|---|
| `/actuator/env` | Dumps all environment variables, including secrets from K8s Secrets |
| `/actuator/configprops` | Dumps all configuration properties, may include passwords |
| `/actuator/beans` | Full application context — reveals internal architecture |
| `/actuator/heapdump` | Downloads a JVM heap dump — contains in-memory secrets |
| `/actuator/shutdown` | Shuts down the application (if enabled) |

The `include: health` config already excludes these, but it's worth explicitly blocking
them as a defence-in-depth measure:

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info,prometheus     # only what's needed
  endpoint:
    env:
      enabled: false          # disable entirely, not just web-unexposed
    configprops:
      enabled: false
    beans:
      enabled: false
    heapdump:
      enabled: false
    shutdown:
      enabled: false
```

### 2. Hide server identity headers

By default, Spring Boot and the embedded Tomcat can leak version information via
response headers (`Server`, `X-Powered-By`). Add to your config:

```yaml
server:
  server-header: ""                        # suppress the Server header
  error:
    include-message: never                 # don't include exception messages in error responses
    include-stacktrace: never              # don't include stack traces in error responses
    include-binding-errors: never
```

---

## Your Task

### 1. Create the default deny policy

Create `k8s/namespaces/default-deny-ingress.yaml`:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: shopnow
spec:
  podSelector: {}
  policyTypes:
    - Ingress
```

Apply it:

```bash
kubectl apply -f k8s/namespaces/default-deny-ingress.yaml
```

> **This will break everything.** After applying, no pod in `shopnow` can receive traffic.
> Health probes will start failing, Services will have no reachable endpoints. This is
> expected — you're about to add the allow rules.

### 2. Create NetworkPolicy allow rules for each service

Create the following files. Each policy allows only the specific ingress that service needs.

**`k8s/api-gateway/networkpolicy.yaml`** — allow traffic from Ingress controller and
external port-forwards:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-ingress-to-gateway
  namespace: shopnow
  labels:
    app: api-gateway
    part-of: shopnow
spec:
  podSelector:
    matchLabels:
      app: api-gateway
  policyTypes:
    - Ingress
  ingress:
    - ports:
        - port: 8080
          protocol: TCP
      # No 'from' restriction — the gateway is the public entry point
```

**`k8s/product-service/networkpolicy.yaml`** — only api-gateway and order-service can
reach it:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-gateway-to-product
  namespace: shopnow
  labels:
    app: product-service
    part-of: shopnow
spec:
  podSelector:
    matchLabels:
      app: product-service
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: api-gateway
        - podSelector:
            matchLabels:
              app: order-service
      ports:
        - port: 8081
          protocol: TCP
```

**`k8s/order-service/networkpolicy.yaml`** — only api-gateway can reach it:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-gateway-to-order
  namespace: shopnow
  labels:
    app: order-service
    part-of: shopnow
spec:
  podSelector:
    matchLabels:
      app: order-service
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: api-gateway
      ports:
        - port: 8082
          protocol: TCP
```

**`k8s/inventory-service/networkpolicy.yaml`** — api-gateway and order-service can
reach it:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-gateway-to-inventory
  namespace: shopnow
  labels:
    app: inventory-service
    part-of: shopnow
spec:
  podSelector:
    matchLabels:
      app: inventory-service
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: api-gateway
        - podSelector:
            matchLabels:
              app: order-service
      ports:
        - port: 8083
          protocol: TCP
```

**`k8s/user-service/networkpolicy.yaml`** — only api-gateway can reach it:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-gateway-to-user
  namespace: shopnow
  labels:
    app: user-service
    part-of: shopnow
spec:
  podSelector:
    matchLabels:
      app: user-service
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: api-gateway
      ports:
        - port: 8084
          protocol: TCP
```

**`k8s/infrastructure/networkpolicy-postgres.yaml`** — each postgres instance only
accepts connections from its owning service:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-services-to-postgres
  namespace: shopnow
  labels:
    part-of: shopnow
spec:
  podSelector:
    matchLabels:
      app: postgres-product
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: product-service
      ports:
        - port: 5432
          protocol: TCP
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-order-to-postgres-order
  namespace: shopnow
  labels:
    part-of: shopnow
spec:
  podSelector:
    matchLabels:
      app: postgres-order
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: order-service
      ports:
        - port: 5432
          protocol: TCP
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-inventory-to-postgres-inventory
  namespace: shopnow
  labels:
    part-of: shopnow
spec:
  podSelector:
    matchLabels:
      app: postgres-inventory
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: inventory-service
      ports:
        - port: 5432
          protocol: TCP
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-user-to-postgres-user
  namespace: shopnow
  labels:
    part-of: shopnow
spec:
  podSelector:
    matchLabels:
      app: postgres-user
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: user-service
      ports:
        - port: 5432
          protocol: TCP
```

**`k8s/discovery-server/networkpolicy.yaml`** — all services need to reach Eureka:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-all-to-eureka
  namespace: shopnow
  labels:
    app: discovery-server
    part-of: shopnow
spec:
  podSelector:
    matchLabels:
      app: discovery-server
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              part-of: shopnow
      ports:
        - port: 8761
          protocol: TCP
```

**`k8s/config-server/networkpolicy.yaml`** — all services need to reach config-server
at startup:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-all-to-config
  namespace: shopnow
  labels:
    app: config-server
    part-of: shopnow
spec:
  podSelector:
    matchLabels:
      app: config-server
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              part-of: shopnow
      ports:
        - port: 8888
          protocol: TCP
```

### 3. Apply all NetworkPolicies and verify

```bash
# Apply all at once
kubectl apply -f k8s/namespaces/default-deny-ingress.yaml
kubectl apply -f k8s/api-gateway/networkpolicy.yaml
kubectl apply -f k8s/product-service/networkpolicy.yaml
kubectl apply -f k8s/order-service/networkpolicy.yaml
kubectl apply -f k8s/inventory-service/networkpolicy.yaml
kubectl apply -f k8s/user-service/networkpolicy.yaml
kubectl apply -f k8s/infrastructure/networkpolicy-postgres.yaml
kubectl apply -f k8s/discovery-server/networkpolicy.yaml
kubectl apply -f k8s/config-server/networkpolicy.yaml

# List all policies
kubectl get networkpolicy -n shopnow

# Verify services still work through the gateway
kubectl port-forward svc/api-gateway 8080:8080 -n shopnow &
curl -s http://localhost:8080/api/products | head -c 200
```

### 4. Test that blocked traffic is actually blocked

Start a debug pod and try to reach a database it shouldn't be able to:

```bash
# Run a temporary pod with curl
kubectl run nettest --image=busybox:1.36 -n shopnow --rm -it --restart=Never -- sh

# Inside the pod, try to reach postgres-order (should be blocked):
wget -qO- --timeout=3 http://postgres-order:5432
# Expected: timeout / connection refused

# Try to reach order-service (should also be blocked — nettest has no allow rule):
wget -qO- --timeout=3 http://order-service:8082/actuator/health
# Expected: timeout

exit
```

> If both connections succeed, your CNI doesn't enforce NetworkPolicy. See the CNI
> requirement section above.

### 5. Add SecurityContext to all Deployments

Update every Deployment in `k8s/` to add security contexts. Here is the pattern to apply
to **each** service Deployment (order-service shown as example):

Add `securityContext` at the pod level and container level, and add the `/tmp` volume:

```yaml
spec:
  template:
    spec:
      securityContext:                        # pod-level
        runAsNonRoot: true
        runAsUser: 1000
        runAsGroup: 1000
        fsGroup: 1000
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: order-service
          securityContext:                    # container-level
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop:
                - ALL
          volumeMounts:
            - name: tmp
              mountPath: /tmp
          # ... rest of container spec unchanged
      volumes:
        - name: tmp
          emptyDir: {}
```

Apply this to **all** service Deployments:
- `k8s/api-gateway/deployment.yaml`
- `k8s/product-service/deployment.yaml`
- `k8s/order-service/deployment.yaml`
- `k8s/inventory-service/deployment.yaml`
- `k8s/user-service/deployment.yaml`
- `k8s/config-server/deployment.yaml`
- `k8s/discovery-server/deployment.yaml`

> **Do not add `readOnlyRootFilesystem` to postgres StatefulSets.** PostgreSQL writes
> to its data directory — it needs a writable filesystem. The PVC handles data, but
> postgres also writes to `/var/run/postgresql` and other paths.

### 6. Disable automountServiceAccountToken

For every service **except user-service**, add to the pod spec:

```yaml
spec:
  template:
    spec:
      automountServiceAccountToken: false
```

user-service keeps the default (`true`) because it has a Role that reads Secrets from
the K8s API (Lesson 12).

### 7. Redeploy and verify

```bash
# Re-apply all deployments
kubectl apply -f k8s/api-gateway/deployment.yaml
kubectl apply -f k8s/product-service/deployment.yaml
kubectl apply -f k8s/order-service/deployment.yaml
kubectl apply -f k8s/inventory-service/deployment.yaml
kubectl apply -f k8s/user-service/deployment.yaml
kubectl apply -f k8s/config-server/deployment.yaml
kubectl apply -f k8s/discovery-server/deployment.yaml

# Watch pods restart
kubectl get pods -n shopnow -w

# Verify all pods become Ready
kubectl get pods -n shopnow

# Verify the security context is applied
kubectl get pod -n shopnow -l app=order-service -o jsonpath='{.items[0].spec.securityContext}'
kubectl get pod -n shopnow -l app=order-service -o jsonpath='{.items[0].spec.containers[0].securityContext}'
```

> **If a pod crashes with `readOnlyRootFilesystem`:** check the logs. If the error
> mentions writing to a path (e.g. `/opt/app/logs`), add another `emptyDir` mount for
> that path. The `/tmp` mount covers most Spring Boot needs, but some apps have
> additional write paths.

### 8. Update Spring Boot actuator config

In your `shopnow-config` git repo, update the shared application config (or each
service's individual config) to disable dangerous endpoints and suppress server headers:

```yaml
management:
  endpoint:
    env:
      enabled: false
    configprops:
      enabled: false
    beans:
      enabled: false
    heapdump:
      enabled: false
    shutdown:
      enabled: false

server:
  server-header: ""
  error:
    include-message: never
    include-stacktrace: never
    include-binding-errors: never
```

Commit and push the config repo, then restart pods to pick up the new config:

```bash
kubectl rollout restart deployment -n shopnow
```

### 9. Verify the full hardened state

Run through this checklist:

```bash
# NetworkPolicies in place
kubectl get networkpolicy -n shopnow

# All pods running as non-root
kubectl get pods -n shopnow -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.securityContext.runAsNonRoot}{"\n"}{end}'

# SA token not mounted (should show 'false' for most services)
kubectl get pods -n shopnow -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.automountServiceAccountToken}{"\n"}{end}'

# Actuator endpoints locked down
kubectl port-forward svc/api-gateway 8080:8080 -n shopnow &
curl -s http://localhost:8080/api/products | head -c 100    # should work
curl -s http://localhost:8080/actuator/env                   # should 404 or 401
curl -s http://localhost:8080/actuator/heapdump              # should 404 or 401
```

---

## Notes & Learnings

> _Record anything surprising, problems you hit, or insights you had._

---

## Up Next

Congratulations — you've completed the ShopNow curriculum. The cluster is now running
with network segmentation, least-privilege containers, and locked-down actuator endpoints.

For next steps, consider:
- Adding Egress NetworkPolicies (restrict outbound traffic per service)
- Implementing Pod Security Standards at the namespace level (`pod-security.kubernetes.io/enforce: restricted`)
- Setting up OPA/Gatekeeper for policy-as-code
- Moving to a managed K8s cluster (EKS, GKE, AKS) and applying these same patterns
