# Repository guidance

## Backwards compatibility

- Always preserve backwards compatibility and minimize disruption to existing
  users and use cases unless the operator explicitly authorizes a breaking or
  major change.
- Treat behavior and defaults as compatibility contracts alongside exported APIs
  and types. Preserve admission and backpressure, ordering and concurrency, error
  behavior, and lifecycle semantics.
- Prefer additive, opt-in features and preserve existing defaults.
- Before pursuing a breaking change, explain its compatibility impact and
  recommend reserving it for a major version update. An ambiguous feature request
  does not authorize breaking existing behavior.
- Routine compatible changes do not require additional approval under this
  policy.
