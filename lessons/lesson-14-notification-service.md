# Lesson 14 — Kafka StatefulSet & Headless Services: Notification Service

**Status:** [ ] Complete
**K8s Concepts:** StatefulSet (ZooKeeper + Kafka), Headless Service, broker DNS
**Spring Boot Concepts:** Spring Kafka, producer, consumer, event-driven pub/sub

---

## Concept: Why Async Messaging?

So far every inter-service call is **synchronous**: order-service calls inventory-service
and blocks until it gets a response. This is simple but brittle:

- If inventory-service is slow, order-service is slow
- If inventory-service is down, order-service returns an error even for unrelated logic
- Every downstream service that needs to know about an order must be called explicitly

**Asynchronous messaging** decouples producers from consumers:

```
order-service     Kafka topic         notification-service
     │                                     │
     │  publish(OrderPlacedEvent)          │
     └──────────────────────────────────►  │
                                           │ consume(OrderPlacedEvent)
                                           │ send email / push notification
```

order-service does not know notification-service exists. It just publishes an event and
moves on. Any number of services can subscribe to the same topic independently.

---

## Concept: Kafka Fundamentals

```
Producer → Topic (partitioned log) → Consumer Group → Consumer instances
```

| Term | Meaning |
|---|---|
| **Topic** | Named, ordered, durable log of messages |
| **Partition** | A topic is split into N partitions for parallelism |
| **Offset** | Each message has a sequential offset within a partition |
| **Consumer Group** | A named group of consumers that share the work of reading a topic |
| **Broker** | A Kafka server node; manages partitions |
| **ZooKeeper** | Coordination service Kafka uses to elect leaders and store metadata |

When a consumer group has N members and a topic has N partitions, each member reads
exactly one partition — maximum parallelism. With 1 partition (our dev setup), only one
consumer instance is active regardless of how many pods are running.

---

## Concept: StatefulSet for Kafka and ZooKeeper

Both ZooKeeper and Kafka are **stateful** — they must preserve data across restarts and
need stable identities to form a cluster.

ZooKeeper nodes identify each other by ID (1, 2, 3…). Kafka brokers are identified by
their `broker.id`. Both use their pod ordinal index for these IDs.

```
kafka-0  → broker.id=0, advertised.listeners=PLAINTEXT://kafka-0.kafka.shopnow.svc.cluster.local:9092
kafka-1  → broker.id=1, advertised.listeners=PLAINTEXT://kafka-1.kafka.shopnow.svc.cluster.local:9092
```

Producers and consumers connect to a **bootstrap server** (any broker), which then tells
them where each partition leader lives. Because brokers advertise their DNS name (not pod
IP), clients reconnect to the right broker even after a pod restart.

```
Client
  │  bootstrap: kafka-0.kafka.shopnow.svc.cluster.local:9092
  ▼
Kafka broker
  │  "Partition 0 leader is kafka-0.kafka.shopnow.svc.cluster.local:9092"
  ▼
Client connects directly to partition leader
```

This requires a **Headless Service** so that `kafka-0.kafka.shopnow.svc.cluster.local`
resolves to the pod IP of `kafka-0`.

---

## Concept: Headless Service for Kafka

```yaml
apiVersion: v1
kind: Service
metadata:
  name: kafka          # ← used in the DNS name kafka-0.kafka.<namespace>...
spec:
  clusterIP: None      # headless
  selector:
    app: kafka
  ports:
    - port: 9092
```

With this service, DNS gives you:
- `kafka.shopnow.svc.cluster.local` → A records for all pod IPs (round-robin)
- `kafka-0.kafka.shopnow.svc.cluster.local` → always `kafka-0`'s IP

The bootstrap address `kafka-0.kafka.shopnow.svc.cluster.local:9092` is stable across
pod restarts because it resolves via the headless service, not a hard-coded IP.

---

## Concept: Event Schema

Define events as plain Java records shared between producer and consumer via JSON.
For this lesson:

```java
// Published by order-service when an order is confirmed
public record OrderPlacedEvent(
    String orderNumber,
    String customerEmail,   // included so notification-service can send the email
    List<String> skuCodes
) {}
```

Keep events backwards-compatible: add fields, never remove or rename them, because
consumers and producers deploy independently.

---

## Your Task

### 1. Deploy ZooKeeper

Create `k8s/infrastructure/zookeeper.yaml`:

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: zookeeper
  namespace: shopnow
  labels:
    app: zookeeper
    part-of: shopnow
