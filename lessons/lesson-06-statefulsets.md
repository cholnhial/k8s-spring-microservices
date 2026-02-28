# Lesson 06 — StatefulSets & PVCs: Running PostgreSQL

**Status:** [x] Complete
**K8s Concepts:** StatefulSet, PersistentVolume (PV), PersistentVolumeClaim (PVC), StorageClass
**Spring Boot Concepts:** Spring Data JPA, Flyway migrations

---

## Concept: Why Not a Deployment for Postgres?

A **Deployment** creates pods with random names and no stable storage.
If the pod is replaced, any data written to its filesystem is **lost forever**.

A **StatefulSet** provides:
- **Stable, predictable Pod names** (`postgres-0`, `postgres-1`)
- **Stable network identity** (each Pod gets its own DNS entry)
- **Persistent storage per Pod** via `volumeClaimTemplates`

Storage is provided by the following chain:

```
StatefulSet
  └── PersistentVolumeClaim (PVC)  ← "I need 1Gi of storage"
        └── PersistentVolume (PV)   ← "Here is 1Gi on the node disk"
              └── StorageClass      ← "Provision it using this driver"
```

In Minikube, the `standard` StorageClass provisions PVs automatically using `hostPath`
(a directory on the Minikube VM's disk).

---

## Your Task

### 1. Create the PostgreSQL Secret

```bash
kubectl create secret generic product-db-credentials \
  --from-literal=POSTGRES_DB=productdb \
  --from-literal=POSTGRES_USER=shopnow \
  --from-literal=POSTGRES_PASSWORD=changeme \
  -n shopnow
```

### 2. Write the PostgreSQL StatefulSet

Create `k8s/infrastructure/postgres-product.yaml`:

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres-product
  namespace: shopnow
  labels:
    app: postgres-product
    part-of: shopnow
spec:
  serviceName: postgres-product    # Must match the Headless Service name below
  replicas: 1
  selector:
    matchLabels:
      app: postgres-product
  template:
    metadata:
      labels:
        app: postgres-product
        part-of: shopnow
    spec:
      containers:
        - name: postgres
          image: postgres:16-alpine
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 5432
          envFrom:
            - secretRef:
                name: product-db-credentials
          volumeMounts:
            - name: postgres-data
              mountPath: /var/lib/postgresql/data
          resources:
            requests:
              memory: "256Mi"
              cpu: "250m"
            limits:
              memory: "512Mi"
              cpu: "500m"
  volumeClaimTemplates:          # K8s creates a PVC for each Pod automatically
    - metadata:
        name: postgres-data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: standard   # Minikube default
        resources:
          requests:
            storage: 1Gi
```

### 3. Create a Headless Service for PostgreSQL

A **Headless Service** (ClusterIP: None) gives each StatefulSet Pod its own stable DNS name.
For a single-replica database you could use a normal ClusterIP Service, but the headless
pattern is correct and scales to replicated databases.

Create `k8s/infrastructure/postgres-product-svc.yaml`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: postgres-product
  namespace: shopnow
spec:
  clusterIP: None       # Headless — no virtual IP, DNS resolves to Pod IPs directly
  selector:
    app: postgres-product
  ports:
    - port: 5432
      targetPort: 5432
```

### 4. Verify persistence

```bash
kubectl apply -f k8s/infrastructure/
kubectl get statefulset -n shopnow
kubectl get pvc -n shopnow
kubectl get pv

# Connect to postgres
kubectl exec -it postgres-product-0 -n shopnow -- psql -U shopnow -d productdb

# Kill the pod and verify data survives
kubectl delete pod postgres-product-0 -n shopnow
kubectl get pods -n shopnow -w   # Watch it recreate as postgres-product-0
```

### 5. Repeat for other databases

You will need a separate PostgreSQL StatefulSet (and Secret) for each service that owns a DB:
- `postgres-order` for order-service
- `postgres-inventory` for inventory-service
- `postgres-user` for user-service

> **This is intentional.** Each service owns its own database — a core microservices pattern.
> Services never share a database. They communicate via API calls or events.

---

## Spring Boot Connection Setup

In the service's config file (managed by config-server):

```yaml
spring:
  datasource:
    url: jdbc:postgresql://postgres-product:5432/productdb
    username: ${POSTGRES_USER}
    password: ${POSTGRES_PASSWORD}
  jpa:
    hibernate:
      ddl-auto: validate        # Let Flyway manage schema, not Hibernate
  flyway:
    enabled: true
    locations: classpath:db/migration
```

---

## Notes & Learnings

> _Record anything surprising, problems you hit, or insights you had._

---

## Up Next

[Lesson 07 — Service Discovery: Deploying Eureka](lesson-07-discovery.md)
