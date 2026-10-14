#!/bin/bash

# --- 1. PFADE RELATIV ZUM SKRIPT ERMITTELN ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- 2. LADE UMGEBUNG (.env) ---
ENV_FILE="$SCRIPT_DIR/pbr.env"
if [ -f "$ENV_FILE" ]; then
    # shellcheck disable=SC1090
    source "$ENV_FILE"
else
    MAGICK_EXE=""
    DEFAULT_PROFILE="default"
    EXPORT_SUBFOLDER="pbr_export"
    KEEP_TEMP_FILES=false
    LOG_PREFIX="[PBR-GEN]"
fi

PROFILE_DIR="$SCRIPT_DIR/pbr.profiles"
SELECTED_PROFILE=$DEFAULT_PROFILE

# --- FUNKTIONEN ---

usage() {
    cat <<EOF
Usage: pbr.sh [options]

JSON / Config Input:
  --json <json_str|@file>  Full configuration as JSON string or @path/to/file.json
  --config <file.json>     Alias for --json @file.json

Input/Output:
  --in <path>              Input file or directory (required unless using --json)
  --out <path>             Output directory (default: <input-dir>/pbr_export or same as input)
  --out-format <ext>       Output format: jpg, png, webp, tiff, exr (default: webp)
  --quality <n>            Compression quality 1-100 (default: format-specific)
  --resize <WxH>           Resize with Lanczos (e.g. 1024x1024)
  --no-copy                Skip copying/converting the albedo to output dir

Generation:
  --profile <name>         Profile to load from pbr.profiles/ (default: $DEFAULT_PROFILE)
  --maps <list>            Comma-separated list of maps to generate:
                             height, displacement, normal, specular, roughness, ao, edge
                           (default: all)
  --force                  Overwrite existing output files
  --keep-temp              Keep intermediate .tmp files

Profile parameter overrides (all also settable via --set KEY=VALUE or JSON params):
  --norm-strength <v>      Normal map Sobel scale, e.g. 220%   [NORM_STRENGTH]
  --height-blur <v>        Blur before heightmap, e.g. 0x1     [HEIGHT_BLUR]
  --disp-blur <v>          Blur for displacement map, e.g. 0x4  [DISP_BLUR]
  --spec-contrast <v>      Sigmoidal contrast, e.g. 8,30%      [SPEC_CONTRAST]
  --rough-gamma <v>        Roughness gamma curve, e.g. 0.7     [ROUGH_GAMMA]
  --ao-blur <v>            AO soft blur sigma, e.g. 0x4        [AO_SOFT_BLUR]
  --ao-fine <v>            AO valley multiplier, e.g. 8        [AO_FINE]
  --ao-level <v>           AO base brightness add, e.g. 5%     [AO_LEVEL]
  --edge-threshold <v>     Edge detection threshold, e.g. 85%  [EDGE_THRESHOLD]
  --set KEY=VALUE          Override any profile variable directly

Available profiles: $(ls "$PROFILE_DIR"/*.conf 2>/dev/null | xargs -I{} basename {} .conf | tr '\n' ' ')

Examples:
  pbr.sh --in albedo.jpg --profile stone --maps normal,roughness,ao
  pbr.sh --json '{"in": "albedo.jpg", "profile": "stone", "maps": ["normal", "roughness", "ao"], "params": {"AO_FINE": 8}}'
  pbr.sh --config my-job.json
EOF
    exit 0
}

check_deps() {
    if command -v magick &> /dev/null; then
        MAGICK_EXE="magick"
    elif command -v convert &> /dev/null; then
        MAGICK_EXE="convert"
    elif [ -n "$MAGICK_EXE" ] && command -v "$MAGICK_EXE" &> /dev/null; then
        :
    else
        echo "$LOG_PREFIX Fehler: ImageMagick (magick oder convert) nicht gefunden!"
        exit 1
    fi
    echo "$LOG_PREFIX Nutze: $MAGICK_EXE"
}

# Prüft ob eine Map in der MAPS-Auswahl enthalten ist
map_enabled() {
    local map="$1"
    [[ ",$MAPS," == *",$map,"* ]]
}

process_file() {
    local IN="$1"
    local OUT_DIR="$2"
    local BASE
    local NAME
    local ORIG_EXT
    local EXT

    BASE=$(basename -- "$IN")
    ORIG_EXT="${BASE##*.}"
    NAME="${BASE%.*}"

    # Entferne _diffuse falls vorhanden
    NAME="${NAME%_diffuse}"

    # Bestimme das Ausgabeformat (Standard: webp, ausser der User gibt was anderes an)
    EXT="${OUT_FORMAT:-webp}"
    EXT="${EXT#.}"
    EXT=$(echo "$EXT" | tr '[:upper:]' '[:lower:]')

    # Bestimme die passenden ImageMagick Kompressions-Optionen
    local IM_QUALITY_OPTS=""
    if [ -n "$COMPRESSION_QUALITY" ]; then
        case "$EXT" in
            jpg|jpeg|webp) IM_QUALITY_OPTS="-quality $COMPRESSION_QUALITY" ;;
            png) IM_QUALITY_OPTS="-quality 90" ;;
            tiff|tif) IM_QUALITY_OPTS="-compress LZW" ;;
            exr) IM_QUALITY_OPTS="-compress Zip" ;;
        esac
    else
        case "$EXT" in
            png) IM_QUALITY_OPTS="-quality 90" ;;
            webp) IM_QUALITY_OPTS="-define webp:lossless=true" ;;
            tiff|tif) IM_QUALITY_OPTS="-compress LZW" ;;
        esac
    fi

    local IM_RESIZE_OPTS=""
    if [ -n "$RESIZE_VAL" ]; then
        IM_RESIZE_OPTS="-filter Lanczos -resize $RESIZE_VAL"
    fi

    echo "$LOG_PREFIX Erstelle Maps für: $BASE ..."

    local OUT_BASE="$OUT_DIR/$NAME"
    local ORIG_EXT_LOWER
    ORIG_EXT_LOWER=$(echo "$ORIG_EXT" | tr '[:upper:]' '[:lower:]')

    # Originalbild konvertieren/skalieren (überspringbar via --no-copy)
    if [ "$NO_COPY" != true ]; then
        if [ "$ORIG_EXT_LOWER" != "$EXT" ] || [ -n "$RESIZE_VAL" ]; then
            if [ "$FORCE_OVERWRITE" = true ] || ( [ ! -f "${OUT_BASE}_diffuse.$EXT" ] && [ ! -f "${OUT_BASE}.$EXT" ] ); then
                echo "$LOG_PREFIX -> Konvertiere/Skaliere Original..."
                $MAGICK_EXE "$IN" $IM_RESIZE_OPTS $IM_QUALITY_OPTS "${OUT_BASE}.$EXT"
            fi
        fi
    fi

    # Hilfsfunktion: Prüft ob eine Datei mit einem der Suffixe existiert
    has_existing() {
        local obase="$1"
        local oext="$2"
        shift 2
        for s in "$@"; do
            if [ -f "${obase}${s}.${oext}" ]; then
                return 0
            fi
        done
        return 1
    }

    # HEIGHT — immer intern erzeugt (Basis für alle anderen Maps)
    local HEIGHT_FILE="${OUT_BASE}_height.$EXT"
    if map_enabled "height" && { [ "$FORCE_OVERWRITE" = true ] || ! has_existing "$OUT_BASE" "$EXT" "_height"; }; then
        echo "$LOG_PREFIX -> Height"
        $MAGICK_EXE "$IN" -colorspace gray $IM_RESIZE_OPTS -blur "$HEIGHT_BLUR" $IM_QUALITY_OPTS "$HEIGHT_FILE"
    elif ! map_enabled "height"; then
        # Height nicht exportieren, aber intern als temp erzeugen
        HEIGHT_FILE="${OUT_DIR}/${NAME}_height_internal.tmp"
        $MAGICK_EXE "$IN" -colorspace gray $IM_RESIZE_OPTS -blur "$HEIGHT_BLUR" "$HEIGHT_FILE"
    else
        echo "$LOG_PREFIX -> Überspringe Height (existiert bereits)"
    fi

    # DISPLACEMENT
    if map_enabled "displacement"; then
        local DISP_FILE="${OUT_BASE}_displacement.$EXT"
        if [ "$FORCE_OVERWRITE" = true ] || ! has_existing "$OUT_BASE" "$EXT" "_displacement" "_disp"; then
            echo "$LOG_PREFIX -> Displacement"
            $MAGICK_EXE "$HEIGHT_FILE" -blur "$DISP_BLUR" $IM_QUALITY_OPTS "$DISP_FILE"
        else
            echo "$LOG_PREFIX -> Überspringe Displacement (existiert bereits)"
        fi
    fi

    # NORMAL
    if map_enabled "normal"; then
        local NORM_FILE="${OUT_BASE}_normal.$EXT"
        if [ "$FORCE_OVERWRITE" = true ] || ! has_existing "$OUT_BASE" "$EXT" "_normal"; then
            echo "$LOG_PREFIX -> Normal"
            # Normalisierte Tangent-Space-Normal-Map (OpenGL-Konvention, unit length, portabel):
            # Sobel X/Y -> R/G, Z=up -> B, danach exakte per-Pixel-Normalisierung via -fx.
            # Kein Verlass auf Shader-Renormalisierung. Vorzeichen wie generateNormalMap (invertR=false):
            # nx=(0.5-a), ny=(0.5-b), nz=1, v=(nx,ny,nz)/|(nx,ny,nz)| -> Kanal 0.5+0.5*v.
            local A_TMP="${OUT_DIR}/${NAME}_ngx.tmp"
            local B_TMP="${OUT_DIR}/${NAME}_ngy.tmp"
            local RN_TMP="${OUT_DIR}/${NAME}_ngr.tmp"
            local GN_TMP="${OUT_DIR}/${NAME}_ngg.tmp"
            local BN_TMP="${OUT_DIR}/${NAME}_ngb.tmp"
            local FX_LEN="sqrt((0.5-u[0])*(0.5-u[0])+(0.5-u[1])*(0.5-u[1])+1)"
            $MAGICK_EXE "$HEIGHT_FILE" -define convolve:scale="$NORM_STRENGTH" -bias 50% \
                -convolve '-1,0,1,-2,0,2,-1,0,1' "$A_TMP"
            $MAGICK_EXE "$HEIGHT_FILE" -define convolve:scale="$NORM_STRENGTH" -bias 50% \
                -convolve '-1,-2,-1,0,0,0,1,2,1' "$B_TMP"
            $MAGICK_EXE "$A_TMP" "$B_TMP" -fx "0.5+0.5*(0.5-u[0])/$FX_LEN" "$RN_TMP"
            $MAGICK_EXE "$A_TMP" "$B_TMP" -fx "0.5+0.5*(0.5-u[1])/$FX_LEN" "$GN_TMP"
            $MAGICK_EXE "$A_TMP" "$B_TMP" -fx "0.5+0.5/$FX_LEN" "$BN_TMP"
            $MAGICK_EXE "$RN_TMP" "$GN_TMP" "$BN_TMP" -combine $IM_QUALITY_OPTS "$NORM_FILE"
            rm -f "$A_TMP" "$B_TMP" "$RN_TMP" "$GN_TMP" "$BN_TMP"
        else
            echo "$LOG_PREFIX -> Überspringe Normal (existiert bereits)"
        fi
    fi

    # SPECULAR — ggf. intern für Roughness benötigt
    local SPEC_FILE="${OUT_BASE}_specular.$EXT"
    local SPEC_INTERNAL="${OUT_DIR}/${NAME}_spec_internal.tmp"
    if map_enabled "specular"; then
        if [ "$FORCE_OVERWRITE" = true ] || ! has_existing "$OUT_BASE" "$EXT" "_specular" "_spec"; then
            echo "$LOG_PREFIX -> Specular"
            $MAGICK_EXE "$HEIGHT_FILE" -sigmoidal-contrast $SPEC_CONTRAST $IM_QUALITY_OPTS "$SPEC_FILE"
        else
            echo "$LOG_PREFIX -> Überspringe Specular (existiert bereits)"
        fi
    elif map_enabled "roughness" && [ ! -f "$SPEC_FILE" ] && [ ! -f "${OUT_BASE}_spec.$EXT" ]; then
        # Roughness braucht Specular intern — als temp erzeugen
        $MAGICK_EXE "$HEIGHT_FILE" -sigmoidal-contrast $SPEC_CONTRAST "$SPEC_INTERNAL"
        SPEC_FILE="$SPEC_INTERNAL"
    fi

    # ROUGHNESS
    if map_enabled "roughness"; then
        local ROUGH_FILE="${OUT_BASE}_roughness.$EXT"
        if [ "$FORCE_OVERWRITE" = true ] || ! has_existing "$OUT_BASE" "$EXT" "_roughness"; then
            echo "$LOG_PREFIX -> Roughness"
            local ACTUAL_SPEC=""
            if [ -f "$SPEC_FILE" ]; then
                ACTUAL_SPEC="$SPEC_FILE"
            elif [ -f "${OUT_BASE}_spec.$EXT" ]; then
                ACTUAL_SPEC="${OUT_BASE}_spec.$EXT"
            fi

            if [ -n "$ACTUAL_SPEC" ]; then
                # Engine-semantik (generateRoughnessMap): rough = (1 - spec)^(1/gamma)
                local ROUGH_EXP
                ROUGH_EXP=$(awk -v g="$ROUGH_GAMMA" 'BEGIN{printf "%.4f", 1.0/g}')
                $MAGICK_EXE "$ACTUAL_SPEC" -negate -gamma "$ROUGH_EXP" $IM_QUALITY_OPTS "$ROUGH_FILE"
            else
                echo "$LOG_PREFIX Warnung: Konnte Specular-Map für Roughness nicht finden!"
            fi
        else
            echo "$LOG_PREFIX -> Überspringe Roughness (existiert bereits)"
        fi
    fi

    # AMBIENT OCCLUSION
    if map_enabled "ao"; then
        local AO_FILE="${OUT_BASE}_ambient.$EXT"
        if [ "$FORCE_OVERWRITE" = true ] || ! has_existing "$OUT_BASE" "$EXT" "_ambient" "_ao"; then
            echo "$LOG_PREFIX -> Ambient Occlusion"
            # AO = weicher Basis-Schatten (geblurte Hoehe) mit AO_LEVEL-Basisshift, abgedunkelt durch
            # feine Vertiefungs-Detektion (Tal-Signal aus der Hoehe, skaliert mit AO_FINE).
            # Kein -negate/-threshold mehr (das kollabierte auf fast-schwarz); entspricht generateAOMap()
            # in TextureFilters.ts. Niedriges AO_LEVEL = dunkler/staerker, hohes = heller/flacher.
            local AO_BASE="${OUT_DIR}/${NAME}_ao_base.tmp"
            local AO_VALLEY="${OUT_DIR}/${NAME}_ao_valley.tmp"
            $MAGICK_EXE "$HEIGHT_FILE" -blur "$AO_SOFT_BLUR" -evaluate add "$AO_LEVEL" "$AO_BASE"
            $MAGICK_EXE "$HEIGHT_FILE" \
                -convolve '0,0.25,0,0.25,-1,0.25,0,0.25,0' -evaluate multiply "$AO_FINE" \
                -negate "$AO_VALLEY"
            $MAGICK_EXE "$AO_BASE" "$AO_VALLEY" -compose multiply -composite \
                -clamp $IM_QUALITY_OPTS "$AO_FILE"
            rm -f "$AO_BASE" "$AO_VALLEY"
        else
            echo "$LOG_PREFIX -> Überspringe Ambient Occlusion (existiert bereits)"
        fi
    fi

    # EDGE MAP
    if map_enabled "edge"; then
        local EDGE_FILE="${OUT_BASE}_edge.$EXT"
        if [ "$FORCE_OVERWRITE" = true ] || ! has_existing "$OUT_BASE" "$EXT" "_edge"; then
            echo "$LOG_PREFIX -> Edge"
            $MAGICK_EXE "$HEIGHT_FILE" -edge 1 -negate -threshold "$EDGE_THRESHOLD" $IM_QUALITY_OPTS "$EDGE_FILE"
        else
            echo "$LOG_PREFIX -> Überspringe Edge (existiert bereits)"
        fi
    fi

    [ "$KEEP_TEMP_FILES" = false ] && rm -f "$OUT_DIR"/*.tmp
}

run_pipeline() {
    local IN_PATH="$1"
    local OUT_PATH="$2"

    # Lade Profil-Parameter
    local CONF="$PROFILE_DIR/${SELECTED_PROFILE}.conf"
    if [ -f "$CONF" ]; then
        source "$CONF"
        echo "$LOG_PREFIX Profil '$SELECTED_PROFILE' aktiv."
    else
        echo "$LOG_PREFIX Profil '$SELECTED_PROFILE' nicht gefunden. Nutze Defaults."
        source "$PROFILE_DIR/default.conf" 2>/dev/null
    fi

    # Wende manuelle Overrides an
    if [ ${#OVERRIDES[@]} -gt 0 ]; then
        echo "$LOG_PREFIX Wende manuelle Parameter-Overrides an..."
        for ov in "${OVERRIDES[@]}"; do
            local KEY="${ov%%=*}"
            local VAL="${ov#*=}"
            # Nur gültige Shell-Variablennamen akzeptieren, dann ohne eval setzen --
            # ein ungeprüftes eval führte sonst $(...) im Wert aus oder überschrieb globale Variablen.
            if [[ "$KEY" =~ ^[A-Z_]+$ ]]; then
                printf -v "$KEY" '%s' "$VAL"
                echo "$LOG_PREFIX  -> $KEY = $VAL"
            else
                echo "$LOG_PREFIX  -> Überspringe ungültigen Parameter '$KEY' (erlaubt: [A-Z_])"
            fi
        done
    fi

    # Maps-Liste normalisieren
    MAPS=$(echo "$MAPS" | tr -d ' ' | tr '[:upper:]' '[:lower:]')
    echo "$LOG_PREFIX Maps: $MAPS"

    shopt -s nullglob nocaseglob nocasematch

    if [ -d "$IN_PATH" ]; then
        local TARGET="${OUT_PATH:-$IN_PATH/$EXPORT_SUBFOLDER}"
        mkdir -p "$TARGET"
        for f in "$IN_PATH"/*.{jpg,jpeg,png,bmp,tga,gif,tiff,tif,webp,exr}; do
            [ -e "$f" ] || continue
            if [[ "$f" =~ _(height|disp|displacement|normal|spec|specular|roughness|ao|ambient|edge)\. ]]; then
                echo "$LOG_PREFIX Überspringe generierte Map als Input: $(basename "$f")"
                continue
            fi
            process_file "$f" "$TARGET"
        done
    elif [ -f "$IN_PATH" ]; then
        local TARGET="${OUT_PATH:-$(dirname "$IN_PATH")}"
        mkdir -p "$TARGET"
        process_file "$IN_PATH" "$TARGET"
    else
        echo "Fehler: Ungültiger Input-Pfad: $IN_PATH"
        return 1
    fi
}

# --- 3. LOGIK ---

# --help/-h muss ohne vorhandene Dependencies (ImageMagick etc.) funktionieren
for arg in "$@"; do
    case $arg in
        --help|-h) usage ;;
    esac
done

check_deps

INPUT=""
OUT_ARG=""
FORCE_OVERWRITE=false
OUT_FORMAT=""
COMPRESSION_QUALITY=""
RESIZE_VAL=""
NO_COPY=false
MAPS="height,displacement,normal,specular,roughness,ao,edge"
JSON_INPUT=""
declare -a OVERRIDES=()

while [[ "$#" -gt 0 ]]; do
    case $1 in
        --json)           JSON_INPUT="$2"; shift ;;
        --config)         JSON_INPUT="@$2"; shift ;;
        --in)             INPUT="$2"; shift ;;
        --out)            OUT_ARG="$2"; shift ;;
        --profile)        SELECTED_PROFILE="$2"; shift ;;
        --force)          FORCE_OVERWRITE=true ;;
        --out-format)     OUT_FORMAT="$2"; shift ;;
        --quality)        COMPRESSION_QUALITY="$2"; shift ;;
        --resize)         RESIZE_VAL="$2"; shift ;;
        --no-copy)        NO_COPY=true ;;
        --keep-temp)      KEEP_TEMP_FILES=true ;;
        --maps)           MAPS="$2"; shift ;;
        --set)            OVERRIDES+=("$2"); shift ;;
        # Named shortcuts für alle Profil-Parameter
        --norm-strength)  OVERRIDES+=("NORM_STRENGTH=$2"); shift ;;
        --height-blur)    OVERRIDES+=("HEIGHT_BLUR=$2"); shift ;;
        --disp-blur)      OVERRIDES+=("DISP_BLUR=$2"); shift ;;
        --spec-contrast)  OVERRIDES+=("SPEC_CONTRAST=$2"); shift ;;
        --rough-gamma)    OVERRIDES+=("ROUGH_GAMMA=$2"); shift ;;
        --ao-blur)        OVERRIDES+=("AO_SOFT_BLUR=$2"); shift ;;
        --ao-fine)        OVERRIDES+=("AO_FINE=$2"); shift ;;
        --ao-level)       OVERRIDES+=("AO_LEVEL=$2"); shift ;;
        --edge-threshold) OVERRIDES+=("EDGE_THRESHOLD=$2"); shift ;;
        --help|-h)        usage ;;
        *) echo "Unbekannter Parameter: $1"; echo "Nutze --help für Hilfe."; exit 1 ;;
    esac
    shift
done

# Wenn JSON übergeben wurde: parse via Python3 und führe Job(s) aus
if [ -n "$JSON_INPUT" ]; then
    # JSON über Env-Variable übergeben statt in Python-Quelltext einzusetzen —
    # ein ''' (oder US-ASCII-Sonderzeichen) im JSON wäre sonst Python-Injection.
    PBR_JSON_INPUT="$JSON_INPUT" python3 -c "
import sys, json, os, subprocess

raw = os.environ['PBR_JSON_INPUT']
if raw.startswith('@'):
    with open(raw[1:], 'r') as f:
        data = json.load(f)
else:
    data = json.loads(raw)

jobs = data.get('jobs', [data]) if isinstance(data, dict) else data

script = sys.argv[1]
for job in jobs:
    cmd = [script]
    if 'in' in job:
        cmd.extend(['--in', str(job['in'])])
    if 'out' in job:
        cmd.extend(['--out', str(job['out'])])
    if 'profile' in job:
        cmd.extend(['--profile', str(job['profile'])])
    if job.get('force'):
        cmd.append('--force')
    if job.get('noCopy'):
        cmd.append('--no-copy')
    if job.get('keepTemp'):
        cmd.append('--keep-temp')
    if 'outFormat' in job or 'out_format' in job:
        cmd.extend(['--out-format', str(job.get('outFormat') or job.get('out_format'))])
    if 'quality' in job:
        cmd.extend(['--quality', str(job['quality'])])
    if 'resize' in job:
        cmd.extend(['--resize', str(job['resize'])])
    if 'maps' in job:
        m = job['maps']
        if isinstance(m, list):
            m = ','.join(m)
        cmd.extend(['--maps', str(m)])
    params = job.get('params', job.get('overrides', {}))
    for k, v in params.items():
        cmd.extend(['--set', f'{k}={v}'])
    
    # Execute job
    print(f'[PBR-JSON] Launching job: {job.get(\"in\", \"<no input>\")}')
    res = subprocess.run(cmd)
    if res.returncode != 0:
        sys.exit(res.returncode)
" "$0"
    exit $?
fi

# Reguläre CLI-Ausführung
if [ -z "$INPUT" ]; then
    echo "Fehler: Kein Input angegeben. Nutze --in [Datei/Ordner] oder --json [...] oder --help"
    exit 1
fi

run_pipeline "$INPUT" "$OUT_ARG"
echo "$LOG_PREFIX Fertig."