spec:
  serviceName: zookeeper
  replicas: 1
  selector:
    matchLabels:
      app: zookeeper
  template:
    metadata:
      labels:
        app: zookeeper
        part-of: shopnow
    spec:
      containers:
        - name: zookeeper
          image: bitnami/zookeeper:3.9
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 2181
          env:
            - name: ALLOW_ANONYMOUS_LOGIN
              value: "yes"
          volumeMounts:
            - name: zookeeper-data
              mountPath: /bitnami/zookeeper
          resources:
            requests:
              memory: "256Mi"
              cpu: "100m"
            limits:
              memory: "512Mi"
              cpu: "250m"
  volumeClaimTemplates:
    - metadata:
        name: zookeeper-data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: standard
        resources:
          requests:
            storage: 1Gi
```

Create `k8s/infrastructure/zookeeper-svc.yaml`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: zookeeper
  namespace: shopnow
  labels:
    app: zookeeper
    part-of: shopnow
spec:
  clusterIP: None
  selector:
    app: zookeeper
  ports:
    - port: 2181
      targetPort: 2181
```

### 2. Deploy Kafka

Create `k8s/infrastructure/kafka.yaml`:

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: kafka
  namespace: shopnow
  labels:
    app: kafka
    part-of: shopnow
spec:
  serviceName: kafka
  replicas: 1
  selector:
    matchLabels:
      app: kafka
  template:
    metadata:
      labels:
        app: kafka
        part-of: shopnow
    spec:
      containers:
        - name: kafka
          image: bitnami/kafka:3.7
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 9092
          env:
            - name: KAFKA_CFG_ZOOKEEPER_CONNECT
              value: "zookeeper-0.zookeeper.shopnow.svc.cluster.local:2181"
            - name: KAFKA_CFG_LISTENERS
              value: "PLAINTEXT://0.0.0.0:9092"
            - name: KAFKA_CFG_ADVERTISED_LISTENERS
              value: "PLAINTEXT://kafka-0.kafka.shopnow.svc.cluster.local:9092"
            - name: KAFKA_CFG_LISTENER_SECURITY_PROTOCOL_MAP
              value: "PLAINTEXT:PLAINTEXT"
            - name: ALLOW_PLAINTEXT_LISTENER
              value: "yes"
            - name: KAFKA_CFG_AUTO_CREATE_TOPICS_ENABLE
              value: "true"
            - name: KAFKA_CFG_OFFSETS_TOPIC_REPLICATION_FACTOR
              value: "1"
          volumeMounts:
            - name: kafka-data
              mountPath: /bitnami/kafka
          resources:
            requests:
              memory: "512Mi"
              cpu: "250m"
            limits:
              memory: "1Gi"
              cpu: "500m"
  volumeClaimTemplates:
    - metadata:
        name: kafka-data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: standard
        resources:
          requests:
            storage: 2Gi
```

Create `k8s/infrastructure/kafka-svc.yaml`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: kafka
  namespace: shopnow
  labels:
    app: kafka
    part-of: shopnow
spec:
  clusterIP: None
  selector:
    app: kafka
  ports:
    - port: 9092
      targetPort: 9092
```

Apply everything and wait:

```bash
kubectl apply -f k8s/infrastructure/zookeeper.yaml
kubectl apply -f k8s/infrastructure/zookeeper-svc.yaml
kubectl rollout status statefulset/zookeeper -n shopnow --timeout=90s

kubectl apply -f k8s/infrastructure/kafka.yaml
kubectl apply -f k8s/infrastructure/kafka-svc.yaml
kubectl rollout status statefulset/kafka -n shopnow --timeout=120s
```

Verify Kafka is reachable:

```bash
kubectl exec -it kafka-0 -n shopnow -- kafka-topics.sh \
  --bootstrap-server kafka-0.kafka.shopnow.svc.cluster.local:9092 --list
# no output yet (no topics), but no error = Kafka is up
```

### 3. Update order-service to publish events

Add the Kafka starter to `services/order-service/pom.xml`:

```xml
<dependency>
    <groupId>org.springframework.kafka</groupId>
    <artifactId>spring-kafka</artifactId>
</dependency>
```

Add Kafka config to `order-service.yaml` in your config repo:

```yaml
spring:
  kafka:
    bootstrap-servers: kafka-0.kafka.shopnow.svc.cluster.local:9092
    producer:
      key-serializer: org.apache.kafka.common.serialization.StringSerializer
      value-serializer: org.springframework.kafka.support.serializer.JsonSerializer
```

Create `dev.chol.shopnow.order_service.event.OrderPlacedEvent`:

```java
public record OrderPlacedEvent(
    String orderNumber,
    String customerEmail,
    List<String> skuCodes
) {}
```

Create `OrderEventPublisher` (injected into your `OrderService`):

```java
@Service
@RequiredArgsConstructor
public class OrderEventPublisher {
    private final KafkaTemplate<String, OrderPlacedEvent> kafkaTemplate;

    public void publishOrderPlaced(Order order) {
        var skuCodes = order.getOrderLineItems().stream()
                .map(OrderLineItem::getSkuCode)
                .toList();
        kafkaTemplate.send("order-created",
                new OrderPlacedEvent(order.getOrderNumber(), "customer@example.com", skuCodes));
    }
}
```

