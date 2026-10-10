# Variables
NPM := npm
VITE := npx vite
DIST_DIR := dist
NODE_MODULES := node_modules

# Colors for help output
BLUE := \033[36m
RESET := \033[0m

.PHONY: help install dev build build-lib build-demo test test-watch lint format clean fclean preview start pbr

# Default target
all: help

help: ## Zeigt diese Hilfe an
	@echo "Verfügbare Befehle für Small World Machine:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "$(BLUE)%-20s$(RESET) %s\n", $$1, $$2}'

install: $(NODE_MODULES) ## Installiert Abhängigkeiten

$(NODE_MODULES): package.json
	$(NPM) install
	@touch $(NODE_MODULES)

serve: install ## Startet den Development-Server (Vite)
	$(NPM) run dev

build: install ## Erstellt Library und Demo (Produktion)
	$(NPM) run build

build-lib: install ## Erstellt nur die Library
	$(NPM) run build:lib

build-demo: install ## Erstellt nur die Demo
	$(NPM) run build:demo

test: install ## Führt alle Tests einmalig aus
	$(NPM) run test

test-watch: install ## Startet Vitest im Watch-Modus
	$(NPM) run test:watch

lint: install ## Überprüft den Code auf Linting-Fehler
	$(NPM) run lint

format: install ## Formatiert den Code mit Prettier und fixiert Linting-Fehler
	$(NPM) run format

clean: ## Löscht Build-Artefakte
	rm -rf $(DIST_DIR)
	@echo "Build-Artefakte gelöscht."

fclean: clean ## Löscht Build-Artefakte und node_modules
	rm -rf $(NODE_MODULES)
	@echo "node_modules gelöscht."

preview: build ## Startet eine Vorschau der gebauten Demo
	$(NPM) run preview

start: build ## Baut das Projekt und serviert es (lokal)
	$(NPM) run start

pbr: ## Generiert PBR-Maps aus einem Bild/Ordner (Bsp: make pbr IN=./ordner SET="NORM_STRENGTH=3.0")
	@if [ -z "$(IN)" ]; then \
		echo "Fehler: Du musst IN angeben! (z.B. make pbr IN=./ordner)"; \
		exit 1; \
	fi
	@bash scripts/pbr.sh --in $(IN) \
		$(if $(OUT),--out $(OUT)) \
		$(if $(PROFILE),--profile $(PROFILE)) \
		$(if $(filter true,$(FORCE)),--force) \
		$(if $(OUT_FORMAT),--out-format $(OUT_FORMAT)) \
		$(if $(QUALITY),--quality $(QUALITY)) \
		$(if $(RESIZE),--resize "$(RESIZE)") \
		$(foreach s,$(SET),--set "$(s)")
