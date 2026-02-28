# Lesson 03 — Deployments & ReplicaSets: Self-Healing Workloads

**Status:** [x] Complete
**K8s Concepts:** Deployment, ReplicaSet, rollout, rollback, `kubectl rollout`
**Spring Boot Concepts:** n/a (infrastructure focus)

---

## Concept: Why Not Just Run Pods?

Pods on their own have no self-healing. If a Pod crashes or the node it runs on dies,
the Pod is gone forever. A **Deployment** fixes this by declaring *desired state*:

> "I want 2 replicas of this Pod running at all times."

Kubernetes continuously reconciles actual state toward desired state.

```
Deployment
  └── ReplicaSet (manages N identical Pods)
        ├── Pod (instance 1)
        ├── Pod (instance 2)
        └── Pod (instance 3)
```

A **ReplicaSet** is what actually keeps the right number of Pods alive. You rarely interact
with it directly — the Deployment manages ReplicaSets for you when you do rolling updates.

---

## Concept: Rolling Updates

When you update an image in a Deployment, Kubernetes does a **rolling update** by default:
1. Spin up a new Pod with the new image
2. Wait for it to be Ready
3. Kill one old Pod
4. Repeat until all Pods are updated

This gives you **zero-downtime deploys**. You can also roll back to the previous version
if something goes wrong.

---

## Your Task

### 1. Deploy Eureka Discovery Server

We will deploy Eureka first because every other service needs it running.
You will write the Spring Boot implementation and build the real image in Lesson 07.
For now, use a plain `nginx:alpine` placeholder so you can learn the Deployment resource
without needing your own image yet.

Create `k8s/discovery-server/deployment.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: discovery-server
  namespace: shopnow
  labels:
    app: discovery-server
    part-of: shopnow
    version: "1.0"
spec:
  replicas: 1
  selector:
    matchLabels:
      app: discovery-server
  template:
    metadata:
      labels:
        app: discovery-server
        part-of: shopnow
        version: "1.0"
    spec:
      containers:
        - name: discovery-server
          image: nginx:alpine    # placeholder — replaced with shopnow/discovery-server:latest in Lesson 07
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 8761
          resources:
            requests:
              memory: "256Mi"
              cpu: "250m"
            limits:
              memory: "512Mi"
              cpu: "500m"
```

> **Lesson 07:** When you build the real Spring Boot Eureka server, you will replace
> `nginx:alpine` with `shopnow/discovery-server:latest` built via Buildpacks:
> ```bash
> eval $(minikube docker-env)
> cd services/discovery-server
> ./mvnw spring-boot:build-image -Dspring-boot.build-image.imageName=shopnow/discovery-server:latest
> ```

### 2. Observe the ReplicaSet

```bash
kubectl apply -f k8s/discovery-server/deployment.yaml
kubectl get deployment -n shopnow
kubectl get replicaset -n shopnow
kubectl get pods -n shopnow

# See the full rollout history
kubectl rollout history deployment/discovery-server -n shopnow
```

### 3. Simulate a Pod crash

```bash
# Delete a pod manually — watch it get recreated
kubectl delete pod <pod-name> -n shopnow
kubectl get pods -n shopnow -w    # -w watches for changes
```

### 4. Scale the Deployment

```bash
kubectl scale deployment/discovery-server --replicas=3 -n shopnow
kubectl get pods -n shopnow
kubectl scale deployment/discovery-server --replicas=1 -n shopnow
```

### 5. Simulate a rollback

```bash
# "Update" to a bad image
kubectl set image deployment/discovery-server \
  discovery-server=non-existent-image:broken -n shopnow

kubectl rollout status deployment/discovery-server -n shopnow   # watch it fail
kubectl rollout undo deployment/discovery-server -n shopnow     # roll back
kubectl rollout status deployment/discovery-server -n shopnow   # watch recovery
```

---

## Key Deployment Fields

```yaml
spec:
  replicas: 2
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1          # Extra pods allowed during update
      maxUnavailable: 0    # No pods can be down during update
  selector:
    matchLabels:           # MUST match template.metadata.labels
      app: my-app
```

---

## Notes & Learnings

> _Record anything surprising, problems you hit, or insights you had._

---

## Up Next

[Lesson 04 — Services & Networking](lesson-04-services.md)
