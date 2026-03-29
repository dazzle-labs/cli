# stage-runtime development Makefile
#
# Wraps cargo commands with the right feature flags, env vars, and test filters.
# Run `make help` to see all targets.

SHELL := /bin/bash

CARGO := cargo
CARGO_TEST := $(CARGO) test --package stage-runtime
CARGO_BENCH := $(CARGO) bench --package stage-runtime

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

.PHONY: build check clippy

build: ## Build with default features
	$(CARGO) build --package stage-runtime

check: ## Compile-check
	$(CARGO) check --package stage-runtime

clippy: ## Run clippy
	$(CARGO) clippy --package stage-runtime -- -D warnings

# ---------------------------------------------------------------------------
# Tests — by subsystem
# ---------------------------------------------------------------------------

.PHONY: test test-canvas2d test-htmlcss test-webgl2 test-audio test-encoder
.PHONY: test-props test-fuzz test-e2e test-adversarial

test: ## Run all tests (excludes encoder, GPU)
	$(CARGO_TEST)

test-all: ## Run all tests (requires ffmpeg)
	$(CARGO_TEST)

test-canvas2d: ## Canvas2D reference + unit tests
	$(CARGO_TEST) --test reference_test --test canvas2d_basic_test --test canvas2d_event_test

test-htmlcss: ## HTML/CSS reference + mixed tests
	$(CARGO_TEST) --test htmlcss_reference_test --test htmlcss_mixed_test

test-webgl2: ## WebGL2 reference + unit + shader tests (requires GPU)
	$(CARGO_TEST) --test webgl2_reference_test --test webgl2_basic_test --test webgl2_event_test --test webgl2_shader_test

test-audio: ## Audio reference + e2e + offline tests
	$(CARGO_TEST) --test audio_reference_test --test audio_e2e_test --test audio_offline_test

test-encoder: ## Encoder round-trip tests (requires ffmpeg)
	$(CARGO_TEST) --test encoder_test

test-props: ## Property-based tests (proptest)
	$(CARGO_TEST) --test hotpath_prop_test --test highvalue_prop_test --test polyfill_prop_test

test-fuzz: ## Fuzz tests (shader + context)
	$(CARGO_TEST) --test shader_fuzz_test --test context_fuzz_test

test-e2e: ## End-to-end framework tests (Three.js, p5, GSAP, D3, Tone patterns)
	$(CARGO_TEST) --test framework_e2e_test

test-adversarial: ## Adversarial review regression tests
	$(CARGO_TEST) --test adversarial_fixes_test

# ---------------------------------------------------------------------------
# Tests — single scene (usage: make scene NAME=solid_rects)
# ---------------------------------------------------------------------------

.PHONY: scene

scene: ## Run a single reference scene (NAME=scene_name)
ifndef NAME
	$(error Usage: make scene NAME=solid_rects)
endif
	$(CARGO_TEST) --test reference_test -- ref_$(NAME) --exact 2>/dev/null || \
	$(CARGO_TEST) --test htmlcss_reference_test -- ref_$(NAME) --exact 2>/dev/null || \
	$(CARGO_TEST) --test webgl2_reference_test -- webgl2_$(NAME) --exact

# ---------------------------------------------------------------------------
# Tests — visual debugging
# ---------------------------------------------------------------------------

.PHONY: test-save test-save-canvas2d test-save-htmlcss test-save-webgl2

test-save: ## Run all reference tests, save every render as PNG
	SAVE_ALL=1 $(CARGO_TEST) --test reference_test --test htmlcss_reference_test --test webgl2_reference_test

test-save-canvas2d: ## Run Canvas2D reference tests, save renders
	SAVE_ALL=1 $(CARGO_TEST) --test reference_test

test-save-htmlcss: ## Run HTML/CSS reference tests, save renders
	SAVE_ALL=1 $(CARGO_TEST) --test htmlcss_reference_test

test-save-webgl2: ## Run WebGL2 reference tests, save renders
	SAVE_ALL=1 $(CARGO_TEST) --test webgl2_reference_test

# ---------------------------------------------------------------------------
# Fixtures — regenerate Chrome reference images
# ---------------------------------------------------------------------------

.PHONY: fixtures fixtures-canvas2d fixtures-htmlcss fixtures-webgl2 fixtures-audio

fixtures: ## Regenerate ALL Chrome reference images (requires Puppeteer)
	node tests/fixtures/generate.cjs
	node tests/htmlcss_fixtures/generate.cjs
	node tests/webgl2_fixtures/generate.cjs
	node tests/audio_fixtures/generate_reference.cjs

fixtures-canvas2d: ## Regenerate Canvas2D reference images
	node tests/fixtures/generate.cjs

fixtures-htmlcss: ## Regenerate HTML/CSS reference images
	node tests/htmlcss_fixtures/generate.cjs

fixtures-webgl2: ## Regenerate WebGL2 reference images
	node tests/webgl2_fixtures/generate.cjs

fixtures-audio: ## Regenerate audio reference data
	node tests/audio_fixtures/generate_reference.cjs

# ---------------------------------------------------------------------------
# Benchmarks
# ---------------------------------------------------------------------------

.PHONY: bench bench-render bench-htmlcss bench-e2e bench-percentile

bench: ## Run all benchmarks
	$(CARGO_BENCH) --bench render_bench
	$(CARGO_BENCH) --bench htmlcss_bench
	$(CARGO_BENCH) --bench percentile_bench

bench-render: ## Canvas2D + WebGL2 render benchmarks
	$(CARGO_BENCH) --bench render_bench

bench-htmlcss: ## HTML/CSS render benchmarks
	$(CARGO_BENCH) --bench htmlcss_bench

bench-e2e: ## Full pipeline encode benchmarks (requires ffmpeg)
	$(CARGO_BENCH) --bench e2e_encode_bench

bench-percentile: ## Percentile statistics benchmarks
	$(CARGO_BENCH) --bench percentile_bench

# ---------------------------------------------------------------------------
# Help
# ---------------------------------------------------------------------------

.PHONY: help
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
