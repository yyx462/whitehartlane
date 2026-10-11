# Incident 2026-09-30: checkout degradation (40 minutes)

## Section 1 — auth degradation
- 02:03 UTC — token refresh latency on auth-2 rises from 40ms to 9s
      after a connection-pool config push (change CH-8841)
- 02:07 UTC — checkout error rate hits 31%; pagers fire
- 02:19 UTC — CH-8841 rolled back; latency recovers over four minutes
- 02:23 UTC — error rate back under 0.5%

## Section 2 — database failover lag
- 02:05 UTC — the connection storm trips the db-11 health check;
      the replica failover starts
- 02:11 UTC — failover completes, but the replica lag cache serves
      stale prices for six minutes
- 02:17 UTC — lag cache purged manually; fresh prices resume
- 02:43 UTC — incident closed; both systems green for 20 minutes
