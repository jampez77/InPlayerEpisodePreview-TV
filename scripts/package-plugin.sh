#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
project_dir="$repo_dir/Namo.Plugin.InPlayerEpisodePreview"
jellyfin_version="${1:-10.11.0}"
base_version="$(sed -n 's/.*<PluginVersion>\([^<]*\)<\/PluginVersion>.*/\1/p' "$project_dir/Namo.Plugin.InPlayerEpisodePreview.csproj")"
case "$jellyfin_version" in
    10.10.7) framework=net8.0; plugin_version="$base_version.1" ;;
    10.11.*) framework=net9.0; plugin_version="$base_version.2" ;;
    12.*) framework=net10.0; plugin_version="$base_version.3" ;;
    *) echo "Supported Jellyfin targets: 10.10.7, 10.11.x, 12.x" >&2; exit 1 ;;
esac

cd "$project_dir"
npm ci
npm run typecheck
npm test
npm run build
dotnet build Namo.Plugin.InPlayerEpisodePreview.csproj --configuration Release --nologo \
    -p:JellyfinVersion="$jellyfin_version" -p:PluginVersion="$plugin_version"

mkdir -p "$repo_dir/dist"
archive="$repo_dir/dist/InPlayerEpisodePreview_${plugin_version}-${jellyfin_version}.zip"
python3 - "$project_dir/bin/Release/$framework/Namo.Plugin.InPlayerEpisodePreview.dll" "$archive" <<'PY'
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import sys
assembly, output = map(Path, sys.argv[1:])
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    archive.write(assembly, assembly.name)
print(f'Packaged {output}')
PY
