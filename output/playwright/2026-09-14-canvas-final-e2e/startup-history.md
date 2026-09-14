# Isolated final fixture startup

The first API af84347 fixture attempt (`b1c4450b-a799-4c42-ab88-bbbcc4bf3007`) processed the key reference, then stopped with `FIXTURE_MEDIA_REJECTED hand`. Its old diagnostic did not retain the media issue code, so this is not attributed to a specific product or infrastructure cause. The fixture never became available for browser acceptance. Its owned resources were cleaned; cleanup reported `closed: true`, no failures and no worker errors, with zero provider calls.

The harness now records status and structured media issue details before aborting. A bounded retry uses the same actual input files and product media processing limits; it does not weaken timeouts or bypass ready-state validation. Its final outcome is recorded in the acceptance report.

Separately, the earlier local full media suite was interrupted after repeated container setup timeouts. A minimal unchanged ffmpeg version probe measured container creation at 13.099 s and total completion at 19.244 s; after stopping that suite, creation took 0.807 s and completion 6.777 s. This identifies local setup latency, without establishing a precise CPU/IO cause. Linux GitHub CI for API af84347 subsequently completed verify, verify-deployment and verify-isolated-recovery successfully. Local partial results are retained in the adjacent media regression evidence directory.
