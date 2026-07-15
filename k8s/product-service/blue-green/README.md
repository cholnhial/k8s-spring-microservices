# Product Service Blue/Green Demo

These manifests support Lesson 18 without changing the normal `product-service`
Deployment used by later lessons.

Before applying the blue/green Deployments, remove the normal rollout controller for
the demo:

```bash
kubectl delete hpa product-service-hpa -n shopnow --ignore-not-found=true
kubectl delete deployment product-service -n shopnow --ignore-not-found=true
```

That matters because the normal `product-service` Deployment selects
`app: product-service`, which would overlap with both `slot: blue` and `slot: green`
pods. The HPA also targets the normal Deployment, so delete it for the demo and
re-apply `k8s/product-service/hpa.yaml` after restoring the normal Deployment.

The standard Service at `k8s/product-service/service.yaml` selects every pod with
`app: product-service`. For a real blue/green flip, patch that Service selector to
include the slot you want live:

```bash
kubectl patch svc/product-service -n shopnow -p '{"spec":{"selector":{"app":"product-service","slot":"blue"}}}'
kubectl patch svc/product-service -n shopnow -p '{"spec":{"selector":{"app":"product-service","slot":"green"}}}'
```

Use `product-service-green-test` to smoke test green before flipping the main Service:

```bash
kubectl port-forward svc/product-service-green-test 8091:8081 -n shopnow
```

The `product-service-blue-live` Service is only a named helper for direct blue-slot
testing. It is not part of the normal application path.

Restore the normal path after the lesson:

```bash
kubectl delete -f k8s/product-service/blue-green/
kubectl apply -f k8s/product-service/deployment.yaml
kubectl apply -f k8s/product-service/service.yaml
kubectl apply -f k8s/product-service/hpa.yaml
```
