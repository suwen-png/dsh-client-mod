# ============================================================================
# RETIRED 2026-09-12  (T-PLUG-008)
# ----------------------------------------------------------------------------
# This script is DEAD. It has been replaced by:
#
#     node dsh-director-plugin/scripts/plugin-install.mjs --apply
#
# Why it was retired -- two defects, both confirmed by inspection:
#
#   1. WRONG PATHS (pointed at the abandoned pre-plugin layout)
#        $PluginDir = ~/.dsh/profiles/web/node_modules/dsh-director/lib
#        $SourceDir = D:\hermes-data\dsh-director
#      Neither exists any more. The plugin now installs to THREE points
#      (host node_modules package + profile junction + user patch layer),
#      which this old one-file copy could never satisfy.
#
#   2. DESTRUCTIVE CACHE CLEAR
#      Its cache list included "Network", which must be PRESERVED
#      (it holds session/network state). Only these are safe to clear:
#        Cache / Code Cache / GPUCache / DawnGraphiteCache / DawnWebGPUCache
#
# The replacement tool is strictly better: default read-only, idempotent,
# read-back verification after every write, surgical uninstall, and it
# never deletes anything outside its own three install points.
#
# Usage now:
#   node dsh-director-plugin/scripts/plugin-install.mjs            # check only
#   node dsh-director-plugin/scripts/plugin-install.mjs --apply    # install
#   node dsh-director-plugin/scripts/plugin-install.mjs --uninstall
#   node dsh-director-plugin/scripts/verify-install-clean.mjs      # acceptance
#
# See dsh-director-plugin/INSTALL.md for the full guide.
# ============================================================================

Write-Host ""
Write-Host "======================================================================" -ForegroundColor Red
Write-Host " RETIRED: scripts/deploy.ps1 is no longer functional." -ForegroundColor Red
Write-Host "======================================================================" -ForegroundColor Red
Write-Host ""
Write-Host " It pointed at abandoned paths and cleared the 'Network' cache." -ForegroundColor Yellow
Write-Host ""
Write-Host " Use instead:" -ForegroundColor Cyan
Write-Host "   node dsh-director-plugin/scripts/plugin-install.mjs" -ForegroundColor White
Write-Host "   node dsh-director-plugin/scripts/plugin-install.mjs --apply" -ForegroundColor White
Write-Host ""
Write-Host " Full guide: dsh-director-plugin/INSTALL.md" -ForegroundColor Cyan
Write-Host ""

exit 1