Call `orderEventPublisher.publishOrderPlaced(savedOrder)` at the end of your
`OrderService.createOrder()` method — **after** saving the order and verifying inventory.

Rebuild and redeploy order-service.

### 4. Implement notification-service

Generate a Spring Boot project with:

| Dependency | Starter |
|---|---|
| Spring Kafka | `spring-kafka` |
| Spring Boot Actuator | `spring-boot-starter-actuator` |
| Config Client | `spring-cloud-starter-config` |
| Eureka Discovery Client | `spring-cloud-starter-netflix-eureka-client` |

Place it in `services/notification-service/`.

`application.yaml`:

```yaml
spring:
  application:
    name: notification-service
  config:
    import: "optional:configserver:http://config-server:8888"
```

Add `notification-service.yaml` to your config repo:

```yaml
server:
  port: 8086

spring:
  kafka:
    bootstrap-servers: kafka-0.kafka.shopnow.svc.cluster.local:9092
    consumer:
      group-id: notification-service
      auto-offset-reset: earliest
      key-deserializer: org.apache.kafka.common.serialization.StringDeserializer
      value-deserializer: org.springframework.kafka.support.serializer.JsonDeserializer
      properties:
        spring.json.trusted.packages: "dev.chol.shopnow.*"

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

Create `OrderPlacedEvent` record (same fields as in order-service):

```java
public record OrderPlacedEvent(
    String orderNumber,
    String customerEmail,
    List<String> skuCodes
) {}
```

Create `OrderNotificationListener`:

```java
@Service
@Slf4j
public class OrderNotificationListener {

    @KafkaListener(topics = "order-created", groupId = "notification-service")
    public void handleOrderPlaced(OrderPlacedEvent event) {
        log.info("Order placed: {} — notifying {} about items {}",
                event.orderNumber(), event.customerEmail(), event.skuCodes());
        // In production: send email, push notification, etc.
    }
}
```

### 5. Deploy notification-service

Create `k8s/notification-service/deployment.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: notification-service
  namespace: shopnow
  labels:
    app: notification-service
    part-of: shopnow
    version: "1.0"
spec:
  replicas: 1
  selector:
    matchLabels:
      app: notification-service
  template:
    metadata:
      labels:
        app: notification-service
        part-of: shopnow
        version: "1.0"
    spec:
      containers:
        - name: notification-service
          image: shopnow/notification-service:latest
          imagePullPolicy: Never
          ports:
            - containerPort: 8086
          startupProbe:
            httpGet:
              path: /actuator/health
              port: 8086
            failureThreshold: 30
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: 8086
            periodSeconds: 10
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: 8086
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

Create `k8s/notification-service/service.yaml`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: notification-service
  namespace: shopnow
  labels:
    app: notification-service
    part-of: shopnow
    version: "1.0"
spec:
  selector:
    app: notification-service
  ports:
    - port: 8086
      targetPort: 8086
```

Build and deploy:

```bash
eval $(minikube docker-env)
cd services/notification-service
./mvnw spring-boot:build-image -Dspring-boot.build-image.imageName=shopnow/notification-service:latest
cd ../..

kubectl apply -f k8s/notification-service/
kubectl rollout status deployment/notification-service -n shopnow --timeout=120s
```

### 6. Test the event flow

```bash
kubectl port-forward svc/api-gateway 8080:8080 -n shopnow

# Create an order (triggers the event)
curl -s -X POST http://localhost:8080/api/orders \
  -H "Content-Type: application/json" \
  -d '{"orderLineItems":[{"skuCode":"SKU-1","price":29.99,"quantity":1}]}'
```

Watch notification-service logs for the consumed event:

```bash
kubectl logs -f deployment/notification-service -n shopnow
# Expected: Order placed: ORD-xxx — notifying customer@example.com about items [SKU-1]
```

Inspect the Kafka topic directly:

```bash
kubectl exec -it kafka-0 -n shopnow -- kafka-console-consumer.sh \
  --bootstrap-server kafka-0.kafka.shopnow.svc.cluster.local:9092 \
  --topic order-created \
  --from-beginning
# You should see the JSON event payloads
```

Check consumer group lag (how far behind is notification-service?):

```bash
kubectl exec -it kafka-0 -n shopnow -- kafka-consumer-groups.sh \
  --bootstrap-server kafka-0.kafka.shopnow.svc.cluster.local:9092 \
  --group notification-service \
  --describe
# LAG column should be 0 — all messages consumed
```

---

## Notes & Learnings

> _Record anything surprising, problems you hit, or insights you had._

---

## Up Next

[Lesson 15 — nginx + Angular: Frontend Deployment](lesson-15-frontend.md)
