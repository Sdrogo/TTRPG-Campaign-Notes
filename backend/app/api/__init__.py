"""HTTP layer: one FastAPI router per resource. Handlers stay thin - parse the
request, call the domain layer, map its exceptions to HTTP statuses."""
