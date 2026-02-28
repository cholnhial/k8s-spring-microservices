# Lesson 04 — Services & Networking: Exposing Workloads

**Status:** [x] Complete
**K8s Concepts:** Service (ClusterIP, NodePort, LoadBalancer), DNS, kube-proxy, Endpoints
**Spring Boot Concepts:** Service-to-service HTTP calls, Eureka client registration

---

## Concept: The Problem Pods Have

Every Pod gets its own IP address — but that IP **changes every time the Pod is replaced**.
Other services cannot rely on a Pod IP to call it.

A **Service** is a stable network identity in front of a set of Pods. It:
- Gets a permanent **ClusterIP** (virtual IP inside the cluster)
- Gets a permanent **DNS name** (`<service-name>.<namespace>.svc.cluster.local`)
- Load-balances traffic across all healthy Pods that match its selector

```
Service: discovery-server (10.96.0.50:8761)
   │
   ├──► Pod A (10.244.0.5:8761)
   ├──► Pod B (10.244.0.8:8761)
   └──► Pod C (10.244.1.2:8761)
```

---

## Service Types

| Type | Reachable From | Use Case |
|---|---|---|
| `ClusterIP` | Inside the cluster only | Default; service-to-service calls |
| `NodePort` | Outside via `<node-ip>:<port>` (30000-32767) | Dev/testing access without Ingress |
| `LoadBalancer` | Outside via a cloud load balancer | Production on cloud providers |

> **In Minikube**, `LoadBalancer` services get an `<pending>` external IP unless you run
> `minikube tunnel`. Use `NodePort` or `Ingress` for local external access.

---

## Your Task

### 1. Expose the Discovery Server

Create `k8s/discovery-server/service.yaml`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: discovery-server
  namespace: shopnow
  labels:
    app: discovery-server
    part-of: shopnow
    version: "1.0"
spec:
  type: ClusterIP            # Only reachable inside the cluster
  selector:
    app: discovery-server    # Routes to pods with this label
  ports:
    - name: http
      port: 8761             # Port the Service listens on
      targetPort: 8761       # Port the container is listening on
```

Apply it and verify:

```bash
kubectl apply -f k8s/discovery-server/service.yaml
kubectl get svc -n shopnow
kubectl describe svc discovery-server -n shopnow   # check Endpoints section
```

### 2. Test DNS resolution from inside the cluster

```bash
kubectl run dns-test --image=busybox:latest --restart=Never -it --rm -n shopnow -- sh

# Inside the pod:
nslookup discovery-server.shopnow.svc.cluster.local
wget -qO- http://discovery-server:8761/
```

### 3. Access Eureka from your laptop via NodePort

Create `k8s/discovery-server/service-nodeport.yaml`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: discovery-server-external
  namespace: shopnow
  labels:
    app: discovery-server
    part-of: shopnow
    version: "1.0"
spec:
  type: NodePort
  selector:
    app: discovery-server
  ports:
    - port: 8761
      targetPort: 8761
      nodePort: 30761    # Fixed port on the Minikube node
```

```bash
kubectl apply -f k8s/discovery-server/service-nodeport.yaml
minikube service discovery-server-external -n shopnow   # Opens browser automatically
```

### 4. Understand Endpoints

```bash
# Endpoints are the actual Pod IPs behind a Service
kubectl get endpoints discovery-server -n shopnow

# Scale and watch endpoints update
kubectl scale deployment/discovery-server --replicas=2 -n shopnow
kubectl get endpoints discovery-server -n shopnow   # Two IPs now
```

---

## DNS Shorthand

From inside the `shopnow` namespace, services can be reached by short name:

| DNS Name | Resolves To |
|---|---|
| `discovery-server` | `discovery-server.shopnow.svc.cluster.local` |
| `discovery-server.shopnow` | Same — works cross-namespace with namespace suffix |

Spring Boot services in the same namespace configure their Eureka URL as:
```yaml
eureka.client.service-url.defaultZone: http://discovery-server:8761/eureka
```

---

## Notes & Learnings

> _Record anything surprising, problems you hit, or insights you had._

- What happens when endpoints scale?

---

## Up Next

[Lesson 05 — ConfigMaps & Secrets: Spring Cloud Config Server](lesson-05-config.md)
