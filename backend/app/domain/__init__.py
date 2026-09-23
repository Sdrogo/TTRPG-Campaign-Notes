"""Business rules and invariants, framework-independent: plain data in, plain
data out, no FastAPI or database imports. Rule violations are raised as narrow
exceptions that the API layer maps to HTTP statuses."""
