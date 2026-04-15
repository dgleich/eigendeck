# Performance Results

This directory tracks SQLite storage performance over time.

## Running benchmarks

```bash
# Full performance suite (saves results automatically)
node tools/bench-perf.mjs --save tools/perf-results/

# Junction model benchmark
node tools/bench-junction.mjs

# JSON conversion benchmark
node tools/bench-json-convert.mjs

# Storage format comparison (SQLite vs ZIP vs JSON)
node tools/bench-storage.mjs example-demos/magnetic-powers
```

## Baseline (April 2026, 250 slides, ~1000 elements)

| Operation | Median |
|---|---|
| read_slide_elements | 0.005ms |
| read_element_by_id | 0.002ms |
| write_update_element | 0.024ms |
| write_sync_propagation_5 | 0.074ms |
| read_all_slides_with_elements | 1.2ms |
| history_load_at_time | 3.6ms |
| toJSON (250 slides) | 3.2ms |
| fromJSON (250 slides) | 6.3ms |

## Tracking

Results are saved as JSON files with timestamps. Compare with:

```bash
# Show latest result
cat tools/perf-results/$(ls -t tools/perf-results/perf-*.json | head -1)

# Compare two results
diff <(jq '.results | to_entries[] | "\(.key): \(.value.median)"' FILE1) \
     <(jq '.results | to_entries[] | "\(.key): \(.value.median)"' FILE2)
```
